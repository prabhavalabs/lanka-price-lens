import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

export const adminSessionCookie = "lpl_admin_session";
export const adminSessionSeconds = 12 * 60 * 60;
export const maximumFailedLoginAttempts = 5;
export const adminLockoutSeconds = 15 * 60;

export type AdminUser = { id: string; email: string };
export type AdminAuthentication =
  | { status: "authenticated"; user: AdminUser }
  | { status: "invalid_credentials"; attemptsRemaining: number | null }
  | { status: "locked"; attemptsRemaining: 0; lockedUntil: string; retryAfterSeconds: number };

const dummySalt = "00000000000000000000000000000000";
const dummyPasswordHash = `scrypt$${dummySalt}$${scryptSync("invalid-password", dummySalt, 64).toString("hex")}`;

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex || !/^[a-f0-9]{128}$/u.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function seedAdminUser(database: OperationalDatabase, email: string, passwordHash: string): void {
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/u.test(passwordHash)) throw new Error("ADMIN_PASSWORD_HASH is invalid");
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("ADMIN_EMAIL is invalid");
  const now = new Date().toISOString();
  database.transaction(() => {
    const existing = database.prepare("SELECT id, password_hash FROM admin_user WHERE email = ?").get(normalizedEmail) as { id: string; password_hash: string } | undefined;
    if (!existing) {
      database
        .prepare("INSERT INTO admin_user (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
        .run(`admin_${randomUUID()}`, normalizedEmail, passwordHash, now, now);
    } else if (existing.password_hash !== passwordHash) {
      database
        .prepare("UPDATE admin_user SET password_hash = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
        .run(passwordHash, now, existing.id);
      database.prepare("DELETE FROM admin_session WHERE user_id = ?").run(existing.id);
    }
  })();
}

export function authenticateAdmin(database: OperationalDatabase, email: string, password: string): AdminAuthentication {
  const normalizedEmail = normalizeEmail(email);
  const user = normalizedEmail
    ? (database
        .prepare(
          `SELECT id, email, password_hash, failed_login_count, locked_until
           FROM admin_user WHERE email = ? AND status = 'active'`,
        )
        .get(normalizedEmail) as
        | { id: string; email: string; password_hash: string; failed_login_count: number; locked_until: string | null }
        | undefined)
    : undefined;
  const now = new Date();
  const locked = user?.locked_until ? new Date(user.locked_until) > now : false;
  const valid = verifyPassword(password, locked || !user ? dummyPasswordHash : user.password_hash);
  if (!user) return { status: "invalid_credentials", attemptsRemaining: null };
  if (locked) {
    const lockedUntil = user.locked_until!;
    return {
      status: "locked",
      attemptsRemaining: 0,
      lockedUntil,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 1_000)),
    };
  }
  if (!valid) {
    const failures = user.failed_login_count + 1;
    if (failures >= maximumFailedLoginAttempts) {
      const lockedUntil = new Date(now.getTime() + adminLockoutSeconds * 1_000).toISOString();
      database
        .prepare("UPDATE admin_user SET failed_login_count = 0, locked_until = ?, updated_at = ? WHERE id = ?")
        .run(lockedUntil, now.toISOString(), user.id);
      return { status: "locked", attemptsRemaining: 0, lockedUntil, retryAfterSeconds: adminLockoutSeconds };
    }
    database
      .prepare("UPDATE admin_user SET failed_login_count = ?, locked_until = NULL, updated_at = ? WHERE id = ?")
      .run(failures, now.toISOString(), user.id);
    return { status: "invalid_credentials", attemptsRemaining: maximumFailedLoginAttempts - failures };
  }
  database.prepare("UPDATE admin_user SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(now.toISOString(), user.id);
  return { status: "authenticated", user: { id: user.id, email: user.email } };
}

