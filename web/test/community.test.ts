import assert from "node:assert/strict";
import test from "node:test";

import type { ProductProposal, RecipeSubmission } from "@lanka-pricelens/shared";

import { AccountApiError } from "../src/lib/account-api.ts";
import { inviteAfterMs, inviteCooldownMs, readInviteMemory, shouldInvite, writeInviteMemory } from "../src/lib/community.ts";
import { applyReaction, contributionRows, describeContributionError, latestSubmissionFor, latestSubmissions, matchingProposals, nextReaction, pendingProposalFor, shiftScore, type SentTranslation } from "../src/lib/contributions.ts";

const start = 1_000_000;

test("the invite appears a few seconds after arriving, not before", () => {
  assert.equal(shouldInvite({}, { startedAt: start }, start + inviteAfterMs - 1), false);
  assert.equal(shouldInvite({}, { startedAt: start }, start + inviteAfterMs), true);
});

test("not now means a month of quiet, and joining means never again", () => {
  const later = start + inviteAfterMs;
  assert.equal(shouldInvite({ dismissedAt: start }, { startedAt: start }, later), false);
  assert.equal(shouldInvite({ dismissedAt: start }, { startedAt: start }, start + inviteCooldownMs + later), true);
  assert.equal(shouldInvite({ joinedAt: start }, { startedAt: start }, start + inviteCooldownMs * 12), false);
});

test("memory survives a broken or missing store", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  writeInviteMemory(storage, { dismissedAt: 5 });
  assert.deepEqual(readInviteMemory(storage), { dismissedAt: 5 });
  store.set("pricelens.community.v1", "{not json");
  assert.deepEqual(readInviteMemory(storage), {});
  assert.deepEqual(readInviteMemory(undefined), {});
  writeInviteMemory({ setItem: () => { throw new Error("full"); } }, { joinedAt: 1 });
});

// What a signed-in person gives back on the recipes.

test("a thumb pressed moves the counts before the server answers, and never below zero", () => {
  const none = { likes: 0, dislikes: 0, score: 0 };
  assert.deepEqual(applyReaction(none, null, "up"), { likes: 1, dislikes: 0, score: 1 });
  assert.deepEqual(applyReaction({ likes: 1, dislikes: 0, score: 1 }, "up", "down"), { likes: 0, dislikes: 1, score: 0 });
  assert.deepEqual(applyReaction({ likes: 0, dislikes: 1, score: 0 }, "down", "none"), none);
  // Dislikes had pushed the score to its floor: a like lifts the count but not yet the score.
  assert.deepEqual(applyReaction({ likes: 0, dislikes: 3, score: 0 }, null, "up"), { likes: 1, dislikes: 3, score: 0 });
  // A stale cache cannot go negative.
  assert.deepEqual(applyReaction(none, "up", "none"), none);
});

test("a score alone shifts by the difference between the old thumb and the new", () => {
  assert.equal(shiftScore(0, null, "up"), 1);
  assert.equal(shiftScore(1, "up", "down"), 0);
  assert.equal(shiftScore(2, "down", "none"), 3);
  assert.equal(shiftScore(5, "up", "up"), 5);
});

test("pressing the thumb that is already down takes it back; the other one switches", () => {
  assert.equal(nextReaction(null, "up"), "up");
  assert.equal(nextReaction("up", "up"), "none");
  assert.equal(nextReaction("up", "down"), "down");
  assert.equal(nextReaction("down", "down"), "none");
});

