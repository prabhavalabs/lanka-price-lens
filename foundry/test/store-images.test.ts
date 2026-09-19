import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openOperationalDatabase, type OperationalDatabase } from "../src/db.ts";
import { disabledImageSources, fetchStoreImages, imageKind, imageRules, purgeStoreImages, storeImagesRoot } from "../src/retail/images.ts";
import { syncStoreProducts } from "../src/retail/store-products.ts";
import type { FetchLike } from "../src/retail/types.ts";

const jpeg = (fill: number, length = 64): Uint8Array => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length }, () => fill)]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 32 }, () => 1)]);

function seeded(): { database: OperationalDatabase; root: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "lpl-store-images-"));
  const database = openOperationalDatabase(join(directory, "operations.sqlite"));
  const now = "2026-09-19T02:00:00.000Z";
  database.exec(`
    INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at)
    VALUES ('keells', '{}', 'Keells', 'JKH', 'https://keells.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('spar', '{}', 'SPAR', 'SPAR', 'https://spar.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}');
    INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status, first_seen_at, last_seen_at)
    VALUES ('pub_k', 'keells', 'k1', 'Snapshot', '${now}', '2026-09-19', '2026-09-19', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_s', 'spar', 's1', 'Snapshot', '${now}', '2026-09-19', '2026-09-19', 'u', 'u', 'canonicalized', '${now}', '${now}');
    INSERT INTO ingest_run (id, source_id, trigger, status, started_at, heartbeat_at, lease_expires_at) VALUES ('run_1', 'keells', 'manual', 'succeeded', '${now}', '${now}', '${now}');
    INSERT INTO source_artifact (id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status)
    VALUES ('art_k', 'pub_k', 'u', 'u', '${now}', 'application/json', 1, 'a', 'canonicalized'), ('art_s', 'pub_s', 'u', 'u', '${now}', 'application/json', 1, 'b', 'canonicalized');
  `);
  return { database, root: join(directory, "store-images"), cleanup: () => { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function stage(database: OperationalDatabase, id: string, artifact: string, rowRef: string, label: string, raw: Record<string, unknown>, status = "validated", date = "2026-09-19"): void {
  database
    .prepare(
      `INSERT INTO staging_observation (id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label, source_date, price_type, currency, source_quantity, source_unit, min_value_minor, max_value_minor, status, raw_json)
       VALUES (?, 'run_1', ?, ?, ?, 'Store', ?, 'retail_online_store', 'LKR', '1', 'piece', 10000, 10000, ?, ?)`,
    )
    .run(id, artifact, rowRef, label, date, status, JSON.stringify(raw));
}

const offer = { list_minor: 12_000, offer_minor: 10_000, kind: "mrp", audience: "everyone" };
const at = new Date("2026-09-19T03:00:00.000Z");

/** A transport that answers from a table and remembers what it was asked. */
function transport(table: Record<string, Uint8Array | number | Error>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const answer = table[url];
    if (answer instanceof Error) throw answer;
    if (typeof answer === "number") return new Response("no", { status: answer });
    if (!answer) return new Response("no", { status: 404 });
    return new Response(new Blob([Buffer.from(answer)]), { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as FetchLike & { calls: string[] };
  http.calls = calls;
  return http;
}

test("store items on offer are kept with their page and the original address of their picture; a new address re-queues the picture", () => {
  const { database, cleanup } = seeded();
  try {
    stage(database, "s1", "art_k", "128298", "Popcorn Butter 25g", { offer, url: "https://www.keellssuper.com/productDetail?itemcode=128298&Popcorn", image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic128298.jpg" });
    stage(database, "s2", "art_k", "200", "No Offer Tea", { url: "https://www.keellssuper.com/productDetail?itemcode=200&Tea", image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic200.jpg" });
    stage(database, "s3", "art_k", "300", "Stale Soap", { offer, image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic300.jpg" }, "stale");
    stage(database, "s4", "art_s", "1:11", "CUCUMBER", { offer, url: "https://evil.example/cucumber", image: "https://evil.example/c.jpg" });
    stage(database, "s5", "art_k", "400", "Old Offer", { offer, image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic400.jpg" }, "validated", "2026-09-01");

    assert.deepEqual(syncStoreProducts(database, { now: at }), { scanned: 2, added: 2, updated: 0, repictured: 0 }, "only fresh, non-stale rows that carry an offer");
    const rows = database.prepare("SELECT source_id, row_ref, label, page_url, image_source_url, image_status FROM store_product ORDER BY source_id").all();
    assert.deepEqual(rows, [
      { source_id: "keells", row_ref: "128298", label: "Popcorn Butter 25g", page_url: "https://www.keellssuper.com/productDetail?itemcode=128298&Popcorn", image_source_url: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic128298.jpg", image_status: "pending" },
      { source_id: "spar", row_ref: "1:11", label: "CUCUMBER", page_url: null, image_source_url: null, image_status: "none" },
    ], "addresses off the stores' hosts are dropped where they are read");

    database.prepare("UPDATE store_product SET image_status = 'stored', image_path = 'keells/ab/old.jpg' WHERE row_ref = '128298'").run();
    assert.deepEqual(syncStoreProducts(database, { now: at, sourceId: "keells" }), { scanned: 1, added: 0, updated: 1, repictured: 0 }, "the same picture address is left alone");
    database.prepare("UPDATE staging_observation SET raw_json = ? WHERE id = 's1'").run(JSON.stringify({ offer, image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic128298v2.jpg" }));
    assert.equal(syncStoreProducts(database, { now: at }).repictured, 1);
    assert.deepEqual(database.prepare("SELECT image_status, image_path, page_url FROM store_product WHERE row_ref = '128298'").get(), { image_status: "pending", image_path: "keells/ab/old.jpg", page_url: "https://www.keellssuper.com/productDetail?itemcode=128298&Popcorn" }, "the old copy keeps showing, and a missing link never erases a known one");
  } finally {
    cleanup();
  }
});

test("pictures are fetched directly first, through the proxy only after a failure a proxy could cure, checked as images, and stored once by content", async () => {
  const { database, root, cleanup } = seeded();
  try {
    const host = "https://essstr.blob.core.windows.net/essimg/350x/Small/";
    const insert = database.prepare("INSERT INTO store_product (source_id, row_ref, label, image_source_url, image_status, first_seen_at, last_seen_at) VALUES ('keells', ?, ?, ?, 'pending', ?, ?)");
    const items: Array<[string, string]> = [["1", `${host}a.jpg`], ["2", `${host}same-as-a.jpg`], ["3", `${host}gone.jpg`], ["4", `${host}blocked.jpg`], ["5", `${host}html.jpg`], ["6", "https://evil.example/x.jpg"], ["7", `${host}down.jpg`], ["8", `${host}p.png`]];
    for (const [ref, url] of items) insert.run(ref, `Item ${ref}`, url, at.toISOString(), at.toISOString());

    const direct = transport({ [`${host}a.jpg`]: jpeg(7), [`${host}same-as-a.jpg`]: jpeg(7), [`${host}gone.jpg`]: 404, [`${host}blocked.jpg`]: 403, [`${host}html.jpg`]: new TextEncoder().encode("<html>blocked, sorry, this is not a picture</html>"), [`${host}down.jpg`]: new Error("ECONNRESET"), [`${host}p.png`]: png });
    const proxy = transport({ [`${host}blocked.jpg`]: jpeg(9), [`${host}down.jpg`]: new Error("ECONNRESET") });
    const result = await fetchStoreImages(database, { root, http: direct, proxyFor: () => proxy, now: at, gapMs: 0 });
    assert.deepEqual(result, { attempted: 8, stored: 3, reused: 1, missing: 1, failed: 3, via_proxy: 1, bytes: jpeg(7).byteLength * 2 + jpeg(9).byteLength + png.byteLength });
    assert.deepEqual(proxy.calls.sort(), [`${host}blocked.jpg`, `${host}down.jpg`], "the proxy is asked only after a block or an outage, never for a picture that is simply not there");
    assert.ok(!direct.calls.includes("https://evil.example/x.jpg"), "an address off the stores' image hosts is never requested");

    const rows = database.prepare("SELECT row_ref, image_status, image_via, image_path, image_content_type, image_error, next_attempt_at IS NOT NULL AS retry FROM store_product ORDER BY row_ref").all() as Array<Record<string, unknown>>;
    const byRef = Object.fromEntries(rows.map((row) => [row.row_ref, row]));
    assert.equal(byRef["1"]?.image_path, byRef["2"]?.image_path, "an identical picture is one file");
    assert.match(String(byRef["1"]?.image_path), /^keells\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/u);
    assert.deepEqual([byRef["4"]?.image_status, byRef["4"]?.image_via], ["stored", "proxy"]);
    assert.deepEqual([byRef["3"]?.image_status, byRef["3"]?.retry], ["missing", 1], "looked for again in two weeks");
    assert.deepEqual([byRef["5"]?.image_status, byRef["5"]?.image_error], ["failed", "NOT_AN_IMAGE"]);
    assert.deepEqual([byRef["6"]?.image_status, byRef["6"]?.image_error, byRef["6"]?.retry], ["failed", "IMAGE_HOST_NOT_ALLOWED", 0]);
    assert.equal(byRef["8"]?.image_content_type, "image/png");
    assert.deepEqual(readFileSync(join(root, String(byRef["1"]?.image_path))), Buffer.from(jpeg(7)));
    assert.equal(readdirSync(join(root, "keells")).length >= 2, true);

    const again = await fetchStoreImages(database, { root, http: direct, now: at, gapMs: 0 });
    assert.equal(again.attempted, 0, "stored pictures are never fetched again, and failures wait for their time");
    const later = await fetchStoreImages(database, { root, http: transport({ [`${host}down.jpg`]: jpeg(3) }), now: new Date(at.getTime() + 2 * 86_400_000), gapMs: 0 });
    assert.deepEqual([later.attempted, later.stored], [2, 1], "the outage and the non-image are retried after their backoff; the one that works is kept");

    // Generated product photos live in another tree; nothing here can reach them.
    const generated = join(root, "..", "images-products-tomato.jpg");
    writeFileSync(generated, "generated");
    assert.deepEqual(purgeStoreImages(database, root, "keells"), { rows: 8 });
    assert.equal(existsSync(join(root, "keells")), false);
    assert.equal(readFileSync(generated, "utf8"), "generated");
    assert.equal((database.prepare("SELECT COUNT(*) AS n FROM store_product WHERE image_path IS NOT NULL OR image_status != 'none'").get() as { n: number }).n, 0);
    assert.throws(() => purgeStoreImages(database, root, "../etc"), /SOURCE_ID_INVALID/u);
  } finally {
    cleanup();
  }
});

test("a disabled source is left alone, failures stop after the attempt cap, and the root sits beside the database unless set", async () => {
  const { database, root, cleanup } = seeded();
  try {
    const url = "https://cdn.shopify.com/s/files/1/x/a.jpg";
    database.prepare("INSERT INTO store_product (source_id, row_ref, label, image_source_url, image_status, image_attempts, first_seen_at, last_seen_at) VALUES ('spar', '1', 'A', ?, 'pending', ?, ?, ?)").run(url, imageRules.maxAttempts - 1, at.toISOString(), at.toISOString());
    assert.equal((await fetchStoreImages(database, { root, http: transport({ [url]: jpeg(1) }), skipSources: ["spar"], now: at, gapMs: 0 })).attempted, 0);
    await fetchStoreImages(database, { root, http: transport({ [url]: 500 }), now: at, gapMs: 0 });
    assert.deepEqual(database.prepare("SELECT image_status, image_attempts, next_attempt_at FROM store_product").get(), { image_status: "failed", image_attempts: imageRules.maxAttempts, next_attempt_at: null }, "after the last attempt it is not queued again");

    assert.deepEqual(disabledImageSources({ LPL_STORE_IMAGES_DISABLED: " keells_online_prices, spar_online_prices ,," }), ["keells_online_prices", "spar_online_prices"]);
    assert.equal(storeImagesRoot({ LPL_DATABASE_PATH: "/data/operations.sqlite" }), "/data/store-images");
    assert.equal(storeImagesRoot({ LPL_STORE_IMAGES_DIR: "/srv/pictures", LPL_DATABASE_PATH: "/data/operations.sqlite" }), "/srv/pictures");
    assert.equal(imageKind(new TextEncoder().encode("<!doctype html><html></html>")), null);
    assert.equal(imageKind(Uint8Array.from([0xff, 0xd8]))?.type, undefined, "too short to be anything");
  } finally {
    cleanup();
  }
});