export function createAdminSession(database: OperationalDatabase, userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  database.prepare("DELETE FROM admin_session WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(now.toISOString());
  database
    .prepare("INSERT INTO admin_session (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + adminSessionSeconds * 1_000).toISOString());
  return token;
}

export function findAdminSession(database: OperationalDatabase, token: string | undefined): AdminUser | undefined {
  if (!token || token.length > 128) return undefined;
  return database
    .prepare(
      `SELECT user.id, user.email FROM admin_session session
       JOIN admin_user user ON user.id = session.user_id
       WHERE session.token_hash = ? AND session.revoked_at IS NULL
         AND session.expires_at > ? AND user.status = 'active'`,
    )
    .get(hashToken(token), new Date().toISOString()) as AdminUser | undefined;
}

export function revokeAdminSession(database: OperationalDatabase, token: string | undefined): void {
  if (!token || token.length > 128) return;
  database.prepare("UPDATE admin_session SET revoked_at = ? WHERE token_hash = ?").run(new Date().toISOString(), hashToken(token));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : undefined;
}

// --- Tokens for programs acting as the owner (docs/mcp.md) ------------------------------------

/** Every token starts with this, so one that leaks into a log or a paste is recognisable at a glance. */
export const adminTokenPrefix = "lpl_";
export const adminTokenScopes = ["distribution", "full"] as const;
export type AdminTokenScope = (typeof adminTokenScopes)[number];

export function isAdminTokenScope(value: unknown): value is AdminTokenScope {
  return typeof value === "string" && (adminTokenScopes as readonly string[]).includes(value);
}

export type AdminTokenRow = {
  id: string;
  name: string;
  scope: AdminTokenScope;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

/** What a bearer token proves: who it acts as, and how far it reaches. */
export type AdminTokenIdentity = { user: AdminUser; tokenId: string; scope: AdminTokenScope };

/**
 * Makes a token and returns it once. Only its hash is stored (the same hashing the sessions use),
 * so this is the only moment the value exists anywhere but in the owner's hands.
 */
export function createAdminToken(
  database: OperationalDatabase,
  input: { userId: string; name: string; scope: AdminTokenScope; expiresAt?: string | null },
  now = new Date(),
): { token: string; row: AdminTokenRow } {
  const token = `${adminTokenPrefix}${randomBytes(32).toString("base64url")}`;
  const id = `token_${randomUUID()}`;
  database
    .prepare("INSERT INTO admin_token (id, user_id, name, token_hash, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.userId, input.name.slice(0, 120), hashToken(token), input.scope, now.toISOString(), input.expiresAt ?? null);
  return { token, row: database.prepare("SELECT id, name, scope, created_at, last_used_at, expires_at, revoked_at FROM admin_token WHERE id = ?").get(id) as AdminTokenRow };
}

export function listAdminTokens(database: OperationalDatabase, userId: string): AdminTokenRow[] {
  return database
    .prepare("SELECT id, name, scope, created_at, last_used_at, expires_at, revoked_at FROM admin_token WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as AdminTokenRow[];
}

export function revokeAdminToken(database: OperationalDatabase, userId: string, tokenId: string, now = new Date()): boolean {
  return database.prepare("UPDATE admin_token SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(now.toISOString(), tokenId, userId).changes > 0;
}

/**
 * The owner behind a bearer token, or null when it is unknown, revoked, or past its day. The
 * lookup is by hash, so a token that is not in the database leaves no trace of what was tried.
 * `last_used_at` is written on every accepted call, which is what makes a forgotten token visible.
 */
export function findAdminToken(database: OperationalDatabase, presented: string | undefined, now = new Date()): AdminTokenIdentity | null {
  if (!presented || !presented.startsWith(adminTokenPrefix)) return null;
  const row = database
    .prepare(
      `SELECT t.id, t.user_id, t.scope, t.expires_at, t.revoked_at, u.email
         FROM admin_token t JOIN admin_user u ON u.id = t.user_id
        WHERE t.token_hash = ? AND u.status = 'active'`,
    )
    .get(hashToken(presented)) as { id: string; user_id: string; scope: AdminTokenScope; expires_at: string | null; revoked_at: string | null; email: string } | undefined;
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) <= now) return null;
  database.prepare("UPDATE admin_token SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  return { user: { id: row.user_id, email: row.email }, tokenId: row.id, scope: row.scope };
}

/** The `Authorization: Bearer …` value, if the header carries one. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/u.exec(header ?? "");
  return match?.[1];
}

/**
 * What a scope may reach. `distribution` is the one the MCP server gets: the library, the calendar
 * and the channels, and nothing else, so a token on a laptop cannot read the prices, the accounts,
 * or the sources even though the owner's own browser can.
 */
export function scopeAllows(scope: AdminTokenScope, path: string): boolean {
  if (scope === "full") return true;
  return path.startsWith("/v1/admin/distribution");
}
