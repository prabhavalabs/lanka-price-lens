import { z } from "zod";

/**
 * The recipe layer over the dish catalogue.
 *
 * - The **ingredient registry** is every ingredient a recipe may name: the priced products of the
 *   price vocabulary (`product_…`) and the pantry entries not priced yet (`pantry_…`), each with its
 *   names in three languages and its nutrition per 100 g of the edible part, with the sources the
 *   value was checked against and the reasoning behind the chosen figure.
 * - A **recipe** hangs off a catalogue dish: quantities for a base number of servings, the method in
 *   three languages, times, tags. Everything derived (a scaled ingredient list, calories per
 *   serving, cost per serving) is computed from these facts by `recipe-math.ts`, never stored.
 * - A **menu** is what a household composes for an occasion: a name, a headcount, and recipes that
 *   scale to it.
 */

const dishId = z.string().regex(/^dish_[a-z0-9]+(?:_[a-z0-9]+)*$/u);
const ingredientId = z.string().regex(/^(?:product|pantry)_[a-z0-9]+(?:_[a-z0-9]+)*$/u);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected YYYY-MM-DD");
const positive = z.number().finite().positive();
const nonNegative = z.number().finite().min(0);

export const languages = ["en", "si", "ta"] as const;
export type Language = (typeof languages)[number];

