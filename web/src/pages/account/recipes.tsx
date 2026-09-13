import { RiAddLine, RiDeleteBinLine, RiEditLine, RiTimeLine } from "@remixicon/react";
import type { UserRecipe } from "@lanka-pricelens/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { AccountActionError } from "@/components/account-notice";
import { ErrorState } from "@/components/error-state";
import { RecipeEditor } from "@/components/recipe-editor";
import { RecipeViewSection } from "@/components/recipe-view";
import { RequireAccount } from "@/components/require-account";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { accountApi, AccountApiError, type UserRecipeSummary } from "@/lib/account-api";
import { dishCategoryLabel, minutesLabel, relativeDay } from "@/lib/format";
import { draftFromRecipe, emptyDraft, toRecipeView } from "@/lib/own-recipes";
import { usePageTitle } from "@/lib/page-title";
import { amountLabel, tagLabel } from "@/lib/recipe-format";
import { useAccount } from "@/store/account";

/**
 * A person's own recipes: private to the account, filed under the catalogue's categories,
 * scaled, counted, and priced the same way as the corpus. The list, one recipe with its
 * computed view, and the editor for a new or an existing one.
 */

const recipesQueryKey = (accountId: string) => ["account", "recipes", accountId] as const;

/** What the list route sends for each recipe: the denormalised columns, and the rest when the API includes it. */
type RecipeListItem = UserRecipeSummary;

function useAccountId(): string {
  const account = useAccount();
  return account.status === "signed_in" ? account.account.id : "";
}

export function MyRecipesPage() {
  usePageTitle("My recipes · PriceLens");
  return (
    <RequireAccount description="Your own recipes are kept on your account, counted and priced like the catalogue's." title="Sign in to see your recipes">
      <MyRecipesList />
    </RequireAccount>
  );
}

