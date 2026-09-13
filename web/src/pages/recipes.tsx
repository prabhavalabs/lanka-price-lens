import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ErrorState } from "@/components/error-state";
import { RecipeCard } from "@/components/recipe-card";
import { RecipeSearchBar } from "@/components/recipe-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchRecipeQuery } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { kcalLabel } from "@/lib/recipe-format";
import { readSearch, toQueryParams, writeSearch, type RecipeSearch } from "@/lib/recipe-search";
import { cn } from "@/lib/utils";

/**
 * Browse and search the recipes. The search lives in the address (text, category, tags,
 * calories, protein, time, cost, sort, page); typing is debounced, every result comes from the
 * server ranked and filtered, a superseded request is cancelled, and the last results stay on
 * screen while the next load.
 */
export function RecipesPage() {
  usePageTitle("Sri Lankan recipes priced today · PriceLens");
  const [params, setParams] = useSearchParams();
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
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Recipes</h1>
        <p className="mt-1 max-w-xl text-pretty text-muted-foreground">363 Sri Lankan dishes with what each needs, the calories, and what it costs to cook today. Search by name in any language or by ingredient, or ask for what you need: light, high protein, quick, cheap.</p>
      </header>
      <RecipeSearchBar fetching={list.isFetching} onChange={update} search={search} total={list.data?.total ?? null} />
      {list.isPending ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}</div> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : null}
      {list.data ? (
        <>
          {list.data.items.length ? (
            <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", list.isFetching && "opacity-70")}>
              {list.data.items.map((item) => (
                <RecipeCard key={item.dish.id} dish={item.dish}>
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
            </div>
          )}
          {list.data.pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button disabled={list.data.page <= 1} onClick={() => goToPage(list.data.page - 1)} size="sm" variant="outline">Previous</Button>
              <span className="text-muted-foreground tabular-nums">Page {list.data.page} of {list.data.pages}</span>
              <Button disabled={list.data.page >= list.data.pages} onClick={() => goToPage(list.data.page + 1)} size="sm" variant="outline">Next</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
