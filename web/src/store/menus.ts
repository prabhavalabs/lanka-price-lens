import { useSyncExternalStore } from "react";

/**
 * A household's menus: "Sunday lunch for 8", "Poya dana for 30". Each holds a headcount and
 * recipes that scale to it (a recipe may be made for fewer people, a sambol for the table).
 * Kept in this browser, like the basket; the totals and the shopping list come from the API.
 */

export type MenuItem = { recipe_id: string; label: string; servings: number | null };
export type Menu = { id: string; name: string; occasion: string | null; people: number; items: MenuItem[]; created_at: string; updated_at: string };
export type MenusState = { menus: Menu[] };

const storageKey = "pricelens.menus.v1";
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

function readMenus(raw: string | null): Menu[] {
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
        items: Array.isArray(menu.items) ? menu.items.filter((item) => typeof item?.recipe_id === "string").map((item) => ({ recipe_id: item.recipe_id, label: typeof item.label === "string" ? item.label : item.recipe_id, servings: typeof item.servings === "number" ? clampPeople(item.servings) : null })) : [],
        created_at: typeof menu.created_at === "string" ? menu.created_at : new Date(0).toISOString(),
        updated_at: typeof menu.updated_at === "string" ? menu.updated_at : new Date(0).toISOString(),
      }))
      .slice(0, maxMenus);
  } catch {
    return [];
  }
}

function read(): MenusState {
  if (typeof window === "undefined") return { menus: [] };
  try {
    return { menus: readMenus(window.localStorage.getItem(storageKey)) };
  } catch {
    return { menus: [] };
  }
}

let state: MenusState = read();
const listeners = new Set<() => void>();
const emptyState: MenusState = { menus: [] };

function commit(next: MenusState): void {
  state = next;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next.menus));
  } catch {
    // Private mode or a full store: the menus live for this page only.
  }
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      state = read();
      for (const listener of listeners) listener();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function newMenuId(): string {
  return `menu_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const menuStore = {
  get: () => state,
  subscribe,
  create: (input: { name: string; people: number; occasion?: string | null | undefined }): string => {
    const id = newMenuId();
    commit(createMenu(state, { id, ...input }));
    return id;
  },
  update: (id: string, patch: Partial<Pick<Menu, "name" | "occasion" | "people">>) => commit(updateMenu(state, id, patch)),
  remove: (id: string) => commit(removeMenu(state, id)),
  addRecipe: (menuId: string, recipe: { id: string; label: string }) => commit(addRecipe(state, menuId, recipe)),
  removeRecipe: (menuId: string, recipeId: string) => commit(removeRecipe(state, menuId, recipeId)),
  setServings: (menuId: string, recipeId: string, servings: number | null) => commit(setServings(state, menuId, recipeId, servings)),
};

export function useMenus(): MenusState {
  return useSyncExternalStore(subscribe, () => state, () => emptyState);
}

export function useMenu(id: string): Menu | null {
  return useSyncExternalStore(subscribe, () => state.menus.find((menu) => menu.id === id) ?? null, () => null);
}
