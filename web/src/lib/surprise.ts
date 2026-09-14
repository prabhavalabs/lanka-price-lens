import { ApiError, fetchSurprise, surpriseExcludeLimit, type SurprisePick } from "./api.ts";

/**
 * Surprise me: one dish drawn for the reader, never the same one twice in a tab. The ids shown
 * so far live in sessionStorage; when the catalogue runs dry for the reader's preferences the
 * list is cleared and the draw tried once more from the start. Nothing here touches React, so
 * the tests run under plain node with a fake fetch and an in-memory list.
 */

/** The sessionStorage key for the ids shown in this tab. */
export const seenStorageKey = "pricelens.surprise.seen";

/** How many ids the tab remembers: the route accepts at most this many exclusions. */
export const seenLimit = surpriseExcludeLimit;

/** The stored list, parsed: only strings, no repeats, the most recent last, at most `seenLimit`. */
export function parseSeen(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string" && entry && !ids.includes(entry)) ids.push(entry);
  }
  return ids.slice(-seenLimit);
}

/** The list with `id` as its most recent entry, the oldest dropped once the list is full. */
export function rememberSeen(seen: readonly string[], id: string): string[] {
  return [...seen.filter((entry) => entry !== id), id].slice(-seenLimit);
}

/** The API's answer when nothing in the catalogue fits: 404 with code NO_MATCH. */
export function isNoMatch(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === "NO_MATCH";
}

/** The banner's one line: "Picked for you · vegetarian · under 30 minutes". */
export function pickedLabel(reasons: readonly string[]): string {
  return ["Picked for you", ...reasons.map((reason) => reason.trim()).filter(Boolean)].join(" · ");
}

/** The reasons carried in the navigation state from the draw to the recipe page, or none when the state is not ours. */
export function readReasons(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const reasons = (state as { reasons?: unknown }).reasons;
  return Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim() !== "") : [];
}

/** Where the seen ids are kept; the browser's sessionStorage on the site, an array in the tests. */
export type SeenStore = { load(): string[]; save(ids: string[]): void };

/** The tab's list in sessionStorage; a browser that refuses storage (private mode, a full quota) forgets, which only means a repeat. */
export const sessionSeen: SeenStore = {
  load() {
    try {
      return parseSeen(window.sessionStorage.getItem(seenStorageKey));
    } catch {
      return [];
    }
  },
  save(ids) {
    try {
      if (ids.length) window.sessionStorage.setItem(seenStorageKey, JSON.stringify(ids));
      else window.sessionStorage.removeItem(seenStorageKey);
    } catch {
      // Nothing to do: the next draw may repeat a dish, which is the lesser harm.
    }
  },
};

export type DrawOptions = { diet?: string | undefined; signal?: AbortSignal | undefined };
export type DrawDeps = { fetch?: typeof fetchSurprise; seen?: SeenStore };

/**
 * One draw: ask for a dish the tab has not shown, remember it, and answer it. When the API says
 * nothing else matches and the tab has seen something, start over once; null means the
 * catalogue has nothing for these preferences at all. Any other failure is thrown as it came.
 */
export async function drawSurprise({ diet, signal }: DrawOptions = {}, { fetch = fetchSurprise, seen = sessionSeen }: DrawDeps = {}): Promise<SurprisePick | null> {
  const shown = seen.load();
  const draw = async (exclude: string[]): Promise<SurprisePick | null> => {
    try {
      const pick = await fetch({ exclude, diet }, signal);
      seen.save(rememberSeen(exclude, pick.id));
      return pick;
    } catch (error) {
      if (isNoMatch(error)) return null;
      throw error;
    }
  };
  const first = await draw(shown);
  if (first || shown.length === 0) return first;
  seen.save([]);
  return draw([]);
}

/** The path the draw opens, with the mark the recipe page reads to show the banner. */
export function surprisePath(id: string): string {
  return `/r/${encodeURIComponent(id)}?surprise=1`;
}
