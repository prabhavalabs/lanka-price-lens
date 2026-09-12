import type { Channel, ChannelKind, Target } from "./channel.ts";
import type { Message } from "./message.ts";

/**
 * The outbox holds every message queued for a target until a channel accepts it. Sending is
 * detached from composing: a composer enqueues, a dispatcher (a timer tick, a CLI run) claims
 * what is due and delivers it, retrying with growing waits and giving up after a few tries.
 * Targets that are gone (blocked bot, expired subscription) are reported so the application
 * can disable them.
 */

export type OutboxStatus = "queued" | "sending" | "sent" | "dead";

export type OutboxEntry = {
  id: string;
  /** The application's reference for the target (its subscription row), reported back on delivery and on a dead target. */
  targetId: string;
  target: Target;
  message: Message;
  dedupeKey: string | null;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  reference: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueEntry = { targetId: string; target: Target; message: Message; dedupeKey?: string | null | undefined; notBefore?: Date | undefined };

export type OutboxStore = {
  /** Queues the entries; one with a dedupe key already queued or sent for the same target is dropped and counted as a duplicate. */
  enqueue: (entries: EnqueueEntry[], now: Date) => { queued: number; duplicates: number };
  /** Marks up to `limit` due entries as sending and returns them; entries stuck in sending longer than `staleAfterMs` are claimed again. */
  claimDue: (limit: number, now: Date, staleAfterMs: number) => OutboxEntry[];
  markSent: (id: string, reference: string | null, now: Date) => void;
  reschedule: (id: string, error: string, nextAttemptAt: Date, now: Date) => void;
  markDead: (id: string, error: string, now: Date) => void;
  counts: () => Record<OutboxStatus, number>;
  recent: (limit: number) => OutboxEntry[];
  /** Deletes sent and dead entries updated before `before`; returns how many. */
  purge: (before: Date) => number;
};

export type ChannelRegistry = ReadonlyMap<ChannelKind, Channel>;

export type DispatchEvent =
  | { type: "sent"; entry: OutboxEntry; reference: string | null }
  | { type: "retry"; entry: OutboxEntry; error: string; nextAttemptAt: Date }
  | { type: "dead"; entry: OutboxEntry; error: string; gone: boolean };

export type DispatchOptions = {
  now?: (() => Date) | undefined;
  /** Entries claimed per run. */
  limit?: number | undefined;
  maxAttempts?: number | undefined;
  /** Wait before attempt n+1, indexed by attempts made so far; the last value repeats. */
  backoffMs?: number[] | undefined;
  staleSendingMs?: number | undefined;
  /** Called once per entry whose target is gone, before it is marked dead. */
  onGone?: ((entry: OutboxEntry, error: string) => void | Promise<void>) | undefined;
  onEvent?: ((event: DispatchEvent) => void) | undefined;
  /** Milliseconds to wait between two sends on the same channel (Telegram allows about thirty a second, one per chat per second). */
  pauseMs?: Partial<Record<ChannelKind, number>> | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

export type DispatchReport = { claimed: number; sent: number; retried: number; dead: number };

export const defaultBackoffMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
export const defaultPauseMs: Partial<Record<ChannelKind, number>> = { telegram: 50, discord: 250, slack: 250, email: 100, webpush: 20 };

export async function dispatchOutbox(store: OutboxStore, channels: ChannelRegistry, options: DispatchOptions = {}): Promise<DispatchReport> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 5;
  const backoff = options.backoffMs?.length ? options.backoffMs : defaultBackoffMs;
  const pause = { ...defaultPauseMs, ...options.pauseMs };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = store.claimDue(options.limit ?? 200, now(), options.staleSendingMs ?? 10 * 60_000);
  const report: DispatchReport = { claimed: entries.length, sent: 0, retried: 0, dead: 0 };
  let lastKind: ChannelKind | null = null;
  for (const entry of entries) {
    const channel = channels.get(entry.target.kind);
    const attempt = entry.attempts + 1;
    if (!channel) {
      const error = `CHANNEL_UNAVAILABLE: ${entry.target.kind} is not configured`;
      store.markDead(entry.id, error, now());
      report.dead += 1;
      options.onEvent?.({ type: "dead", entry, error, gone: false });
      continue;
    }
    if (lastKind === channel.kind && (pause[channel.kind] ?? 0) > 0) await sleep(pause[channel.kind] ?? 0);
    lastKind = channel.kind;
    let delivery: Awaited<ReturnType<Channel["send"]>>;
    try {
      delivery = await channel.send(entry.target, entry.message);
    } catch (error) {
      delivery = { ok: false, error: `CHANNEL_THREW: ${error instanceof Error ? error.message : String(error)}`, retryable: true, gone: false };
    }
    const stamp = now();
    if (delivery.ok) {
      store.markSent(entry.id, delivery.reference, stamp);
      report.sent += 1;
      options.onEvent?.({ type: "sent", entry, reference: delivery.reference });
      continue;
    }
    if (delivery.gone) await options.onGone?.(entry, delivery.error);
    if (!delivery.gone && delivery.retryable && attempt < maxAttempts) {
      const wait = delivery.retryAfterMs ?? backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 60_000;
      const nextAttemptAt = new Date(stamp.getTime() + wait);
      store.reschedule(entry.id, delivery.error, nextAttemptAt, stamp);
      report.retried += 1;
      options.onEvent?.({ type: "retry", entry, error: delivery.error, nextAttemptAt });
      continue;
    }
    store.markDead(entry.id, delivery.error, stamp);
    report.dead += 1;
    options.onEvent?.({ type: "dead", entry, error: delivery.error, gone: delivery.gone });
  }
  return report;
}
