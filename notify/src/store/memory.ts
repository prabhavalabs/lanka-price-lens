import { randomUUID } from "node:crypto";

import type { EnqueueEntry, OutboxEntry, OutboxStatus, OutboxStore } from "../outbox.ts";

/** An outbox that lives in the process: for tests and for applications that need no durability. */
export function createMemoryOutbox(): OutboxStore & { entries: () => OutboxEntry[] } {
  const rows = new Map<string, OutboxEntry>();
  const dedupeSeen = (targetId: string, key: string): boolean => [...rows.values()].some((row) => row.targetId === targetId && row.dedupeKey === key && row.status !== "dead");
  return {
    entries: () => [...rows.values()],
    enqueue: (entries, now) => {
      let queued = 0;
      let duplicates = 0;
      for (const entry of entries) {
        const key = entry.dedupeKey ?? entry.message.dedupe_key ?? null;
        if (key && dedupeSeen(entry.targetId, key)) {
          duplicates += 1;
          continue;
        }
        const stamp = now.toISOString();
        const id = `outbox_${randomUUID()}`;
        rows.set(id, { id, targetId: entry.targetId, target: entry.target, message: entry.message, dedupeKey: key, status: "queued", attempts: 0, nextAttemptAt: (entry.notBefore ?? now).toISOString(), sentAt: null, reference: null, lastError: null, createdAt: stamp, updatedAt: stamp });
        queued += 1;
      }
      return { queued, duplicates };
    },
    claimDue: (limit, now, staleAfterMs, only) => {
      const stamp = now.toISOString();
      const stale = new Date(now.getTime() - staleAfterMs).toISOString();
      const due = [...rows.values()]
        .filter((row) => (row.status === "queued" && row.nextAttemptAt <= stamp) || (row.status === "sending" && row.updatedAt <= stale))
        .filter((row) => !only || row.target.kind === only)
        .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);
      for (const row of due) rows.set(row.id, { ...row, status: "sending", updatedAt: stamp });
      return due.map((row) => ({ ...rows.get(row.id)! }));
    },
    markSent: (id, reference, now) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: "sent", attempts: row.attempts + 1, reference, sentAt: now.toISOString(), updatedAt: now.toISOString(), lastError: null });
    },
    reschedule: (id, error, nextAttemptAt, now) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: "queued", attempts: row.attempts + 1, lastError: error, nextAttemptAt: nextAttemptAt.toISOString(), updatedAt: now.toISOString() });
    },
    markDead: (id, error, now) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: "dead", attempts: row.attempts + 1, lastError: error, updatedAt: now.toISOString() });
    },
    counts: () => {
      const counts: Record<OutboxStatus, number> = { queued: 0, sending: 0, sent: 0, dead: 0 };
      for (const row of rows.values()) counts[row.status] += 1;
      return counts;
    },
    recent: (limit) => [...rows.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit),
    purge: (before) => {
      const cutoff = before.toISOString();
      let removed = 0;
      for (const [id, row] of rows) {
        if ((row.status === "sent" || row.status === "dead") && row.updatedAt < cutoff) {
          rows.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  } satisfies OutboxStore & { entries: () => OutboxEntry[] };
}

