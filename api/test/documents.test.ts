import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";

const manifest = sourceManifestSchema.parse({
  id: "harti",
  name: "HARTI",
  owner: "HARTI",
  landing_url: "https://harti.invalid/daily",
  retrieval_method: "scheduled_download",
  expected_cadence: "daily",
  formats: ["pdf"],
  geographic_scope: "selected_wholesale_markets",
  price_types: ["wholesale_observed"],
  rights_status: "approved_permission",
  rights_evidence_ref: "docs/source-permission.md",
  attribution_text: "Source: HARTI",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-01-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 1,
  retry: { attempts: 1, cooldown_minutes: 0 },
  enabled: true,
});

test("document sync and pending processing routes validate their input and start background work for the owner", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  try {
    const app = createApp(database, manifest, undefined, {
      archiveStorage: { bucket: "test", list: async () => new Map(), put: async () => undefined, get: async () => null, uri: (key: string) => `memory://test/${key}` } as never,
    });
    const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? null : JSON.stringify(body) });

    assert.equal((await post("/v1/admin/sources/harti/sync", {})).status, 401);
    const login = await post("/v1/auth/login", { email: "owner@example.com", password: "correct horse battery staple" });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    assert.equal((await post("/v1/admin/sources/nowhere/sync", {}, { cookie })).status, 404);
    assert.equal((await post("/v1/admin/sources/harti/sync", { mode: "everything" }, { cookie })).status, 400);
    assert.equal((await post("/v1/admin/sources/harti/sync", { mode: "backfill", from: "2026-09-01", to: "2026-08-01" }, { cookie })).status, 400);
    assert.equal((await post("/v1/admin/sources/harti/sync", { from: "yesterday" }, { cookie })).status, 400);
    assert.equal((await post("/v1/admin/sources/harti/sync", { limit: 0 }, { cookie })).status, 400);
    assert.equal((await post("/v1/admin/sources/harti/process-pending", { since: "last week" }, { cookie })).status, 400);

    const nothing = await post("/v1/admin/sources/harti/process-pending", {}, { cookie });
    assert.equal(nothing.status, 200);
    const summary = (await nothing.json()) as { payload: { candidates: number }; message: string };
    assert.deepEqual([summary.payload.candidates, summary.message], [0, "Nothing to process"]);

    const started = await post("/v1/admin/sources/harti/sync", { mode: "backfill", from: "2026-08-01", to: "2026-08-02", limit: 5 }, { cookie });
    const startedBody = await started.text();
    assert.equal(started.status, 202, startedBody);
    const run = JSON.parse(startedBody) as { payload: { id: string; workflow: string; trigger: string; mode: string; from: string; limit: number } };
    assert.deepEqual([run.payload.workflow, run.payload.trigger, run.payload.mode, run.payload.from, run.payload.limit], ["source_sync", "backfill", "backfill", "2026-08-01", 5]);
    // The background sync reaches an unreachable host and records its failure; the run row exists either way.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const row = database.prepare("SELECT status FROM ingest_run WHERE id = ?").get(run.payload.id) as { status: string };
      if (row.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const finished = database.prepare("SELECT status FROM ingest_run WHERE id = ?").get(run.payload.id) as { status: string };
    assert.notEqual(finished.status, "running");
  } finally {
    database.close();
  }
});
