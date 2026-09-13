import type { AccountMenu, AccountMenuInput } from "@lanka-pricelens/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { accountApi, AccountApiError } from "../lib/account-api.ts";
import { useAccount } from "./account.ts";

/**
 * A household's menus: "Sunday lunch for 8", "Poya dana for 30". Each holds a headcount and
 * recipes that scale to it (a recipe may be made for fewer people, a sambol for the table).
 * Menus live on the account: the list is one query against /v1/account/menus, every change is
 * applied to the cached copy first (the pure transitions below) and then PUT to the server;
 * the totals and the shopping list still come from the public compute endpoint.
 *
 * Menus kept in this browser before accounts existed stay under `pricelens.menus.v1` until the
 * menus page offers them for import on the first signed-in visit, then the key is cleared.
 */

export type MenuItem = { recipe_id: string; label: string; servings: number | null };
export type Menu = { id: string; name: string; occasion: string | null; people: number; items: MenuItem[]; created_at: string; updated_at: string };
export type MenusState = { menus: Menu[] };

export const legacyStorageKey = "pricelens.menus.v1";
export const maxPeople = 1000;
export const maxMenus = 30;
export const maxItems = 40;

function clampPeople(value: number): number {
  return Math.min(maxPeople, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
}

// Pure transitions, testable without a browser.
export function createMenu(state: MenusState, input: { id: string; name: string; people: number; occasion?: string | null | undefined; now?: string | undefined }): MenusState {
  const now = input.now ?? new Date().toISOString();
  const menu: Menu = { id: input.id, name: input.name.trim() || "Untitled menu", occasion: input.occasion?.trim() || null, people: clampPeople(input.people), items: [], created_at: now, updated_at: now };
  return { menus: [menu, ...state.menus.filter((entry) => entry.id !== menu.id)].slice(0, maxMenus) };
}

export function updateMenu(state: MenusState, id: string, patch: Partial<Pick<Menu, "name" | "occasion" | "people">>, now = new Date().toISOString()): MenusState {
  return {
    menus: state.menus.map((menu) => {
      if (menu.id !== id) return menu;
      return { ...menu, ...(patch.name !== undefined ? { name: patch.name.trim() || menu.name } : {}), ...(patch.occasion !== undefined ? { occasion: patch.occasion?.trim() || null } : {}), ...(patch.people !== undefined ? { people: clampPeople(patch.people) } : {}), updated_at: now };
    }),
  };
}

export function removeMenu(state: MenusState, id: string): MenusState {
  return { menus: state.menus.filter((menu) => menu.id !== id) };
}

/** Adds a recipe to a menu once; adding it again leaves the menu as it was. */
export function addRecipe(state: MenusState, menuId: string, recipe: { id: string; label: string }, now = new Date().toISOString()): MenusState {
  return {
    menus: state.menus.map((menu) => {
      if (menu.id !== menuId || menu.items.some((item) => item.recipe_id === recipe.id) || menu.items.length >= maxItems) return menu;
      return { ...menu, items: [...menu.items, { recipe_id: recipe.id, label: recipe.label, servings: null }], updated_at: now };
    }),
  };
}

export function removeRecipe(state: MenusState, menuId: string, recipeId: string, now = new Date().toISOString()): MenusState {
  return { menus: state.menus.map((menu) => (menu.id === menuId ? { ...menu, items: menu.items.filter((item) => item.recipe_id !== recipeId), updated_at: now } : menu)) };
}

/** Servings of one recipe in a menu; null follows the headcount. */
export function setServings(state: MenusState, menuId: string, recipeId: string, servings: number | null, now = new Date().toISOString()): MenusState {
  return {
    menus: state.menus.map((menu) => (menu.id === menuId ? { ...menu, items: menu.items.map((item) => (item.recipe_id === recipeId ? { ...item, servings: servings === null ? null : clampPeople(servings) } : item)), updated_at: now } : menu)),
  };
}

export function menuIn(state: MenusState, recipeId: string): Menu[] {
  return state.menus.filter((menu) => menu.items.some((item) => item.recipe_id === recipeId));
}

// The server's shape and ours. The account keeps only the ids of the recipes in a menu; the
// site shows a name next to each, learned from the dish when it was added or from the totals.

/** Dish names the site has seen, so a menu card can name its recipes before the totals load. */
const knownLabels = new Map<string, string>();

/** Remembers the English names the compute endpoint returned for a menu's dishes. */
export function rememberDishLabels(names: Record<string, { en: string } | undefined>): void {
  for (const [id, name] of Object.entries(names)) if (name?.en) knownLabels.set(id, name.en);
}

/** "dish_pol_sambol" reads as "Pol sambol" until a real name is known. */
export function labelFromRecipeId(id: string): string {
  const words = id.replace(/^dish_/u, "").split("_").filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** The names a list of menus already carries, keyed by recipe id. */
export function labelsOf(menus: Menu[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const menu of menus) for (const item of menu.items) if (item.label && item.label !== labelFromRecipeId(item.recipe_id)) labels[item.recipe_id] = item.label;
  return labels;
}

/** A menu as the account returns it, with a name for each recipe: one we know, or one read off the id. */
export function fromAccountMenu(menu: AccountMenu, labels: Record<string, string> = {}): Menu {
  return {
    id: menu.id,
    name: menu.name,
    occasion: menu.occasion ?? null,
    people: clampPeople(menu.people),
    items: menu.items.slice(0, maxItems).map((item) => ({ recipe_id: item.recipe_id, label: labels[item.recipe_id] ?? knownLabels.get(item.recipe_id) ?? labelFromRecipeId(item.recipe_id), servings: item.servings === null || item.servings === undefined ? null : clampPeople(item.servings) })),
    created_at: menu.created_at,
    updated_at: menu.updated_at,
  };
}

/** What the account stores of a menu: exactly the shared schema's fields, nothing the site adds for display. */
export function toMenuInput(menu: Menu): AccountMenuInput {
  return {
    name: (menu.name.trim() || "Untitled menu").slice(0, 120),
    occasion: menu.occasion?.trim().slice(0, 120) || null,
    people: clampPeople(menu.people),
    items: menu.items.slice(0, maxItems).map((item) => ({ recipe_id: item.recipe_id, servings: item.servings === null ? null : clampPeople(item.servings) })),
  };
}

// Menus kept in this browser before accounts existed.

export function parseStoredMenus(raw: string | null): Menu[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((menu): menu is Menu => typeof menu === "object" && menu !== null && typeof (menu as Menu).id === "string" && typeof (menu as Menu).name === "string")
      .map((menu) => ({
        id: menu.id,
        name: menu.name,
        occasion: typeof menu.occasion === "string" ? menu.occasion : null,
        people: clampPeople(typeof menu.people === "number" ? menu.people : 4),
        items: Array.isArray(menu.items) ? menu.items.filter((item) => typeof item?.recipe_id === "string").map((item) => ({ recipe_id: item.recipe_id, label: typeof item.label === "string" ? item.label : labelFromRecipeId(item.recipe_id), servings: typeof item.servings === "number" ? clampPeople(item.servings) : null })) : [],
        created_at: typeof menu.created_at === "string" ? menu.created_at : new Date(0).toISOString(),
        updated_at: typeof menu.updated_at === "string" ? menu.updated_at : new Date(0).toISOString(),
      }))
      .slice(0, maxMenus);
  } catch {
    return [];
  }
}

export function readLegacyMenus(): Menu[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredMenus(window.localStorage.getItem(legacyStorageKey));
  } catch {
    return [];
  }
}

