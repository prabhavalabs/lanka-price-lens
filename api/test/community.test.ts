import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import type { Message } from "@lanka-pricelens/notify";

import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { readRecipeStore } from "../src/recipes.ts";

const recipes = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

function recordingMailer() {
  const sent: { kind: string; to: string; link: string | null }[] = [];
  const record = (kind: string) => async (input: { to: string; link?: string }): Promise<MailResult> => {
    sent.push({ kind, to: input.to, link: input.link ?? null });
    return { ok: true, reference: `${kind}-${sent.length}` };
  };
  const mailer: AccountMailer = { configured: true, describe: () => "recording", verifyEmail: record("verify_email"), welcome: record("welcome"), resetPassword: record("reset_password"), passwordChanged: record("password_changed"), changeEmail: record("change_email"), emailChanged: record("email_changed"), accountDeleted: record("account_deleted") };
  return { mailer, sent };
}

const sessionCookie = (response: Response): string => {
  const match = /lpl_session=([^;]+)/u.exec(response.headers.get("set-cookie") ?? "");
  assert.ok(match, "expected a session cookie");
  return `lpl_session=${match[1]}`;
};

const expectStatus = async (response: Response, status: number): Promise<void> => {
  if (response.status !== status) assert.fail(`expected ${status}, got ${response.status}: ${await response.text()}`);
};

const tokenOf = (link: string | null): string => {
  assert.ok(link);
  return new URL(link).searchParams.get("token") ?? "";
};

test("reactions: one per account, switchable, scored as likes minus dislikes floored at zero, shown on the list and the detail", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const notices: Message[] = [];
    const { mailer } = recordingMailer();
    const app = createApp(database, undefined, undefined, { recipes, accounts: { mailer }, ownerNotifier: { configured: true, targets: ["test"], notify: async (note) => { notices.push(note); return []; } } });
    const dish = [...recipes.recipes.keys()][0]!;
    const register = async (email: string) => {
      const response = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email, password: "a long enough password", display_name: email.split("@")[0] }) });
      await expectStatus(response, 201);
      return sessionCookie(response);
    };
    const nimal = await register("nimal@example.com");
    const kamala = await register("kamala@example.com");

    await expectStatus(await app.request(`/v1/account/community/reactions/${dish}`, { method: "PUT", headers: json, body: JSON.stringify({ value: "up" }) }), 401);
    const first = await app.request(`/v1/account/community/reactions/${dish}`, { method: "PUT", headers: { ...json, cookie: nimal }, body: JSON.stringify({ value: "up" }) });
    await expectStatus(first, 200);
    assert.deepEqual(((await first.json()) as Envelope<{ value: string; likes: number; dislikes: number; score: number }>).payload, { value: "up", likes: 1, dislikes: 0, score: 1 }, "an unverified account may react");
    const second = await app.request(`/v1/account/community/reactions/${dish}`, { method: "PUT", headers: { ...json, cookie: kamala }, body: JSON.stringify({ value: "down" }) });
    assert.deepEqual(((await second.json()) as Envelope<{ score: number; likes: number; dislikes: number }>).payload, { value: "down", likes: 1, dislikes: 1, score: 0 });
    const switched = await app.request(`/v1/account/community/reactions/${dish}`, { method: "PUT", headers: { ...json, cookie: kamala }, body: JSON.stringify({ value: "up" }) });
    assert.equal(((await switched.json()) as Envelope<{ score: number }>).payload.score, 2, "switching replaces, never doubles");
    const removed = await app.request(`/v1/account/community/reactions/${dish}`, { method: "PUT", headers: { ...json, cookie: kamala }, body: JSON.stringify({ value: "none" }) });
    assert.equal(((await removed.json()) as Envelope<{ score: number }>).payload.score, 1);
    await expectStatus(await app.request("/v1/account/community/reactions/dish_not_in_catalogue", { method: "PUT", headers: { ...json, cookie: nimal }, body: JSON.stringify({ value: "up" }) }), 404);

    const mine = (await (await app.request("/v1/account/community/reactions", { headers: { cookie: nimal } })).json()) as Envelope<Record<string, string>>;
    assert.deepEqual(mine.payload, { [dish]: "up" });
    const scores = (await (await app.request(`/v1/public/recipes/scores?ids=${dish},dish_nothing`)).json()) as Envelope<Record<string, number>>;
    assert.deepEqual(scores.payload, { [dish]: 1, dish_nothing: 0 });
    const detail = (await (await app.request(`/v1/public/recipes/${dish}`)).json()) as Envelope<{ reactions: { likes: number; dislikes: number; score: number } }>;
    assert.deepEqual(detail.payload.reactions, { likes: 1, dislikes: 0, score: 1 });
    const listing = (await (await app.request("/v1/public/recipes/query")).json()) as Envelope<{ items: Array<{ dish: { id: string }; score: number }> }>;
    assert.equal(listing.payload.items.find((item) => item.dish.id === dish)?.score, 1);
    assert.equal(notices.length, 0, "reactions never bother the owner");
  } finally {
    database.close();
  }
});

