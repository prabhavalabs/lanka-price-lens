import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { facebookPostUrl, instagramPostUrl, type FacebookPage, type InstagramAccount, type Message } from "@lanka-pricelens/notify";

import { openToken, sealToken } from "./seal.ts";

/**
 * The places PriceLens distributes to, connected from the admin (docs/distribution.md). Both
 * platforms are reached through one Facebook Login: the Pages come back with their own tokens,
 * and an Instagram account is published to with the token of the Page it is linked to.
 *
 * Tokens go in sealed and only come out through `tokenFor`, which a channel calls when it posts,
 * so no token ever rides in the outbox. Everything the admin reads is the public part of an
 * account. One account per platform is active: the one a post goes to.
 *
 * Posts are not kept here. They travel through the notify outbox like every other message, and
 * the history is read back from it.
 */

export const platforms = ["facebook", "instagram"] as const;
export type Platform = (typeof platforms)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (platforms as readonly string[]).includes(value);
}

export type ConnectedAccount = {
  platform: Platform;
  account_id: string;
  name: string;
  /** The Instagram handle; null for a Page. */
  username: string | null;
  link: string | null;
  picture: string | null;
  /** The Page an Instagram account is reached through; null for a Page itself. */
  parent_id: string | null;
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

export type ChannelPost = {
  id: string;
  platform: Platform;
  account_id: string;
  dedupe_key: string | null;
  status: "queued" | "sending" | "sent" | "dead";
  title: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
  error: string | null;
  /** Where the post can be opened, once the platform accepted it. */
  url: string | null;
};

export type SocialStore = {
  list: (platform?: Platform) => ConnectedAccount[];
  active: (platform: Platform) => ConnectedAccount | undefined;
  /**
   * Saves what a person just granted. An account already known keeps its switches and gets the
   * fresh token. The first account that can be posted to becomes the active one when none is.
   */
  connect: (found: { pages: readonly FacebookPage[]; instagram: readonly InstagramAccount[] }, person: string | null, now: Date) => ConnectedAccount[];
  activate: (platform: Platform, accountId: string, now: Date) => boolean;
  setPaused: (platform: Platform, accountId: string, paused: boolean, now: Date) => boolean;
  /** Forgets one account, every account of one platform, or all of them, with their tokens. */
  disconnect: (platform?: Platform, accountId?: string) => number;
  /** The token that publishes for this account; null when it is unknown, marked invalid, or sealed under another secret. */
  tokenFor: (platform: Platform, accountId: string) => string | null;
  markToken: (platform: Platform, accountId: string, health: { valid: boolean; error?: string | null | undefined; expiresAt?: string | null | undefined }, now: Date) => void;
  posts: (limit: number, platform?: Platform) => ChannelPost[];
  /** One post with the message it was built from, for the preview in the admin. */
  readPost: (id: string) => { post: ChannelPost; message: Message } | null;
};

type AccountRow = Omit<ConnectedAccount, "can_post" | "active" | "paused"> & { can_post: number; active: number; paused: number };

const postColumns = "id, channel, address, dedupe_key, status, json_extract(message_json, '$.title') AS title, attempts, created_at, sent_at, next_attempt_at, last_error, reference";
type PostRow = { id: string; channel: Platform; address: string; dedupe_key: string | null; status: ChannelPost["status"]; title: string | null; attempts: number; created_at: string; sent_at: string | null; next_attempt_at: string; last_error: string | null; reference: string | null };
const toPost = (row: PostRow): ChannelPost => ({
  id: row.id,
  platform: row.channel,
  account_id: row.address,
  dedupe_key: row.dedupe_key,
  status: row.status,
  title: row.title ?? "",
  attempts: row.attempts,
  created_at: row.created_at,
  sent_at: row.sent_at,
  next_attempt_at: row.status === "queued" ? row.next_attempt_at : null,
  error: row.status === "sent" ? null : row.last_error,
  url: row.status === "sent" && row.reference ? postUrl(row.channel, row.reference) : null,
});
const columns = "platform, account_id, name, username, link, picture, parent_id, can_post, active, paused, token_status, token_error, token_checked_at, token_expires_at, connected_by, connected_at";
const toAccount = (row: AccountRow): ConnectedAccount => ({ ...row, can_post: row.can_post === 1, active: row.active === 1, paused: row.paused === 1 });

/** Where a post on either platform can be opened. Facebook resolves its own ids; Instagram gave us the address itself. */
export function postUrl(platform: Platform, reference: string): string | null {
  return platform === "facebook" ? facebookPostUrl(reference) : instagramPostUrl(reference);
}

export function createSocialStore(database: OperationalDatabase, secret: string): SocialStore {
  const list = (platform?: Platform): ConnectedAccount[] =>
    (platform
      ? (database.prepare(`SELECT ${columns} FROM social_account WHERE platform = ? ORDER BY active DESC, name`).all(platform) as AccountRow[])
      : (database.prepare(`SELECT ${columns} FROM social_account ORDER BY platform, active DESC, name`).all() as AccountRow[])
    ).map(toAccount);

  const active = (platform: Platform): ConnectedAccount | undefined => {
    const row = database.prepare(`SELECT ${columns} FROM social_account WHERE platform = ? AND active = 1`).get(platform) as AccountRow | undefined;
    return row ? toAccount(row) : undefined;
  };

  const activate = (platform: Platform, accountId: string, now: Date): boolean => {
    const known = database.prepare("SELECT 1 FROM social_account WHERE platform = ? AND account_id = ?").get(platform, accountId);
    if (!known) return false;
    database.transaction(() => {
      database.prepare("UPDATE social_account SET active = 0 WHERE platform = ? AND active = 1").run(platform);
      database.prepare("UPDATE social_account SET active = 1, updated_at = ? WHERE platform = ? AND account_id = ?").run(now.toISOString(), platform, accountId);
    })();
    return true;
  };

  const save = database.prepare(
    `INSERT INTO social_account (platform, account_id, name, username, link, picture, parent_id, token_sealed, can_post, token_status, token_error, token_checked_at, token_expires_at, connected_by, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, NULL, NULL, ?, ?, ?)
     ON CONFLICT(platform, account_id) DO UPDATE SET name = excluded.name, username = excluded.username, link = excluded.link, picture = excluded.picture, parent_id = excluded.parent_id,
       token_sealed = excluded.token_sealed, can_post = excluded.can_post, token_status = 'ok', token_error = NULL, token_checked_at = NULL, token_expires_at = NULL,
       connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
  );

  return {
    list,
    active,
    connect: (found, person, now) => {
      const stamp = now.toISOString();
      const who = person?.slice(0, 200) ?? null;
      database.transaction(() => {
        for (const page of found.pages) {
          save.run("facebook", page.id, page.name.slice(0, 200), null, page.link, null, null, sealToken(page.token, secret), page.canPost ? 1 : 0, who, stamp, stamp);
        }
        for (const account of found.instagram) {
          save.run("instagram", account.id, account.name.slice(0, 200), account.username.slice(0, 200), `https://www.instagram.com/${account.username}/`, account.picture, account.pageId, sealToken(account.token, secret), account.canPost ? 1 : 0, who, stamp, stamp);
        }
      })();
      for (const platform of platforms) {
        if (active(platform)) continue;
        const first = platform === "facebook" ? found.pages.find((page) => page.canPost)?.id : found.instagram.find((account) => account.canPost)?.id;
        if (first) activate(platform, first, now);
      }
      return list();
    },
    activate,
    setPaused: (platform, accountId, paused, now) =>
      database.prepare("UPDATE social_account SET paused = ?, updated_at = ? WHERE platform = ? AND account_id = ?").run(paused ? 1 : 0, now.toISOString(), platform, accountId).changes > 0,
    disconnect: (platform, accountId) => {
      if (platform && accountId) return database.prepare("DELETE FROM social_account WHERE platform = ? AND account_id = ?").run(platform, accountId).changes;
      if (platform) return database.prepare("DELETE FROM social_account WHERE platform = ?").run(platform).changes;
      return database.prepare("DELETE FROM social_account").run().changes;
    },
    tokenFor: (platform, accountId) => {
      const row = database.prepare("SELECT token_sealed, token_status FROM social_account WHERE platform = ? AND account_id = ?").get(platform, accountId) as { token_sealed: string; token_status: string } | undefined;
      if (!row || row.token_status !== "ok") return null;
      return openToken(row.token_sealed, secret);
    },
    markToken: (platform, accountId, health, now) => {
      database
        .prepare("UPDATE social_account SET token_status = ?, token_error = ?, token_checked_at = ?, token_expires_at = COALESCE(?, token_expires_at), updated_at = ? WHERE platform = ? AND account_id = ?")
        .run(health.valid ? "ok" : "invalid", health.valid ? null : (health.error ?? "The platform no longer accepts this token").slice(0, 500), now.toISOString(), health.expiresAt ?? null, now.toISOString(), platform, accountId);
    },
    readPost: (id) => {
      const row = database.prepare(`SELECT ${postColumns}, message_json FROM notify_outbox WHERE id = ? AND channel IN ('facebook', 'instagram')`).get(id) as (PostRow & { message_json: string }) | undefined;
      if (!row) return null;
      try {
        return { post: toPost(row), message: JSON.parse(row.message_json) as Message };
      } catch {
        return null;
      }
    },
    posts: (limit, platform) => {
      const size = Math.max(1, Math.min(limit, 100));
      const rows = (
        platform
          ? database.prepare(`SELECT ${postColumns} FROM notify_outbox WHERE channel = ? ORDER BY created_at DESC LIMIT ?`).all(platform, size)
          : database.prepare(`SELECT ${postColumns} FROM notify_outbox WHERE channel IN ('facebook', 'instagram') ORDER BY created_at DESC LIMIT ?`).all(size)
      ) as PostRow[];
      return rows.map(toPost);
    },
  };
}
