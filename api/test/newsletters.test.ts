import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { mailDefaults } from "../src/mail/defaults.ts";
import { createTemplateStore, renderMail } from "../src/mail/templates.ts";
import { jobIsDue, retryAfterMs } from "../src/social/jobs.ts";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../src/newsletters/unsubscribe.ts";
import { readRecipeStore } from "../src/recipes.ts";

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
  retry: { attempts: 1, cooldown_minutes: 0 },
  enabled: false,
});
const recipes = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
const origin = "https://price.example.test";
const secret = "a-test-secret-that-signs-unsubscribe-tokens";
const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

function recordingMailer() {
  const sent: { kind: string; to: string; link: string | null }[] = [];
  const record = (kind: string) => async (input: { to: string; link?: string }): Promise<MailResult> => {
    sent.push({ kind, to: input.to, link: input.link ?? null });
    return { ok: true, reference: `${kind}-${sent.length}` };
  };
  const mailer: AccountMailer = {
    configured: true,
    describe: () => "recording",
    verifyEmail: record("verify_email"),
    welcome: record("welcome"),
    resetPassword: record("reset_password"),
    passwordChanged: record("password_changed"),
    changeEmail: record("change_email"),
    emailChanged: record("email_changed"),
    accountDeleted: record("account_deleted"),
  };
  return { mailer, sent };
}

const sessionCookie = (response: Response): string => {
  const match = /lpl_session=([^;]+)/u.exec(response.headers.get("set-cookie") ?? "");
  assert.ok(match, "expected a session cookie");
  return `lpl_session=${match[1]}`;
};

/** Fails with the body's text only when the status is wrong, so the body stays readable afterwards. */
const expectStatus = async (response: Response, status: number): Promise<void> => {
  if (response.status !== status) assert.fail(`expected ${status}, got ${response.status}: ${await response.text()}`);
};

const tokenOf = (link: string | null): string => {
  assert.ok(link);
  return new URL(link).searchParams.get("token") ?? "";
};

test("templates: defaults render, edits override field by field, placeholders fill, reset restores", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createTemplateStore(database);
    const welcome = store.get("welcome");
    assert.equal(welcome.edited, false);
    assert.deepEqual(welcome.fields, mailDefaults.welcome);
    assert.ok(welcome.placeholders.some((placeholder) => placeholder.name === "name"));

    const edited = store.put("welcome", { subject: "Welcome aboard, {{name}}" }, "owner@example.com");
    assert.equal(edited.edited, true);
    assert.equal(edited.fields.subject, "Welcome aboard, {{name}}");
    assert.equal(edited.fields.heading, mailDefaults.welcome.heading, "untouched fields keep their defaults");
    assert.equal(store.list().filter((template) => template.edited).length, 1);

    const rendered = renderMail("welcome", { values: { name: "Nimal", link: "https://price.example.test/" } }, { fields: store.get("welcome").fields, siteOrigin: origin });
    assert.equal(rendered.subject, "Welcome aboard, Nimal");
    assert.ok(rendered.html.includes("https://price.example.test/"), "the button carries the link");
    assert.ok(rendered.html.includes("<img"), "the mark is in the header");
    assert.ok(!/<[a-z]/u.test(rendered.text), "the text part has no markup");
    assert.ok(rendered.text.includes("Nimal"));

    const escaped = renderMail("welcome", { values: { name: "<b>Nimal</b>", link: "https://price.example.test/" } }, { siteOrigin: origin });
    assert.ok(escaped.html.includes("&lt;b&gt;Nimal&lt;/b&gt;"), "values are escaped in html");

    assert.equal(store.reset("welcome").edited, false);
    assert.deepEqual(store.get("welcome").fields, mailDefaults.welcome);
  } finally {
    database.close();
  }
});

