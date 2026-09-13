import type { RecipeQueryParams } from "./api.ts";

/**
 * The recipe search as one object read from and written to the address bar, so a search is a
 * link and the back button works. Everything the query endpoint filters on lives here.
 */
export type RecipeSearch = {
  q: string;
  category: string;
  tags: string[];
  diet: string[];
  max_kcal: number | null;
  min_protein: number | null;
  max_minutes: number | null;
  max_cost: number | null;
  sort: string;
  page: number;
};

export const sortOptions: Array<{ value: string; label: string }> = [
  { value: "", label: "Best match" },
  { value: "kcal", label: "Fewest calories" },
  { value: "protein", label: "Most protein" },
  { value: "time", label: "Quickest" },
  { value: "cost", label: "Cheapest" },
  { value: "name", label: "By name" },
];

export const dietOptions: Array<{ value: string; label: string }> = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "gluten_free", label: "Gluten free" },
  { value: "egg_free", label: "Egg free" },
  { value: "dairy_free", label: "Dairy free" },
];
const dietValues = new Set(dietOptions.map((option) => option.value));

export const kcalOptions = [150, 250, 400, 600];
export const proteinOptions = [10, 20, 30];
export const minutesOptions = [20, 30, 60];
export const costOptions = [50, 100, 200, 400];

const number = (value: string | null): number | null => {
  const parsed = Number(value);
  return value !== null && value !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function readSearch(params: URLSearchParams): RecipeSearch {
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    category: params.get("category") ?? "",
    tags: (params.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    diet: (params.get("diet") ?? "").split(",").map((need) => need.trim()).filter((need) => dietValues.has(need)),
    max_kcal: number(params.get("max_kcal")),
    min_protein: number(params.get("min_protein")),
    max_minutes: number(params.get("max_minutes")),
    max_cost: number(params.get("max_cost")),
    sort: params.get("sort") ?? "",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

/** The address for a search: only what differs from the defaults, so a plain visit stays a plain address. */
export function writeSearch(search: RecipeSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (search.q.trim()) params.set("q", search.q.trim());
  if (search.category) params.set("category", search.category);
  if (search.tags.length) params.set("tags", search.tags.join(","));
  if (search.diet.length) params.set("diet", search.diet.join(","));
  if (search.max_kcal) params.set("max_kcal", String(search.max_kcal));
  if (search.min_protein) params.set("min_protein", String(search.min_protein));
  if (search.max_minutes) params.set("max_minutes", String(search.max_minutes));
  if (search.max_cost) params.set("max_cost", String(search.max_cost));
  if (search.sort) params.set("sort", search.sort);
  if (search.page > 1) params.set("page", String(search.page));
  return params;
}

export function toQueryParams(search: RecipeSearch): RecipeQueryParams {
  return {
    q: search.q.trim() || undefined,
    category: search.category || undefined,
    tags: search.tags.length ? search.tags : undefined,
    diet: search.diet.length ? search.diet : undefined,
    max_kcal: search.max_kcal ?? undefined,
    min_protein: search.min_protein ?? undefined,
    max_minutes: search.max_minutes ?? undefined,
    max_cost: search.max_cost ?? undefined,
    sort: search.sort || undefined,
    page: search.page,
    cost: true,
  };
}

/** How many filters are set beyond the text and the sort: the badge on the Filters button. */
export function activeFilterCount(search: RecipeSearch): number {
  return (search.category ? 1 : 0) + search.tags.length + search.diet.length + (search.max_kcal ? 1 : 0) + (search.min_protein ? 1 : 0) + (search.max_minutes ? 1 : 0) + (search.max_cost ? 1 : 0);
}

export const emptySearch: RecipeSearch = { q: "", category: "", tags: [], diet: [], max_kcal: null, min_protein: null, max_minutes: null, max_cost: null, sort: "", page: 1 };
