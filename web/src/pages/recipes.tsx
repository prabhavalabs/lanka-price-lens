import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { RecipeCard } from "@/components/recipe-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchRecipes } from "@/lib/api";
import { dishCategoryLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/lib/page-title";
import { ErrorState } from "@/components/error-state";

const categories = ["rice_and_grains", "vegetable", "pulses_and_eggs", "sambol_and_condiment", "fish_and_seafood", "meat_and_poultry", "snack", "sweet", "drink"];

/** Browse the dish catalogue by name (English, Sinhala, Tamil, or an ingredient) and category. */
export function RecipesPage() {
  usePageTitle("Sri Lankan recipes priced today · PriceLens");
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(query.trim(), 250);
  const page = Number(params.get("page") ?? "1") || 1;
  const list = useQuery({ queryKey: ["recipes", debounced, category, page], queryFn: () => fetchRecipes({ q: debounced || undefined, category: category || undefined, page }), placeholderData: keepPreviousData });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Recipes</h1>
        <p className="mt-1 max-w-xl text-pretty text-muted-foreground">Sri Lankan dishes, with what each needs and what it costs to buy today. Add the things you have to your <Link to="/basket" className="underline">basket</Link> and the basket page suggests what to cook.</p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input aria-label="Search recipes" className="sm:max-w-sm" onChange={(event) => { setQuery(event.target.value); setParam("q", event.target.value.trim()); }} placeholder="Search dishes or ingredients, e.g. parippu, pol sambol, chicken" value={query} />
        <ScrollArea className="-mx-4 sm:mx-0">
          <div className="flex gap-2 px-4 pb-3 sm:px-0">
            <Button className="shrink-0 rounded-full" onClick={() => setParam("category", "")} size="sm" variant={category ? "outline" : "default"}>All</Button>
            {categories.map((entry) => <Button className={cn("shrink-0 rounded-full")} key={entry} onClick={() => setParam("category", entry)} size="sm" variant={category === entry ? "default" : "outline"}>{dishCategoryLabel(entry)}</Button>)}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
      {list.isPending ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : null}
      {list.data ? (
        <>
          <p className="text-sm text-muted-foreground">{list.data.total} {list.data.total === 1 ? "dish" : "dishes"}{debounced ? ` for “${debounced}”` : ""}</p>
          {list.data.items.length ? (
            <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", list.isFetching && "opacity-70")}>
              {list.data.items.map((dish) => <RecipeCard key={dish.id} dish={dish} />)}
            </div>
          ) : <p className="py-12 text-center text-muted-foreground">Nothing matches. Try another spelling or an ingredient.</p>}
          {list.data.pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button disabled={page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(page - 1)); setParams(next); }} size="sm" variant="outline">Previous</Button>
              <span className="text-muted-foreground">Page {list.data.page} of {list.data.pages}</span>
              <Button disabled={page >= list.data.pages} onClick={() => { const next = new URLSearchParams(params); next.set("page", String(page + 1)); setParams(next); }} size="sm" variant="outline">Next</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
