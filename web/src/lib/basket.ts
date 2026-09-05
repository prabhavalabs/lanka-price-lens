import { useCallback, useEffect, useState } from "react";

/** The shopper's list, kept in this browser: product id and how many units they buy. */
export type BasketLine = { id: string; label: string; quantity: number };

const key = "pricelens.basket.v1";

function read(): BasketLine[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((line): line is BasketLine => typeof line === "object" && line !== null && typeof (line as BasketLine).id === "string" && typeof (line as BasketLine).quantity === "number") : [];
  } catch {
    return [];
  }
}

function write(lines: BasketLine[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // Private mode or a full store: the list simply does not persist.
  }
  window.dispatchEvent(new Event("pricelens:basket"));
}

export function useBasket() {
  const [lines, setLines] = useState<BasketLine[]>(() => (typeof window === "undefined" ? [] : read()));
  useEffect(() => {
    const refresh = () => setLines(read());
    window.addEventListener("pricelens:basket", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("pricelens:basket", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const add = useCallback((id: string, label: string, quantity = 1) => {
    const current = read();
    const existing = current.find((line) => line.id === id);
    write(existing ? current.map((line) => (line.id === id ? { ...line, quantity: Math.min(99, line.quantity + quantity) } : line)) : [...current, { id, label, quantity }]);
  }, []);
  const setQuantity = useCallback((id: string, quantity: number) => {
    const current = read();
    write(quantity <= 0 ? current.filter((line) => line.id !== id) : current.map((line) => (line.id === id ? { ...line, quantity: Math.min(99, quantity) } : line)));
  }, []);
  const remove = useCallback((id: string) => write(read().filter((line) => line.id !== id)), []);
  const clear = useCallback(() => write([]), []);
  const has = useCallback((id: string) => lines.some((line) => line.id === id), [lines]);
  return { lines, add, setQuantity, remove, clear, has };
}
