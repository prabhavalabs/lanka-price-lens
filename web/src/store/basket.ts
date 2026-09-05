import { useSyncExternalStore } from "react";

import { trackEvent } from "../lib/analytics.ts";

/**
 * The shopper's basket: one store for the whole site, so the card on the board, the quick
 * basket in the header, the product page, the basket page, and the recipe pages all show the
 * same list and change it the same way. Persisted in this browser and kept in step across tabs.
 *
 * A line's quantity is a decimal in the unit the product is priced in: 0.5 for half a kilo of
 * potatoes, 6 for six eggs, 0.75 for 750 ml of oil.
 */

export type BasketLine = { id: string; label: string; quantity: number; unit: string };
export type BasketState = { lines: BasketLine[] };

const storageKey = "pricelens.basket.v2";
const legacyKey = "pricelens.basket.v1";
const maxQuantity = 999;

/** The smallest sensible step for a unit: a quarter kilo or litre, one piece. */
export function stepFor(unit: string): number {
  return unit === "kg" || unit === "l" ? 0.25 : 1;
}

/** The least a line can hold before it is removed: 50 g, 50 ml, one piece. */
export function minimumFor(unit: string): number {
  return unit === "kg" || unit === "l" ? 0.05 : 1;
}

// Pure transitions, so the behaviour is testable without a browser.
export function addLine(state: BasketState, id: string, label: string, unit: string, quantity = 1): BasketState {
  const existing = state.lines.find((line) => line.id === id);
  if (!existing) return { lines: [...state.lines, { id, label, unit, quantity: clamp(quantity, unit) }] };
  return setQuantity(state, id, existing.quantity + quantity);
}

export function setQuantity(state: BasketState, id: string, quantity: number): BasketState {
  const existing = state.lines.find((line) => line.id === id);
  if (!existing) return state;
  // Below the minimum removes the line: an empty quantity is not something to keep.
  if (!Number.isFinite(quantity) || quantity < minimumFor(existing.unit) - 1e-9) return removeLine(state, id);
  return { lines: state.lines.map((line) => (line.id === id ? { ...line, quantity: clamp(quantity, line.unit) } : line)) };
}

export function removeLine(state: BasketState, id: string): BasketState {
  return { lines: state.lines.filter((line) => line.id !== id) };
}

export function clearLines(): BasketState {
  return { lines: [] };
}

/** Number of distinct products in the basket (the badge in the header). */
export function countOf(state: BasketState): number {
  return state.lines.length;
}

function clamp(quantity: number, unit: string): number {
  const rounded = unit === "kg" || unit === "l" ? Math.round(quantity * 1000) / 1000 : Math.round(quantity);
  return Math.min(maxQuantity, Math.max(minimumFor(unit), rounded));
}

/** "500 g", "1.5 kg", "750 ml", "2 l", "6 pcs", "3 ×" for units the site does not know. */
export function formatQuantity(quantity: number, unit: string): string {
  if (unit === "kg") return quantity < 1 ? `${Math.round(quantity * 1000)} g` : `${trim(quantity)} kg`;
  if (unit === "l") return quantity < 1 ? `${Math.round(quantity * 1000)} ml` : `${trim(quantity)} l`;
  if (unit === "piece") return `${trim(quantity)} ${quantity === 1 ? "pc" : "pcs"}`;
  return `${trim(quantity)} ×`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function readLines(raw: string | null): BasketLine[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((line): line is Partial<BasketLine> & { id: string } => typeof line === "object" && line !== null && typeof (line as BasketLine).id === "string")
      .map((line) => ({ id: line.id, label: typeof line.label === "string" ? line.label : line.id, unit: typeof line.unit === "string" ? line.unit : "unit", quantity: typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 1 }));
  } catch {
    return [];
  }
}

function read(): BasketState {
  if (typeof window === "undefined") return { lines: [] };
  try {
    const current = window.localStorage.getItem(storageKey);
    if (current !== null) return { lines: readLines(current) };
    // A list saved before quantities had units carries over once.
    const legacy = window.localStorage.getItem(legacyKey);
    return { lines: readLines(legacy) };
  } catch {
    return { lines: [] };
  }
}

let state: BasketState = read();
const listeners = new Set<() => void>();
const emptyState: BasketState = { lines: [] };

function commit(next: BasketState): void {
  state = next;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next.lines));
  } catch {
    // Private mode or a full store: the list lives for this page only.
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

export const basketStore = {
  get: () => state,
  subscribe,
  add: (id: string, label: string, unit: string, quantity = 1) => {
    commit(addLine(state, id, label, unit, quantity));
    trackEvent("add_to_basket", { product: id });
  },
  setQuantity: (id: string, quantity: number) => commit(setQuantity(state, id, quantity)),
  increment: (id: string) => {
    const line = state.lines.find((entry) => entry.id === id);
    if (line) commit(setQuantity(state, id, line.quantity + stepFor(line.unit)));
  },
  decrement: (id: string) => {
    const line = state.lines.find((entry) => entry.id === id);
    if (line) commit(setQuantity(state, id, line.quantity - stepFor(line.unit)));
  },
  remove: (id: string) => commit(removeLine(state, id)),
  clear: () => commit(clearLines()),
};

/** The whole basket, re-rendering on every change. */
export function useBasket(): BasketState & { count: number } {
  const current = useSyncExternalStore(subscribe, () => state, () => emptyState);
  return { ...current, count: countOf(current) };
}

/** One product's line, or null when it is not in the basket; re-renders only when that line changes. */
export function useBasketLine(id: string): BasketLine | null {
  return useSyncExternalStore(subscribe, () => state.lines.find((line) => line.id === id) ?? null, () => null);
}
