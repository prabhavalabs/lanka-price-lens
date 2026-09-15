import { scoreOf, type ProductProposal, type ReactionValue, type RecipeScore, type RecipeSubmission, type ReviewStatus, type TranslationFeedback } from "@lanka-pricelens/shared";

import { AccountApiError, type OwnReaction } from "./account-api.ts";
import { describeAccountError } from "./account-forms.ts";

/**
 * Pure helpers behind what a signed-in person gives back on the recipes: the arithmetic of a
 * thumb pressed before the server answers, which submission a recipe's badge shows, whether a
 * label is already proposed, and the wording of a refusal. Nothing here touches React or the
 * DOM, so the tests run under plain node.
 */

/** The reaction a press means: the thumb pressed, or none when that thumb is already down. */
export function nextReaction(current: OwnReaction | null, pressed: OwnReaction): ReactionValue {
  return current === pressed ? "none" : pressed;
}

/** A dish's counts after one account moves its thumb from `previous` to `next`, for the moment before the server answers. */
export function applyReaction(score: RecipeScore, previous: OwnReaction | null, next: ReactionValue): RecipeScore {
  let { likes, dislikes } = score;
  if (previous === "up") likes = Math.max(0, likes - 1);
  if (previous === "down") dislikes = Math.max(0, dislikes - 1);
  if (next === "up") likes += 1;
  if (next === "down") dislikes += 1;
  return { likes, dislikes, score: scoreOf(likes, dislikes) };
}

const weight = (value: ReactionValue | null): number => (value === "up" ? 1 : value === "down" ? -1 : 0);

/**
 * The public score after the same move, when only the score is known (a recipe card). Exact
 * unless dislikes had pushed the score to its floor; the server's answer settles it either way.
 */
export function shiftScore(score: number, previous: OwnReaction | null, next: ReactionValue): number {
  return Math.max(0, score + weight(next) - weight(previous));
}

/** The newest submission made from one of the account's own recipes, or null when it was never sent. */
export function latestSubmissionFor(submissions: readonly RecipeSubmission[], recipeId: string): RecipeSubmission | null {
  let latest: RecipeSubmission | null = null;
  for (const submission of submissions) {
    if (submission.source_recipe_id !== recipeId) continue;
    if (!latest || submission.created_at > latest.created_at) latest = submission;
  }
  return latest;
}

/** The newest submission per own recipe, keyed by the recipe's id; requests, which have no recipe, are left out. */
export function latestSubmissions(submissions: readonly RecipeSubmission[]): Map<string, RecipeSubmission> {
  const latest = new Map<string, RecipeSubmission>();
  for (const submission of submissions) {
    if (!submission.source_recipe_id) continue;
    const current = latest.get(submission.source_recipe_id);
    if (!current || submission.created_at > current.created_at) latest.set(submission.source_recipe_id, submission);
  }
  return latest;
}

const plain = (label: string): string => label.trim().toLowerCase().replace(/\s+/gu, " ");

/** The account's pending proposal for a label, matched without regard to case or spacing, so the same ingredient is not proposed twice. */
export function pendingProposalFor(proposals: readonly ProductProposal[], label: string): ProductProposal | null {
  const wanted = plain(label);
  if (!wanted) return null;
  return proposals.find((proposal) => proposal.status === "pending" && plain(proposal.label) === wanted) ?? null;
}

/** The account's pending proposals whose label contains the typed text; all of them while nothing is typed. */
export function matchingProposals(proposals: readonly ProductProposal[], query: string): ProductProposal[] {
  const wanted = plain(query);
  return proposals.filter((proposal) => proposal.status === "pending" && (!wanted || plain(proposal.label).includes(wanted)));
}

/** What to tell the person when a contribution was refused; the codes the community routes answer with come first. */
export function describeContributionError(error: unknown): string {
  if (error instanceof AccountApiError) {
    if (error.status === 409 && error.code === "ALREADY_SENT") return "You already sent feedback on this today.";
    if (error.status === 403 && error.code === "EMAIL_NOT_VERIFIED") return "Verify your email address to contribute.";
    if (error.status === 413) return error.message || "You have reached the limit of open contributions. Wait for the owner's review.";
    if (error.status === 404) return error.message || "That recipe is not on the site.";
  }
  return describeAccountError(error);
}

export const reviewStatusWords: Record<ReviewStatus, string> = { pending: "pending", approved: "approved", rejected: "rejected" };

/** Translation feedback the site sent this visit; the API keeps it for the owner but has no route to list it back. */
export type SentTranslation = TranslationFeedback & { dish_name: string };

/** One line of the account page's Contributions section, whatever it came from. */
export type ContributionRow = {
  key: string;
  kind: "recipe" | "request" | "ingredient" | "translation";
  title: string;
  detail: string | null;
  status: string;
  tone: "pending" | "good" | "bad";
  /** The owner's note on a decision, when there is one. */
  note: string | null;
  created_at: string;
};

const languageWords = { si: "Sinhala", ta: "Tamil" } as const;

/** Everything the account sent, newest first, in one list. */
export function contributionRows(input: { submissions: readonly RecipeSubmission[]; proposals: readonly ProductProposal[]; translations: readonly SentTranslation[] }): ContributionRow[] {
  const tone = (status: ReviewStatus): ContributionRow["tone"] => (status === "pending" ? "pending" : status === "approved" ? "good" : "bad");
  const rows: ContributionRow[] = [
    ...input.submissions.map((submission): ContributionRow => ({
      key: `submission-${submission.id}`,
      kind: submission.kind,
      title: submission.name,
      detail: submission.notes,
      status: reviewStatusWords[submission.status],
      tone: tone(submission.status),
      note: submission.review_note,
      created_at: submission.created_at,
    })),
    ...input.proposals.map((proposal): ContributionRow => ({
      key: `proposal-${proposal.id}`,
      kind: "ingredient",
      title: proposal.label,
      detail: [proposal.category, proposal.unit_hint ? `by the ${proposal.unit_hint}` : null, proposal.note].filter(Boolean).join(" · ") || null,
      status: reviewStatusWords[proposal.status],
      tone: tone(proposal.status),
      note: proposal.review_note,
      created_at: proposal.created_at,
    })),
    ...input.translations.map((feedback): ContributionRow => ({
      key: `translation-${feedback.id}`,
      kind: "translation",
      title: `${feedback.dish_name} in ${languageWords[feedback.language]}`,
      detail: feedback.verdict === "correct" ? "Marked correct" : feedback.note ? `Needs work: ${feedback.note}` : "Needs work",
      status: feedback.status === "new" ? "sent" : feedback.status,
      tone: feedback.status === "new" ? "pending" : "good",
      note: null,
      created_at: feedback.created_at,
    })),
  ];
  return rows.sort((left, right) => (right.created_at > left.created_at ? 1 : right.created_at < left.created_at ? -1 : 0));
}