test("unsubscribe tokens round-trip and refuse tampering", () => {
  const token = signUnsubscribeToken(secret, "account_abc", "recipes_daily");
  assert.deepEqual(verifyUnsubscribeToken(secret, token), { accountId: "account_abc", kind: "recipes_daily" });
  assert.equal(verifyUnsubscribeToken("another secret", token), null);
  const flipped = `${token.slice(0, 5)}${token[5] === "A" ? "B" : "A"}${token.slice(6)}`;
  assert.equal(verifyUnsubscribeToken(secret, flipped), null, "a changed character breaks the signature");
  assert.equal(verifyUnsubscribeToken(secret, "not-a-token"), null);
});

test("a job runs when its expression matches the minute, and a failure is retried after a wait", () => {
  const at = (iso: string) => new Date(iso);
  const schedule = (patch: Partial<Parameters<typeof jobIsDue>[0]> = {}) => ({
    channel: "email" as const, job: "deals_daily", label: "Daily deals mail", description: "", enabled: true,
    cron: "30 7 * * *", recurrence: "Every day at 07:30", next_run_at: null, last_run_at: null,
    last_status: null, last_error: null, updated_by: null, updated_at: "2026-09-14T00:00:00.000Z", ...patch,
  });
  // 07:29 and 07:30 in Colombo are 01:59 and 02:00 UTC.
  assert.equal(jobIsDue(schedule(), at("2026-09-14T01:59:00Z")), false, "before the minute");
  assert.equal(jobIsDue(schedule(), at("2026-09-14T02:00:00Z")), true, "on the minute");
  assert.equal(jobIsDue(schedule({ cron: "0 8 * * *" }), at("2026-09-14T02:00:00Z")), false, "moved to eight, this minute is not it");
  // A job that just ran is not run again inside the same minute, however slow the tick was.
  assert.equal(jobIsDue(schedule({ last_run_at: "2026-09-14T02:00:10Z", last_status: "ran" }), at("2026-09-14T02:00:40Z")), false, "not twice in a minute");
  const failedAt = at("2026-09-14T02:00:05Z");
  const failed = schedule({ last_run_at: failedAt.toISOString(), last_status: "failed" });
  assert.equal(jobIsDue(failed, new Date(failedAt.getTime() + retryAfterMs - 60_000)), false, "a failure waits before retrying");
  assert.equal(jobIsDue(failed, new Date(failedAt.getTime() + retryAfterMs + 60_000)), true, "then retries, off its own clock");
});