/** Keeps what is still to import, or clears the key once nothing is left. */
export function writeLegacyMenus(menus: Menu[]): void {
  try {
    if (menus.length) window.localStorage.setItem(legacyStorageKey, JSON.stringify(menus));
    else window.localStorage.removeItem(legacyStorageKey);
  } catch {
    // Private mode or a full store: nothing to keep.
  }
}

export function clearLegacyMenus(): void {
  writeLegacyMenus([]);
}

// The account's menus, through React Query.

export const menusQueryKey = (accountId: string) => ["account", "menus", accountId] as const;

export type MenusStatus = "loading" | "ready" | "error" | "signed_out";
export type MenusResult = MenusState & { status: MenusStatus; error: unknown; refetch: () => void };

/** The signed-in person's menus; an empty list while signed out or before the address is verified. */
export function useMenus(): MenusResult {
  const account = useAccount();
  const client = useQueryClient();
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const queryKey = menusQueryKey(accountId);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const labels = labelsOf(client.getQueryData<Menu[]>(queryKey) ?? []);
      try {
        return (await accountApi.menus.list(signal)).items.map((menu) => fromAccountMenu(menu, labels));
      } catch (error) {
        // Not verified yet means no menus yet; signed out mid-flight is the same as none.
        if (error instanceof AccountApiError && (error.status === 401 || error.code === "EMAIL_NOT_VERIFIED")) return [];
        throw error;
      }
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const refetch = () => void query.refetch();
  if (account.status === "signed_out") return { menus: [], status: "signed_out", error: null, refetch };
  if (account.status === "loading" || query.isPending) return { menus: [], status: "loading", error: null, refetch };
  if (query.isError && !query.data) return { menus: [], status: "error", error: query.error, refetch };
  return { menus: query.data ?? [], status: "ready", error: null, refetch };
}

export function useMenu(id: string): { menu: Menu | null; status: MenusStatus; error: unknown; refetch: () => void } {
  const { menus, status, error, refetch } = useMenus();
  return { menu: menus.find((menu) => menu.id === id) ?? null, status, error, refetch };
}

