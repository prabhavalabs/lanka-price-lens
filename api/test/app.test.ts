import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { finishRun, openOperationalDatabase, startRun, syncSource } from "@lanka-pricelens/foundry/db";
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

test("login reports remaining attempts and a temporary lock", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "owner@example.com", passwordHash);
    const app = createApp(database, manifest);
    for (const attemptsRemaining of [4, 3, 2, 1]) {
      const response = await loginRequest(app, "incorrect");
      assert.equal(response.status, 401);
      assert.deepEqual((await response.json()).payload, { reason: "invalid_credentials", attempts_remaining: attemptsRemaining });
    }
    const locked = await loginRequest(app, "incorrect");
    assert.equal(locked.status, 423);
    assert.equal(locked.headers.get("retry-after"), "900");
    const body = (await locked.json()) as { message: string; payload: { reason: string; attempts_remaining: number; locked_until: string; retry_after_seconds: number } };
    assert.equal(body.message, "Sign-in is temporarily locked");
    assert.equal(body.payload.reason, "account_locked");
    assert.equal(body.payload.attempts_remaining, 0);
    assert.equal(body.payload.retry_after_seconds, 900);
    assert.match(body.payload.locked_until, /^\d{4}-\d{2}-\d{2}T/u);

    const stillLocked = await loginRequest(app, "correct horse battery staple");
    assert.equal(stillLocked.status, 423);
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

test("admin tables paginate, search, and filter on the server", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "owner@example.com", passwordHash);
    syncSource(database, manifest);
    const insertPublication = database.prepare(
      `INSERT INTO source_publication (
        id, source_id, source_publication_key, title, published_at, landing_url,
        download_url, status, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?)`,
    );
    for (let index = 1; index <= 5; index += 1) {
      const date = `2026-01-0${index}T00:00:00.000Z`;
      insertPublication.run(`publication_${index}`, manifest.id, `key_${index}`, `Archive ${index}.pdf`, date, manifest.landing_url, `https://example.com/${index}.pdf`, date, date);
    }
    for (const trigger of ["manual", "scheduled"] as const) {
      const run = startRun(database, { sourceId: manifest.id, trigger });
      finishRun(database, run.id, trigger === "manual" ? "succeeded" : "failed");
    }
    const app = createApp(database, manifest);
    const cookie = await loginCookie(app);

    const page = (await (await app.request("/v1/admin/knowledge-base?page=2&pageSize=2", { headers: { cookie } })).json()) as { payload: { items: Array<{ title: string }>; page: number; pages: number; total: number } };
    assert.deepEqual({ page: page.payload.page, pages: page.payload.pages, total: page.payload.total }, { page: 2, pages: 3, total: 5 });
    assert.deepEqual(page.payload.items.map((item) => item.title), ["Archive 3.pdf", "Archive 2.pdf"]);

    const defaults = (await (await app.request("/v1/admin/knowledge-base", { headers: { cookie } })).json()) as { payload: { pageSize: number } };
    assert.equal(defaults.payload.pageSize, 10);

    const searched = (await (await app.request("/v1/admin/knowledge-base?page=1&pageSize=20&search=Archive%204&status=discovered", { headers: { cookie } })).json()) as { payload: { items: Array<{ title: string }>; total: number } };
    assert.equal(searched.payload.total, 1);
    assert.equal(searched.payload.items[0]?.title, "Archive 4.pdf");

    const runs = (await (await app.request("/v1/admin/runs?page=1&pageSize=20&search=manual&status=succeeded", { headers: { cookie } })).json()) as { payload: { items: Array<{ trigger: string }>; total: number } };
    assert.equal(runs.payload.total, 1);
    assert.equal(runs.payload.items[0]?.trigger, "manual");

    const sources = (await (await app.request("/v1/admin/sources?page=1&pageSize=20&search=Test&status=blocked", { headers: { cookie } })).json()) as { payload: { total: number } };
    assert.equal(sources.payload.total, 1);
  } finally {
    database.close();
  }
});

test("workflow APIs expose definitions, schedules, and durable manual dispatches", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "owner@example.com", passwordHash);
    const app = createApp(database, manifest);
    const cookie = await loginCookie(app);
    const workflows = (await (await app.request("/v1/admin/workflows", { headers: { cookie } })).json()) as {
      payload: Array<{ key: string; schedule: { id: string } }>;
    };
    assert.deepEqual(workflows.payload.map((workflow) => workflow.key), [
      "latest_document_collection",
      "historical_backfill",
      "document_processing_pipeline",
    ]);

    const queued = await app.request("/v1/admin/workflows/latest_document_collection/run", { method: "POST", headers: { cookie } });
    assert.equal(queued.status, 202);
    assert.equal((await queued.json()).payload.status, "queued");

    const scheduleId = workflows.payload[0]!.schedule.id;
    const paused = await app.request(`/v1/admin/workflow-schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(paused.status, 200);
    assert.equal((database.prepare("SELECT enabled FROM workflow_schedule WHERE id = ?").get(scheduleId) as { enabled: number }).enabled, 0);
  } finally {
    database.close();
  }
});

async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await loginRequest(app, "correct horse battery staple");
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie ?? "", /HttpOnly/u);
  assert.match(setCookie ?? "", /SameSite=Strict/u);
  return setCookie!.split(";", 1)[0]!;
}

async function loginRequest(app: ReturnType<typeof createApp>, password: string): Promise<Response> {
  return app.request("http://localhost/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password }),
  });
}
