import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";

import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { pushPayload } from "../render/webpush.ts";

/**
 * Web Push (RFC 8030) with aes128gcm payload encryption (RFC 8291, RFC 8188) and VAPID
 * (RFC 8292), on node:crypto alone. A target's address is the subscription endpoint and its
 * meta carries the browser's `p256dh` and `auth` keys. The application keeps one VAPID key
 * pair for its lifetime: the public key is what the page passes to pushManager.subscribe.
 */

export type VapidKeys = { publicKey: string; privateKey: string };
export type WebPushConfig = {
  vapid: VapidKeys;
  /** "mailto:owner@example.com" or the site URL; push services may contact it about abuse. */
  subject: string;
  fetch?: FetchLike | undefined;
  /** Seconds the push service keeps an undelivered message; a day by default. */
  ttlSeconds?: number | undefined;
};

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const maxPlaintextBytes = 3900;
const recordSize = 4096;

export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64url");
}

export function fromBase64url(text: string): Buffer {
  return Buffer.from(text.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
}

/** A fresh P-256 pair in the base64url raw form the Web Push ecosystem uses (65-byte point, 32-byte scalar). */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);
  return { publicKey: base64url(ecdh.getPublicKey()), privateKey: base64url(padded) };
}

export function vapidPrivateKeyObject(keys: VapidKeys): KeyObject {
  const publicKey = fromBase64url(keys.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) throw new Error("VAPID_PUBLIC_KEY_INVALID");
  const privateKey = fromBase64url(keys.privateKey);
  if (privateKey.length !== 32) throw new Error("VAPID_PRIVATE_KEY_INVALID");
  return createPrivateKey({ key: { kty: "EC", crv: "P-256", x: base64url(publicKey.subarray(1, 33)), y: base64url(publicKey.subarray(33, 65)), d: base64url(privateKey) }, format: "jwk" });
}

/** The "vapid t=…, k=…" Authorization value for one push service origin, valid for twelve hours. */
export function vapidAuthorization(keys: VapidKeys, subject: string, audience: string, now = new Date()): string {
  const header = base64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: vapidPrivateKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${keys.publicKey}`;
}

function info(label: string, extra?: Buffer): Buffer {
  return Buffer.concat([Buffer.from(label, "ascii"), Buffer.from([0]), ...(extra ? [extra] : [])]);
}

/** Encrypts `plaintext` for the subscription as one aes128gcm record: salt, record size, the server's public key, then ciphertext and tag. */
export function encryptPushPayload(subscription: PushSubscription, plaintext: Buffer, options: { salt?: Buffer; serverKeys?: ReturnType<typeof createECDH> } = {}): Buffer {
  if (plaintext.length > maxPlaintextBytes) throw new Error(`PUSH_PAYLOAD_TOO_LARGE: ${plaintext.length} > ${maxPlaintextBytes}`);
  const clientPublic = fromBase64url(subscription.keys.p256dh);
  const authSecret = fromBase64url(subscription.keys.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 0x04) throw new Error("PUSH_P256DH_INVALID");
  if (authSecret.length !== 16) throw new Error("PUSH_AUTH_INVALID");
  const server = options.serverKeys ?? createECDH("prime256v1");
  if (!options.serverKeys) server.generateKeys();
  const serverPublic = server.getPublicKey();
  const salt = options.salt ?? randomBytes(16);
  const sharedSecret = server.computeSecret(clientPublic);
  // RFC 8291 §3.3, §3.4: the input keying material mixes the auth secret and both public keys.
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, info("WebPush: info", Buffer.concat([clientPublic, serverPublic])), 32));
  // RFC 8188 §2.2: content key and nonce from the record salt.
  const contentKey = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, info("Content-Encoding: nonce"), 12));
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  // 0x02 marks the last (and only) record; no extra padding is added.
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(16 + 4 + 1 + 65);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(65, 20);
  serverPublic.copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}

export function parsePushSubscription(value: unknown): PushSubscription | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof record.endpoint !== "string" || !/^https:\/\/[^\s]+$/u.test(record.endpoint) || record.endpoint.length > 2000) return null;
  if (typeof record.keys?.p256dh !== "string" || typeof record.keys.auth !== "string") return null;
  try {
    if (fromBase64url(record.keys.p256dh).length !== 65 || fromBase64url(record.keys.auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint: record.endpoint, keys: { p256dh: record.keys.p256dh, auth: record.keys.auth } };
}

/** The target row for a browser subscription: endpoint as address, keys in meta. */
export function pushTarget(subscription: PushSubscription): Target {
  return { kind: "webpush", address: subscription.endpoint, meta: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
}

const urgencyOf: Record<Message["severity"], "very-low" | "low" | "normal" | "high"> = { info: "normal", good: "normal", warn: "high", alert: "high" };

export function createWebPushChannel(config: WebPushConfig): Channel {
  const request = config.fetch ?? fetch;
  // Fail early on a malformed key pair rather than on the first send.
  vapidPrivateKeyObject(config.vapid);
  return {
    kind: "webpush",
    describe: (target) => {
      try {
        const url = new URL(target.address);
        return `webpush:${url.host}/${mask(url.pathname.split("/").at(-1) ?? "", 3)}`;
      } catch {
        return "webpush:invalid";
      }
    },
    send: async (target: Target, message: Message) => {
      const subscription = parsePushSubscription({ endpoint: target.address, keys: { p256dh: target.meta?.p256dh, auth: target.meta?.auth } });
      if (!subscription) return failure("PUSH_SUBSCRIPTION_INVALID", { gone: true });
      let body: Buffer;
      try {
        body = encryptPushPayload(subscription, Buffer.from(JSON.stringify(pushPayload(message)), "utf8"));
      } catch (error) {
        return failure(`PUSH_ENCRYPT: ${error instanceof Error ? error.message : String(error)}`);
      }
      const headers: Record<string, string> = {
        authorization: vapidAuthorization(config.vapid, config.subject, new URL(subscription.endpoint).origin),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
        ttl: String(config.ttlSeconds ?? 86_400),
        urgency: urgencyOf[message.severity],
      };
      const topic = message.dedupe_key?.replace(/[^\w-]/gu, "").slice(0, 32);
      if (topic) headers.topic = topic;
      let response: Response;
      try {
        response = await request(subscription.endpoint, { method: "POST", headers, body: new Uint8Array(body), signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        return failure(`PUSH_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
      }
      if (response.ok) return { ok: true, reference: response.headers.get("location") };
      const classified = classifyStatus(response.status, response.headers);
      return failure(`PUSH_HTTP_${response.status}: ${await bodyExcerpt(response)}`, classified);
    },
  };
}