export type MenuActions = {
  /** Creates a menu on the account, with any recipes given, and answers it (null when the server refused). */
  create: (input: { name: string; people: number; occasion?: string | null | undefined; items?: Array<{ id: string; label: string }> | undefined }) => Promise<Menu | null>;
  /** Saves a menu composed elsewhere (the browser's old menus) as a new one on the account. */
  createFrom: (menu: Menu) => Promise<Menu | null>;
  update: (id: string, patch: Partial<Pick<Menu, "name" | "occasion" | "people">>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  addRecipe: (menuId: string, recipe: { id: string; label: string }) => Promise<boolean>;
  removeRecipe: (menuId: string, recipeId: string) => Promise<boolean>;
  setServings: (menuId: string, recipeId: string, servings: number | null) => Promise<boolean>;
  pending: boolean;
  /** The last failure of an action started from this component; cleared by `clearError` or the next action. */
  error: unknown;
  clearError: () => void;
};

/**
 * Applies a transition to the cached menus at once, sends the changed menu, and puts the
 * server's copy in place if nothing else touched that menu meanwhile; a refusal rolls back
 * the one menu. Rapid steps on a stepper each send the state as it was after their own step.
 */
async function saveTransition(client: QueryClient, queryKey: ReturnType<typeof menusQueryKey>, id: string, transition: (state: MenusState) => MenusState): Promise<void> {
  await client.cancelQueries({ queryKey });
  const previous = client.getQueryData<Menu[]>(queryKey) ?? [];
  const before = previous.find((entry) => entry.id === id);
  const next = transition({ menus: previous }).menus;
  const menu = next.find((entry) => entry.id === id);
  if (!menu) throw new Error("This menu is no longer on your account.");
  if (menu === before) return;
  client.setQueryData<Menu[]>(queryKey, next);
  try {
    const saved = await accountApi.menus.update(id, toMenuInput(menu));
    client.setQueryData<Menu[]>(queryKey, (current) => (current ?? []).map((entry) => (entry === menu ? fromAccountMenu(saved, labelsOf([menu])) : entry)));
  } catch (error) {
    const current = client.getQueryData<Menu[]>(queryKey) ?? [];
    if (current.some((entry) => entry === menu) && before) client.setQueryData<Menu[]>(queryKey, current.map((entry) => (entry === menu ? before : entry)));
    else void client.invalidateQueries({ queryKey });
    throw error;
  }
}

export function useMenuActions(): MenuActions {
  const account = useAccount();
  const client = useQueryClient();
  const queryKey = menusQueryKey(account.status === "signed_in" ? account.account.id : "");
  const runner = useMutation({ mutationFn: (job: () => Promise<unknown>) => job() });
  const run = async <T,>(job: () => Promise<T>): Promise<T | null> => {
    try {
      return (await runner.mutateAsync(job)) as T;
    } catch {
      // The failure is on `runner.error`, shown where the action happened.
      return null;
    }
  };
  const save = (id: string, transition: (state: MenusState) => MenusState) => run(async () => { await saveTransition(client, queryKey, id, transition); return true; }).then((done) => done === true);
  const createFrom = (menu: Menu) =>
    run(async () => {
      const saved = fromAccountMenu(await accountApi.menus.create(toMenuInput(menu)), labelsOf([menu]));
      client.setQueryData<Menu[]>(queryKey, (current) => [saved, ...(current ?? []).filter((entry) => entry.id !== saved.id)].slice(0, maxMenus));
      return saved;
    });
  return {
    create: (input) => {
      let state = createMenu({ menus: [] }, { id: "new", name: input.name, people: input.people, occasion: input.occasion });
      for (const recipe of input.items ?? []) state = addRecipe(state, "new", recipe);
      return createFrom(state.menus[0]!);
    },
    createFrom,
    update: (id, patch) => save(id, (state) => updateMenu(state, id, patch)),
    remove: (id) =>
      run(async () => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData<Menu[]>(queryKey) ?? [];
        const next = removeMenu({ menus: previous }, id).menus;
        client.setQueryData<Menu[]>(queryKey, next);
        try {
          await accountApi.menus.remove(id);
        } catch (error) {
          // Gone already is as good as removed; anything else puts the menu back.
          if (error instanceof AccountApiError && error.status === 404) return true;
          client.setQueryData<Menu[]>(queryKey, (current) => (current === next ? previous : current));
          throw error;
        }
        return true;
      }).then((done) => done === true),
    addRecipe: (menuId, recipe) => save(menuId, (state) => addRecipe(state, menuId, recipe)),
    removeRecipe: (menuId, recipeId) => save(menuId, (state) => removeRecipe(state, menuId, recipeId)),
    setServings: (menuId, recipeId, servings) => save(menuId, (state) => setServings(state, menuId, recipeId, servings)),
    pending: runner.isPending,
    error: runner.error,
    clearError: () => runner.reset(),
  };
}