function MyRecipesList() {
  const accountId = useAccountId();
  const list = useQuery({
    queryKey: recipesQueryKey(accountId),
    queryFn: async ({ signal }) => {
      try {
        return (await accountApi.recipes.list(signal)).items;
      } catch (error) {
        // Not verified yet means no recipes yet.
        if (error instanceof AccountApiError && (error.status === 401 || error.code === "EMAIL_NOT_VERIFIED")) return [];
        throw error;
      }
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const [deleting, setDeleting] = useState<RecipeListItem | null>(null);
  const recipes = list.data ?? [];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">My recipes</h1>
          <p className="mt-1 max-w-xl text-pretty text-muted-foreground">The dishes you cook your own way. Write one down once and it scales to any headcount, with the calories and today's cost, like every recipe on the site. Only you can see them.</p>
        </div>
        {recipes.length ? <Button asChild><Link to="/account/recipes/new"><RiAddLine className="size-4" />New recipe</Link></Button> : null}
      </header>
      {list.isPending ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : null}
      {list.data && recipes.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => {
            const minutes = recipe.minutes;
            const facts = [recipe.base_servings ? `For ${recipe.base_servings}` : null, `${recipe.ingredient_count} ingredient${recipe.ingredient_count === 1 ? "" : "s"}`, `updated ${relativeDay(recipe.updated_at.slice(0, 10))}`].filter(Boolean).join(" · ");
            return (
              <Card key={recipe.id} className="transition-colors hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/account/recipes/${recipe.id}`} className="min-w-0 no-underline">
                      <h2 className="truncate font-heading text-base font-semibold hover:text-primary">{recipe.name}</h2>
                      <p className="text-xs text-muted-foreground tabular-nums">{facts}</p>
                    </Link>
                    <div className="flex shrink-0 gap-0.5">
                      <Button aria-label={`Edit ${recipe.name}`} asChild size="icon-sm" variant="ghost"><Link to={`/account/recipes/${recipe.id}/edit`}><RiEditLine className="size-4" /></Link></Button>
                      <Button aria-label={`Delete ${recipe.name}`} onClick={() => setDeleting(recipe)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
                    </div>
                  </div>
                  {recipe.summary ? <p className="line-clamp-2 text-pretty text-xs text-muted-foreground">{recipe.summary}</p> : null}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{dishCategoryLabel(recipe.category)}</Badge>
                    {minutes ? <Badge variant="outline" className="gap-1 text-[10px]"><RiTimeLine className="size-3" />{minutesLabel(minutes)}</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
      {list.data && !recipes.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="max-w-md text-pretty text-sm text-muted-foreground">No recipes of your own yet. Write down the first one: the ingredients as you buy them, the steps as you cook them, and the site does the counting.</p>
            <Button asChild><Link to="/account/recipes/new"><RiAddLine className="size-4" />Write your first recipe</Link></Button>
          </CardContent>
        </Card>
      ) : null}
      <DeleteRecipeDialog onOpenChange={(open) => { if (!open) setDeleting(null); }} recipe={deleting} />
    </div>
  );
}

/** Deleting a recipe is final, after a confirmation; the dialog stays open until the server has answered. */
function DeleteRecipeDialog({ recipe, onOpenChange, onDeleted }: { recipe: Pick<UserRecipe, "id" | "name"> | null; onOpenChange: (open: boolean) => void; onDeleted?: (() => void) | undefined }) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => accountApi.recipes.remove(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["account", "recipes"] });
      onOpenChange(false);
      onDeleted?.();
    },
  });
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) remove.reset(); onOpenChange(open); }} open={recipe !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{recipe?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>The recipe is removed from your account. There is no way to get it back.</AlertDialogDescription>
        </AlertDialogHeader>
        <AccountActionError error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isPending} onClick={(event) => { event.preventDefault(); if (recipe) remove.mutate(recipe.id); }}>{remove.isPending ? "Deleting…" : "Delete recipe"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One of the person's recipes, scaled to a headcount, with its nutrition and today's cost. */
export function MyRecipePage() {
  const { id = "" } = useParams();
  return (
    <RequireAccount description="Your recipes are kept on your account. Sign in to open this one." title="Sign in to open this recipe">
      <MyRecipeDetail id={id} />
    </RequireAccount>
  );
}

function MyRecipeDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("people"));
  // The recipe's own headcount unless the address says otherwise; the API answers at base servings when none is given.
  const servings = Number.isFinite(requested) && requested >= 1 ? Math.min(500, Math.round(requested)) : undefined;
  const recipe = useQuery({ queryKey: ["account", "recipe", id, servings ?? "base"], queryFn: ({ signal }) => accountApi.recipes.get(id, servings, signal), enabled: Boolean(id), placeholderData: keepPreviousData, retry: false });
  const [deleting, setDeleting] = useState(false);
  const setServings = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("people", String(value));
    setParams(next, { replace: true, preventScrollReset: true });
  };
  usePageTitle(recipe.data ? `${recipe.data.name} · my recipe · PriceLens` : undefined);
  if (recipe.isError) return <ErrorState error={recipe.error} fallback={{ to: "/account/recipes", label: "My recipes" }} onRetry={() => void recipe.refetch()} retrying={recipe.isFetching} />;
  if (recipe.isPending) return <div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  const own = recipe.data;
  const view = toRecipeView(own.view, own.id);
  const minutes = own.times.prep_minutes + own.times.cook_minutes;
  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/account/recipes" className="hover:text-primary">My recipes</Link> › {dishCategoryLabel(own.category)}</nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-3">
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">{own.name}</h1>
          {own.summary ? <p className="max-w-2xl text-pretty text-muted-foreground">{own.summary}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{dishCategoryLabel(own.category)}</Badge>
            {minutes ? <Badge variant="outline" className="gap-1"><RiTimeLine className="size-3" />{minutesLabel(minutes)}</Badge> : null}
            <Badge variant="outline">Private</Badge>
            {view ? null : own.tags.map((tag) => <Badge key={tag} variant="outline">{tagLabel(tag)}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><Link to={`/account/recipes/${own.id}/edit`}><RiEditLine className="size-4" />Edit</Link></Button>
          <Button aria-label="Delete recipe" onClick={() => setDeleting(true)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
        </div>
      </header>

      {view ? (
        <RecipeViewSection addToMenu={false} dishId={own.id} dishName={own.name} loading={recipe.isFetching} onServings={setServings} recipe={view} servings={view.servings} />
      ) : (
        <PlainRecipe recipe={own} />
      )}

      <DeleteRecipeDialog onDeleted={() => navigate("/account/recipes")} onOpenChange={setDeleting} recipe={deleting ? own : null} />
    </div>
  );
}

/** The recipe as written, for when the API has not computed a view (older API, or nothing to count). */
function PlainRecipe({ recipe }: { recipe: UserRecipe }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">Ingredients for {recipe.base_servings}</h2><p className="text-xs text-muted-foreground">As written; the scaled amounts, calories, and cost are not available right now.</p></div>
          <ul className="divide-y">
            {recipe.ingredients.map((line, index) => (
              <li key={index} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{line.label.en}{line.preparation?.en ? <span className="text-muted-foreground"> · {line.preparation.en}</span> : null}{line.optional ? <span className="text-muted-foreground"> (optional)</span> : null}</span>
                <span className="shrink-0 font-semibold tabular-nums">{amountLabel(line.quantity, line.unit)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 sm:p-5">
          <h2 className="font-heading text-lg font-semibold">Method</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed">
            {recipe.steps.en.map((step, index) => <li key={index}>{step.text}{step.minutes ? <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{minutesLabel(step.minutes)}</span> : null}</li>)}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

/** The editor, for a new recipe (`/account/recipes/new`) or an existing one (`/account/recipes/:id/edit`). */
export function MyRecipeEditorPage() {
  const { id } = useParams();
  usePageTitle(id ? "Edit recipe · PriceLens" : "New recipe · PriceLens");
  return (
    <RequireAccount description="Sign in to write recipes of your own; they are kept on your account and counted like the catalogue's." title={id ? "Sign in to edit this recipe" : "Sign in to write a recipe"}>
      <MyRecipeEditor id={id ?? null} />
    </RequireAccount>
  );
}

function MyRecipeEditor({ id }: { id: string | null }) {
  const navigate = useNavigate();
  const existing = useQuery({ queryKey: ["account", "recipe", id, "base"], queryFn: ({ signal }) => accountApi.recipes.get(id!, undefined, signal), enabled: Boolean(id), retry: false, staleTime: 0 });
  if (id && existing.isError) return <ErrorState error={existing.error} fallback={{ to: "/account/recipes", label: "My recipes" }} onRetry={() => void existing.refetch()} retrying={existing.isFetching} />;
  if (id && existing.isPending) return <div className="space-y-4"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  const recipe = id ? existing.data : undefined;
  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/account/recipes" className="hover:text-primary">My recipes</Link> › {recipe ? <><Link to={`/account/recipes/${recipe.id}`} className="hover:text-primary">{recipe.name}</Link> › Edit</> : "New recipe"}</nav>
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">{recipe ? `Edit ${recipe.name}` : "New recipe"}</h1>
        <p className="mt-1 max-w-xl text-pretty text-muted-foreground">{recipe ? "Change anything; the page recounts once it is saved." : "Write it for the number of people you usually cook for. The site scales it to any headcount and works out the calories and today's cost from the ingredients."}</p>
      </header>
      <RecipeEditor
        key={recipe?.id ?? "new"}
        initial={recipe ? draftFromRecipe(recipe) : emptyDraft()}
        onCancel={() => navigate(recipe ? `/account/recipes/${recipe.id}` : "/account/recipes")}
        onSaved={(saved) => navigate(`/account/recipes/${saved.id}`)}
        recipeId={recipe?.id ?? null}
      />
    </div>
  );
}
