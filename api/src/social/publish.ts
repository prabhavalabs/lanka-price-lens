import { dispatchOutbox, message, type ChannelRegistry, type Message, type OutboxStore } from "@lanka-pricelens/notify";

import { postUrl, type Platform, type SocialStore } from "./accounts.ts";
import type { ContentItem, LibraryStore, ScheduleRow } from "./library.ts";

/**
 * Sending a post from the library (docs/distribution.md). The schedule row is the record the
 * owner sees, the outbox is what actually delivers, and this keeps the two in step: the row is
 * marked queued before the send, and published or failed by what came back.
 *
 * One schedule is one post to one platform. It is enqueued with a key built from its own id, so
 * a tick that runs twice over the same row cannot put the post out twice.
 */

export const contentTargetId = "content-library";

export type PublishDeps = {
  accounts: SocialStore;
  content: LibraryStore;
  outbox: OutboxStore;
  channels: () => ChannelRegistry;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

export type PublishOutcome = { ok: true; schedule: ScheduleRow; url: string | null } | { ok: false; schedule: ScheduleRow | null; error: string; status: 409 | 502 };

/**
 * The post as a channel will see it. The caption is carried whole in the title so nothing is
 * reworded on the way out: what the owner wrote in the library is what the platform shows. The
 * link is offered as an action, which Facebook previews and Instagram names in words.
 */
export function contentMessage(item: ContentItem, dedupeKey: string): Message {
  const [first, ...rest] = item.assets;
  const caption = item.caption.trim() || item.title;
  return message({
    title: caption,
    ...(item.link ? { actions: [{ label: "Read more", url: item.link }] } : {}),
    ...(first ? { image: { url: first.url, alt: item.title } } : {}),
    ...(rest.length ? { images: item.assets.map((asset) => ({ url: asset.url, alt: item.title })) } : {}),
    tags: item.tags,
    dedupe_key: dedupeKey,
  });
}

/** What stands between a post and the platform, said plainly enough to show in the admin. */
export function publishBlocker(accounts: SocialStore, platform: Platform, item: ContentItem): string | null {
  const account = accounts.active(platform);
  const named = platform === "facebook" ? "a Facebook Page" : "an Instagram account";
  if (!account) return `Connect ${named} first`;
  if (account.token_status !== "ok") return `${account.name} needs connecting again`;
  if (!account.can_post) return `This account cannot post to ${account.name}`;
  if (platform === "instagram" && !item.assets.length) return "Instagram takes no post without a picture";
  return null;
}

/** Sends one schedule now. Used by the tick and by "Post now" in the admin, which share the record they leave. */
export async function publishSchedule(deps: PublishDeps, schedule: ScheduleRow, item: ContentItem): Promise<PublishOutcome> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)));
  const platform = schedule.platform;
  const blocker = publishBlocker(deps.accounts, platform, item);
  if (blocker) {
    deps.content.markSchedule(schedule.id, { status: "failed", error: blocker }, now());
    return { ok: false, schedule: { ...schedule, status: "failed", error: blocker }, error: blocker, status: 409 };
  }
  const account = deps.accounts.active(platform) as NonNullable<ReturnType<SocialStore["active"]>>;
  const stamp = now();
  const dedupeKey = `content:${schedule.id}`;
  deps.content.markSchedule(schedule.id, { status: "queued", error: null }, stamp);
  deps.outbox.enqueue([{ targetId: contentTargetId, target: { kind: platform, address: account.account_id }, message: contentMessage(item, dedupeKey), dedupeKey }], stamp);

  // What became of this one entry is read from the dispatch itself rather than from the outbox
  // afterwards, so the outcome does not depend on which outbox the application happens to use.
  let outcome: { id: string; reference: string | null } | { id: string; error: string } | null = null;
  const report = await dispatchOutbox(deps.outbox, deps.channels(), {
    now,
    only: platform,
    onGone: (entry, error) => deps.accounts.markToken(platform, entry.target.address, { valid: false, error }, now()),
    onEvent: (event) => {
      if (event.entry.dedupeKey !== dedupeKey) return;
      outcome = event.type === "sent" ? { id: event.entry.id, reference: event.reference } : { id: event.entry.id, error: event.error };
    },
  });

  const settled = outcome as { id: string; reference: string | null } | { id: string; error: string } | null;
  if (settled && !("error" in settled)) {
    const url = settled.reference ? postUrl(platform, settled.reference) : null;
    const publishedAt = now().toISOString();
    deps.content.markSchedule(schedule.id, { status: "published", outboxId: settled.id, postUrl: url, error: null, publishedAt }, now());
    log({ level: "info", message: "Content published", platform, schedule: schedule.id, report });
    return { ok: true, schedule: { ...schedule, status: "published", post_url: url, published_at: publishedAt }, url };
  }
  // A post the owner asked for is not retried behind their back an hour later: it went now or it did not.
  const error = settled?.error ?? "The platform did not take the post";
  if (settled) deps.outbox.markDead(settled.id, error, now());
  deps.content.markSchedule(schedule.id, { status: "failed", outboxId: settled?.id ?? null, error }, now());
  log({ level: "error", message: "Content not published", platform, schedule: schedule.id, detail: error });
  return { ok: false, schedule: { ...schedule, status: "failed", error }, error, status: 502 };
}

export type TickReport = { due: number; published: number; failed: number };

/**
 * Publishes everything whose moment has come. Called on a timer by the application and by the
 * admin's "Run now"; a schedule whose platform is not connected fails with that as its reason,
 * so the calendar says why rather than leaving the row waiting for ever.
 */
export async function runDueSchedules(deps: PublishDeps, limit = 10): Promise<TickReport> {
  const now = deps.now ?? (() => new Date());
  const due = deps.content.due(now(), limit);
  const report: TickReport = { due: due.length, published: 0, failed: 0 };
  for (const row of due) {
    const { item, ...schedule } = row;
    const outcome = await publishSchedule(deps, schedule, item);
    if (outcome.ok) report.published += 1;
    else report.failed += 1;
  }
  return report;
}
