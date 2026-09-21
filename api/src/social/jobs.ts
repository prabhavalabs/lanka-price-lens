import type { DealsDay } from "@lanka-pricelens/foundry/deals";
import type { Message, OutboxStore } from "@lanka-pricelens/notify";

import type { DealsAccess } from "../newsletters/deals.ts";
import type { NewsletterKind } from "../newsletters/store.ts";
import { colomboDay } from "../newsletters/time.ts";
import type { SocialStore } from "./accounts.ts";
import { facebookDealsPost } from "./post.ts";
import { cronMatches, previousRun } from "./recurrence.ts";
import type { ChannelJobSchedule, SettingChannel, SettingsStore } from "./settings.ts";

/**
 * Running what the channels are set to send (docs/distribution.md).
 *
 * Each channel holds jobs of its own and each job its own recurrence, so the deals mail can go at
 * half past seven while the Page's post waits for nine and the digest goes hourly. A job is asked
 * to run when its expression matches the minute and both its own switch and its channel's are on.
 *
 * Every job is idempotent within its day: a mail run is guarded by the newsletter's own run
 * record, and a post carries a dedupe key the outbox honours. That is what makes a retry safe,
 * and it is why a job can be run by hand from the admin without a second post going out.
 */

export type JobOutcome = { status: "ran" | "failed" | "skipped"; detail: string };

export type JobRunners = {
  /** The daily mails; the newsletter service keeps its own record of the day. */
  newsletter?: ((kind: NewsletterKind, day: string) => Promise<JobOutcome>) | undefined;
  deals: DealsAccess;
  outbox: OutboxStore;
  accounts: SocialStore;
  siteOrigin: string;
  /** The public Telegram channel's address, when one is configured. */
  telegramChannel?: string | null | undefined;
  /** The digest as the Telegram channel gets it; the composer lives with the newsletters. */
  telegramDigest?: ((day: DealsDay, siteOrigin: string) => Message | null) | undefined;
  now?: (() => Date) | undefined;
};

const newsletterJobs: Record<string, NewsletterKind> = { deals_daily: "deals_daily", recipes_daily: "recipes_daily", price_alerts: "price_alerts" };

/** The day's deals, computed when the day has none saved yet. */
async function dealsFor(deps: JobRunners, day: string): Promise<DealsDay | null> {
  return deps.deals.read(day) ?? (await deps.deals.compute(day));
}

/** Posts the day's card and caption to one platform, through the outbox that holds the dedupe key. */
async function postDeals(deps: JobRunners, platform: "facebook" | "instagram", day: string): Promise<JobOutcome> {
  const account = deps.accounts.active(platform);
  if (!account) return { status: "skipped", detail: `No ${platform} account is connected` };
  if (account.paused) return { status: "skipped", detail: "The account's daily post is paused" };
  if (!account.can_post || account.token_status !== "ok") return { status: "failed", detail: "The account cannot post: reconnect it" };
  const dealsDay = await dealsFor(deps, day);
  if (!dealsDay) return { status: "failed", detail: "The deals for the day are not available" };
  const post = facebookDealsPost(dealsDay, deps.siteOrigin, { dedupeKey: `${platform}:deals_daily:${dealsDay.day}` });
  if (!post) return { status: "skipped", detail: "The day has too few deals for a post" };
  const queued = deps.outbox.enqueue([{ targetId: `${platform}-account`, target: { kind: platform, address: account.account_id }, message: post, dedupeKey: post.dedupe_key ?? null }], (deps.now ?? (() => new Date()))());
  return queued.queued ? { status: "ran", detail: `Queued for ${account.name}` } : { status: "skipped", detail: "The day already has its post" };
}

/** The digest to the public Telegram channel. Readers who linked a chat are served by the mail run. */
async function postDigest(deps: JobRunners, day: string): Promise<JobOutcome> {
  if (!deps.telegramChannel || !deps.telegramDigest) return { status: "skipped", detail: "No Telegram channel is configured" };
  const dealsDay = await dealsFor(deps, day);
  if (!dealsDay) return { status: "failed", detail: "The deals for the day are not available" };
  const post = deps.telegramDigest(dealsDay, deps.siteOrigin);
  if (!post) return { status: "skipped", detail: "The day has too little to say" };
  const queued = deps.outbox.enqueue([{ targetId: "telegram-channel", target: { kind: "telegram", address: deps.telegramChannel }, message: post, dedupeKey: post.dedupe_key ?? null }], (deps.now ?? (() => new Date()))());
  return queued.queued ? { status: "ran", detail: "Queued for the channel" } : { status: "skipped", detail: "The day already has its digest" };
}

/** Runs one job now, whatever its recurrence says; the admin's "Run now" and the tick share this. */
export async function runChannelJob(channel: SettingChannel, job: string, deps: JobRunners, day = colomboDay((deps.now ?? (() => new Date()))())): Promise<JobOutcome> {
  const kind = newsletterJobs[job];
  if (channel === "email" && kind) {
    if (!deps.newsletter) return { status: "failed", detail: "Mail is not configured" };
    return deps.newsletter(kind, day);
  }
  if (job === "deals_post" && (channel === "facebook" || channel === "instagram")) return postDeals(deps, channel, day);
  if (channel === "telegram" && job === "deals_digest") return postDigest(deps, day);
  return { status: "failed", detail: `No runner for ${channel}/${job}` };
}

/** How long after a failure a job is tried again, whatever its recurrence says. */
export const retryAfterMs = 30 * 60_000;
/**
 * How late a missed run may still go out. A minute the server spent restarting is a minute its
 * jobs did not get, and a mail an hour late is worth having; one that turns up at midnight is not.
 */
export const catchUpMs = 2 * 60 * 60_000;

/**
 * Whether a job runs at this minute.
 *
 * Its expression matches, or the minute it should have run passed while nobody was listening — a
 * deploy, a restart, a machine asleep — and that minute is recent enough to be worth serving now.
 * A job that has never run is not caught up: the first one waits for its own minute, so a deploy
 * does not send a morning's mail in the evening. A failure is retried off its own clock.
 *
 * A job that already ran inside this minute never runs twice, which keeps a slow tick from
 * doubling a post.
 */
export function jobIsDue(schedule: ChannelJobSchedule, now: Date, zone?: string): boolean {
  const last = schedule.last_run_at ? Date.parse(schedule.last_run_at) : Number.NaN;
  if (Number.isFinite(last) && now.getTime() - last < 60_000) return false;
  if (cronMatches(schedule.cron, now, zone)) return true;
  if (!Number.isFinite(last)) return false;
  const missed = previousRun(schedule.cron, now, Math.ceil(catchUpMs / 60_000), zone);
  if (missed && missed.getTime() > last && now.getTime() - missed.getTime() <= catchUpMs) return true;
  return schedule.last_status === "failed" && now.getTime() - last >= retryAfterMs;
}

export type DueJob = { channel: SettingChannel; job: string; label: string };

/** Every job that should run at this minute, in the order the catalogue lists them. */
export function dueJobs(settings: SettingsStore, now: Date, zone?: string): DueJob[] {
  const channels = new Map(settings.all().map((channel) => [channel.channel, channel.enabled]));
  return settings
    .jobs()
    .filter((schedule) => schedule.enabled && channels.get(schedule.channel) !== false && jobIsDue(schedule, now, zone))
    .map((schedule) => ({ channel: schedule.channel, job: schedule.job, label: schedule.label }));
}
