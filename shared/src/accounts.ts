import { z } from "zod";

import { dishCategories } from "./dish-vocabulary.ts";
import { localizedTextSchema, menuSchema, recipeIngredientSchema, recipeTags, servingRoles } from "./recipes.ts";

/**
 * Accounts on the public site: what a visitor sends to register, sign in, recover a password,
 * and manage a profile, and what a signed-in person can keep on the server (menus, own recipes).
 * The API validates every body with these; the site uses the same schemas for its forms.
 */

export const accountLocales = ["en", "si", "ta"] as const;
export type AccountLocale = (typeof accountLocales)[number];

export const emailSchema = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "That email address does not look right");
/** Long rather than complicated: ten characters or more, anything goes, up to 200. */
export const passwordSchema = z.string().min(10, "Use at least ten characters").max(200);
export const displayNameSchema = z.string().trim().min(1, "Tell us what to call you").max(80);
export const tokenSchema = z.string().trim().min(20).max(200);

export const registerSchema = z.object({ email: emailSchema, password: passwordSchema, display_name: displayNameSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200), remember: z.boolean().default(true) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const verifyEmailSchema = z.object({ token: tokenSchema });
export const changePasswordSchema = z.object({ current_password: z.string().min(1).max(200), new_password: passwordSchema });
export const changeEmailSchema = z.object({ new_email: emailSchema, password: z.string().min(1).max(200) });
export const deleteAccountSchema = z.object({ password: z.string().max(200).optional(), confirm: z.literal("DELETE") });

/** What a person eats, for the recipe picks and the daily recipe mail (docs/newsletters.md). */
export const dietChoices = ["everything", "vegetarian", "vegan", "pescatarian"] as const;
export type DietChoice = (typeof dietChoices)[number];
export const avoidChoices = ["egg", "dairy", "fish", "meat", "gluten"] as const;
export type AvoidChoice = (typeof avoidChoices)[number];
export const goalChoices = ["weight_loss", "high_protein", "diabetic_friendly", "heart_healthy", "budget", "quick", "kid_friendly", "comfort"] as const;
export type GoalChoice = (typeof goalChoices)[number];

export const preferencesSchema = z.object({
  /** Mail about the account itself (verification, password changes) is always sent; this covers everything else. */
  notify_email: z.boolean().default(true),
  /** The daily deals mail: supermarket drops, the cheapest store, and the household essentials watch. */
  notify_digest: z.boolean().default(false),
  /** Price alerts on watched products and menus. */
  notify_alerts: z.boolean().default(false),
  /** The daily recipe mail: three recipes picked for these preferences. */
  notify_recipes: z.boolean().default(false),
  diet: z.enum(dietChoices).default("everything"),
  avoid: z.array(z.enum(avoidChoices)).max(5).default([]),
  goals: z.array(z.enum(goalChoices)).max(8).default([]),
  /** Favourite kinds of dish, from the catalogue's categories. */
  likes: z.array(z.enum(dishCategories)).max(9).default([]),
});
export type AccountPreferences = z.infer<typeof preferencesSchema>;

export const profilePatchSchema = z.object({
  display_name: displayNameSchema.optional(),
  locale: z.enum(accountLocales).optional(),
  preferences: preferencesSchema.partial().optional(),
});

/** What the site knows about the signed-in person. Never the password hash, never the tokens. */
export type AccountProfile = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  avatar_url: string | null;
  locale: AccountLocale;
  preferences: AccountPreferences;
  /** Sign-in methods linked besides the password: "google". */
  identities: string[];
  has_password: boolean;
  created_at: string;
};

/**
 * The wishlist (docs/newsletters.md): products a person stars to watch. Each entry carries its
 * own alert rule: any drop against the day before, or a price the cheapest seller must reach.
 */
export const watchAlertModes = ["off", "any_drop", "below"] as const;
export type WatchAlertMode = (typeof watchAlertModes)[number];
export const watchAlertSchema = z.object({
  mode: z.enum(watchAlertModes).default("any_drop"),
  /** Rupees in cents; only read when the mode is "below". */
  threshold_minor: z.number().int().min(1).max(100_000_000).nullable().default(null),
});
export type WatchAlert = z.infer<typeof watchAlertSchema>;
export const watchItemInputSchema = z.object({ alert: watchAlertSchema.optional() });
export type WatchItemInput = z.infer<typeof watchItemInputSchema>;
export const watchLimit = 100;
export const productIdPattern = /^product_[a-z0-9]+(?:_[a-z0-9]+)*$/u;
export type WatchItem = {
  product_id: string;
  alert: WatchAlert;
  created_at: string;
  updated_at: string;
  last_alert_at: string | null;
  /** The cheapest price (cents) the last alert reported, so the next one waits for a further move. */
  last_alert_minor: number | null;
};
/** What the wishlist shows beside an entry: the cheapest seller today and how that compares with the day before. */
export type WatchPrice = {
  label: string;
  category: string;
  unit: string;
  cheapest: { market_id: string; market_label: string; group: string; price: number; observed_on: string } | null;
  /** The cheapest price the day before, in rupees; null without one. */
  yesterday: number | null;
  change_pct: number | null;
  sellers: number;
};
export type WatchEntry = WatchItem & { price: WatchPrice | null };


export const accountMenuInputSchema = menuSchema.omit({ id: true, created_at: true });
export type AccountMenuInput = z.infer<typeof accountMenuInputSchema>;
export type AccountMenu = AccountMenuInput & { id: string; account_id: string; created_at: string; updated_at: string };

/** The catalogue's categories, repeated here so an own recipe files under the same headings. */
export const userRecipeCategories = ["rice_and_grains", "vegetable", "pulses_and_eggs", "sambol_and_condiment", "fish_and_seafood", "meat_and_poultry", "snack", "sweet", "drink"] as const;

const stepsSchema = z.array(z.object({ text: z.string().trim().min(1).max(1000), minutes: z.number().int().min(0).nullable().default(null) })).min(1).max(40);

/**
 * A recipe a person writes for themselves: the corpus recipe shape with English required and
 * the other languages optional, filed under a catalogue category. Nutrition and cost are
 * computed from the ingredient registry and today's prices, as for the corpus.
 */
export const userRecipeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(userRecipeCategories),
  summary: z.string().trim().max(500).nullable().default(null),
  base_servings: z.number().int().min(1).max(100),
  serving: z.object({ role: z.enum(servingRoles), portion_g: z.number().finite().positive().max(5000), description: localizedTextSchema.nullable().default(null) }),
  yield_g: z.number().finite().positive().max(100_000),
  ingredients: z.array(recipeIngredientSchema).min(1).max(60),
  steps: z.object({ en: stepsSchema, si: stepsSchema.nullable().default(null), ta: stepsSchema.nullable().default(null) }),
  times: z.object({ prep_minutes: z.number().int().min(0).max(10_000), cook_minutes: z.number().int().min(0).max(10_000), passive_minutes: z.number().int().min(0).max(100_000).default(0) }),
  equipment: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  tips: localizedTextSchema.nullable().default(null),
  tags: z.array(z.enum(recipeTags)).max(12).default([]),
  /** Private recipes are the owner's alone; a later release may allow sharing. */
  visibility: z.enum(["private"]).default("private"),
});
export type UserRecipeInput = z.infer<typeof userRecipeInputSchema>;
export type UserRecipe = UserRecipeInput & { id: string; account_id: string; created_at: string; updated_at: string };
