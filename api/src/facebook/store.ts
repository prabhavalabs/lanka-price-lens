import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { facebookPostUrl, type FacebookPage } from "@lanka-pricelens/notify";

import { openToken, sealToken } from "./seal.ts";

/**
 * The Facebook Pages connected from the admin (docs/facebook.md). Tokens go in sealed and only
 * come out through `tokenFor`, which the channel calls when it posts; everything the admin
 * reads is the public part of a Page. One Page at most is active: the one the daily post and
 * "Post now" go to. Posts are not kept here: they travel through the notify outbox like every
 * other message, and the history is read from it.
 */

export type ConnectedPage = {
  page_id: string;
  name: string;
  link: string | null;
  can_post: boolean;
  active: boolean;
  paused: boolean;
  token_status: "ok" | "invalid";
  token_error: string | null;
  token_checked_at: string | null;
  token_expires_at: string | null;
  connected_by: string | null;
  connected_at: string;
};

export type PagePost = {
  id: string;
  page_id: string;
  dedupe_key: string | null;
  status: "queued" | "sending" | "sent" | "dead";
  title: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
  error: string | null;
  /** Where the post can be opened, once Facebook accepted it. */
  url: string | null;
};

export type FacebookStore = {
  list: () => ConnectedPage[];
  active: () => ConnectedPage | undefined;
  /** Saves the Pages a person just granted; a Page already known keeps its switches and gets the fresh token. The first Page that can be posted to becomes active when none is. */
  connect: (pages: FacebookPage[], person: string | null, now: Date) => ConnectedPage[];
  activate: (pageId: string, now: Date) => boolean;
  setPaused: (pageId: string, paused: boolean, now: Date) => boolean;
  /** Forgets one Page, or all of them, with their tokens. */
  disconnect: (pageId: string | null) => number;
  /** The Page's token for the channel; null when the Page is unknown, marked invalid, or sealed under another secret. */
  tokenFor: (pageId: string) => string | null;
  markToken: (pageId: string, health: { valid: boolean; error?: string | null | undefined; expiresAt?: string | null | undefined }, now: Date) => void;
  posts: (limit: number) => PagePost[];
};

type PageRow = Omit<ConnectedPage, "can_post" | "active" | "paused"> & { can_post: number; active: number; paused: number };
const columns = "page_id, name, link, can_post, active, paused, token_status, token_error, token_checked_at, token_expires_at, connected_by, connected_at";
const toPage = (row: PageRow): ConnectedPage => ({ ...row, can_post: row.can_post === 1, active: row.active === 1, paused: row.paused === 1 });

export function createFacebookStore(database: OperationalDatabase, secret: string): FacebookStore {
  const list = (): ConnectedPage[] => (database.prepare(`SELECT ${columns} FROM facebook_page ORDER BY active DESC, name`).all() as PageRow[]).map(toPage);
  const active = (): ConnectedPage | undefined => {
    const row = database.prepare(`SELECT ${columns} FROM facebook_page WHERE active = 1`).get() as PageRow | undefined;
    return row ? toPage(row) : undefined;
  };
  const activate = (pageId: string, now: Date): boolean => {
    const known = database.prepare("SELECT 1 FROM facebook_page WHERE page_id = ?").get(pageId);
    if (!known) return false;
    database.transaction(() => {
      database.prepare("UPDATE facebook_page SET active = 0 WHERE active = 1").run();
      database.prepare("UPDATE facebook_page SET active = 1, updated_at = ? WHERE page_id = ?").run(now.toISOString(), pageId);
    })();
    return true;
  };
  return {
    list,
    active,
    connect: (pages, person, now) => {
      const stamp = now.toISOString();
      database.transaction(() => {
        for (const page of pages) {
          database
            .prepare(
              `INSERT INTO facebook_page (page_id, name, link, token_sealed, can_post, token_status, token_error, token_checked_at, connected_by, connected_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'ok', NULL, NULL, ?, ?, ?)
               ON CONFLICT(page_id) DO UPDATE SET name = excluded.name, link = excluded.link, token_sealed = excluded.token_sealed, can_post = excluded.can_post,
                 token_status = 'ok', token_error = NULL, token_checked_at = NULL, token_expires_at = NULL, connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
            )
            .run(page.id, page.name.slice(0, 200), page.link, sealToken(page.token, secret), page.canPost ? 1 : 0, person?.slice(0, 200) ?? null, stamp, stamp);
        }
      })();
      if (!active()) {
        const first = pages.find((page) => page.canPost);
        if (first) activate(first.id, now);
      }
      return list();
    },
    activate,
    setPaused: (pageId, paused, now) => database.prepare("UPDATE facebook_page SET paused = ?, updated_at = ? WHERE page_id = ?").run(paused ? 1 : 0, now.toISOString(), pageId).changes > 0,
    disconnect: (pageId) => (pageId ? database.prepare("DELETE FROM facebook_page WHERE page_id = ?").run(pageId) : database.prepare("DELETE FROM facebook_page").run()).changes,
    tokenFor: (pageId) => {
      const row = database.prepare("SELECT token_sealed, token_status FROM facebook_page WHERE page_id = ?").get(pageId) as { token_sealed: string; token_status: string } | undefined;
      if (!row || row.token_status !== "ok") return null;
      return openToken(row.token_sealed, secret);
    },
    markToken: (pageId, health, now) => {
      database
        .prepare("UPDATE facebook_page SET token_status = ?, token_error = ?, token_checked_at = ?, token_expires_at = COALESCE(?, token_expires_at), updated_at = ? WHERE page_id = ?")
        .run(health.valid ? "ok" : "invalid", health.valid ? null : (health.error ?? "Facebook no longer accepts this token").slice(0, 500), now.toISOString(), health.expiresAt ?? null, now.toISOString(), pageId);
    },
    posts: (limit) => {
      const rows = database
        .prepare("SELECT id, address, dedupe_key, status, json_extract(message_json, '$.title') AS title, attempts, created_at, sent_at, next_attempt_at, last_error, reference FROM notify_outbox WHERE channel = 'facebook' ORDER BY created_at DESC LIMIT ?")
        .all(Math.max(1, Math.min(limit, 100))) as Array<{ id: string; address: string; dedupe_key: string | null; status: PagePost["status"]; title: string | null; attempts: number; created_at: string; sent_at: string | null; next_attempt_at: string; last_error: string | null; reference: string | null }>;
      return rows.map((row) => ({
        id: row.id,
        page_id: row.address,
        dedupe_key: row.dedupe_key,
        status: row.status,
        title: row.title ?? "",
        attempts: row.attempts,
        created_at: row.created_at,
        sent_at: row.sent_at,
        next_attempt_at: row.status === "queued" ? row.next_attempt_at : null,
        error: row.status === "sent" ? null : row.last_error,
        url: row.status === "sent" && row.reference ? facebookPostUrl(row.reference) : null,
      }));
    },
  };
}
