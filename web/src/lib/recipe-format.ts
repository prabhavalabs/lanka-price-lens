import type { Lang, Localized, Nutrition, RecipeIngredientView } from "./api.ts";

/** Labels for the tags a recipe can carry, as the site shows them. */
export const tagLabels: Record<string, string> = {
  high_protein: "High protein",
  low_calorie: "Low calorie",
  low_carb: "Low carb",
  low_fat: "Low fat",
  high_fibre: "High fibre",
  iron_rich: "Iron rich",
  calcium_rich: "Calcium rich",
  diabetic_friendly: "Diabetic friendly",
  weight_loss_friendly: "Weight loss",
  heart_healthy: "Heart healthy",
  kid_friendly: "Kids like it",
  pregnancy_friendly: "Pregnancy friendly",
  elderly_friendly: "Gentle for elders",
  quick: "Quick",
  one_pot: "One pot",
  budget: "Budget",
  festive: "Festive",
  street_food: "Street food",
  comfort: "Comfort food",
  light: "Light",
  filling: "Filling",
  probiotic: "Probiotic",
  hydrating: "Hydrating",
  immune_support: "Immune support",
  traditional_remedy: "Traditional remedy",
  high_sugar: "High sugar",
  deep_fried: "Deep fried",
  high_sodium: "High salt",
};

/** Tags a reader can filter by on the recipes page, in the order shown. */
export const filterTags = ["weight_loss_friendly", "high_protein", "low_calorie", "diabetic_friendly", "high_fibre", "quick", "budget", "kid_friendly", "one_pot", "light", "filling"] as const;

export function tagLabel(tag: string): string {
  return tagLabels[tag] ?? tag.replace(/_/gu, " ");
}

/** The text in the reader's language, falling back to English. */
export function localized(text: Localized | null | undefined, lang: Lang): string | null {
  if (!text) return null;
  return (lang === "si" ? text.si : lang === "ta" ? text.ta : null) ?? text.en;
}

/** An ingredient's name in the reader's language: the recipe's own wording first, then the registry's name. */
export function ingredientName(line: RecipeIngredientView, lang: Lang): string {
  if (lang === "si") return line.label.si ?? line.names?.si ?? line.label.en;
  if (lang === "ta") return line.label.ta ?? line.names?.ta ?? line.label.en;
  return line.label.en;
}

/** "600 g", "1.5 l", "2 pcs", "½ pc". */
export function amountLabel(quantity: number, unit: "g" | "ml" | "piece"): string {
  if (unit === "piece") return `${fractional(quantity)} ${quantity === 1 ? "pc" : "pcs"}`;
  if (unit === "g") return quantity >= 1000 ? `${trim(quantity / 1000)} kg` : `${trim(quantity)} g`;
  return quantity >= 1000 ? `${trim(quantity / 1000)} l` : `${trim(quantity)} ml`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function fractional(value: number): string {
  const whole = Math.floor(value);
  const half = value - whole >= 0.5;
  if (whole === 0 && half) return "½";
  return half ? `${whole}½` : String(whole);
}

export function kcalLabel(kcal: number): string {
  return `${Math.round(kcal).toLocaleString("en-LK")} kcal`;
}

export function gramsLabel(value: number | null, suffix = "g"): string {
  return value === null ? "—" : `${Math.round(value * 10) / 10} ${suffix}`;
}

/** The share of energy from protein, fat, and carbohydrate, as whole percentages that sum to 100. */
export function macroShares(nutrition: Nutrition): { protein: number; fat: number; carb: number } {
  const protein = nutrition.protein_g * 4;
  const fat = nutrition.fat_g * 9;
  const carb = nutrition.carb_g * 4;
  const total = protein + fat + carb;
  if (total <= 0) return { protein: 0, fat: 0, carb: 0 };
  const p = Math.round((protein / total) * 100);
  const f = Math.round((fat / total) * 100);
  return { protein: p, fat: f, carb: Math.max(0, 100 - p - f) };
}
