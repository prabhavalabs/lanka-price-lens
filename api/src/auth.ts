import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

export const adminSessionCookie = "lpl_admin_session";
export const adminSessionSeconds = 12 * 60 * 60;

export type AdminUser = { id: string; email: string };

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

export function authenticateAdmin(database: OperationalDatabase, email: string, password: string): AdminUser | undefined {
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
  if (!user || locked || !valid) {
    if (user && !locked) {
      const failures = user.failed_login_count + 1;
      database
        .prepare("UPDATE admin_user SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?")
        .run(
          failures >= 5 ? 0 : failures,
          failures >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null,
          now.toISOString(),
          user.id,
        );
    }
    return undefined;
  }
  database.prepare("UPDATE admin_user SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(now.toISOString(), user.id);
  return { id: user.id, email: user.email };
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
