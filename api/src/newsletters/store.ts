import { newId, type OperationalDatabase } from "@lanka-pricelens/foundry/db";

/**
 * What the newsletters keep in the operational SQLite (tables in foundry/src/db.ts): one row
 * per run of a kind for a day, and one row per mail composed in it, with the payload the mail
 * was built from (the dish ids, for the "not the same ones twice in three weeks" rule) and
 * the outbox entry that carries it.
 */

export const newsletterKinds = ["recipes_daily", "deals_daily", "price_alerts"] as const;
export type NewsletterKind = (typeof newsletterKinds)[number];

export function isNewsletterKind(value: unknown): value is NewsletterKind {
  return typeof value === "string" && (newsletterKinds as readonly string[]).includes(value);
}

export type NewsletterRunStatus = "running" | "sent" | "skipped" | "failed" | "dry_run";

/** Why recipients were passed over, counted per reason, and a few examples of what went out. */
export type NewsletterReport = {
  dry_run: boolean;
  reasons: Record<string, number>;
  samples: Array<{ account_id: string; email: string; subject: string }>;
  /** How many linked Telegram chats got the mail as a message. */
  telegram?: number | undefined;
  /** 1 when the day's deals digest was queued for the public Telegram channel. */
  channel_post?: number | undefined;
};

export type NewsletterRun = {
  id: string;
  kind: NewsletterKind;
  day: string;
  trigger: string;
  status: NewsletterRunStatus;
  started_at: string;
  finished_at: string | null;
  recipients: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
  report: NewsletterReport | null;
};

export type NewsletterDelivery = {
  id: string;
  run_id: string;
  kind: NewsletterKind;
  day: string;
  account_id: string;
  payload: Record<string, unknown>;
  outbox_id: string | null;
  created_at: string;
};

export type NewsletterStore = {
  startRun: (kind: NewsletterKind, day: string, trigger: string, now: Date) => NewsletterRun;
  finishRun: (id: string, outcome: { status: NewsletterRunStatus; recipients: number; sent: number; skipped: number; failed: number; error: string | null; report: NewsletterReport | null }, now: Date) => NewsletterRun;
  getRun: (id: string) => NewsletterRun | undefined;
  /** Newest first; every kind when `kind` is null. */
  listRuns: (kind: NewsletterKind | null, limit: number) => NewsletterRun[];
  /** The newest run of the kind for the day that was not a dry run. */
  latestRun: (kind: NewsletterKind, day: string) => NewsletterRun | undefined;
  recordDelivery: (input: { run_id: string; kind: NewsletterKind; day: string; account_id: string; payload: Record<string, unknown>; outbox_id: string | null }, now: Date) => NewsletterDelivery;
  listDeliveries: (runId: string, limit: number) => NewsletterDelivery[];
  /** Every dish id in the account's recipe deliveries on or after `sinceDay`. */
  recentDishIds: (accountId: string, sinceDay: string) => Set<string>;
  /** The outbox entry queued for the target under the dedupe key, when the outbox lives in this database. */
  outboxIdFor: (targetId: string, dedupeKey: string) => string | null;
};

type RunRow = Omit<NewsletterRun, "report"> & { report_json: string | null };
type DeliveryRow = Omit<NewsletterDelivery, "payload"> & { payload_json: string };

function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function runOf(row: RunRow): NewsletterRun {
  const { report_json, ...rest } = row;
  return { ...rest, report: parseJson<NewsletterReport | null>(report_json, null) };
}

function deliveryOf(row: DeliveryRow): NewsletterDelivery {
  const { payload_json, ...rest } = row;
  return { ...rest, payload: parseJson<Record<string, unknown>>(payload_json, {}) };
}

const runColumns = "id, kind, day, trigger, status, started_at, finished_at, recipients, sent, skipped, failed, error, report_json";
const deliveryColumns = "id, run_id, kind, day, account_id, payload_json, outbox_id, created_at";

