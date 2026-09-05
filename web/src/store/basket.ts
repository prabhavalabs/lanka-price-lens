import { useSyncExternalStore } from "react";

/**
 * The shopper's basket: one store for the whole site, so the card on the board, the quick
 * basket in the header, the product page, and the basket page all show the same list and
 * change it the same way. Persisted in this browser and kept in step across tabs.
 */

export type BasketLine = { id: string; label: string; quantity: number };
export type BasketState = { lines: BasketLine[] };

const storageKey = "pricelens.basket.v1";
const maxQuantity = 99;

// Pure transitions, so the behaviour is testable without a browser.
export function addLine(state: BasketState, id: string, label: string, quantity = 1): BasketState {
  const existing = state.lines.find((line) => line.id === id);
  if (!existing) return { lines: [...state.lines, { id, label, quantity: clamp(quantity) }] };
  return setQuantity(state, id, existing.quantity + quantity);
}

export function setQuantity(state: BasketState, id: string, quantity: number): BasketState {
  // Reaching zero removes the line: an empty quantity is not something to keep.
  if (quantity <= 0) return removeLine(state, id);
  return { lines: state.lines.map((line) => (line.id === id ? { ...line, quantity: clamp(quantity) } : line)) };
}

export function removeLine(state: BasketState, id: string): BasketState {
  return { lines: state.lines.filter((line) => line.id !== id) };
}

export function clearLines(): BasketState {
  return { lines: [] };
}

export function countOf(state: BasketState): number {
  return state.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function clamp(quantity: number): number {
  return Math.min(maxQuantity, Math.max(1, Math.round(quantity)));
}

function read(): BasketState {
  if (typeof window === "undefined") return { lines: [] };
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const lines = Array.isArray(parsed)
      ? parsed.filter((line): line is BasketLine => typeof line === "object" && line !== null && typeof (line as BasketLine).id === "string" && typeof (line as BasketLine).label === "string" && typeof (line as BasketLine).quantity === "number")
      : [];
    return { lines };
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
  add: (id: string, label: string, quantity = 1) => commit(addLine(state, id, label, quantity)),
  setQuantity: (id: string, quantity: number) => commit(setQuantity(state, id, quantity)),
  increment: (id: string, label: string) => commit(addLine(state, id, label, 1)),
  decrement: (id: string) => {
    const line = state.lines.find((entry) => entry.id === id);
    if (line) commit(setQuantity(state, id, line.quantity - 1));
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
