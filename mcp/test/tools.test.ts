import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createClient, readSettings, runTool, toolDefinitions, type ToolContext } from "../src/index.ts";

type Call = { url: string; method: string; body: string | null; authorization: string | null; contentType: string | null };

const envelope = (payload: unknown, success = true, message = "OK") => new Response(JSON.stringify({ success, message, payload }), { status: success ? 200 : 400, headers: { "content-type": "application/json" } });

function recorder(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {});
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? (typeof init.body === "string" ? init.body : "<bytes>") : null,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, request };
}

const item = {
  id: "post-1",
  kind: "carousel" as const,
  title: "Five ways to save",
  caption: "භාණ්ඩ ගන්නකොට සල්ලි ඉතුරු කරන්න",
  link: "https://badumila.com",
  status: "ready" as const,
  tags: ["badumila"],
  assets: [{ id: "asset-1", position: 0, media_type: "image/jpeg", width: 1080, height: 1350, bytes: 1234, url: "https://badumila.com/content/a.jpg" }],
  schedules: [{ id: "sched-1", item_id: "post-1", platform: "instagram" as const, scheduled_for: "2026-09-25T13:00:00.000Z", status: "scheduled" as const, post_url: null, error: null, published_at: null }],
  created_at: "2026-09-21T06:00:00.000Z",
  updated_at: "2026-09-21T06:00:00.000Z",
};

const bench = (respond: (call: Call) => Response, canWrite = true) => {
  const { calls, request } = recorder(respond);
  const context: ToolContext = { client: createClient({ origin: "https://admin.example.test", token: "lpl_secret-token", fetch: request }), canWrite, now: () => new Date("2026-09-21T06:00:00.000Z") };
  const tool = (name: string) => toolDefinitions().find((definition) => definition.name === name)!;
  return { calls, context, tool };
};

test("the token travels in the header on every call and never in the address or the answer", async () => {
  const { calls, context, tool } = bench(() => envelope({ rows: [item], total: 1 }));
  const result = await runTool(tool("list_posts"), context, { search: "save" });
  assert.equal(calls[0]?.authorization, "Bearer lpl_secret-token");
  assert.ok(!calls[0]?.url.includes("lpl_secret-token"));
  assert.ok(!(result.content[0]?.text ?? "").includes("lpl_secret-token"));
  assert.ok(calls[0]?.url.endsWith("/v1/admin/distribution/library?search=save&limit=50"));
});

test("reading mode refuses everything that changes anything, and says how to arm it", async () => {
  const { calls, context, tool } = bench(() => envelope(item), false);
  for (const name of ["create_post", "update_post", "add_picture", "remove_picture", "schedule_post", "cancel_schedule", "post_now"]) {
    const result = await runTool(tool(name), context, { id: "post-1", schedule_id: "sched-1", title: "x", caption: "y", path: "/tmp/x.jpg", platform: "facebook", at: "2026-09-25T08:30:00Z", picture_id: "asset-1" });
    assert.equal(result.isError, true, `${name} should be refused`);
    assert.match(result.content[0]?.text ?? "", /reading mode|LPL_MCP_WRITE/u);
  }
  assert.equal(calls.length, 0, "nothing reached the admin");

  // Reading still works.
  assert.equal((await runTool(tool("read_post"), context, { id: "post-1" })).isError, undefined);
  assert.equal(calls.length, 1);
});

test("post_now shows what would go out and stops, until it is confirmed", async () => {
  const entry = { ...item.schedules[0]!, title: item.title, kind: item.kind, thumbnail: null };
  const { calls, context, tool } = bench((call) => {
    if (call.url.includes("/calendar")) return envelope({ from: "", to: "", entries: [entry] });
    if (call.url.includes("/preview")) return envelope({ facebook: { caption: "FB", blocker: null }, instagram: { caption: "IG caption", blocker: null }, pictures: [] });
    if (call.url.includes("/post")) return envelope({ ...item, schedules: [{ ...entry, status: "published", post_url: "https://www.instagram.com/p/X/" }] });
    return envelope(item);
  });

  const held = await runTool(tool("post_now"), context, { schedule_id: "sched-1" });
  assert.match(held.content[0]?.text ?? "", /confirm: true/u);
  assert.match(held.content[0]?.text ?? "", /IG caption/u, "it shows what would go out");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "nothing was published");

  const sent = await runTool(tool("post_now"), context, { schedule_id: "sched-1", confirm: true });
  assert.equal(sent.isError, undefined);
  const published = calls.find((call) => call.method === "POST" && call.url.includes("/schedules/sched-1/post"));
  assert.ok(published, "confirmed, it publishes");
});