function submission(input: Partial<RecipeSubmission> & { id: string }): RecipeSubmission {
  return { account_id: "acc_1", kind: "recipe", name: "Ambul thiyal", notes: null, source_recipe_id: "dish_user_1", recipe: null, status: "pending", review_note: null, created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z", reviewed_at: null, reviewed_by: null, ...input };
}

function proposal(input: Partial<ProductProposal> & { id: string }): ProductProposal {
  return { account_id: "acc_1", label: "Kohila", category: "vegetables", unit_hint: "kg", note: null, status: "pending", review_note: null, created_at: "2026-09-02T10:00:00.000Z", reviewed_at: null, reviewed_by: null, ...input };
}

test("a recipe's badge follows its newest submission, whatever order the list came in", () => {
  const older = submission({ id: "s1", status: "rejected", review_note: "Too close to the catalogue's own", created_at: "2026-08-01T00:00:00.000Z" });
  const newer = submission({ id: "s2", status: "pending", created_at: "2026-09-01T00:00:00.000Z" });
  const other = submission({ id: "s3", source_recipe_id: "dish_user_2", status: "approved" });
  const request = submission({ id: "s4", kind: "request", name: "Kiri hodi", source_recipe_id: null });
  assert.equal(latestSubmissionFor([older, newer, other, request], "dish_user_1"), newer);
  assert.equal(latestSubmissionFor([newer, older], "dish_user_1"), newer);
  assert.equal(latestSubmissionFor([older, newer], "dish_user_9"), null);
  const byRecipe = latestSubmissions([older, newer, other, request]);
  assert.deepEqual([...byRecipe.keys()], ["dish_user_1", "dish_user_2"]);
  assert.equal(byRecipe.get("dish_user_1"), newer);
  assert.equal(byRecipe.get("dish_user_2"), other);
});

test("a label already proposed is found whatever the case or spacing, once it is no longer pending it is not", () => {
  const pending = proposal({ id: "p1", label: "Kohila" });
  const rejected = proposal({ id: "p2", label: "Gotukola", status: "rejected" });
  const spaced = proposal({ id: "p3", label: "Wing  bean" });
  assert.equal(pendingProposalFor([pending, rejected, spaced], " kohila "), pending);
  assert.equal(pendingProposalFor([pending, rejected, spaced], "KOHILA"), pending);
  assert.equal(pendingProposalFor([pending, rejected, spaced], "wing bean"), spaced);
  assert.equal(pendingProposalFor([pending, rejected, spaced], "gotukola"), null);
  assert.equal(pendingProposalFor([pending], ""), null);
  assert.deepEqual(matchingProposals([pending, rejected, spaced], "").map((entry) => entry.id), ["p1", "p3"]);
  assert.deepEqual(matchingProposals([pending, rejected, spaced], "bean").map((entry) => entry.id), ["p3"]);
  assert.deepEqual(matchingProposals([pending, rejected, spaced], "gotu"), []);
});

test("a refusal reads in the person's words, with the community codes first", () => {
  assert.equal(describeContributionError(new AccountApiError(409, "already", "ALREADY_SENT")), "You already sent feedback on this today.");
  assert.equal(describeContributionError(new AccountApiError(403, "verify", "EMAIL_NOT_VERIFIED")), "Verify your email address to contribute.");
  assert.equal(describeContributionError(new AccountApiError(413, "You have 20 open submissions", null)), "You have 20 open submissions");
  assert.equal(describeContributionError(new AccountApiError(404, "Recipe not found", "NOT_FOUND")), "Recipe not found");
  assert.equal(describeContributionError(new AccountApiError(401, "", null)), "Your session has ended. Sign in again.");
  assert.equal(describeContributionError(new Error("boom")), "boom");
});

test("the contributions list mixes everything sent, newest first, with the owner's note", () => {
  const translation: SentTranslation = { id: "t1", account_id: "acc_1", dish_id: "dish_pol_sambol", dish_name: "Pol sambol", language: "si", verdict: "incorrect", correction: null, note: "Step 2 is wrong", status: "new", created_at: "2026-09-03T00:00:00.000Z", reviewed_at: null, reviewed_by: null };
  const rows = contributionRows({
    submissions: [submission({ id: "s1", status: "rejected", review_note: "Send it with amounts" }), submission({ id: "s2", kind: "request", name: "Kiri hodi", source_recipe_id: null, created_at: "2026-09-04T00:00:00.000Z" })],
    proposals: [proposal({ id: "p1" })],
    translations: [translation],
  });
  assert.deepEqual(rows.map((row) => [row.kind, row.title, row.status]), [
    ["request", "Kiri hodi", "pending"],
    ["translation", "Pol sambol in Sinhala", "sent"],
    ["ingredient", "Kohila", "pending"],
    ["recipe", "Ambul thiyal", "rejected"],
  ]);
  assert.equal(rows[3]?.note, "Send it with amounts");
  assert.equal(rows[3]?.tone, "bad");
  assert.equal(rows[1]?.detail, "Needs work: Step 2 is wrong");
  assert.equal(rows[2]?.detail, "vegetables · by the kg");
});
