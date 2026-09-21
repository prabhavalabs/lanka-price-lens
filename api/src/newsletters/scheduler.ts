import { dispatchOutbox, type ChannelRegistry, type DispatchReport, type OutboxEntry, type OutboxStore } from "@lanka-pricelens/notify";

import { dueJobs, runChannelJob, type DueJob, type JobRunners } from "../social/jobs.ts";
import type { SettingsStore } from "../social/settings.ts";
import { colomboDay } from "./time.ts";
import type { NewsletterRunStatus } from "./store.ts";

/**
 * The timer inside the API process: every minute it dispatches the notify outbox, then runs
 * whatever the channels are due to send (api/src/social/jobs.ts). Each channel holds jobs of its
 * own — the deals mail, the recipes mail, the alerts, a platform's post, the Telegram digest —
 * and each job its own recurrence, read from the database at every tick, so a change made in the
 * admin takes effect on the next minute rather than on the next deploy.
 *
 * A tick still going when the next is due is skipped, so two runs never overlap, and a job that
 * failed is tried again after half an hour whatever its recurrence says.
 */

export const defaultNewsletterHour = "07:30";

export type LastRun = { status: NewsletterRunStatus; started_at: string; finished_at: string | null };

export type SchedulerDeps = {
  outbox: OutboxStore;
  channels: ChannelRegistry;
  /** What each channel sends and when; read at every tick, never cached. */
  settings: SettingsStore;
  /** What a due job actually does; the runners for mail, the platforms, and the digest. */
  runners: JobRunners;
  intervalMs?: number | undefined;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
  /** A dead address reported by the outbox; the application may switch the account's mail off. */
  onGone?: ((entry: OutboxEntry, error: string) => void | Promise<void>) | undefined;
  /** Called after every tick with what it did; for tests and the log. */
  onTick?: ((tick: TickReport) => void) | undefined;
};

export type TickReport = { at: string; dispatch: DispatchReport | null; runs: DueJob[]; error: string | null };

/** Starts the timer and returns the function that stops it. The first tick runs straight away. */
export function startNewsletterScheduler(deps: SchedulerDeps): () => void {
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.error(JSON.stringify(line)));
  let ticking = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (ticking || stopped) return;
    ticking = true;
    const report: TickReport = { at: clock().toISOString(), dispatch: null, runs: [], error: null };
    try {
      report.dispatch = await dispatchOutbox(deps.outbox, deps.channels, { now: clock, onGone: deps.onGone });
      for (const due of dueJobs(deps.settings, clock())) {
        if (stopped) break;
        const now = clock();
        const day = colomboDay(now);
        report.runs.push(due);
        // Marked before it runs, so a job that throws is not tried again on the very next minute.
        deps.settings.markJobRun(due.channel, due.job, { status: "ran", error: null }, now);
        try {
          const outcome = await runChannelJob(due.channel, due.job, { ...deps.runners, now: clock }, day);
          deps.settings.markJobRun(due.channel, due.job, { status: outcome.status, error: outcome.status === "ran" ? null : outcome.detail }, clock());
          log({ level: outcome.status === "failed" ? "error" : "info", message: "Channel job", channel: due.channel, job: due.job, day, status: outcome.status, detail: outcome.detail });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          deps.settings.markJobRun(due.channel, due.job, { status: "failed", error: detail }, clock());
          log({ level: "error", message: "Channel job threw", channel: due.channel, job: due.job, day, detail });
        }
      }
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      log({ level: "error", message: "Scheduler tick failed", detail: report.error });
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
