import type { AccountPreferences, AvoidChoice, DietChoice, GoalChoice } from "./accounts.ts";
import type { dishCategories } from "./dish-vocabulary.ts";
import type { RecipeTag } from "./recipes.ts";

/**
 * Picking dishes for a person: the Surprise me button on the site and the three recipes in the
 * daily mail (docs/newsletters.md). Pure functions over plain facts about a dish and the
 * account's food preferences. Diet and the things to avoid are hard filters; goals, favourite
 * kinds of dish, and popularity make a score; the picks are weighted random draws, seeded when
 * the caller needs the same answer twice (a mail for a day, "another one" in a tab).
 */

export type DishCategory = (typeof dishCategories)[number];

export type DishFacts = {
  id: string;
  category: DishCategory;
  /** The catalogue's diet tags for the dish (`dish.diet`). */
  diet: string[];
  /** The recipe's tags, curated and earned (`recipe.tags`). */
  tags: string[];
  kcal_per_serving: number | null;
  /** Prep, cook, and passive minutes together. */
  minutes: number | null;
  /** 1 = everyday, 2 = common, 3 = occasional. */
  popularity: 1 | 2 | 3;
};

/** A dish qualifies for the diet when its tags say so; "everything" asks nothing. */
const dietRules: Record<DietChoice, (diet: readonly string[]) => boolean> = {
  everything: () => true,
  vegetarian: (diet) => diet.includes("vegetarian") || diet.includes("vegan"),
  vegan: (diet) => diet.includes("vegan"),
  pescatarian: (diet) => !diet.includes("contains_meat"),
};

/** Avoiding an ingredient means the dish must lack its `contains_*` tag; avoiding gluten means it must be tagged gluten free. */
const avoidRules: Record<AvoidChoice, (diet: readonly string[]) => boolean> = {
  egg: (diet) => !diet.includes("contains_egg"),
  dairy: (diet) => !diet.includes("contains_dairy"),
  fish: (diet) => !diet.includes("contains_fish"),
  meat: (diet) => !diet.includes("contains_meat"),
  gluten: (diet) => diet.includes("gluten_free"),
};

/** The recipe tags each goal looks for, and the ones that count against it. */
const goalTags: Record<GoalChoice, { wants: readonly RecipeTag[]; penalties: readonly RecipeTag[] }> = {
  weight_loss: { wants: ["weight_loss_friendly", "low_calorie", "light"], penalties: ["deep_fried", "high_sugar"] },
  high_protein: { wants: ["high_protein"], penalties: [] },
  diabetic_friendly: { wants: ["diabetic_friendly"], penalties: ["high_sugar"] },
  heart_healthy: { wants: ["heart_healthy"], penalties: ["high_sodium", "deep_fried"] },
  budget: { wants: ["budget"], penalties: [] },
  quick: { wants: ["quick", "one_pot"], penalties: [] },
  kid_friendly: { wants: ["kid_friendly"], penalties: [] },
  comfort: { wants: ["comfort", "filling"], penalties: [] },
};

const goalPhrases: Record<GoalChoice, string> = {
  weight_loss: "good for weight loss",
  high_protein: "high protein",
  diabetic_friendly: "diabetic friendly",
  heart_healthy: "heart healthy",
  budget: "easy on the budget",
  quick: "quick to make",
  kid_friendly: "kids like it",
  comfort: "comfort food",
};

const avoidPhrases: Record<AvoidChoice, string> = { egg: "no egg", dairy: "no dairy", fish: "no fish", meat: "no meat", gluten: "gluten free" };

const categoryPhrases: Record<DishCategory, string> = {
  rice_and_grains: "rice and grains",
  vegetable: "vegetables",
  pulses_and_eggs: "pulses and eggs",
  sambol_and_condiment: "sambols and condiments",
  fish_and_seafood: "fish and seafood",
  meat_and_poultry: "meat and poultry",
  snack: "snacks",
  sweet: "sweets",
  drink: "drinks",
};

/** Points for each matching goal tag, taken away for each penalty tag, and for a favourite kind of dish. */
const goalPoints = 2;
const penaltyPoints = 3;
const likePoints = 2;
/** A dish this quick earns the "under 30 minutes" line and the quick goal. */
export const quickMinutes = 30;