test("a picture is read from disk and sent as the body; anything that is not one is refused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lpl-mcp-"));
  try {
    const picture = join(directory, "slide.png");
    await writeFile(picture, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const notPicture = join(directory, "notes.txt");
    await writeFile(notPicture, "hello");

    const { calls, context, tool } = bench(() => envelope(item));
    const added = await runTool(tool("add_picture"), context, { id: "post-1", path: picture });
    assert.equal(added.isError, undefined);
    assert.equal(calls[0]?.contentType, "image/png");
    assert.equal(calls[0]?.method, "POST");

    const refusedType = await runTool(tool("add_picture"), context, { id: "post-1", path: notPicture });
    assert.equal(refusedType.isError, true);
    assert.match(refusedType.content[0]?.text ?? "", /not a picture/u);

    const missing = await runTool(tool("add_picture"), context, { id: "post-1", path: join(directory, "nope.jpg") });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0]?.text ?? "", /could not be read/u);
    assert.equal(calls.length, 1, "only the real picture was sent");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a time that is not a time is refused before it reaches the admin", async () => {
  const { calls, context, tool } = bench(() => envelope(item));
  const bad = await runTool(tool("schedule_post"), context, { id: "post-1", platform: "facebook", at: "next tuesday" });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]?.text ?? "", /ISO 8601/u);
  assert.equal(calls.length, 0);

  const good = await runTool(tool("schedule_post"), context, { id: "post-1", platform: "facebook", at: "2026-09-25T08:30:00+05:30" });
  assert.equal(good.isError, undefined);
  assert.match(calls[0]?.body ?? "", /2026-09-25T03:00:00\.000Z/u, "the zone is honoured");
});

test("the admin's refusals are passed on in its own words, and a dead token says so plainly", async () => {
  const unauthorised = bench(() => new Response(JSON.stringify({ success: false, message: "Authentication required", payload: null }), { status: 401, headers: { "content-type": "application/json" } }));
  const dead = await runTool(unauthorised.tool("list_posts"), unauthorised.context, {});
  assert.equal(dead.isError, true);
  assert.match(dead.content[0]?.text ?? "", /revoked, or past its day/u);

  const narrow = bench(() => new Response(JSON.stringify({ success: false, message: "This token reaches the distribution part of the admin only", payload: null }), { status: 403, headers: { "content-type": "application/json" } }));
  const refused = await runTool(narrow.tool("channels_status"), narrow.context, {});
  assert.match(refused.content[0]?.text ?? "", /distribution part of the admin only/u);

  const offline = bench(() => {
    throw new Error("connect ECONNREFUSED");
  });
  const unreachable = await runTool(offline.tool("channels_status"), offline.context, {});
  assert.equal(unreachable.isError, true);
  assert.match(unreachable.content[0]?.text ?? "", /could not be reached/u);
});

test("the settings insist on a token that looks like ours and an address that is not plain http", () => {
  assert.match((readSettings({} as NodeJS.ProcessEnv) as { error: string }).error, /LPL_MCP_TOKEN is not set/u);
  assert.match((readSettings({ LPL_MCP_TOKEN: "hunter2" } as NodeJS.ProcessEnv) as { error: string }).error, /start with lpl_/u);
  assert.match((readSettings({ LPL_MCP_TOKEN: "lpl_x", LPL_MCP_ORIGIN: "http://badumila.com" } as NodeJS.ProcessEnv) as { error: string }).error, /https address/u);

  const reading = readSettings({ LPL_MCP_TOKEN: "lpl_x" } as NodeJS.ProcessEnv) as { origin: string; canWrite: boolean };
  assert.deepEqual([reading.origin, reading.canWrite], ["https://admin.badumila.com", false], "reading only until it is armed");
  assert.equal((readSettings({ LPL_MCP_TOKEN: "lpl_x", LPL_MCP_WRITE: "1" } as NodeJS.ProcessEnv) as { canWrite: boolean }).canWrite, true);
  assert.equal((readSettings({ LPL_MCP_TOKEN: "lpl_x", LPL_MCP_ORIGIN: "http://localhost:3000" } as NodeJS.ProcessEnv) as { origin: string }).origin, "http://localhost:3000");
});

test("every tool has a name, a description that says what it is for, and writing tools are marked", () => {
  const definitions = toolDefinitions();
  assert.ok(definitions.length >= 12);
  assert.equal(new Set(definitions.map((definition) => definition.name)).size, definitions.length, "no two tools share a name");
  for (const definition of definitions) {
    assert.match(definition.name, /^[a-z][a-z_]*$/u);
    assert.ok(definition.description.length > 40, `${definition.name} needs a real description`);
  }
  const writers = definitions.filter((definition) => definition.writes).map((definition) => definition.name);
  assert.deepEqual(writers.sort(), ["add_picture", "cancel_schedule", "create_post", "post_now", "remove_picture", "schedule_post", "update_post"]);
});
