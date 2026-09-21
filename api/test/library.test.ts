import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { createChannels, createMemoryOutbox, facebookText, instagramText } from "@lanka-pricelens/notify";
import sharp from "sharp";

import { createSocialStore } from "../src/social/accounts.ts";
import { createLibraryStore } from "../src/social/library.ts";
import { contentMessage, publishBlocker, publishSchedule, runDueSchedules } from "../src/social/publish.ts";

const now = new Date("2026-09-21T06:00:00.000Z");
const page = { id: "1234567890", name: "PriceLens", token: "PAGE-TOKEN", link: "https://www.facebook.com/pricelens", canPost: true };
const instagram = { id: "17841400000000000", username: "badumila", name: "බඩු මිල", picture: null, pageId: page.id, pageName: page.name, token: "PAGE-TOKEN", canPost: true };

/** A picture in a format Instagram will not take, to prove the library re-encodes what it is given. */
const png = (width: number, height: number): Promise<Buffer> => sharp({ create: { width, height, channels: 4, background: { r: 6, g: 95, b: 70, alpha: 1 } } }).png().toBuffer();

async function bench() {
  const directory = await mkdtemp(join(tmpdir(), "lpl-content-"));
  const database = openOperationalDatabase(":memory:");
  const library = createLibraryStore(database, directory, "https://badumila.test");
  const accounts = createSocialStore(database, "state-secret");
  return { directory, database, library, accounts, close: async () => { database.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("a post grows from words to a carousel as pictures are added, and every picture becomes a JPEG", async () => {
  const kit = await bench();
  try {
    const draft = kit.library.create({ title: "Five ways to save", caption: "භාණ්ඩ ගන්නකොට සල්ලි ඉතුරු කරන්න", tags: ["badumila", "SriLanka"] }, "owner@example.com", now);
    assert.deepEqual([draft.kind, draft.status, draft.assets.length, draft.tags], ["text", "draft", 0, ["badumila", "SriLanka"]]);

    const one = await kit.library.addAsset(draft.id, await png(2000, 2500), now);
    assert.ok(!("error" in one));
    assert.equal(kit.library.read(draft.id)?.kind, "image");
    // The upload was a tall PNG; what is kept is a JPEG no wider than the platforms read.
    assert.equal(one.media_type, "image/jpeg");
    assert.equal(one.width, 1440);
    assert.equal(one.height, 1800);
    assert.match(one.file, /^[0-9a-f]{32}\.jpg$/u);
    assert.equal(one.url, `https://badumila.test/content/${one.file}`);
    assert.equal((await sharp(join(kit.directory, one.file)).metadata()).format, "jpeg");

    await kit.library.addAsset(draft.id, await png(1080, 1350), now);
    const set = kit.library.read(draft.id)!;
    assert.equal(set.kind, "carousel");
    assert.deepEqual(set.assets.map((asset) => asset.position), [0, 1]);

    // Removing the first closes the gap, so the order the owner sees is the order Instagram gets.
    await kit.library.removeAsset(draft.id, set.assets[0]!.id);
    const left = kit.library.read(draft.id)!;
    assert.deepEqual([left.kind, left.assets.length, left.assets[0]!.position], ["image", 1, 0]);
    assert.deepEqual(await readdir(kit.directory), [left.assets[0]!.file], "the dropped picture's file is gone too");

    assert.ok("error" in (await kit.library.addAsset(draft.id, Buffer.from("not a picture"), now)));
    assert.ok("error" in (await kit.library.addAsset("no-such-post", await png(100, 100), now)));
  } finally {
    await kit.close();
  }
});

test("deleting a post takes its pictures off the disk with it", async () => {
  const kit = await bench();
  try {
    const item = kit.library.create({ title: "Draft", caption: "Words" }, null, now);
    await kit.library.addAsset(item.id, await png(400, 400), now);
    assert.equal((await readdir(kit.directory)).length, 1);
    assert.equal(await kit.library.remove(item.id), true);
    assert.deepEqual(await readdir(kit.directory), []);
    assert.equal(await kit.library.remove(item.id), false);
  } finally {
    await kit.close();
  }
});

test("the message a post makes is the caption as written, with every picture in order", async () => {
  const kit = await bench();
  try {
    const item = kit.library.create({ title: "Lime", caption: "දෙහි මිල රු. 2,047 දක්වා ගියා", link: "https://badumila.com/deals", tags: ["badumila"] }, null, now);
    await kit.library.addAsset(item.id, await png(1080, 1350), now);
    await kit.library.addAsset(item.id, await png(1080, 1350), now);
    const full = kit.library.read(item.id)!;
    const rendered = contentMessage(full, "content:test");

    assert.equal(rendered.title, "දෙහි මිල රු. 2,047 දක්වා ගියා", "the caption goes out as it was written");
    assert.equal(rendered.images?.length, 2);
    assert.deepEqual(rendered.images?.map((picture) => picture.url), full.assets.map((asset) => asset.url));
    assert.equal(rendered.image?.url, full.assets[0]!.url, "a channel that shows one picture still has one");
    assert.ok(facebookText(rendered).includes("https://badumila.com/deals"), "Facebook gets the link");
    assert.ok(instagramText(rendered).includes("badumila.com/deals"), "Instagram is given it in words");
    assert.ok(!instagramText(rendered).includes("https://"), "because a caption there cannot be tapped");
    assert.ok(instagramText(rendered).endsWith("#badumila"));
  } finally {
    await kit.close();
  }
});

test("a caption of the length a real post runs to goes out whole", async () => {
  const kit = await bench();
  try {
    // What the owner actually writes: a few hundred words of Sinhala, well past a headline's length.
    const caption = `දෙහි මිල තව ඉහළ යනවා.\n\n${"අවුරුදු දහයක තොග මිල දත්ත බැලුවම පැහැදිලි රටාවක් තියෙනවා. ".repeat(12)}`;
    assert.ok(caption.length > 200, "the case this guards is a caption longer than a headline");
    const item = kit.library.create({ title: "Lime season", caption, link: "https://badumila.com", tags: ["badumila"] }, null, now);
    await kit.library.addAsset(item.id, await png(1080, 1350), now);
    const rendered = contentMessage(kit.library.read(item.id)!, "content:long");

    assert.equal(rendered.title, caption.trim(), "nothing is reworded or cut on the way out");
    assert.ok(facebookText(rendered).startsWith("දෙහි මිල තව ඉහළ යනවා."));
    assert.ok(instagramText(rendered).startsWith("දෙහි මිල තව ඉහළ යනවා."));
  } finally {
    await kit.close();
  }
});

test("what stands between a post and a platform is said plainly", async () => {
  const kit = await bench();
  try {
    const words = kit.library.create({ title: "Words only", caption: "No picture here" }, null, now);
    assert.equal(publishBlocker(kit.accounts, "instagram", words), "Connect an Instagram account first");
    kit.accounts.connect({ pages: [page], instagram: [instagram] }, "Nipun", now);
    assert.equal(publishBlocker(kit.accounts, "facebook", words), null, "Facebook takes a post with only words");
    assert.equal(publishBlocker(kit.accounts, "instagram", words), "Instagram takes no post without a picture");

    kit.accounts.markToken("facebook", page.id, { valid: false, error: "FACEBOOK_190: session invalidated" }, now);
    assert.equal(publishBlocker(kit.accounts, "facebook", words), "PriceLens needs connecting again");
  } finally {
    await kit.close();
  }
});

test("a scheduled post goes out when its moment comes, once, and the row records where it landed", async () => {
  const kit = await bench();
  try {
    kit.accounts.connect({ pages: [page], instagram: [instagram] }, "Nipun", now);
    const item = kit.library.create({ title: "Lime", caption: "දෙහි මිල", status: "ready" }, null, now);
    await kit.library.addAsset(item.id, await png(1080, 1350), now);
    const when = new Date(now.getTime() + 60_000);
    kit.library.schedule(item.id, "instagram", when, "owner@example.com", now);

    const calls: string[] = [];
    const request = (async (url: string | URL) => {
      calls.push(new URL(String(url)).pathname);
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/media_publish")) return new Response(JSON.stringify({ id: "MEDIA-1" }), { headers: { "content-type": "application/json" } });
      if (path.endsWith("/media")) return new Response(JSON.stringify({ id: "CONTAINER-1" }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ permalink: "https://www.instagram.com/p/XYZ/" }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const outbox = createMemoryOutbox();
    const deps = {
      accounts: kit.accounts,
      content: kit.library,
      outbox,
      channels: () => createChannels({ instagram: { accountToken: (id: string) => kit.accounts.tokenFor("instagram", id), sleep: async () => {}, readyTimeoutMs: 0 }, fetch: request }),
      log: () => undefined,
    };

    // Nothing is due yet.
    assert.deepEqual(await runDueSchedules({ ...deps, now: () => now }), { due: 0, published: 0, failed: 0 });
    assert.equal(calls.length, 0);

    const later = new Date(when.getTime() + 1000);
    assert.deepEqual(await runDueSchedules({ ...deps, now: () => later }), { due: 1, published: 1, failed: 0 });
    const published = kit.library.read(item.id)!.schedules[0]!;
    assert.deepEqual([published.status, published.post_url], ["published", "https://www.instagram.com/p/XYZ/"]);
    assert.ok(published.published_at);

    // A second tick finds nothing: the row is no longer scheduled, so the post cannot go out twice.
    const before = calls.length;
    assert.deepEqual(await runDueSchedules({ ...deps, now: () => later }), { due: 0, published: 0, failed: 0 });
    assert.equal(calls.length, before);
  } finally {
    await kit.close();
  }
});

test("a post the platform refuses is marked failed with the reason, and is not tried again on its own", async () => {
  const kit = await bench();
  try {
    kit.accounts.connect({ pages: [page], instagram: [] }, "Nipun", now);
    const item = kit.library.create({ title: "Notice", caption: "Something to say" }, null, now);
    const row = kit.library.schedule(item.id, "facebook", now, null, now)!;
    const request = (async () => new Response(JSON.stringify({ error: { message: "(#200) Permissions error", code: 200 } }), { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;
    const outbox = createMemoryOutbox();
    const outcome = await publishSchedule(
      { accounts: kit.accounts, content: kit.library, outbox, channels: () => createChannels({ facebook: { pageToken: (id: string) => kit.accounts.tokenFor("facebook", id) }, fetch: request }), now: () => now, log: () => undefined },
      row,
      kit.library.read(item.id)!,
    );
    assert.equal(outcome.ok, false);
    const failed = kit.library.read(item.id)!.schedules[0]!;
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /FACEBOOK_200/u);
    // The owner can call it off and plan it again; nothing retries behind their back.
    assert.equal(kit.library.cancelSchedule(row.id, now), true);
    assert.equal(kit.library.read(item.id)!.schedules[0]!.status, "cancelled");
    assert.deepEqual(kit.library.due(new Date(now.getTime() + 86_400_000), 10), []);
  } finally {
    await kit.close();
  }
});

test("the calendar answers for a span of time and carries enough of each post to show it", async () => {
  const kit = await bench();
  try {
    const item = kit.library.create({ title: "Planting", caption: "දැන් හිටවන්න" }, null, now);
    const asset = await kit.library.addAsset(item.id, await png(1080, 1350), now);
    assert.ok(!("error" in asset));
    kit.library.schedule(item.id, "facebook", new Date("2026-09-25T02:30:00.000Z"), null, now);
    kit.library.schedule(item.id, "instagram", new Date("2026-09-25T12:30:00.000Z"), null, now);
    kit.library.schedule(item.id, "facebook", new Date("2026-11-01T02:30:00.000Z"), null, now);

    const week = kit.library.calendar("2026-09-22T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
    assert.equal(week.length, 2);
    assert.deepEqual(week.map((entry) => entry.platform), ["facebook", "instagram"]);
    assert.deepEqual([week[0]!.title, week[0]!.kind, week[0]!.status], ["Planting", "image", "scheduled"]);
    assert.equal(week[0]!.thumbnail, asset.url, "the calendar shows the post's first picture");
    assert.equal(kit.library.calendar("2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z").length, 1);
  } finally {
    await kit.close();
  }
});

test("the library lists, searches, and keeps what is archived out of the way", async () => {
  const kit = await bench();
  try {
    kit.library.create({ title: "Lime prices", caption: "දෙහි", tags: ["data"] }, null, now);
    kit.library.create({ title: "Planting guide", caption: "ගෙවතු වගාව", tags: ["garden"] }, null, now);
    const old = kit.library.create({ title: "Last year", caption: "Old news" }, null, now);
    kit.library.update(old.id, { title: "Last year", caption: "Old news", status: "archived" }, now);

    assert.equal(kit.library.list({ limit: 50, offset: 0 }).total, 2, "archived posts stay out of the way");
    assert.equal(kit.library.list({ status: "archived", limit: 50, offset: 0 }).total, 1);
    assert.equal(kit.library.list({ search: "lime", limit: 50, offset: 0 }).total, 1);
    assert.equal(kit.library.list({ search: "garden", limit: 50, offset: 0 }).total, 1, "tags are searched too");
    assert.equal(kit.library.list({ limit: 1, offset: 0 }).rows.length, 1);
    assert.equal(kit.library.update("no-such-post", { title: "x", caption: "y" }, now), undefined);
  } finally {
    await kit.close();
  }
});