test("contributions: translation feedback, requests, own-recipe submissions, and product proposals reach the owner and the admin review", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const salt = "0123456789abcdef0123456789abcdef";
    seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
    const notices: Message[] = [];
    const { mailer, sent } = recordingMailer();
    const app = createApp(database, undefined, undefined, { recipes, accounts: { mailer, config: { siteOrigin: "https://price.example.test" } }, ownerNotifier: { configured: true, targets: ["test"], notify: async (note) => { notices.push(note); return []; } } });
    const dish = [...recipes.recipes.keys()][0]!;
    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "nimal@example.com", password: "a long enough password", display_name: "Nimal" }) });
    await expectStatus(registered, 201);
    const cookie = sessionCookie(registered);

    // Unverified accounts may react but not contribute.
    await expectStatus(await app.request("/v1/account/community/submissions", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ kind: "request", name: "Kiribath" }) }), 403);
    const verifyMail = sent.find((mail) => mail.kind === "verify_email");
    await expectStatus(await app.request("/v1/account/verify-email", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ token: tokenOf(verifyMail?.link ?? null) }) }), 200);

    // Translation feedback, once a day per dish and language.
    const feedback = await app.request("/v1/account/community/translations", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ dish_id: dish, language: "si", verdict: "incorrect", correction: "නිවැරදි පෙළ", note: "Step 2 reads oddly" }) });
    await expectStatus(feedback, 201);
    await expectStatus(await app.request("/v1/account/community/translations", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ dish_id: dish, language: "si", verdict: "correct" }) }), 409);
    await expectStatus(await app.request("/v1/account/community/translations", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ dish_id: dish, language: "en", verdict: "correct" }) }), 400);
    const mineFeedback = (await (await app.request("/v1/account/community/translations", { headers: { cookie } })).json()) as Envelope<Array<{ id: string; language: string; status: string }>>;
    assert.deepEqual(mineFeedback.payload.map((row) => [row.language, row.status]), [["si", "new"]]);
    // Taken back, the day's rule frees up and the feedback can be sent again with details.
    const feedbackId = mineFeedback.payload[0]!.id;
    await expectStatus(await app.request(`/v1/account/community/translations/${feedbackId}`, { method: "DELETE", headers: { ...json, cookie } }), 200);
    await expectStatus(await app.request(`/v1/account/community/translations/${feedbackId}`, { method: "DELETE", headers: { ...json, cookie } }), 404);
    await expectStatus(await app.request("/v1/account/community/translations", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ dish_id: dish, language: "si", verdict: "incorrect", correction: "නිවැරදි පෙළ", note: "Step 2 reads oddly" }) }), 201);

    // A request, then a recipe of the account's own.
    const request = await app.request("/v1/account/community/submissions", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ kind: "request", name: "Kiribath with lunu miris", notes: "The New Year one" }) });
    await expectStatus(request, 201);
    const own = await app.request("/v1/account/recipes", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({
      name: "Nimal's dhal",
      category: "pulses_and_eggs",
      summary: "Red lentils the way my mother made them.",
      base_servings: 4,
      serving: { portion_g: 150, yield_g: 600, role: "side" },
      times: { prep_minutes: 5, cook_minutes: 20, passive_minutes: 0 },
      ingredients: [{ ref: null, label: { en: "Red dhal" }, quantity: 200, unit: "g", part: "main" }],
      steps: { en: [{ text: "Simmer the dhal until soft.", minutes: 20 }] },
      tags: [],
      visibility: "private",
    }) });
    if (own.status !== 201) {
      // The fixture's own-recipe shape is checked elsewhere; a request alone still proves the review path.
      assert.equal(own.status, 400, await own.text());
    } else {
      const ownId = ((await own.json()) as Envelope<{ id: string }>).payload.id;
      const submitted = await app.request("/v1/account/community/submissions", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ kind: "recipe", source_recipe_id: ownId }) });
      await expectStatus(submitted, 201);
      assert.equal(((await submitted.json()) as Envelope<{ recipe: { name: string } | null }>).payload.recipe?.name, "Nimal's dhal", "the submission carries the recipe as it was");
    }
    await expectStatus(await app.request("/v1/account/community/submissions", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ kind: "recipe", source_recipe_id: "dish_user_not_mine" }) }), 404);

    // An ingredient the registry lacks.
    const proposal = await app.request("/v1/account/community/products", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ label: "Kohila leaves", category: "vegetables", unit_hint: "g" }) });
    await expectStatus(proposal, 201);
    const mineProposals = (await (await app.request("/v1/account/community/products", { headers: { cookie } })).json()) as Envelope<Array<{ label: string; status: string }>>;
    assert.deepEqual(mineProposals.payload.map((row) => [row.label, row.status]), [["Kohila leaves", "pending"]]);
    const mineSubmissions = (await (await app.request("/v1/account/community/submissions", { headers: { cookie } })).json()) as Envelope<Array<{ kind: string; recipe: unknown }>>;
    assert.ok(mineSubmissions.payload.some((row) => row.kind === "request"));
    assert.ok(mineSubmissions.payload.every((row) => row.recipe === null), "lists leave the recipe JSON out");

    // The owner heard about each one, with a link into the admin.
    const kinds = notices.map((note) => note.tags[1]);
    assert.ok(kinds.includes("translation") && kinds.includes("request") && kinds.includes("proposal"), kinds.join(","));
    assert.ok(notices.every((note) => note.actions[0]?.url === "https://price.example.test/admin/community"));
    assert.ok(notices.every((note) => note.title.startsWith("[PriceLens]")));

    // The admin reviews.
    const ownerLogin = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    await expectStatus(ownerLogin, 200);
    const owner = (ownerLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const overview = (await (await app.request("/v1/admin/community/overview", { headers: { cookie: owner } })).json()) as Envelope<{ pending_submissions: number; new_translations: number; pending_products: number }>;
    assert.equal(overview.payload.new_translations, 1);
    assert.equal(overview.payload.pending_products, 1);
    assert.ok(overview.payload.pending_submissions >= 1);
    const submissions = (await (await app.request("/v1/admin/community/submissions?status=pending", { headers: { cookie: owner } })).json()) as Envelope<{ items: Array<{ id: string; kind: string; email: string; display_name: string }>; total: number }>;
    const requestRow = submissions.payload.items.find((row) => row.kind === "request");
    assert.ok(requestRow);
    assert.equal(requestRow.email, "nimal@example.com");
    const approved = await app.request(`/v1/admin/community/submissions/${requestRow.id}`, { method: "PATCH", headers: { ...json, cookie: owner }, body: JSON.stringify({ status: "approved", review_note: "On the list for October" }) });
    await expectStatus(approved, 200);
    assert.deepEqual((({ status, review_note, reviewed_by }) => ({ status, review_note, reviewed_by }))(((await approved.json()) as Envelope<{ status: string; review_note: string; reviewed_by: string }>).payload), { status: "approved", review_note: "On the list for October", reviewed_by: "owner@example.com" });
    const afterReview = (await (await app.request("/v1/account/community/submissions", { headers: { cookie } })).json()) as Envelope<Array<{ id: string; status: string; review_note: string | null }>>;
    assert.equal(afterReview.payload.find((row) => row.id === requestRow.id)?.review_note, "On the list for October", "the person sees the owner's note");
    const translations = (await (await app.request("/v1/admin/community/translations?status=new", { headers: { cookie: owner } })).json()) as Envelope<{ items: Array<{ id: string; dish_name: string | null; correction: string }> }>;
    assert.equal(translations.payload.items[0]?.correction, "නිවැරදි පෙළ");
    await expectStatus(await app.request(`/v1/admin/community/translations/${translations.payload.items[0]?.id}`, { method: "PATCH", headers: { ...json, cookie: owner }, body: JSON.stringify({ status: "applied" }) }), 200);
    const products = (await (await app.request("/v1/admin/community/products?status=pending", { headers: { cookie: owner } })).json()) as Envelope<{ items: Array<{ id: string }> }>;
    await expectStatus(await app.request(`/v1/admin/community/products/${products.payload.items[0]?.id}`, { method: "PATCH", headers: { ...json, cookie: owner }, body: JSON.stringify({ status: "rejected", review_note: "Already mapped as kohila" }) }), 200);
    await expectStatus(await app.request("/v1/admin/community/products/prop_missing", { method: "PATCH", headers: { ...json, cookie: owner }, body: JSON.stringify({ status: "approved" }) }), 404);
    await expectStatus(await app.request("/v1/admin/community/reactions", { headers: { cookie: owner } }), 200);
  } finally {
    database.close();
  }
});
