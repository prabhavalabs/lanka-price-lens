import { z } from "zod";

import type { UserRecipeInput } from "./accounts.ts";

/**
 * What a signed-in person can give back on the recipe section (docs/community.md): a
 * thumbs up or down, a verdict on a Sinhala or Tamil translation, a request for a missing
 * recipe or a recipe of their own for the catalogue, and a product the registry lacks.
 */

const dishId = z.string().regex(/^dish_[a-z0-9]+(?:_[a-z0-9]+)*$/u);
const text = (max: number) => z.string().trim().max(max).nullable().default(null);

export const reactionValues = ["up", "down", "none"] as const;
export type ReactionValue = (typeof reactionValues)[number];
export const reactionSchema = z.object({ value: z.enum(reactionValues) });
/** Likes and dislikes of a dish; the public sees `score`, never the dislikes. */
export type RecipeScore = { likes: number; dislikes: number; score: number };
export const scoreOf = (likes: number, dislikes: number): number => Math.max(0, likes - dislikes);

export const translationLanguages = ["si", "ta"] as const;
export type TranslationLanguage = (typeof translationLanguages)[number];
export const translationVerdicts = ["correct", "incorrect"] as const;
export type TranslationVerdict = (typeof translationVerdicts)[number];
export const translationFeedbackInputSchema = z.object({
  dish_id: dishId,
  language: z.enum(translationLanguages),
  verdict: z.enum(translationVerdicts),
  /** The person's corrected text, when they offer one. */
  correction: text(4000),
  note: text(1000),
});
export type TranslationFeedbackInput = z.infer<typeof translationFeedbackInputSchema>;
export const translationStatuses = ["new", "reviewed", "applied"] as const;
export type TranslationStatus = (typeof translationStatuses)[number];
export type TranslationFeedback = TranslationFeedbackInput & { id: string; account_id: string; status: TranslationStatus; created_at: string; reviewed_at: string | null; reviewed_by: string | null };

export const submissionKinds = ["request", "recipe"] as const;
export type SubmissionKind = (typeof submissionKinds)[number];
export const submissionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request"), name: z.string().trim().min(2).max(120), notes: text(2000) }),
  z.object({ kind: z.literal("recipe"), source_recipe_id: z.string().trim().min(1).max(64), notes: text(2000) }),
]);
export type SubmissionInput = z.infer<typeof submissionInputSchema>;
export const reviewStatuses = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export type RecipeSubmission = {
  id: string;
  account_id: string;
  kind: SubmissionKind;
  name: string;
  notes: string | null;
  /** The account's own recipe the submission was made from; null for a request. */
  source_recipe_id: string | null;
  /** The recipe as submitted; omitted from lists, present on the detail routes. */
  recipe: UserRecipeInput | null;
  status: ReviewStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export const openSubmissionLimit = 20;

export const proposalUnitHints = ["kg", "g", "l", "ml", "piece"] as const;
export const productProposalInputSchema = z.object({
  label: z.string().trim().min(2).max(120),
  /** A kind the site already uses (vegetables, fruits, grain, fish, meat, dairy, other) or the person's own word. */
  category: text(60),
  unit_hint: z.enum(proposalUnitHints).nullable().default(null),
  note: text(1000),
});
export type ProductProposalInput = z.infer<typeof productProposalInputSchema>;
export type ProductProposal = ProductProposalInput & { id: string; account_id: string; status: ReviewStatus; review_note: string | null; created_at: string; reviewed_at: string | null; reviewed_by: string | null };
export const pendingProposalLimit = 50;

/** What the admin sees beside any contribution: who made it. */
export type Contributor = { email: string; display_name: string };
