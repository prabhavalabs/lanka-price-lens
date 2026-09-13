import { useSyncExternalStore } from "react";

/** The language a reader wants recipe text in; remembered in this browser. */
export type Lang = "en" | "si" | "ta";
export const languageNames: Record<Lang, string> = { en: "English", si: "සිංහල", ta: "தமிழ்" };

const storageKey = "pricelens.language.v1";

function read(): Lang {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "si" || value === "ta" ? value : "en";
  } catch {
    return "en";
  }
}

let current: Lang = typeof window === "undefined" ? "en" : read();
const listeners = new Set<() => void>();

export const languageStore = {
  get: () => current,
  set: (lang: Lang) => {
    current = lang;
    try {
      window.localStorage.setItem(storageKey, lang);
    } catch {
      // Remembered for this page only.
    }
    for (const listener of listeners) listener();
  },
};

export function useLanguage(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => "en",
  );
}
