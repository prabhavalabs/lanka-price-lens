import { pickDaily, type AccountPreferences } from "@lanka-pricelens/shared";

import type { ContentBlock, RecipeCard } from "../mail/layout.ts";
import type { MailData } from "../mail/templates.ts";
import type { RecipeIndexEntry } from "../recipe-views.ts";
import { dishFactsOf } from "../surprise.ts";
import { countWords, dayWords } from "./time.ts";

/**
 * The daily recipe mail for one account: three dishes chosen for the person's preferences by
 * `pickDaily`, deterministic for the day and the account, never one the account was sent in
 * the last three weeks (the caller passes those ids). Each card links the recipe page and shows
 * the site's card image, the calories, the minutes, and what a serving costs when the caller
 * can price it.
 */

export const recipesPerMail = 3;

/** Rupees per serving for an entry, or null when today's prices cannot cost it. */
export type CostLookup = (entry: RecipeIndexEntry) => number | null;

export type RecipeMailDeps = {
  index: Map<string, RecipeIndexEntry>;
  /** "https://price.prabhavalabs.com": where the links and the card images point. */
  siteOrigin: string;
  cost?: CostLookup | null | undefined;
  count?: number | undefined;
};

export type RecipeMail = {
  dishIds: string[];
  cards: RecipeCard[];
  data: MailData;
};

/** "Rs 1,234": whole rupees with thousands separators. */
export function formatRupees(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-US")}`;
}

export function recipeUrl(siteOrigin: string, dishId: string): string {
  return `${siteOrigin}/r/${dishId}`;
}

export function recipeImageUrl(siteOrigin: string, dishId: string): string {
  return `${siteOrigin}/og/r/${dishId}.png`;
}

export function recipeCardOf(entry: RecipeIndexEntry, siteOrigin: string, cost: CostLookup | null | undefined): RecipeCard {
  const perServing = cost ? cost(entry) : null;
  return {
    image: recipeImageUrl(siteOrigin, entry.dish.id),
    name: entry.dish.names.en,
    summary: entry.dish.summary,
    kcal: entry.metrics.kcal,
    minutes: entry.metrics.minutes,
    cost: perServing !== null && perServing !== undefined && Number.isFinite(perServing) ? `${formatRupees(perServing)} per serving` : null,
    url: recipeUrl(siteOrigin, entry.dish.id),
  };
}

/** The recipe cards block for a set of entries, in the order given. */
export function recipeBlock(entries: RecipeIndexEntry[], siteOrigin: string, cost: CostLookup | null | undefined, heading: string | null = null): Extract<ContentBlock, { type: "recipes" }> {
  return { type: "recipes", heading, cards: entries.map((entry) => recipeCardOf(entry, siteOrigin, cost)) };
}

/**
 * Composes the mail, or null when nothing in the catalogue suits the person's preferences
 * once the recent deliveries are excluded. A short mail (one or two recipes) still goes: a
 * narrow diet should not mean silence, and a repeat is never sent.
 */
export function composeRecipesMail(
  account: { id: string; display_name: string; preferences: AccountPreferences },
  day: string,
  exclude: Iterable<string>,
  deps: RecipeMailDeps,
  unsubscribeUrl: string | null = null,
): RecipeMail | null {
  const count = deps.count ?? recipesPerMail;
  const origin = deps.siteOrigin.replace(/\/+$/u, "");
  // The same facts the site's Surprise me scores, so the mail and the page agree on what suits a person.
  const facts = [...deps.index.values()].map(dishFactsOf);
  const picks = pickDaily(facts, account.preferences, { exclude, count, seed: `${day}:${account.id}` });
  if (picks.length === 0) return null;
  const entries = picks.map((pick) => deps.index.get(pick.id)).filter((entry): entry is RecipeIndexEntry => entry !== undefined);
  const block = recipeBlock(entries, origin, deps.cost);
  return {
    dishIds: entries.map((entry) => entry.dish.id),
    cards: block.cards,
    data: {
      values: { name: account.display_name, date: dayWords(day), count: countWords(entries.length), link: `${origin}/recipes` },
      blocks: [block],
      unsubscribeUrl,
    },
  };
}
