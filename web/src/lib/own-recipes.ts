import { userRecipeInputSchema, type UserRecipeInput } from "@lanka-pricelens/shared";

import type { Lang, RecipeView } from "./api.ts";

/**
 * A person's own recipe as the editor holds it: every number is the text typed so far, every
 * optional language an empty string until written, every list entry keyed so React can keep
 * its field state while lines move. `validateDraft` turns a draft into the shared input schema's
 * shape and reads the schema's issues back as messages next to the fields they belong to.
 */

export type Text3 = { en: string; si: string; ta: string };
export type RecipeUnit = "g" | "ml" | "piece";
export type IngredientDraft = { key: string; ref: string | null; label: Text3; quantity: string; unit: RecipeUnit; household: string; preparation: Text3; optional: boolean; scaling: "linear" | "sublinear" | "fixed"; part: string };
export type StepDraft = { key: string; text: string; minutes: string };
export type RecipeDraft = {
  name: string;
  category: string;
  summary: string;
  base_servings: number;
  serving: { role: string; portion_g: string; description: Text3 };
  yield_g: string;
  ingredients: IngredientDraft[];
  steps: { en: StepDraft[]; si: StepDraft[]; ta: StepDraft[] };
  times: { prep_minutes: string; cook_minutes: string; passive_minutes: string };
  equipment: string[];
  tips: Text3;
  tags: string[];
};

let counter = 0;
export function draftKey(): string {
  counter += 1;
  return `d${counter}`;
}

export const emptyText3 = (): Text3 => ({ en: "", si: "", ta: "" });

export function emptyStep(): StepDraft {
  return { key: draftKey(), text: "", minutes: "" };
}

export function emptyIngredient(input: { ref: string | null; name: string; names?: { si?: string | null | undefined; ta?: string | null | undefined } | undefined; unit?: RecipeUnit | undefined }): IngredientDraft {
  return { key: draftKey(), ref: input.ref, label: { en: input.name, si: input.names?.si ?? "", ta: input.names?.ta ?? "" }, quantity: "", unit: input.unit ?? "g", household: "", preparation: emptyText3(), optional: false, scaling: "linear", part: "main" };
}

export function emptyDraft(): RecipeDraft {
  return {
    name: "",
    category: "vegetable",
    summary: "",
    base_servings: 4,
    // A plate-side curry portion and a pot for four, so a first draft saves without a weighing scale.
    serving: { role: "with_rice", portion_g: "150", description: emptyText3() },
    yield_g: "600",
    ingredients: [],
    steps: { en: [emptyStep()], si: [], ta: [] },
    times: { prep_minutes: "", cook_minutes: "", passive_minutes: "" },
    equipment: [],
    tips: emptyText3(),
    tags: [],
  };
}

const text3From = (text: { en: string; si: string | null; ta: string | null } | null | undefined): Text3 => ({ en: text?.en ?? "", si: text?.si ?? "", ta: text?.ta ?? "" });
const numberText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));

/** The editor's copy of a saved recipe. */
export function draftFromRecipe(recipe: UserRecipeInput): RecipeDraft {
  const steps = (list: Array<{ text: string; minutes: number | null }> | null): StepDraft[] => (list ?? []).map((step) => ({ key: draftKey(), text: step.text, minutes: numberText(step.minutes) }));
  return {
    name: recipe.name,
    category: recipe.category,
    summary: recipe.summary ?? "",
    base_servings: recipe.base_servings,
    serving: { role: recipe.serving.role, portion_g: numberText(recipe.serving.portion_g), description: text3From(recipe.serving.description) },
    yield_g: numberText(recipe.yield_g),
    ingredients: recipe.ingredients.map((line) => ({ key: draftKey(), ref: line.ref, label: text3From(line.label), quantity: numberText(line.quantity), unit: line.unit, household: line.household ?? "", preparation: text3From(line.preparation), optional: line.optional, scaling: line.scaling, part: line.part })),
    steps: { en: steps(recipe.steps.en), si: steps(recipe.steps.si), ta: steps(recipe.steps.ta) },
    times: { prep_minutes: numberText(recipe.times.prep_minutes), cook_minutes: numberText(recipe.times.cook_minutes), passive_minutes: numberText(recipe.times.passive_minutes) },
    equipment: [...recipe.equipment],
    tips: text3From(recipe.tips),
    tags: [...recipe.tags],
  };
}

/** A typed number, or undefined when nothing was typed, or NaN when it does not read as one. */
function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

const toText3 = (text: Text3) => ({ en: text.en.trim(), si: text.si.trim() || null, ta: text.ta.trim() || null });
/** Nothing at all when English is empty: the schema's nullable text, not a text with a blank English. */
const toOptionalText3 = (text: Text3) => (text.en.trim() ? toText3(text) : null);
const toSteps = (steps: StepDraft[]) => steps.map((step) => ({ text: step.text.trim(), minutes: step.minutes.trim() ? numberOf(step.minutes) : null }));

