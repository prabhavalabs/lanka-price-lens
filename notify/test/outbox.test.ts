import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { createMemoryOutbox, createSqliteOutbox, dispatchOutbox, message, outboxSchema, type Channel, type ChannelRegistry, type Delivery, type OutboxStore, type Target } from "../src/index.ts";

const start = new Date("2026-09-12T06:00:00.000Z");

function clock(at = start) {
  let current = at;
  return { now: () => current, advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
}

function scripted(kind: Channel["kind"], script: Delivery[]): { channel: Channel; sent: Array<{ target: Target; title: string }> } {
  const sent: Array<{ target: Target; title: string }> = [];
  let index = 0;
  return {
    sent,
    channel: {
      kind,
      describe: (target) => `${kind}:${target.address}`,
      send: async (target, body) => {
        sent.push({ target, title: body.title });
        const delivery = script[Math.min(index, script.length - 1)] ?? { ok: true, reference: null };
        index += 1;
        return delivery;
      },
    },
  };
}

const registry = (...channels: Channel[]): ChannelRegistry => new Map(channels.map((channel) => [channel.kind, channel]));
const target: Target = { kind: "discord", address: "https://discord.com/api/webhooks/1/a" };
const note = (title: string, key?: string) => message({ title, ...(key ? { dedupe_key: key } : {}) });

const stores: Array<{ name: string; create: () => OutboxStore }> = [
  { name: "memory", create: () => createMemoryOutbox() },
  {
    name: "sqlite",
    create: () => {
      const database = new Database(":memory:");
      database.exec(outboxSchema);
      return createSqliteOutbox(database);
    },
  },
];

for (const { name, create } of stores) {
  test(`${name}: enqueue dedupes per target, claims only what is due, and sends in order`, async () => {
    const store = create();
    const time = clock();
    const first = store.enqueue([{ targetId: "t1", target, message: note("Digest", "digest:1") }, { targetId: "t1", target, message: note("Digest again", "digest:1") }, { targetId: "t2", target: { ...target, address: "https://discord.com/api/webhooks/2/b" }, message: note("Digest", "digest:1") }, { targetId: "t1", target, message: note("Later"), notBefore: new Date(start.getTime() + 3_600_000) }], time.now());
    assert.deepEqual(first, { queued: 3, duplicates: 1 });
    assert.deepEqual(store.counts(), { queued: 3, sending: 0, sent: 0, dead: 0 });
    const discord = scripted("discord", [{ ok: true, reference: "m1" }]);
    const report = await dispatchOutbox(store, registry(discord.channel), { now: time.now, sleep: async () => undefined });
    assert.deepEqual(report, { claimed: 2, sent: 2, retried: 0, dead: 0 });
    assert.deepEqual(discord.sent.map((entry) => entry.target.address), [target.address, "https://discord.com/api/webhooks/2/b"]);
    assert.deepEqual(store.counts(), { queued: 1, sending: 0, sent: 2, dead: 0 });
    time.advance(3_600_000);
    const later = await dispatchOutbox(store, registry(discord.channel), { now: time.now, sleep: async () => undefined });
    assert.equal(later.sent, 1);
    const recent = store.recent(10);
    assert.equal(recent.length, 3);
    assert.ok(recent.every((entry) => entry.status === "sent" && entry.attempts === 1));
    assert.equal(recent.find((entry) => entry.message.title === "Digest" && entry.targetId === "t1")?.reference, "m1");
    // A sent message with the same key is still a duplicate; a dead one is not.
    assert.deepEqual(store.enqueue([{ targetId: "t1", target, message: note("Digest", "digest:1") }], time.now()), { queued: 0, duplicates: 1 });
  });

  test(`${name}: retryable failures back off and die after the last attempt; gone targets are reported`, async () => {
    const store = create();
    const time = clock();
    store.enqueue([{ targetId: "t1", target, message: note("Flaky") }, { targetId: "t2", target: { kind: "telegram", address: "42" }, message: note("Blocked") }, { targetId: "t3", target: { kind: "email", address: "x@example.com" }, message: note("No channel") }], time.now());
    const discord = scripted("discord", [{ ok: false, error: "DISCORD_HTTP_429: slow down", retryable: true, gone: false, retryAfterMs: 2_000 }, { ok: false, error: "DISCORD_HTTP_500: oops", retryable: true, gone: false }, { ok: true, reference: "ok" }]);
    const telegram = scripted("telegram", [{ ok: false, error: "TELEGRAM_HTTP_403: bot was blocked", retryable: false, gone: true }]);
    const gone: string[] = [];
    const events: string[] = [];
    const options = { now: time.now, sleep: async () => undefined, maxAttempts: 3, backoffMs: [1_000, 10_000], onGone: (entry: { targetId: string }) => { gone.push(entry.targetId); }, onEvent: (event: { type: string }) => { events.push(event.type); } };
    const first = await dispatchOutbox(store, registry(discord.channel, telegram.channel), options);
    assert.deepEqual(first, { claimed: 3, sent: 0, retried: 1, dead: 2 });
    assert.deepEqual(gone, ["t2"]);
    assert.deepEqual(events.sort(), ["dead", "dead", "retry"]);
    const flaky = () => store.recent(10).find((entry) => entry.message.title === "Flaky")!;
    assert.equal(flaky().status, "queued");
    assert.equal(flaky().attempts, 1);
    assert.equal(flaky().nextAttemptAt, new Date(start.getTime() + 2_000).toISOString(), "the provider's retry-after wins over the backoff table");
    assert.match(store.recent(10).find((entry) => entry.message.title === "No channel")!.lastError ?? "", /CHANNEL_UNAVAILABLE: email/u);

    time.advance(1_000);
    assert.equal((await dispatchOutbox(store, registry(discord.channel), options)).claimed, 0, "not due yet");
    time.advance(1_000);
    const second = await dispatchOutbox(store, registry(discord.channel), options);
    assert.deepEqual(second, { claimed: 1, sent: 0, retried: 1, dead: 0 });
    assert.equal(flaky().nextAttemptAt, new Date(time.now().getTime() + 10_000).toISOString(), "second wait comes from the backoff table");
    time.advance(10_000);
    const third = await dispatchOutbox(store, registry(discord.channel), options);
    assert.deepEqual(third, { claimed: 1, sent: 1, retried: 0, dead: 0 });
    assert.equal(flaky().attempts, 3);

    // A message that keeps failing dies on the last allowed attempt.
    store.enqueue([{ targetId: "t1", target, message: note("Doomed") }], time.now());
    const failing = scripted("discord", [{ ok: false, error: "DISCORD_HTTP_503", retryable: true, gone: false }]);
    for (let round = 0; round < 3; round += 1) {
      await dispatchOutbox(store, registry(failing.channel), options);
      time.advance(20_000);
    }
    const doomed = store.recent(10).find((entry) => entry.message.title === "Doomed")!;
    assert.equal(doomed.status, "dead");
    assert.equal(doomed.attempts, 3);
    assert.equal(failing.sent.length, 3);
  });

  test(`${name}: an entry stuck in sending is claimed again after the stale window, and old rows purge`, async () => {
    const store = create();
    const time = clock();
    store.enqueue([{ targetId: "t1", target, message: note("Stuck") }], time.now());
    const claimed = store.claimDue(10, time.now(), 600_000);
    assert.equal(claimed.length, 1);
    assert.equal(store.claimDue(10, time.now(), 600_000).length, 0, "a claimed entry is not handed out twice");
    time.advance(601_000);
    const again = store.claimDue(10, time.now(), 600_000);
    assert.equal(again.length, 1);
    store.markSent(again[0]!.id, null, time.now());
    time.advance(30 * 86_400_000);
    assert.equal(store.purge(new Date(time.now().getTime() - 86_400_000)), 1);
    assert.deepEqual(store.counts(), { queued: 0, sending: 0, sent: 0, dead: 0 });
  });

  test(`${name}: a channel that throws is treated as a retryable failure`, async () => {
    const store = create();
    const time = clock();
    store.enqueue([{ targetId: "t1", target, message: note("Throws") }], time.now());
    const thrower: Channel = { kind: "discord", describe: () => "discord", send: async () => { throw new Error("socket hang up"); } };
    const report = await dispatchOutbox(store, registry(thrower), { now: time.now, sleep: async () => undefined });
    assert.deepEqual(report, { claimed: 1, sent: 0, retried: 1, dead: 0 });
    assert.match(store.recent(1)[0]!.lastError ?? "", /CHANNEL_THREW: socket hang up/u);
  });
}

test("sends on the same channel are paced, different channels are not", async () => {
  const store = createMemoryOutbox();
  const time = clock();
  store.enqueue([{ targetId: "a", target: { kind: "telegram", address: "1" }, message: note("one") }, { targetId: "b", target: { kind: "telegram", address: "2" }, message: note("two") }, { targetId: "c", target, message: note("three") }], time.now());
  const waits: number[] = [];
  await dispatchOutbox(store, registry(scripted("telegram", []).channel, scripted("discord", []).channel), { now: time.now, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [50]);
});
