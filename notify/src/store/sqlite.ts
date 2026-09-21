import { randomUUID } from "node:crypto";

import { isChannelKind, type Target } from "../channel.ts";
import { messageSchema, type Message } from "../message.ts";
import type { OutboxEntry, OutboxStatus, OutboxStore } from "../outbox.ts";

/**
 * The outbox on a SQLite handle with better-sqlite3's synchronous shape (prepare, run, get,
 * all, exec). The application runs `outboxSchema` in its own migrations; the store never
 * creates tables on its own.
 */

export type SqliteLike = {
  prepare(sql: string): { run(...params: unknown[]): { changes: number }; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  exec(sql: string): unknown;
};

export const outboxSchema = `
  CREATE TABLE IF NOT EXISTS notify_outbox (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    meta_json TEXT,
    message_json TEXT NOT NULL,
    dedupe_key TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    sent_at TEXT,
    reference TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notify_outbox_due_idx ON notify_outbox (status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS notify_outbox_target_idx ON notify_outbox (target_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS notify_outbox_dedupe_idx ON notify_outbox (target_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status <> 'dead';
`;

type Row = {
  id: string;
  target_id: string;
  channel: string;
  address: string;
  meta_json: string | null;
  message_json: string;
  dedupe_key: string | null;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: string;
  sent_at: string | null;
  reference: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function entryOf(row: Row): OutboxEntry {
  const kind = isChannelKind(row.channel) ? row.channel : "discord";
  const target: Target = { kind, address: row.address, meta: row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : undefined };
  const parsed = messageSchema.safeParse(JSON.parse(row.message_json));
  const message: Message = parsed.success ? parsed.data : messageSchema.parse({ title: "(unreadable message)" });
  return { id: row.id, targetId: row.target_id, target, message, dedupeKey: row.dedupe_key, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at, sentAt: row.sent_at, reference: row.reference, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createSqliteOutbox(database: SqliteLike): OutboxStore {
  const insert = database.prepare(
    `INSERT INTO notify_outbox (id, target_id, channel, address, meta_json, message_json, dedupe_key, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
  );
  const duplicate = database.prepare("SELECT 1 FROM notify_outbox WHERE target_id = ? AND dedupe_key = ? AND status <> 'dead' LIMIT 1");
  return {
    enqueue: (entries, now) => {
      let queued = 0;
      let duplicates = 0;
      const stamp = now.toISOString();
      for (const entry of entries) {
        const key = entry.dedupeKey ?? entry.message.dedupe_key ?? null;
        if (key && duplicate.get(entry.targetId, key)) {
          duplicates += 1;
          continue;
        }
        insert.run(`outbox_${randomUUID()}`, entry.targetId, entry.target.kind, entry.target.address, entry.target.meta ? JSON.stringify(entry.target.meta) : null, JSON.stringify(entry.message), key, (entry.notBefore ?? now).toISOString(), stamp, stamp);
        queued += 1;
      }
      return { queued, duplicates };
    },
    claimDue: (limit, now, staleAfterMs, only) => {
      const stamp = now.toISOString();
      const stale = new Date(now.getTime() - staleAfterMs).toISOString();
      const rows = database
        .prepare(
          `SELECT * FROM notify_outbox
           WHERE ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND updated_at <= ?)) AND (? IS NULL OR channel = ?)
           ORDER BY next_attempt_at, created_at LIMIT ?`,
        )
        .all(stamp, stale, only ?? null, only ?? null, limit) as Row[];
      const claim = database.prepare("UPDATE notify_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status IN ('queued', 'sending')");
      const claimed: OutboxEntry[] = [];
      for (const row of rows) {
        if (claim.run(stamp, row.id).changes === 1) claimed.push(entryOf({ ...row, status: "sending", updated_at: stamp }));
      }
      return claimed;
    },
    markSent: (id, reference, now) => {
      database.prepare("UPDATE notify_outbox SET status = 'sent', attempts = attempts + 1, reference = ?, sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?").run(reference, now.toISOString(), now.toISOString(), id);
    },
    reschedule: (id, error, nextAttemptAt, now) => {
      database.prepare("UPDATE notify_outbox SET status = 'queued', attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?").run(error.slice(0, 500), nextAttemptAt.toISOString(), now.toISOString(), id);
    },
    markDead: (id, error, now) => {
      database.prepare("UPDATE notify_outbox SET status = 'dead', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?").run(error.slice(0, 500), now.toISOString(), id);
    },
    counts: () => {
      const counts: Record<OutboxStatus, number> = { queued: 0, sending: 0, sent: 0, dead: 0 };
      for (const row of database.prepare("SELECT status, COUNT(*) AS count FROM notify_outbox GROUP BY status").all() as Array<{ status: OutboxStatus; count: number }>) counts[row.status] = row.count;
      return counts;
    },
    recent: (limit) => (database.prepare("SELECT * FROM notify_outbox ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(entryOf),
    purge: (before) => database.prepare("DELETE FROM notify_outbox WHERE status IN ('sent', 'dead') AND updated_at < ?").run(before.toISOString()).changes,
  };
}
