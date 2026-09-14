import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { drawSurprise, surprisePath } from "@/lib/surprise";

/** How a draw ended: the page moved, nothing fits the preferences, or the request failed. */
export type SurpriseOutcome = { kind: "picked"; id: string } | SurpriseNote;

/** The outcomes that leave the reader where they are and need a word of explanation. */
export type SurpriseNote = { kind: "empty" } | { kind: "error"; message: string };

/** What to tell the reader when the draw came back empty. */
export const surpriseEmptyMessage = "Nothing matches your preferences yet.";

/**
 * One draw at a time, from wherever the site offers it: the search bar, the ⋯ menu, the banner
 * on a picked recipe. A pick navigates to the recipe with the reasons in the navigation state,
 * so the banner needs no second request; `replace` swaps the current entry for "Another one".
 */
export function useSurprise() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SurpriseNote | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const pick = useCallback(async ({ diet, replace = false }: { diet?: string | undefined; replace?: boolean } = {}): Promise<SurpriseOutcome> => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setOutcome(null);
    let result: SurpriseOutcome;
    try {
      const drawn = await drawSurprise({ diet, signal: current.signal });
      result = drawn ? { kind: "picked", id: drawn.id } : { kind: "empty" };
      if (drawn) navigate(surprisePath(drawn.id), { replace, state: { reasons: drawn.reasons } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "error", message: "" };
      result = { kind: "error", message: error instanceof Error && error.message ? error.message : "Could not pick a recipe. Try again in a moment." };
    }
    if (controller.current === current) {
      controller.current = null;
      setPending(false);
      setOutcome(result.kind === "picked" ? null : result);
    }
    return result;
  }, [navigate]);
  const reset = useCallback(() => setOutcome(null), []);
  return { pick, pending, outcome, reset };
}
