import { dispatchOutbox, type ChannelRegistry, type DispatchReport, type OutboxEntry, type OutboxStore } from "@lanka-pricelens/notify";

import type { NewsletterService } from "./service.ts";
import { newsletterKinds, type NewsletterKind, type NewsletterRunStatus } from "./store.ts";
import { colomboDay, colomboMinutes, parseClock } from "./time.ts";

/**
 * The timer inside the API process: every minute it dispatches the notify outbox, and once
 * the Colombo clock passes the send hour it runs each newsletter kind once for the day. A
 * tick that is still going when the next is due is skipped, so two runs never overlap; a
 * failed run is tried again after half an hour, and a run left "running" by a crash is
 * retried after the same wait.
 */

export const defaultNewsletterHour = "07:30";
/** How long after a failed or abandoned run the scheduler tries the kind again. */
export const retryAfterMs = 30 * 60_000;

export type LastRun = { status: NewsletterRunStatus; started_at: string; finished_at: string | null };

/**
 * Whether a kind should run now: the clock has passed the hour and the day has no completed
 * run; a failed run (or one abandoned mid-way) is retried once enough time has passed.
 */
export function shouldRun(now: Date, hour: string, lastRun: LastRun | null): boolean {
  if (colomboMinutes(now) < parseClock(hour, defaultNewsletterHour)) return false;
  if (!lastRun || lastRun.status === "dry_run") return true;
  if (lastRun.status === "sent" || lastRun.status === "skipped") return false;
  const since = Date.parse(lastRun.finished_at ?? lastRun.started_at);
  return Number.isFinite(since) ? now.getTime() - since >= retryAfterMs : true;
}

export type SchedulerDeps = {
  service: NewsletterService;
  outbox: OutboxStore;
  channels: ChannelRegistry;
  /** LPL_NEWSLETTERS_ENABLED: when false the timer only dispatches the outbox and never starts a run. */
  enabled: boolean;
  /** LPL_NEWSLETTER_HOUR, "07:30" by default. */
  hour?: string | undefined;
  intervalMs?: number | undefined;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
  /** A dead address reported by the outbox; the application may switch the account's mail off. */
  onGone?: ((entry: OutboxEntry, error: string) => void | Promise<void>) | undefined;
  /** Called after every tick with what it did; for tests and the log. */
  onTick?: ((tick: TickReport) => void) | undefined;
};

export type TickReport = { at: string; dispatch: DispatchReport | null; runs: NewsletterKind[]; error: string | null };

/** Starts the timer and returns the function that stops it. The first tick runs straight away. */
export function startNewsletterScheduler(deps: SchedulerDeps): () => void {
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.error(JSON.stringify(line)));
  const hour = deps.hour?.trim() || defaultNewsletterHour;
  let ticking = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (ticking || stopped) return;
    ticking = true;
    const report: TickReport = { at: clock().toISOString(), dispatch: null, runs: [], error: null };
    try {
      report.dispatch = await dispatchOutbox(deps.outbox, deps.channels, { now: clock, onGone: deps.onGone });
      if (deps.enabled) {
        for (const kind of newsletterKinds) {
          if (stopped) break;
          const now = clock();
          const day = colomboDay(now);
          if (!shouldRun(now, hour, deps.service.latestRun(kind, day) ?? null)) continue;
          report.runs.push(kind);
          const outcome = await deps.service.runNewsletter(kind, { day, trigger: "scheduled" });
          log({ level: outcome.run.status === "failed" ? "error" : "info", message: "Newsletter run", kind, day, status: outcome.run.status, recipients: outcome.run.recipients, sent: outcome.run.sent, skipped: outcome.run.skipped, failed: outcome.run.failed, error: outcome.run.error });
        }
      }
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      log({ level: "error", message: "Newsletter scheduler tick failed", detail: report.error });
    } finally {
      ticking = false;
      deps.onTick?.(report);
    }
  };

  const timer = setInterval(() => void tick(), deps.intervalMs ?? 60_000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
