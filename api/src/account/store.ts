import { createHash, randomBytes } from "node:crypto";

import { newId, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { preferencesSchema, type AccountPreferences } from "@lanka-pricelens/shared";

import { AccountError, type Account, type AccountIdentity, type AccountListRequest, type AccountSession, type AccountStore, type AccountToken, type AccountTokenKind } from "./types.ts";

/**
 * The accounts store on the operational SQLite database (tables in foundry/src/db.ts). Sessions
 * and one-time tokens are random values the caller receives once; only their sha256 is kept, so
 * a copy of the database cannot sign anyone in. Preferences travel as JSON in preferences_json
 * and come back through the shared schema, so a missing or stale key falls back to its default.
 */

export const maximumFailedLoginAttempts = 5;
export const lockoutSeconds = 15 * 60;

/** How a stored session or token is looked up: the sha256 of the raw value, hex. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh opaque token for a session or a mail link: 32 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Sessions and tokens are 43 characters; anything much longer is not one of ours and is never hashed. */
const maximumTokenLength = 128;

type AccountRow = Omit<Account, "preferences"> & { preferences_json: string };

function parsePreferences(json: string): AccountPreferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the defaults: a row with unreadable preferences still describes an account.
  }
  return preferencesSchema.parse({});
}

function toAccount(row: AccountRow): Account {
  const { preferences_json, ...rest } = row;
  return { ...rest, preferences: parsePreferences(preferences_json) };
}

/** Escapes LIKE wildcards in a search term so a person looking for "a_b" does not match "acb". */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

