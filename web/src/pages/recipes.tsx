import { RiDiceLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { dietChoices, type DietChoice } from "@lanka-pricelens/shared";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { ErrorState } from "@/components/error-state";
import { RecipeCard } from "@/components/recipe-card";
import { RecipeSearchBar } from "@/components/recipe-search";
import { RequestDish } from "@/components/request-dish";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { surpriseEmptyMessage, useSurprise, type SurpriseNote } from "@/hooks/use-surprise";
import { fetchRecipeQuery } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { kcalLabel } from "@/lib/recipe-format";
import { readSearch, toQueryParams, writeSearch, type RecipeSearch } from "@/lib/recipe-search";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";

const isDietChoice = (value: string): value is DietChoice => (dietChoices as readonly string[]).includes(value);

/** The ⋯ menu lands here with the outcome of a draw that did not open a recipe, so the note has somewhere to show. */
function readHandedOutcome(state: unknown): SurpriseNote | null {
  if (!state || typeof state !== "object") return null;
  const outcome = (state as { surprise?: unknown }).surprise;
  if (!outcome || typeof outcome !== "object") return null;
  const kind = (outcome as { kind?: unknown }).kind;
  if (kind === "empty") return { kind: "empty" };
  if (kind === "error") return { kind: "error", message: String((outcome as { message?: unknown }).message ?? "") };
  return null;
}

/**
 * Browse and search the recipes. The search lives in the address (text, category, tags,
 * calories, protein, time, cost, sort, page); typing is debounced, every result comes from the
 * server ranked and filtered, a superseded request is cancelled, and the last results stay on
 * screen while the next load.
 */
export function RecipesPage() {
  usePageTitle("Sri Lankan recipes priced today · PriceLens");
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const account = useAccount();
  const surprise = useSurprise();
  const [handed] = useState(() => readHandedOutcome(location.state));
  const fromAddress = readSearch(params);
  // The text is kept locally so keystrokes are instant; everything else goes straight to the address.
  const [text, setText] = useState(fromAddress.q);
  const search: RecipeSearch = { ...fromAddress, q: text };
  const debouncedText = useDebouncedValue(text.trim(), 250);
  const effective: RecipeSearch = { ...fromAddress, q: debouncedText };
  const list = useQuery({
    queryKey: ["recipes-query", toQueryParams(effective)],
    queryFn: ({ signal }) => fetchRecipeQuery(toQueryParams(effective), signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const update = (next: RecipeSearch) => {
    setText(next.q);
    setParams(writeSearch({ ...next, q: next.q.trim() }), { replace: true });
  };
  const goToPage = (page: number) => setParams(writeSearch({ ...effective, page }));
  // Signed in, the account's preferences decide the draw; signed out, a vegetarian or vegan filter on the search narrows it.
  const guestDiet = account.status === "signed_out" ? search.diet.find(isDietChoice) : undefined;
  const surpriseNote = surprise.outcome ?? (surprise.pending ? null : handed);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Recipes</h1>
        <p className="mt-1 max-w-xl text-pretty text-muted-foreground">363 Sri Lankan dishes with what each needs, the calories, and what it costs to cook today. Search by name in any language or by ingredient, or ask for what you need: light, high protein, quick, cheap.</p>
      </header>
      <RecipeSearchBar
        action={
          <Button className="h-10 gap-1.5" disabled={surprise.pending} onClick={() => void surprise.pick({ diet: guestDiet })} title="Open a dish picked for you" type="button" variant="outline">
            <RiDiceLine className="size-4" />
            <span className="max-sm:sr-only">{surprise.pending ? "Picking" : "Surprise me"}</span>
          </Button>
        }
        fetching={list.isFetching}
        onChange={update}
        search={search}
        total={list.data?.total ?? null}
      />
      {surpriseNote ? (
        <p className="-mt-3 text-sm text-muted-foreground" role="status">
          {surpriseNote.kind === "empty" ? (
            <>{surpriseEmptyMessage} {account.status === "signed_in" ? <Link className="underline" to="/account#preferences">Change your preferences</Link> : "Loosen the diet filter"} and try again.</>
          ) : (
            surpriseNote.message || "Could not pick a recipe. Try again in a moment."
          )}
        </p>
      ) : null}
      {list.isPending ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}</div> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : null}
      {list.data ? (
        <>
          {list.data.items.length ? (
            <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", list.isFetching && "opacity-70")}>
              {list.data.items.map((item) => (
                <RecipeCard key={item.dish.id} dish={item.dish} score={item.score}>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px] tabular-nums">{kcalLabel(item.metrics.kcal)} / serving</Badge>
                    <Badge variant="outline" className="text-[10px] tabular-nums">{Math.round(item.metrics.protein_g)} g protein</Badge>
                    {typeof item.cost_per_serving === "number" ? <Badge variant="outline" className="text-[10px] tabular-nums">{item.cost_estimated ? "≈ " : ""}{rupees(item.cost_per_serving)} / serving</Badge> : null}
                  </div>
                </RecipeCard>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              <p>Nothing matches. Try another spelling, an ingredient, or fewer filters.</p>
              <p className="mt-2 text-sm">Or browse everything on the <Link to="/basket" className="underline">basket</Link> page from what you already have.</p>
              <p className="mt-4 text-sm"><RequestDish query={effective.q} /></p>
            </div>
          )}
          {list.data.pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button disabled={list.data.page <= 1} onClick={() => goToPage(list.data.page - 1)} size="sm" variant="outline">Previous</Button>
              <span className="text-muted-foreground tabular-nums">Page {list.data.page} of {list.data.pages}</span>
              <Button disabled={list.data.page >= list.data.pages} onClick={() => goToPage(list.data.page + 1)} size="sm" variant="outline">Next</Button>
            </div>
          ) : null}
          {list.data.items.length ? <p className="text-center text-sm text-muted-foreground"><RequestDish query={effective.q} /></p> : null}
        </>
      ) : null}
    </div>
  );
}
