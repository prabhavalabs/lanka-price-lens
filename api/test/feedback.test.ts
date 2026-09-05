import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { RateLimiter } from "../src/feedback.ts";

test("visitors can send feedback within a budget and the owner works through it in the admin", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  try {
    const app = createApp(database);
    const send = (body: unknown, address = "203.0.113.7") =>
      app.request("http://localhost/v1/public/feedback", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address, "user-agent": "TestBrowser/1.0" }, body: JSON.stringify(body) });

    assert.equal((await send({ kind: "bug", message: "short" })).status, 400, "a message needs a sentence");
    assert.equal((await send({ kind: "praise", message: "This is lovely, thank you very much" })).status, 400);
    assert.equal((await send({ kind: "feedback", message: "Prices for eggs look wrong on the board", email: "not-an-email" })).status, 400);
    const bot = await send({ kind: "feedback", message: "Buy cheap watches at my site please", website: "http://spam.example" });
    assert.equal(bot.status, 201, "a filled honeypot is accepted and dropped");
    const first = await send({ kind: "bug", message: "The chart does not load on my phone in Safari.", email: "reader@example.com", page: "https://price.example/p/product_potato" });
    assert.equal(first.status, 201);
    const stored = database.prepare("SELECT kind, message, email, page, user_agent, status FROM feedback").all() as Array<Record<string, unknown>>;
    assert.equal(stored.length, 1, "the bot's message was not stored");
    assert.deepEqual(stored[0], { kind: "bug", message: "The chart does not load on my phone in Safari.", email: "reader@example.com", page: "https://price.example/p/product_potato", user_agent: "TestBrowser/1.0", status: "new" });

    // The honeypot submission and the bug report used two of the five; three more go through, the sixth is refused.
    for (let index = 0; index < 3; index += 1) assert.equal((await send({ kind: "feedback", message: `Message number ${index} with enough words in it` })).status, 201);
    assert.equal((await send({ kind: "feedback", message: "One more message from the same connection today" })).status, 429, "five an hour per address");
    assert.equal((await send({ kind: "feedback", message: "A message from another connection is fine" }, "198.51.100.9")).status, 201);

    assert.equal((await app.request("http://localhost/v1/admin/feedback")).status, 401);
    const login = await app.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const list = (await (await app.request("http://localhost/v1/admin/feedback?status=new", { headers: { cookie } })).json()) as { payload: { items: Array<{ id: string; kind: string }>; total: number; counts: Record<string, number> } };
    assert.equal(list.payload.total, 5);
    assert.deepEqual(list.payload.counts, { new: 5, seen: 0, done: 0 });
    const bug = list.payload.items.find((item) => item.kind === "bug")!;
    const seen = await app.request(`http://localhost/v1/admin/feedback/${bug.id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ status: "seen" }) });
    assert.equal(seen.status, 200);
    assert.equal((await app.request(`http://localhost/v1/admin/feedback/${bug.id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ status: "archived" }) })).status, 400);
    assert.equal((await app.request("http://localhost/v1/admin/feedback/feedback_missing", { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ status: "done" }) })).status, 404);
    const after = (await (await app.request("http://localhost/v1/admin/feedback", { headers: { cookie } })).json()) as { payload: { counts: Record<string, number> } };
    assert.deepEqual(after.payload.counts, { new: 4, seen: 1, done: 0 });
  } finally {
    database.close();
  }
});

test("the rate limiter counts a sliding window", () => {
  const limiter = new RateLimiter(2, 1000);
  assert.deepEqual([limiter.allow("a", 0), limiter.allow("a", 100), limiter.allow("a", 200)], [true, true, false]);
  assert.equal(limiter.allow("a", 1100), true, "the first hit has left the window");
  assert.equal(limiter.allow("b", 200), true, "keys are independent");
});
