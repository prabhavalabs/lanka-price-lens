import assert from "node:assert/strict";
import test from "node:test";

import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { finishRun, openOperationalDatabase, startRun, syncSource } from "../src/db.ts";
import { failureCodeOf, retryableFailure, retryPolicyFor, runWithRetry } from "../src/retry.ts";

const manifest = sourceManifestSchema.parse({
  id: "retry_test",
  name: "Retry test",
  owner: "Test",
  landing_url: "https://example.invalid/",
  retrieval_method: "scheduled_download",
  expected_cadence: "daily",
  formats: ["pdf"],
  geographic_scope: "selected_wholesale_markets",
  price_types: ["wholesale_observed"],
  rights_status: "approved_permission",
  rights_evidence_ref: "test",
  attribution_text: "Test",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-01-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
  retry: { attempts: 3, cooldown_minutes: 5 },
});

test("a manifest carries a retry policy with defaults and command-line overrides", () => {
  const defaulted = sourceManifestSchema.parse({ ...manifest, retry: undefined });
  assert.deepEqual(defaulted.retry, { attempts: 3, cooldown_minutes: 10 });
  assert.deepEqual(manifest.retry, { attempts: 3, cooldown_minutes: 5 });
  assert.deepEqual(retryPolicyFor(manifest, { attempts: 1 }), { attempts: 1, cooldown_minutes: 5 });
  assert.deepEqual(retryPolicyFor(manifest, { cooldownMinutes: 0 }), { attempts: 3, cooldown_minutes: 0 });
  assert.ok(retryableFailure({ status: "failed", code: "SOURCE_HTTP_503" }));
  assert.ok(retryableFailure({ status: "failed", code: null }));
  assert.ok(!retryableFailure({ status: "blocked", code: "SOURCE_TEMPLATE_CHANGED" }), "a quarantined document is not an outage");
  assert.ok(!retryableFailure({ status: "failed", code: "SETTINGS_INVALID" }), "a bad setting is an operator mistake");
  assert.ok(!retryableFailure({ status: "skipped", code: "CAPTURE_PAUSED" }));
  assert.equal(failureCodeOf(new Error("SOURCE_HTTP_503: upstream down")), "SOURCE_HTTP_503");
  assert.equal(failureCodeOf(new Error("fetch failed")), null);
});

test("a failed run is retried after the cooldown, each attempt is its own linked run, and the last failure stands", async () => {
  const database = openOperationalDatabase(":memory:");
  syncSource(database, manifest);
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  try {
    // Two outages, then success.
    let calls = 0;
    const outcome = await runWithRetry(database, manifest.retry, { sourceId: manifest.id, workflow: "source_sync" }, async ({ attempt, final }) => {
      calls += 1;
      const run = startRun(database, { sourceId: manifest.id, trigger: "scheduled", workflow: "source_sync" });
      assert.deepEqual([attempt, final], [calls, calls === 3]);
      if (calls < 3) {
        finishRun(database, run.id, "failed", { code: "SOURCE_HTTP_503", message: "SOURCE_HTTP_503: down" });
        throw new Error("SOURCE_HTTP_503: down");
      }
      finishRun(database, run.id, "succeeded");
      return { runId: run.id, status: "succeeded", code: null };
    }, { wait });
    assert.deepEqual([outcome.attempts, outcome.result.status, waits, outcome.waitedMs], [3, "succeeded", [300_000, 300_000], 600_000]);
    const runs = database.prepare("SELECT id, status, attempt, retry_of FROM ingest_run WHERE source_id = ? ORDER BY started_at, rowid").all(manifest.id) as Array<{ id: string; status: string; attempt: number; retry_of: string | null }>;
    assert.deepEqual(runs.map((run) => [run.status, run.attempt]), [["failed", 1], ["failed", 2], ["succeeded", 3]]);
    assert.deepEqual(runs.map((run) => run.retry_of), [null, runs[0]!.id, runs[1]!.id], "each attempt points at the run it retries");

    // A failure a retry cannot help with ends the attempts at once.
    waits.length = 0;
    const settings = await runWithRetry(database, manifest.retry, { sourceId: manifest.id, workflow: "retail_capture" }, async () => ({ runId: null, status: "failed", code: "SETTINGS_INVALID" }), { wait });
    assert.deepEqual([settings.attempts, waits], [1, []]);

    // When every attempt fails the failure stands and the error surfaces.
    waits.length = 0;
    let attempts = 0;
    await assert.rejects(
      runWithRetry(database, { attempts: 2, cooldown_minutes: 1 }, { sourceId: manifest.id, workflow: "source_sync" }, async () => { attempts += 1; throw new Error("fetch failed"); }, { wait }),
      /fetch failed/u,
    );
    assert.deepEqual([attempts, waits], [2, [60_000]]);
    // A policy of one attempt never waits.
    const once = await runWithRetry(database, { attempts: 1, cooldown_minutes: 30 }, { sourceId: manifest.id, workflow: "source_sync" }, async () => ({ runId: null, status: "failed", code: "SOURCE_HTTP_500" }), { wait });
    assert.deepEqual([once.attempts, once.result.status, once.waitedMs], [1, "failed", 0]);
  } finally {
    database.close();
  }
});
