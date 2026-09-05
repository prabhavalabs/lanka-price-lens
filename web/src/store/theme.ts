import { useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the device says. The choice is kept in this browser; "system" is the
 * default and follows the device when it changes. `index.html` applies the saved choice before the
 * first paint so the page never flashes the wrong theme.
 */

export type ThemeChoice = "light" | "dark" | "system";

const storageKey = "pricelens.theme";
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = readChoice();

export function resolvedTheme(current: ThemeChoice = choice): "light" | "dark" {
  if (current !== "system") return current;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolvedTheme();
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

function notify(): void {
  apply();
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (choice === "system") notify(); });
  apply();
}

export const themeStore = {
  get: () => choice,
  set: (next: ThemeChoice) => {
    choice = next;
    try {
      if (next === "system") window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next);
    } catch {
      // The choice still applies for this page.
    }
    notify();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useTheme(): { choice: ThemeChoice; resolved: "light" | "dark"; set: (next: ThemeChoice) => void } {
  const current = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => "system" as ThemeChoice);
  return { choice: current, resolved: resolvedTheme(current), set: themeStore.set };
}
