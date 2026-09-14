import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { message, type OutboxStore, type Target } from "@lanka-pricelens/notify";

import type { Account, AccountStore } from "../account/types.ts";
import { renderMail, type TemplateStore } from "../mail/templates.ts";
import type { RecipeIndexEntry } from "../recipe-views.ts";
import { composeDealsMail, type DealsAccess } from "./deals.ts";
import { composeRecipesMail, type CostLookup } from "./recipes.ts";
import { createNewsletterStore, type NewsletterKind, type NewsletterReport, type NewsletterRun, type NewsletterStore } from "./store.ts";
import { addDays, colomboDay, isDay } from "./time.ts";
import { preferenceOf, unsubscribeUrl } from "./unsubscribe.ts";

/**
 * One run of a newsletter kind for a Colombo day: find the recipients, compose and render a
 * mail for each, queue it in the notify outbox (which delivers and retries), and record the
 * run and every delivery. A kind that already has a completed run for the day does not run
 * again unless forced; a dry run composes and counts without queueing anything.
 */

/** How long the "not the same recipe twice" memory reaches back. */
export const exclusionDays = 21;

export type NewsletterDeps = {
  database: OperationalDatabase;
  accounts: AccountStore;
  outbox: OutboxStore;
  /** Edited wording from the admin; the defaults apply without it. */
  templates?: TemplateStore | undefined;
  /** "https://price.prabhavalabs.com": where every link in the mail points. */
  siteOrigin: string;
  /** LPL_ACCOUNT_STATE_SECRET: signs the unsubscribe tokens. */
  secret: string;
  /** The footer's reply address and the mailto: part of List-Unsubscribe; the sender's address. */
  replyTo: string;
  markUrl?: string | undefined;
  recipes?:
    | {
        index: Map<string, RecipeIndexEntry>;
        /** Today's cost per serving, built once per run; null when the warehouse is away. */
        costs?: (() => Promise<CostLookup | null>) | undefined;
      }
    | undefined;
  deals?: DealsAccess | undefined;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

export type RunOptions = {
  /** YYYY-MM-DD in Colombo; today when absent. */
  day?: string | undefined;
  trigger: string;
  dryRun?: boolean | undefined;
  /** Runs even when a completed run exists for the day; the outbox's dedupe still keeps a person from getting the mail twice. */
  force?: boolean | undefined;
};

export type RunOutcome = {
  run: NewsletterRun;
  /** True when an earlier completed run answered instead of a new one. */
  repeated: boolean;
};

export type NewsletterService = {
  runNewsletter: (kind: NewsletterKind, options: RunOptions) => Promise<RunOutcome>;
  listRuns: (kind: NewsletterKind | null, limit: number) => NewsletterRun[];
  latestRun: (kind: NewsletterKind, day: string) => NewsletterRun | undefined;
  store: NewsletterStore;
};

export class NewsletterRunningError extends Error {
  readonly kind: NewsletterKind;
  constructor(kind: NewsletterKind) {
    super(`A ${kind} run is already in progress`);
    this.kind = kind;
  }
}

/** Active accounts with a verified address, mail switched on, and the kind's own switch on. */
export function isRecipient(account: Account, kind: NewsletterKind): boolean {
  return account.status === "active" && account.email_verified_at !== null && account.preferences.notify_email && account.preferences[preferenceOf[kind]];
}

/** Every recipient of the kind, paging through the store. */
export function listRecipients(accounts: AccountStore, kind: NewsletterKind): Account[] {
  const recipients: Account[] = [];
  let page = 1;
  for (;;) {
    const result = accounts.listAccounts({ search: "", status: "active", page, pageSize: 100 });
    for (const account of result.items) if (isRecipient(account, kind)) recipients.push(account);
    if (page >= result.pages || result.items.length === 0) break;
    page += 1;
  }
  return recipients;
}

export function dedupeKeyFor(kind: NewsletterKind, day: string, accountId: string): string {
  return `${kind}:${day}:${accountId}`;
}

/** The headers every newsletter carries: one-click unsubscribe by https and by mail. */
export function listHeaders(unsubscribe: string, replyTo: string, kind: NewsletterKind): Record<string, string> {
  return {
    "List-Unsubscribe": `<mailto:${replyTo}?subject=${encodeURIComponent(`unsubscribe ${kind}`)}>, <${unsubscribe}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function maskAddress(address: string): string {
  const [user = "", domain = ""] = address.split("@");
  return `${user.slice(0, 2)}…@${domain}`;
}

export function createNewsletterService(deps: NewsletterDeps): NewsletterService {
  const store = createNewsletterStore(deps.database);
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.error(JSON.stringify(line)));
  const siteOrigin = deps.siteOrigin.replace(/\/+$/u, "");
  const running = new Set<NewsletterKind>();

  const runNewsletter = async (kind: NewsletterKind, options: RunOptions): Promise<RunOutcome> => {
    const day = options.day ?? colomboDay(clock());
    if (!isDay(day)) throw new Error(`Not a day: ${options.day ?? ""}`);
    const dryRun = options.dryRun === true;
    if (running.has(kind)) throw new NewsletterRunningError(kind);
    if (!dryRun && !options.force) {
      const done = store.latestRun(kind, day);
      if (done && (done.status === "sent" || done.status === "skipped")) return { run: done, repeated: true };
    }
    running.add(kind);
    const run = store.startRun(kind, day, options.trigger, clock());
    const report: NewsletterReport = { dry_run: dryRun, reasons: {}, samples: [] };
    const counts = { recipients: 0, sent: 0, skipped: 0, failed: 0 };
    const skip = (reason: string) => {
      counts.skipped += 1;
      report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
    };
    const finish = (status: NewsletterRun["status"], error: string | null): RunOutcome => ({ run: store.finishRun(run.id, { status, ...counts, error, report }, clock()), repeated: false });
    try {
      const fields = deps.templates?.get(kind).fields;
      const recipients = listRecipients(deps.accounts, kind);
      counts.recipients = recipients.length;

      // What the run composes from: the deals day (computed and saved when missing) or the recipe index with today's costs.
      let dealsDay: Awaited<ReturnType<DealsAccess["compute"]>> = null;
      let cost: CostLookup | null = null;
      if (kind === "deals_daily") {
        if (!deps.deals) return finish("failed", "DEALS_NOT_CONFIGURED");
        dealsDay = deps.deals.read(day) ?? (await deps.deals.compute(day));
        if (!dealsDay) return finish("failed", "DEALS_UNAVAILABLE: the warehouse did not answer");
      } else {
        if (!deps.recipes) return finish("failed", "RECIPES_NOT_CONFIGURED");
        if (recipients.length && deps.recipes.costs) {
          try {
            cost = await deps.recipes.costs();
          } catch (error) {
            log({ level: "warn", message: "Recipe costs unavailable for the newsletter", detail: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      for (const account of recipients) {
        try {
          const unsubscribe = unsubscribeUrl(siteOrigin, deps.secret, account.id, kind);
          let payload: Record<string, unknown>;
          let data;
          if (kind === "deals_daily") {
            const composed = composeDealsMail(account, dealsDay!, { siteOrigin }, unsubscribe);
            if (!composed) {
              skip("nothing_to_say");
              continue;
            }
            payload = { ...composed.summary };
            data = composed.data;
          } else {
            const exclude = store.recentDishIds(account.id, addDays(day, -exclusionDays));
            const composed = composeRecipesMail(account, day, exclude, { index: deps.recipes!.index, siteOrigin, cost }, unsubscribe);
            if (!composed) {
              skip("no_recipes");
              continue;
            }
            payload = { dish_ids: composed.dishIds };
            data = composed.data;
          }
          const rendered = renderMail(kind, data, { fields, markUrl: deps.markUrl, replyTo: deps.replyTo, siteOrigin });
          payload.subject = rendered.subject;
          if (report.samples.length < 5) report.samples.push({ account_id: account.id, email: maskAddress(account.email), subject: rendered.subject });
          if (dryRun) {
            counts.sent += 1;
            continue;
          }
          const dedupeKey = dedupeKeyFor(kind, day, account.id);
          const target: Target = { kind: "email", address: account.email, meta: { subject: rendered.subject, html: rendered.html, text: rendered.text, reply_to: deps.replyTo, headers: listHeaders(unsubscribe, deps.replyTo, kind) } };
          const fallback = message({ title: rendered.subject.slice(0, 200), summary: rendered.text.slice(0, 4000), dedupe_key: dedupeKey, tags: ["newsletter", kind] });
          const queued = deps.outbox.enqueue([{ targetId: account.id, target, message: fallback, dedupeKey }], clock());
          if (queued.queued === 0) {
            skip("duplicate");
            continue;
          }
          store.recordDelivery({ run_id: run.id, kind, day, account_id: account.id, payload, outbox_id: store.outboxIdFor(account.id, dedupeKey) }, clock());
          counts.sent += 1;
        } catch (error) {
          counts.failed += 1;
          report.reasons.error = (report.reasons.error ?? 0) + 1;
          log({ level: "error", message: "Newsletter mail failed", kind, day, account: account.id, detail: error instanceof Error ? error.message : String(error) });
        }
      }
      const nothingToSay = kind === "deals_daily" && recipients.length > 0 && counts.sent === 0 && counts.failed === 0 && (report.reasons.nothing_to_say ?? 0) === recipients.length;
      return finish(dryRun ? "dry_run" : nothingToSay ? "skipped" : "sent", null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log({ level: "error", message: "Newsletter run failed", kind, day, detail });
      return finish("failed", detail.slice(0, 500));
    } finally {
      running.delete(kind);
    }
  };

  return {
    runNewsletter,
    listRuns: store.listRuns,
    latestRun: store.latestRun,
    store,
  };
}