export function createNewsletterStore(database: OperationalDatabase): NewsletterStore {
  const readRun = (id: string): NewsletterRun | undefined => {
    const row = database.prepare(`SELECT ${runColumns} FROM newsletter_run WHERE id = ?`).get(id) as RunRow | undefined;
    return row ? runOf(row) : undefined;
  };
  return {
    startRun: (kind, day, trigger, now) => {
      const id = newId("nlrun");
      database
        .prepare("INSERT INTO newsletter_run (id, kind, day, trigger, status, started_at, finished_at, recipients, sent, skipped, failed, error, report_json) VALUES (?, ?, ?, ?, 'running', ?, NULL, 0, 0, 0, 0, NULL, NULL)")
        .run(id, kind, day, trigger, now.toISOString());
      return readRun(id)!;
    },
    finishRun: (id, outcome, now) => {
      database
        .prepare("UPDATE newsletter_run SET status = ?, finished_at = ?, recipients = ?, sent = ?, skipped = ?, failed = ?, error = ?, report_json = ? WHERE id = ?")
        .run(outcome.status, now.toISOString(), outcome.recipients, outcome.sent, outcome.skipped, outcome.failed, outcome.error, outcome.report ? JSON.stringify(outcome.report) : null, id);
      const run = readRun(id);
      if (!run) throw new Error(`Newsletter run ${id} not found`);
      return run;
    },
    getRun: readRun,
    listRuns: (kind, limit) => {
      const size = Math.min(200, Math.max(1, Math.floor(limit) || 20));
      const rows = kind
        ? (database.prepare(`SELECT ${runColumns} FROM newsletter_run WHERE kind = ? ORDER BY started_at DESC, id LIMIT ?`).all(kind, size) as RunRow[])
        : (database.prepare(`SELECT ${runColumns} FROM newsletter_run ORDER BY started_at DESC, id LIMIT ?`).all(size) as RunRow[]);
      return rows.map(runOf);
    },
    latestRun: (kind, day) => {
      const row = database.prepare(`SELECT ${runColumns} FROM newsletter_run WHERE kind = ? AND day = ? AND status <> 'dry_run' ORDER BY started_at DESC, id LIMIT 1`).get(kind, day) as RunRow | undefined;
      return row ? runOf(row) : undefined;
    },
    recordDelivery: (input, now) => {
      const id = newId("nldel");
      database
        .prepare("INSERT INTO newsletter_delivery (id, run_id, kind, day, account_id, payload_json, outbox_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.run_id, input.kind, input.day, input.account_id, JSON.stringify(input.payload), input.outbox_id, now.toISOString());
      return deliveryOf(database.prepare(`SELECT ${deliveryColumns} FROM newsletter_delivery WHERE id = ?`).get(id) as DeliveryRow);
    },
    listDeliveries: (runId, limit) => (database.prepare(`SELECT ${deliveryColumns} FROM newsletter_delivery WHERE run_id = ? ORDER BY created_at, id LIMIT ?`).all(runId, Math.min(1000, Math.max(1, Math.floor(limit) || 100))) as DeliveryRow[]).map(deliveryOf),
    recentDishIds: (accountId, sinceDay) => {
      const ids = new Set<string>();
      const rows = database.prepare("SELECT payload_json FROM newsletter_delivery WHERE account_id = ? AND kind = 'recipes_daily' AND day >= ?").all(accountId, sinceDay) as Array<{ payload_json: string }>;
      for (const row of rows) {
        const payload = parseJson<{ dish_ids?: unknown }>(row.payload_json, {});
        if (Array.isArray(payload.dish_ids)) for (const id of payload.dish_ids) if (typeof id === "string") ids.add(id);
      }
      return ids;
    },
    outboxIdFor: (targetId, dedupeKey) => {
      try {
        const row = database.prepare("SELECT id FROM notify_outbox WHERE target_id = ? AND dedupe_key = ? AND status <> 'dead' ORDER BY created_at DESC LIMIT 1").get(targetId, dedupeKey) as { id: string } | undefined;
        return row?.id ?? null;
      } catch {
        return null;
      }
    },
  };
}
