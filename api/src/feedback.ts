import { newId, type OperationalDatabase } from "@lanka-pricelens/foundry/db";

/**
 * Feedback and bug reports from the public site. Anyone may send one (no account), so the
 * route validates strictly, keeps a per-address budget, and ignores submissions that fill the
 * honeypot field. The owner works through them in the admin: new, seen, done.
 */

export type FeedbackKind = "feedback" | "bug";
export type FeedbackStatus = "new" | "seen" | "done";

export type FeedbackItem = {
  id: string;
  kind: FeedbackKind;
  message: string;
  email: string | null;
  page: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
};

export type FeedbackInput = { kind: FeedbackKind; message: string; email: string | null; page: string | null; userAgent: string | null };

const kinds = new Set<string>(["feedback", "bug"]);
const statuses = new Set<string>(["new", "seen", "done"]);

/** The submission as the route accepts it, or the reason it is refused. `honeypot` true means a bot filled the hidden field: answer as if accepted, store nothing. */
export function parseFeedback(body: unknown, userAgent: string | null): { ok: true; input: FeedbackInput; honeypot: boolean } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object" };
  const record = body as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "feedback";
  if (!kinds.has(kind)) return { ok: false, error: "kind must be feedback or bug" };
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message.length < 10) return { ok: false, error: "Please write at least a sentence (10 characters)" };
  if (message.length > 4000) return { ok: false, error: "Message is too long (4000 characters at most)" };
  const email = typeof record.email === "string" && record.email.trim() ? record.email.trim().slice(0, 200) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return { ok: false, error: "That email address does not look right" };
  const page = typeof record.page === "string" && record.page.trim() ? record.page.trim().slice(0, 500) : null;
  const honeypot = typeof record.website === "string" && record.website.trim().length > 0;
  return { ok: true, input: { kind: kind as FeedbackKind, message, email, page, userAgent: userAgent?.slice(0, 300) ?? null }, honeypot };
}

export function submitFeedback(database: OperationalDatabase, input: FeedbackInput, now = new Date()): FeedbackItem {
  const id = newId("feedback");
  const stamp = now.toISOString();
  database
    .prepare("INSERT INTO feedback (id, kind, message, email, page, user_agent, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)")
    .run(id, input.kind, input.message, input.email, input.page, input.userAgent, stamp, stamp);
  return database.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as FeedbackItem;
}

export function listFeedback(database: OperationalDatabase, options: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {}): { items: FeedbackItem[]; total: number; page: number; pageSize: number; counts: Record<FeedbackStatus, number> } {
  const status = options.status && statuses.has(options.status) ? options.status : null;
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const page = Math.max(1, options.page ?? 1);
  const where = status ? " WHERE status = ?" : "";
  const params = status ? [status] : [];
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM feedback${where}`).get(...params) as { count: number }).count;
  const items = database.prepare(`SELECT * FROM feedback${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as FeedbackItem[];
  const counts: Record<FeedbackStatus, number> = { new: 0, seen: 0, done: 0 };
  for (const row of database.prepare("SELECT status, COUNT(*) AS count FROM feedback GROUP BY status").all() as Array<{ status: FeedbackStatus; count: number }>) counts[row.status] = row.count;
  return { items, total, page, pageSize, counts };
}

export function updateFeedbackStatus(database: OperationalDatabase, id: string, status: string, now = new Date()): FeedbackItem | null {
  if (!statuses.has(status)) return null;
  const changed = database.prepare("UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?").run(status, now.toISOString(), id).changes;
  return changed ? (database.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as FeedbackItem) : null;
}

/** A sliding-window budget per key (a visitor's address): `limit` submissions per `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((stamp) => now - stamp < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}