/** The draft in the shape the shared schema reads; nothing is validated here. */
export function draftToInput(draft: RecipeDraft): unknown {
  const optionalSteps = (steps: StepDraft[]) => (steps.some((step) => step.text.trim()) ? toSteps(steps) : null);
  return {
    name: draft.name.trim(),
    category: draft.category,
    summary: draft.summary.trim() || null,
    base_servings: draft.base_servings,
    serving: { role: draft.serving.role, portion_g: numberOf(draft.serving.portion_g), description: toOptionalText3(draft.serving.description) },
    yield_g: numberOf(draft.yield_g),
    ingredients: draft.ingredients.map((line) => ({
      ref: line.ref,
      label: toText3(line.label),
      quantity: numberOf(line.quantity),
      unit: line.unit,
      household: line.household.trim() || null,
      preparation: toOptionalText3(line.preparation),
      optional: line.optional,
      scaling: line.scaling,
      part: line.part,
    })),
    steps: { en: toSteps(draft.steps.en), si: optionalSteps(draft.steps.si), ta: optionalSteps(draft.steps.ta) },
    times: { prep_minutes: numberOf(draft.times.prep_minutes) ?? 0, cook_minutes: numberOf(draft.times.cook_minutes) ?? 0, passive_minutes: numberOf(draft.times.passive_minutes) ?? 0 },
    equipment: draft.equipment.map((item) => item.trim()).filter(Boolean),
    tips: toOptionalText3(draft.tips),
    tags: draft.tags,
    visibility: "private",
  };
}

type Issue = { code: string; path: PropertyKey[]; message: string; minimum?: number | bigint; maximum?: number | bigint; origin?: string; expected?: string };

/** The schema's complaint in the editor's words. */
function wording(issue: Issue): string {
  const last = issue.path.at(-1);
  switch (issue.code) {
    case "invalid_type":
      return issue.expected === "number" ? "Enter a number" : issue.expected === "string" ? "Write something here" : "This is missing";
    case "too_small":
      if (issue.origin === "array") return last === "ingredients" ? "Add at least one ingredient" : last === "en" ? "Add at least one step" : "Add at least one";
      if (issue.origin === "string") return "Write something here";
      return issue.minimum !== undefined && Number(issue.minimum) > 0 ? `Must be at least ${issue.minimum}` : "Must be more than zero";
    case "too_big":
      if (issue.origin === "array") return `Keep it to ${issue.maximum} at most`;
      if (issue.origin === "string") return `Keep it under ${issue.maximum} characters`;
      return `Keep it at ${issue.maximum} or less`;
    case "invalid_value":
      return "Pick one of the options";
    case "invalid_format":
      return "That does not look right";
    default:
      return issue.message;
  }
}

export type DraftValidation = { ok: true; value: UserRecipeInput; errors: Record<string, string> } | { ok: false; value: null; errors: Record<string, string> };

/**
 * Runs the shared schema over the draft. Errors are keyed by the field's path with dots
 * ("ingredients.2.quantity", "steps.en.0.text", "serving.portion_g"), first message per field.
 */
export function validateDraft(draft: RecipeDraft): DraftValidation {
  const result = userRecipeInputSchema.safeParse(draftToInput(draft));
  if (result.success) return { ok: true, value: result.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues as Issue[]) {
    const key = issue.path.map(String).join(".");
    if (!(key in errors)) errors[key] = wording(issue);
  }
  return { ok: false, value: null, errors };
}

/** True when any error sits under the path ("ingredients" covers "ingredients.2.quantity"). */
export function hasErrorUnder(errors: Record<string, string>, path: string): boolean {
  return Object.keys(errors).some((key) => key === path || key.startsWith(`${path}.`));
}

/**
 * The computed view the account's recipe endpoint adds, as the recipe page component reads it.
 * The corpus view carries review flags (off for a user recipe, since nobody drafted it by
 * machine) and a health note an own recipe has no use for; both are settled here so nothing
 * shows as "awaiting review" and nothing is missing.
 */
export function toRecipeView(payload: unknown, fallbackId = ""): RecipeView | null {
  if (typeof payload !== "object" || payload === null) return null;
  const view = payload as Partial<RecipeView> & Record<string, unknown>;
  if (!Array.isArray(view.ingredients) || typeof view.steps !== "object" || view.steps === null || !Array.isArray(view.steps.en)) return null;
  if (typeof view.nutrition !== "object" || view.nutrition === null || typeof view.times !== "object" || view.times === null || typeof view.serving !== "object" || view.serving === null) return null;
  const steps = view.steps;
  const languages: Lang[] = Array.isArray(view.languages) && view.languages.length ? (view.languages as Lang[]) : (["en", ...(steps.si ? ["si" as const] : []), ...(steps.ta ? ["ta" as const] : [])] satisfies Lang[]);
  return {
    id: typeof view.id === "string" ? view.id : fallbackId,
    servings: typeof view.servings === "number" ? view.servings : (view.base_servings ?? 1),
    base_servings: typeof view.base_servings === "number" ? view.base_servings : 1,
    serving: view.serving,
    yield_g: typeof view.yield_g === "number" ? view.yield_g : 0,
    ingredients: view.ingredients,
    steps: { en: steps.en, si: steps.si ?? null, ta: steps.ta ?? null },
    times: view.times,
    equipment: Array.isArray(view.equipment) ? view.equipment : [],
    tips: view.tips ?? null,
    health_note: view.health_note ?? null,
    tags: Array.isArray(view.tags) ? view.tags : [],
    nutrition: view.nutrition,
    cost: view.cost ?? null,
    review: { en: true, si: true, ta: true },
    review_needed: Array.isArray(view.review_needed) ? view.review_needed : [],
    languages,
  };
}