export function createAccountStore(database: OperationalDatabase): AccountStore {
  const selectAccount = "SELECT id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at FROM account";
  const readAccount = (id: string): Account | undefined => {
    const row = database.prepare(`${selectAccount} WHERE id = ?`).get(id) as AccountRow | undefined;
    return row ? toAccount(row) : undefined;
  };

  const store: AccountStore = {
    createAccount(input, now) {
      const id = newId("account");
      const stamp = now.toISOString();
      database
        .prepare(
          `INSERT INTO account (id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, NULL, ?, ?, ?)`,
        )
        .run(id, input.email, input.emailVerified ? stamp : null, input.passwordHash, input.displayName, input.avatarUrl ?? null, input.locale ?? "en", JSON.stringify(preferencesSchema.parse({})), stamp, stamp);
      return readAccount(id)!;
    },

    findAccountById(id) {
      return readAccount(id);
    },

    findAccountByEmail(email) {
      // The column collates NOCASE, so the comparison ignores case without a lower() on every row.
      const row = database.prepare(`${selectAccount} WHERE email = ?`).get(email.trim()) as AccountRow | undefined;
      return row ? toAccount(row) : undefined;
    },

    updateAccount(id, patch, now) {
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        assignments.push(`${column} = ?`);
        values.push(value);
      };
      if (patch.email !== undefined) set("email", patch.email);
      if (patch.email_verified_at !== undefined) set("email_verified_at", patch.email_verified_at);
      if (patch.password_hash !== undefined) set("password_hash", patch.password_hash);
      if (patch.display_name !== undefined) set("display_name", patch.display_name);
      if (patch.avatar_url !== undefined) set("avatar_url", patch.avatar_url);
      if (patch.locale !== undefined) set("locale", patch.locale);
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.preferences !== undefined) set("preferences_json", JSON.stringify(preferencesSchema.parse(patch.preferences)));
      set("updated_at", now.toISOString());
      const changed = database.prepare(`UPDATE account SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id).changes;
      if (!changed) throw new AccountError("NOT_FOUND", "Account not found");
      return readAccount(id)!;
    },

    recordLoginFailure(id, now) {
      const row = database.prepare("SELECT failed_login_count FROM account WHERE id = ?").get(id) as { failed_login_count: number } | undefined;
      if (!row) throw new AccountError("NOT_FOUND", "Account not found");
      const failures = row.failed_login_count + 1;
      if (failures >= maximumFailedLoginAttempts) {
        const lockedUntil = new Date(now.getTime() + lockoutSeconds * 1_000).toISOString();
        database.prepare("UPDATE account SET failed_login_count = 0, locked_until = ?, updated_at = ? WHERE id = ?").run(lockedUntil, now.toISOString(), id);
        return { locked: true, locked_until: lockedUntil, attempts_remaining: 0 };
      }
      database.prepare("UPDATE account SET failed_login_count = ?, locked_until = NULL, updated_at = ? WHERE id = ?").run(failures, now.toISOString(), id);
      return { locked: false, locked_until: null, attempts_remaining: maximumFailedLoginAttempts - failures };
    },

    recordLoginSuccess(id, now) {
      database.prepare("UPDATE account SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(now.toISOString(), id);
    },

    deleteAccount(id) {
      // Identities, sessions, tokens, menus, and recipes go with the row (ON DELETE CASCADE).
      database.prepare("DELETE FROM account WHERE id = ?").run(id);
    },

    countAccounts() {
      return (database.prepare("SELECT COUNT(*) AS count FROM account").get() as { count: number }).count;
    },

    listAccounts(request) {
      const pageSize = Math.min(100, Math.max(1, Math.floor(request.pageSize) || 25));
      const page = Math.max(1, Math.floor(request.page) || 1);
      const conditions: string[] = [];
      const params: unknown[] = [];
      const search = request.search.trim();
      if (search) {
        conditions.push("(email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");
        params.push(likePattern(search), likePattern(search));
      }
      if (request.status) {
        conditions.push("status = ?");
        params.push(request.status);
      }
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const total = (database.prepare(`SELECT COUNT(*) AS count FROM account${where}`).get(...params) as { count: number }).count;
      const rows = database.prepare(`${selectAccount}${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as AccountRow[];
      return { items: rows.map(toAccount), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
    },

    createSession(accountId, meta, ttlSeconds, now) {
      const token = newToken();
      const stamp = now.toISOString();
      // Dead sessions leave the table as new ones arrive; nothing reads them once expired or revoked.
      database.prepare("DELETE FROM account_session WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(stamp);
      database
        .prepare("INSERT INTO account_session (token_hash, account_id, created_at, expires_at, revoked_at, user_agent, address) VALUES (?, ?, ?, ?, NULL, ?, ?)")
        .run(hashToken(token), accountId, stamp, new Date(now.getTime() + ttlSeconds * 1_000).toISOString(), meta.userAgent, meta.address);
      return token;
    },

    findSession(token, now) {
      if (!token || token.length > maximumTokenLength) return undefined;
      const session = database
        .prepare("SELECT token_hash, account_id, created_at, expires_at, revoked_at, user_agent, address FROM account_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?")
        .get(hashToken(token), now.toISOString()) as AccountSession | undefined;
      if (!session) return undefined;
      const account = readAccount(session.account_id);
      return account ? { account, session } : undefined;
    },

    extendSession(tokenHash, expiresAt) {
      database.prepare("UPDATE account_session SET expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(expiresAt.toISOString(), tokenHash);
    },

    revokeSession(token, now) {
      if (!token || token.length > maximumTokenLength) return;
      database.prepare("UPDATE account_session SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(now.toISOString(), hashToken(token));
    },

    revokeSessions(accountId, now, exceptTokenHash) {
      const stamp = now.toISOString();
      return database
        .prepare("UPDATE account_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? AND token_hash <> ?")
        .run(stamp, accountId, stamp, exceptTokenHash ?? "").changes;
    },

    listSessions(accountId, now) {
      return database
        .prepare("SELECT token_hash, account_id, created_at, expires_at, revoked_at, user_agent, address FROM account_session WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
        .all(accountId, now.toISOString()) as AccountSession[];
    },

    createToken(accountId, kind, payload, ttlSeconds, now) {
      const token = newToken();
      const stamp = now.toISOString();
      database.transaction(() => {
        // A new link voids the earlier ones of its kind, so only the latest mail works; expired leftovers go too.
        database.prepare("DELETE FROM account_token WHERE (account_id = ? AND kind = ? AND used_at IS NULL) OR expires_at <= ?").run(accountId, kind, stamp);
        database
          .prepare("INSERT INTO account_token (token_hash, account_id, kind, payload, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
          .run(hashToken(token), accountId, kind, payload, new Date(now.getTime() + ttlSeconds * 1_000).toISOString(), stamp);
      })();
      return token;
    },

    consumeToken(token, kind, now) {
      if (!token || token.length > maximumTokenLength) return undefined;
      const stamp = now.toISOString();
      return database.transaction((): AccountToken | undefined => {
        const row = database
          .prepare("SELECT token_hash, account_id, kind, payload, expires_at, used_at, created_at FROM account_token WHERE token_hash = ?")
          .get(hashToken(token)) as AccountToken | undefined;
        if (!row || row.kind !== kind || row.used_at !== null || row.expires_at <= stamp) return undefined;
        database.prepare("UPDATE account_token SET used_at = ? WHERE token_hash = ?").run(stamp, row.token_hash);
        return { ...row, used_at: stamp };
      })();
    },

    linkIdentity(identity, now) {
      database
        .prepare(
          `INSERT INTO account_identity (provider, subject, account_id, email, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(provider, subject) DO UPDATE SET account_id = excluded.account_id, email = excluded.email`,
        )
        .run(identity.provider, identity.subject, identity.account_id, identity.email, now.toISOString());
      return store.findIdentity(identity.provider, identity.subject)!;
    },

    findIdentity(provider, subject) {
      return database
        .prepare("SELECT provider, subject, account_id, email, created_at FROM account_identity WHERE provider = ? AND subject = ?")
        .get(provider, subject) as AccountIdentity | undefined;
    },

    listIdentities(accountId) {
      return database
        .prepare("SELECT provider, subject, account_id, email, created_at FROM account_identity WHERE account_id = ? ORDER BY created_at, provider")
        .all(accountId) as AccountIdentity[];
    },

    unlinkIdentity(accountId, provider) {
      database.prepare("DELETE FROM account_identity WHERE account_id = ? AND provider = ?").run(accountId, provider);
    },
  };
  return store;
}