/** Text in the three languages of the site; Sinhala and Tamil may be missing until someone writes them. */
export const localizedTextSchema = z.object({
  en: z.string().trim().min(1),
  si: z.string().trim().min(1).nullable().default(null),
  ta: z.string().trim().min(1).nullable().default(null),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const ingredientGroups = ["vegetable", "leafy", "fruit", "grain", "flour", "pulse", "meat", "poultry", "fish", "seafood", "dried_fish", "egg", "dairy", "fat_oil", "spice", "herb", "sweetener", "condiment", "nut_seed", "beverage", "prepared", "other"] as const;
export const ingredientStates = ["raw", "dried", "cooked", "processed"] as const;
export const confidenceLevels = ["high", "medium", "low"] as const;

const optionalMeasure = positive.nullable().default(null);

/** Nutrition per 100 g of the edible part, in the ingredient's stated state. */
export const nutritionSchema = z.object({
  kcal: nonNegative,
  protein_g: nonNegative,
  fat_g: nonNegative,
  carb_g: nonNegative,
  fibre_g: nonNegative.nullable().default(null),
  sugar_g: nonNegative.nullable().default(null),
  sodium_mg: nonNegative.nullable().default(null),
});
export type Nutrition = z.infer<typeof nutritionSchema>;

export const ingredientSchema = z.object({
  id: ingredientId,
  names: z.object({
    en: z.string().trim().min(1),
    si: z.string().trim().min(1).nullable().default(null),
    si_latn: z.string().trim().min(1).nullable().default(null),
    ta: z.string().trim().min(1).nullable().default(null),
    ta_latn: z.string().trim().min(1).nullable().default(null),
  }),
  group: z.enum(ingredientGroups),
  state: z.enum(ingredientStates),
  /** The form a household buys: "curry cut, skin and bone in", "whole, dehusked". */
  as_purchased_note: z.string().trim().min(1).nullable().default(null),
  /** Edible fraction of the purchased weight; recipe quantities are as purchased. Zero for a wrapper such as a banana leaf. */
  edible_portion: z.number().finite().min(0).max(1),
  density_g_per_ml: positive.nullable().default(null),
  measures: z
    .object({ tsp_g: optionalMeasure, tbsp_g: optionalMeasure, cup_g: optionalMeasure, piece_g: optionalMeasure, bunch_g: optionalMeasure })
    .default({ tsp_g: null, tbsp_g: null, cup_g: null, piece_g: null, bunch_g: null }),
  /** Null when no table carries the food (a steeped herb, a wrapper leaf): the ingredient then counts as unknown in a recipe's total. */
  nutrition: nutritionSchema.nullable(),
  /** Where the figure was checked: the table, the entry as it titles the food, and its values. */
  sources: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        entry: z.string().trim().min(1),
        kcal: nonNegative.nullable().default(null),
        protein_g: nonNegative.nullable().default(null),
        fat_g: nonNegative.nullable().default(null),
        carb_g: nonNegative.nullable().default(null),
      }),
    )
    .default([]),
  /** Which source the chosen value follows and the Sri Lankan adjustment made, in a sentence or two. */
  basis: z.string().trim().min(1),
  confidence: z.enum(confidenceLevels),
  notes: z.string().trim().min(1).nullable().default(null),
  /** True once a person has checked the entry against the tables. */
  reviewed: z.boolean().default(false),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const ingredientRegistrySchema = z
  .object({ schema_version: z.literal("1.0.0"), reviewed_by: z.string().min(1), reviewed_at: isoDate, ingredients: z.array(ingredientSchema) })
  .superRefine((registry, context) => {
    const seen = new Set<string>();
    for (const [index, ingredient] of registry.ingredients.entries()) {
      if (seen.has(ingredient.id)) context.addIssue({ code: "custom", message: `Duplicate ingredient id ${ingredient.id}`, path: ["ingredients", index, "id"] });
      seen.add(ingredient.id);
    }
  });
export type IngredientRegistry = z.infer<typeof ingredientRegistrySchema>;

/**
 * Energy the macros account for: 4 kcal/g protein and available carbohydrate, 9 fat, 2 fibre
 * (tables discount fibre this way). A checking aid, not a rule: vanilla extract carries ethanol,
 * baking powder non-nutritive salts, tea and cocoa polyphenols, so the validator warns and a
 * person decides.
 */
export function atwaterEnergy(nutrition: Nutrition): number {
  const fibre = Math.min(nutrition.fibre_g ?? 0, nutrition.carb_g);
  return 4 * nutrition.protein_g + 9 * nutrition.fat_g + 4 * (nutrition.carb_g - fibre) + 2 * fibre;
}

/** True for ingredients the warehouse can price today. */
export function isPricedIngredient(id: string): boolean {
  return id.startsWith("product_");
}

export const servingRoles = ["with_rice", "main", "side", "staple", "snack", "sweet", "drink", "condiment", "breakfast"] as const;
export const recipeUnits = ["g", "ml", "piece"] as const;
export const scalingModes = ["linear", "sublinear", "fixed"] as const;
export const ingredientParts = ["main", "tempering", "marinade", "batter", "dough", "filling", "sauce", "syrup", "garnish", "serving"] as const;
export const recipeTags = [
  "high_protein", "low_calorie", "low_carb", "low_fat", "high_fibre", "iron_rich", "calcium_rich", "diabetic_friendly", "weight_loss_friendly", "heart_healthy",
  "kid_friendly", "pregnancy_friendly", "elderly_friendly", "quick", "one_pot", "budget", "festive", "street_food", "comfort", "light", "filling", "probiotic",
  "hydrating", "immune_support", "traditional_remedy", "high_sugar", "deep_fried", "high_sodium",
] as const;
export type RecipeTag = (typeof recipeTags)[number];

const stepsSchema = z.array(z.object({ text: z.string().trim().min(1), minutes: z.number().int().min(0).nullable().default(null) })).min(1);

export const recipeIngredientSchema = z.object({
  /** Registry id, or null for the rare thing the registry does not carry yet (then `label` names it). */
  ref: ingredientId.nullable(),
  label: localizedTextSchema,
  /** As purchased, for `base_servings`. */
  quantity: positive,
  unit: z.enum(recipeUnits),
  household: z.string().trim().min(1).nullable().default(null),
  preparation: localizedTextSchema.nullable().default(null),
  optional: z.boolean().default(false),
  scaling: z.enum(scalingModes).default("linear"),
  part: z.enum(ingredientParts).default("main"),
});
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;

export const recipeSchema = z
  .object({
    id: dishId,
    base_servings: z.number().int().min(1),
    serving: z.object({ role: z.enum(servingRoles), portion_g: positive, description: localizedTextSchema.nullable().default(null) }),
    /** Cooked weight of the whole recipe at `base_servings`. */
    yield_g: positive,
    ingredients: z.array(recipeIngredientSchema).min(1),
    steps: z.object({ en: stepsSchema, si: stepsSchema.nullable().default(null), ta: stepsSchema.nullable().default(null) }),
    times: z.object({ prep_minutes: z.number().int().min(0), cook_minutes: z.number().int().min(0), passive_minutes: z.number().int().min(0).default(0) }),
    equipment: z.array(z.string().trim().min(1)).default([]),
    tips: localizedTextSchema.nullable().default(null),
    health_note: localizedTextSchema.nullable().default(null),
    tags: z.array(z.enum(recipeTags)).default([]),
    /** What the drafter was unsure of; cleared as a person reviews. */
    review_needed: z.array(z.enum(["si", "ta", "quantities"])).default([]),
    /** Per-language sign-off by a person. */
    review: z.object({ en: z.boolean().default(false), si: z.boolean().default(false), ta: z.boolean().default(false) }).default({ en: false, si: false, ta: false }),
  })
  .superRefine((recipe, context) => {
    for (const language of ["si", "ta"] as const) {
      const steps = recipe.steps[language];
      if (steps && steps.length !== recipe.steps.en.length) context.addIssue({ code: "custom", message: `${recipe.id}: ${steps.length} ${language} steps against ${recipe.steps.en.length} English steps`, path: ["steps", language] });
    }
  });
export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeInput = z.input<typeof recipeSchema>;

/** A household's composed meal: recipes scaled to a headcount, each overridable. */
export const menuSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  occasion: z.string().trim().min(1).max(120).nullable().default(null),
  people: z.number().int().min(1).max(1000),
  items: z
    .array(
      z.object({
        recipe_id: dishId,
        /** Servings of this recipe to make; null means one per person. */
        servings: z.number().int().min(1).max(1000).nullable().default(null),
      }),
    )
    .max(60),
  created_at: z.string().trim().min(1),
});
export type Menu = z.infer<typeof menuSchema>;
