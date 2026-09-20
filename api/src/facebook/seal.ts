import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * A Page's access token at rest. It is sealed with AES-256-GCM under a key derived from the
 * application's state secret (LPL_ACCOUNT_STATE_SECRET), which lives in the environment and
 * never in the database, so a copy of the database alone cannot post to the Page. A token
 * sealed under another secret does not open, and the Page then reads as needing a reconnect.
 */

const version = "v1";

function keyFor(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "lanka-pricelens", "facebook-page-token", 32));
}

export function sealToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const sealed = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), sealed.toString("base64url")].join(".");
}

/** The token, or null when the text is not a sealed token or was sealed under another secret. */
export function openToken(sealed: string, secret: string): string | null {
  const [mark, iv, tag, body] = sealed.split(".");
  if (mark !== version || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
