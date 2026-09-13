import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import test from "node:test";

import { createWebPushChannel, encryptPushPayload, generateVapidKeys, message, parsePushSubscription, pushTarget, vapidAuthorization, type PushSubscription } from "../src/index.ts";

/** A browser-side subscription: its own P-256 pair and a 16-byte auth secret. */
function browserSubscription(endpoint = "https://push.example.net/send/abcdef123456") {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  const auth = randomBytes(16);
  const subscription: PushSubscription = { endpoint, keys: { p256dh: keys.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  return { subscription, keys, auth };
}

/** RFC 8291 / RFC 8188 decryption written independently of the channel, from the receiver's side. */
function decrypt(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer, receiverPublic: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  assert.equal(recordSize, 4096);
  assert.equal(idLength, 65);
  const shared = receiver.computeSecret(senderPublic);
  const label = (text: string, extra?: Buffer) => Buffer.concat([Buffer.from(text, "ascii"), Buffer.from([0]), ...(extra ? [extra] : [])]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, label("WebPush: info", Buffer.concat([receiverPublic, senderPublic])), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, label("Content-Encoding: aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, label("Content-Encoding: nonce"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  const delimiter = padded.lastIndexOf(2);
  assert.equal(delimiter, padded.length - 1, "the record ends with the last-record delimiter and no padding");
  return padded.subarray(0, delimiter);
}

test("vapid keys are a P-256 pair in base64url raw form", () => {
  const keys = generateVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65);
  assert.equal(Buffer.from(keys.publicKey, "base64url")[0], 4);
  assert.equal(Buffer.from(keys.privateKey, "base64url").length, 32);
});

test("the vapid authorization is an ES256 JWT for the push service origin that verifies with the public key", () => {
  const keys = generateVapidKeys();
  const now = new Date("2026-09-12T06:00:00.000Z");
  const header = vapidAuthorization(keys, "mailto:owner@example.com", "https://push.example.net", now);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/u.exec(header);
  assert.ok(match, "vapid t=…, k=… shape");
  const [, head, claims, signature, key] = match;
  assert.equal(key, keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(head!, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(claims!, "base64url").toString()), { aud: "https://push.example.net", exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: "mailto:owner@example.com" });
  const publicKey = Buffer.from(keys.publicKey, "base64url");
  const verifier = createPublicKey({ key: { kty: "EC", crv: "P-256", x: publicKey.subarray(1, 33).toString("base64url"), y: publicKey.subarray(33).toString("base64url") }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(`${head}.${claims}`), { key: verifier, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")), true);
});

test("an encrypted payload decrypts on the receiver's side to the same bytes", () => {
  const { subscription, keys, auth } = browserSubscription();
  const plaintext = Buffer.from(JSON.stringify({ title: "Big onion down 12%", body: "Rs 370 / kg at Keells", url: "https://price.example/p/product_big_onion" }));
  const body = encryptPushPayload(subscription, plaintext);
  assert.equal(body.length, 86 + plaintext.length + 1 + 16);
  assert.deepEqual(decrypt(body, keys, auth, keys.getPublicKey()), plaintext);
  // A second encryption uses a fresh salt and server key, so the bytes differ.
  assert.notDeepEqual(encryptPushPayload(subscription, plaintext), body);
  assert.throws(() => encryptPushPayload(subscription, Buffer.alloc(4000)), /PUSH_PAYLOAD_TOO_LARGE/u);
  assert.throws(() => encryptPushPayload({ ...subscription, keys: { ...subscription.keys, auth: "short" } }, plaintext), /PUSH_AUTH_INVALID/u);
});

test("subscriptions from the browser are checked and turned into targets", () => {
  const { subscription } = browserSubscription();
  assert.deepEqual(parsePushSubscription(subscription), subscription);
  assert.equal(parsePushSubscription({ endpoint: "http://insecure.example/x", keys: subscription.keys }), null);
  assert.equal(parsePushSubscription({ endpoint: subscription.endpoint, keys: { p256dh: "AAAA", auth: subscription.keys.auth } }), null);
  assert.equal(parsePushSubscription(null), null);
  assert.deepEqual(pushTarget(subscription), { kind: "webpush", address: subscription.endpoint, meta: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
});

test("the channel posts an aes128gcm body with vapid, ttl, urgency, and topic; 410 means gone", async () => {
  const { subscription, keys, auth } = browserSubscription();
  const vapid = generateVapidKeys();
  const seen: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: Buffer.from(init?.body as Uint8Array) });
    return new Response(null, { status: 201, headers: { location: "https://push.example.net/receipt/1" } });
  }) as typeof fetch;
  const channel = createWebPushChannel({ vapid, subject: "https://price.example", fetch: request });
  const alert = message({ title: "Big onion down 12%", summary: "Rs 370 / kg at Keells.", severity: "alert", actions: [{ label: "Open", url: "https://price.example/p/product_big_onion" }], dedupe_key: "drop:product_big_onion:2026-09-12" });
  const delivery = await channel.send(pushTarget(subscription), alert);
  assert.deepEqual(delivery, { ok: true, reference: "https://push.example.net/receipt/1" });
  assert.equal(seen[0]!.url, subscription.endpoint);
  assert.equal(seen[0]!.headers["content-encoding"], "aes128gcm");
  assert.equal(seen[0]!.headers.ttl, "86400");
  assert.equal(seen[0]!.headers.urgency, "high");
  assert.equal(seen[0]!.headers.topic, "dropproduct_big_onion2026-09-12");
  assert.ok(String(seen[0]!.headers.authorization).startsWith(`vapid t=`));
  assert.ok(String(seen[0]!.headers.authorization).endsWith(`, k=${vapid.publicKey}`));
  const payload = JSON.parse(decrypt(seen[0]!.body, keys, auth, keys.getPublicKey()).toString()) as { title: string; url: string; tag: string };
  assert.equal(payload.title, "Big onion down 12%");
  assert.equal(payload.url, "https://price.example/p/product_big_onion");
  assert.equal(payload.tag, "drop:product_big_onion:2026-09-12");
  assert.equal(channel.describe(pushTarget(subscription)), "webpush:push.example.net/abc…456");

  const expired = createWebPushChannel({ vapid, subject: "https://price.example", fetch: (async () => new Response("gone", { status: 410 })) as typeof fetch });
  const gone = await expired.send(pushTarget(subscription), alert);
  assert.equal(gone.ok, false);
  if (!gone.ok) {
    assert.equal(gone.gone, true);
    assert.match(gone.error, /PUSH_HTTP_410/u);
  }
  const broken = await channel.send({ kind: "webpush", address: subscription.endpoint, meta: { p256dh: "x", auth: "y" } }, alert);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.gone, true);
  assert.throws(() => createWebPushChannel({ vapid: { publicKey: "AAAA", privateKey: vapid.privateKey }, subject: "x" }), /VAPID_PUBLIC_KEY_INVALID/u);
});