/** The hard filters: the diet and the things to avoid. With nothing set every dish passes. */
export function suitable(dish: DishFacts, preferences: AccountPreferences): boolean {
  if (!dietRules[preferences.diet](dish.diet)) return false;
  return preferences.avoid.every((choice) => avoidRules[choice](dish.diet));
}

/**
 * How well a suitable dish fits: everyday dishes start ahead (3, 2, 1 by popularity tier), each
 * goal adds points per matching tag and takes more away per penalty tag, and a favourite kind
 * of dish adds a bonus. Higher is better; the draw floors the weight at one, so a negative
 * score still leaves a small chance.
 */
export function scoreDish(dish: DishFacts, preferences: AccountPreferences): number {
  let score = 4 - dish.popularity;
  for (const goal of preferences.goals) {
    const { wants, penalties } = goalTags[goal];
    score += goalPoints * wants.filter((tag) => dish.tags.includes(tag)).length;
    score -= penaltyPoints * penalties.filter((tag) => dish.tags.includes(tag)).length;
  }
  if (preferences.likes.includes(dish.category)) score += likePoints;
  return score;
}

/** Short phrases for why the dish was picked, in the order the site shows them. */
export function explainPick(dish: DishFacts, preferences: AccountPreferences): string[] {
  const reasons: string[] = [];
  if (preferences.diet !== "everything" && dietRules[preferences.diet](dish.diet)) reasons.push(preferences.diet);
  for (const choice of preferences.avoid) if (avoidRules[choice](dish.diet)) reasons.push(avoidPhrases[choice]);
  const quick = dish.minutes !== null && dish.minutes <= quickMinutes;
  for (const goal of preferences.goals) {
    // The minutes line says it better than "quick to make" when both apply.
    if (goal === "quick" && quick) continue;
    if (goalTags[goal].wants.some((tag) => dish.tags.includes(tag))) reasons.push(goalPhrases[goal]);
  }
  if (quick) reasons.push(`under ${quickMinutes} minutes`);
  if (preferences.likes.includes(dish.category)) reasons.push(`you like ${categoryPhrases[dish.category]}`);
  if (dish.popularity === 1) reasons.push("popular");
  return [...new Set(reasons)];
}

/**
 * One dish drawn at random among the suitable ones, each weighted by its score (floor one), so
 * a dish that fits well comes up more often without the same one coming up every time. With a
 * seed the draw repeats; `exclude` keeps ids already shown out of it. Null when nothing qualifies.
 */
export function pickSurprise(dishes: DishFacts[], preferences: AccountPreferences, options: { exclude?: Iterable<string>; seed?: string } = {}): DishFacts | null {
  const excluded = new Set(options.exclude ?? []);
  const pool = dishes.filter((dish) => !excluded.has(dish.id) && suitable(dish, preferences));
  const random = options.seed === undefined ? Math.random : seededRandom(options.seed);
  return weightedDraw(pool, (dish) => scoreDish(dish, preferences), random);
}

/**
 * `count` dishes for a day: the same weighted draw, without replacement, deterministic for the
 * seed (the day and the account id), never an excluded id. Each draw is made among the
 * categories not picked yet while any remain, so three picks are three kinds of dish.
 */
export function pickDaily(dishes: DishFacts[], preferences: AccountPreferences, options: { exclude: Iterable<string>; count: number; seed: string }): DishFacts[] {
  const excluded = new Set(options.exclude);
  let pool = dishes.filter((dish) => !excluded.has(dish.id) && suitable(dish, preferences));
  const random = seededRandom(options.seed);
  const picks: DishFacts[] = [];
  const categories = new Set<DishCategory>();
  while (picks.length < options.count && pool.length) {
    const unseen = pool.filter((dish) => !categories.has(dish.category));
    const pick = weightedDraw(unseen.length ? unseen : pool, (dish) => scoreDish(dish, preferences), random);
    if (!pick) break;
    picks.push(pick);
    categories.add(pick.category);
    pool = pool.filter((dish) => dish.id !== pick.id);
  }
  return picks;
}

/** A draw in proportion to weight, each weight at least one, over `items` in the order given. */
function weightedDraw<T>(items: T[], weightOf: (item: T) => number, random: () => number): T | null {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(1, weightOf(item)));
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return items[index] ?? null;
  }
  return items[items.length - 1] ?? null;
}

/** A small deterministic generator (mulberry32) over a 32-bit FNV-1a hash of the seed. */
function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  state >>>= 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
