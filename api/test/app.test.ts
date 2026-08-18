import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase, startRun, syncSource } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";

const salt = "0123456789abcdef0123456789abcdef";
const passwordHash = `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
const manifest = sourceManifestSchema.parse({
  id: "test_source",
  name: "Test source",
  owner: "Test owner",
  landing_url: "https://example.com/prices",
  retrieval_method: "scheduled_download",
  expected_cadence: "business_daily",
  formats: ["pdf"],
  geographic_scope: "test",
  price_types: ["wholesale_observed"],
  rights_status: "unknown",
  rights_evidence_ref: null,
  attribution_text: null,
  retention_policy: "metadata_and_checksum_only",
  parser_owner: null,
  reviewed_by: null,
  reviewed_at: "2026-08-17",
  review_due_at: "2026-11-17",
  request_interval_ms: 1000,
  max_attempts: 1,
  enabled: false,
});

test("manual upload requires owner authentication and a real PDF signature", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "owner@example.com", passwordHash);
    const app = createApp(database, manifest);
    assert.equal((await app.request("/v1/admin/uploads")).status, 401);
    const cookie = await loginCookie(app);

    const form = new FormData();
    form.set("file", new File(["not a PDF"], "prices.pdf", { type: "application/pdf" }));
    const response = await app.request("/v1/admin/uploads", { method: "POST", headers: { cookie }, body: form });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { message: string }).message, "File signature is not a PDF");
  } finally {
    database.close();
  }
});

test("owner ingestion rejects cross-origin requests and overlapping runs", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "owner@example.com", passwordHash);
    const approved = sourceManifestSchema.parse({
      ...manifest,
      rights_status: "approved_permission",
      rights_evidence_ref: "test-fixture://permission",
      attribution_text: "Test source fixture",
      reviewed_by: "fixture-reviewer",
      review_due_at: "2999-12-31",
      enabled: true,
    });
    syncSource(database, approved);
    const active = startRun(database, { sourceId: approved.id, trigger: "backfill" });
    const app = createApp(database, approved);
    const cookie = await loginCookie(app);

    const crossOrigin = await app.request("http://localhost/v1/admin/ingestion/backfill", {
      method: "POST",
      headers: { cookie, origin: "https://example.net" },
    });
    assert.equal(crossOrigin.status, 403);

    const overlap = await app.request("http://localhost/v1/admin/ingestion/backfill", {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(overlap.status, 409);
    assert.equal(((await overlap.json()) as { payload: { id: string } }).payload.id, active.id);
  } finally {
    database.close();
  }
});

async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request("http://localhost/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie ?? "", /HttpOnly/u);
  assert.match(setCookie ?? "", /SameSite=Strict/u);
  return setCookie!.split(";", 1)[0]!;
}