test("the daily recipe mail reaches opted-in verified accounts, runs once a day, and one click unsubscribes", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const salt = "0123456789abcdef0123456789abcdef";
    seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
    const { mailer, sent } = recordingMailer();
    const app = createApp(database, manifest, undefined, { recipes, accounts: { mailer, config: { siteOrigin: origin, stateSecret: secret } } });

    // Nimal opts in and verifies; Kamala opts in but never verifies; Sunil stays out.
    const register = async (email: string, name: string) => {
      const response = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email, password: "a long enough password", display_name: name }) });
      await expectStatus(response, 201);
      return sessionCookie(response);
    };
    const nimal = await register("nimal@example.com", "Nimal");
    const kamala = await register("kamala@example.com", "Kamala");
    await register("sunil@example.com", "Sunil");
    for (const cookie of [nimal, kamala]) {
      const patched = await app.request("/v1/account/me", { method: "PATCH", headers: { ...json, cookie }, body: JSON.stringify({ preferences: { notify_recipes: true, goals: ["quick"] } }) });
      await expectStatus(patched, 200);
    }
    const verifyMail = sent.find((mail) => mail.kind === "verify_email" && mail.to === "nimal@example.com");
    assert.ok(verifyMail);
    const verified = await app.request("/v1/account/verify-email", { method: "POST", headers: { ...json, cookie: nimal }, body: JSON.stringify({ token: tokenOf(verifyMail.link) }) });
    await expectStatus(verified, 200);

    const ownerLogin = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    await expectStatus(ownerLogin, 200);
    const owner = (ownerLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    // A dry run counts and composes without queueing anything.
    const dry = await app.request("/v1/admin/newsletters/run", { method: "POST", headers: { ...json, cookie: owner }, body: JSON.stringify({ kind: "recipes_daily", dry_run: true }) });
    await expectStatus(dry, 200);
    const dryRun = ((await dry.json()) as Envelope<{ status: string; recipients: number; sent: number; deliveries?: Array<{ email: string; subject: string }> }>).payload;
    assert.equal(dryRun.status, "dry_run");
    assert.equal(dryRun.recipients, 1, "only the verified, opted-in account");
    assert.equal(dryRun.sent, 1);
    assert.equal(dryRun.deliveries?.length, 1, "the dry run lists who it would reach");
    assert.equal(dryRun.deliveries?.[0]?.email, "ni…@example.com", "with the address masked");
    assert.ok(dryRun.deliveries?.[0]?.subject.length, "the mail has a subject");

    // The real run queues one mail; the same day does not run twice.
    const first = await app.request("/v1/admin/newsletters/run", { method: "POST", headers: { ...json, cookie: owner }, body: JSON.stringify({ kind: "recipes_daily" }) });
    await expectStatus(first, 200);
    const firstRun = ((await first.json()) as Envelope<{ id: string; status: string; sent: number }>).payload;
    assert.equal(firstRun.status, "sent");
    assert.equal(firstRun.sent, 1);
    const queued = (database.prepare("SELECT COUNT(*) AS count FROM notify_outbox").get() as { count: number }).count;
    assert.equal(queued, 1, "one entry in the outbox");
    const again = await app.request("/v1/admin/newsletters/run", { method: "POST", headers: { ...json, cookie: owner }, body: JSON.stringify({ kind: "recipes_daily" }) });
    const againRun = ((await again.json()) as Envelope<{ id: string }>).payload;
    assert.equal(againRun.id, firstRun.id, "the day's completed run answers instead of a new one");
    const runs = await app.request("/v1/admin/newsletters/runs?kind=recipes_daily", { headers: { cookie: owner } });
    assert.equal(((await runs.json()) as Envelope<unknown[]>).payload.length, 2, "the dry run and the real run are listed");

    // The one-click link in the mail switches the kind off without a session.
    const token = signUnsubscribeToken(secret, (database.prepare("SELECT id FROM account WHERE email = ?").get("nimal@example.com") as { id: string }).id, "recipes_daily");
    const unsubscribed = await app.request(`/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    await expectStatus(unsubscribed, 200);
    const me = (await (await app.request("/v1/account/me", { headers: { cookie: nimal } })).json()) as Envelope<{ preferences: { notify_recipes: boolean; notify_digest: boolean } }>;
    assert.equal(me.payload.preferences.notify_recipes, false);
    assert.equal(me.payload.preferences.notify_digest, false, "the other kinds are untouched");
    const bad = await app.request("/v1/newsletter/unsubscribe?token=nonsense", { method: "POST" });
    assert.equal(bad.status, 400);

    // Templates behind the owner: edit, preview with the edit, reset.
    const put = await app.request("/v1/admin/mail/templates/recipes_daily", { method: "PUT", headers: { ...json, cookie: owner }, body: JSON.stringify({ fields: { subject: "Your three for {{date}}" } }) });
    await expectStatus(put, 200);
    assert.equal(((await put.json()) as Envelope<{ edited: boolean; fields: { subject: string } }>).payload.edited, true);
    const preview = await app.request("/v1/admin/mail/templates/recipes_daily/preview", { method: "POST", headers: { ...json, cookie: owner }, body: JSON.stringify({}) });
    await expectStatus(preview, 200);
    const previewed = ((await preview.json()) as Envelope<{ subject: string; html: string; text: string }>).payload;
    assert.ok(previewed.subject.startsWith("Your three for "), previewed.subject);
    assert.ok(previewed.html.includes("<!doctype html>"));
    const reset = await app.request("/v1/admin/mail/templates/recipes_daily", { method: "DELETE", headers: { cookie: owner } });
    assert.equal(((await reset.json()) as Envelope<{ edited: boolean }>).payload.edited, false);
    const test = await app.request("/v1/admin/mail/templates/welcome/test", { method: "POST", headers: { ...json, cookie: owner }, body: JSON.stringify({}) });
    assert.equal(test.status, 503, "no sending channel in this app, so a test send says so");
  } finally {
    database.close();
  }
});
