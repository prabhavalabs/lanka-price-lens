import { RiAddLine, RiDeleteBinLine, RiEditLine, RiSearchLine, RiSubtractLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AccountActionError } from "@/components/account-notice";
import { ErrorState } from "@/components/error-state";
import { PeopleInput } from "@/components/people-input";
import { RequireAccount } from "@/components/require-account";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { computeMenu, fetchRecipes, type MenuTotals } from "@/lib/api";
import { dishCategoryLabel, rupees, unitLabel } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { amountLabel, gramsLabel, kcalLabel } from "@/lib/recipe-format";
import { basketStore } from "@/store/basket";
import { readLegacyMenus, rememberDishLabels, useMenu, useMenuActions, useMenus, writeLegacyMenus, type Menu } from "@/store/menus";

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

/** The household's menus: a meal for an occasion, with a headcount every recipe scales to. Kept on the account. */
export function MenusPage() {
  usePageTitle("Your menus · PriceLens");
  return (
    <RequireAccount description="Menus are kept on your account, so they are there on any device you sign in from." title="Sign in to see your menus">
      <MenusIndex />
    </RequireAccount>
  );
}

function MenusIndex() {
  const { menus, status, error, refetch } = useMenus();
  const actions = useMenuActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Menu | "new" | null>(null);
  const [deleting, setDeleting] = useState<Menu | null>(null);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Menus</h1>
          <p className="mt-1 max-w-xl text-pretty text-muted-foreground">A menu is a meal for an occasion. Name it, say how many are coming, add <Link to="/recipes" className="underline">recipes</Link>, and every quantity, the calories per person, the cost, and the shopping list follow.</p>
        </div>
        {menus.length ? <Button onClick={() => setEditing("new")}><RiAddLine className="size-4" />New menu</Button> : null}
      </header>
      <LegacyMenusCard />
      <AccountActionError error={actions.error} onDismiss={actions.clearError} />
      {status === "loading" ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div> : null}
      {status === "error" ? <ErrorState error={error} onRetry={refetch} /> : null}
      {status === "ready" && menus.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {menus.map((menu) => (
            <Card key={menu.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/menus/${menu.id}`} className="min-w-0 no-underline">
                    <h2 className="truncate font-heading text-base font-semibold hover:text-primary">{menu.name}</h2>
                    <p className="text-xs text-muted-foreground tabular-nums">{plural(menu.people, "person", "people")} · {plural(menu.items.length, "recipe")}{menu.occasion ? ` · ${menu.occasion}` : ""}</p>
                  </Link>
                  <div className="flex shrink-0 gap-0.5">
                    <Button aria-label={`Edit ${menu.name}`} onClick={() => setEditing(menu)} size="icon-sm" variant="ghost"><RiEditLine className="size-4" /></Button>
                    <Button aria-label={`Delete ${menu.name}`} onClick={() => setDeleting(menu)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
                  </div>
                </div>
                {menu.items.length ? <p className="line-clamp-2 text-xs text-muted-foreground">{menu.items.map((item) => item.label).join(", ")}</p> : <p className="text-xs text-muted-foreground">No recipes yet.</p>}
                <Button className="mt-auto self-start" onClick={() => navigate(`/menus/${menu.id}`)} size="sm" variant="outline">Open</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      {status === "ready" && !menus.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="max-w-md text-pretty text-sm text-muted-foreground">No menus yet. Start one for the next meal you are planning, then add recipes from their pages or from inside the menu.</p>
            <Button onClick={() => setEditing("new")}><RiAddLine className="size-4" />New menu</Button>
          </CardContent>
        </Card>
      ) : null}
      <MenuDialog
        menu={editing === "new" ? null : editing}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        onSaved={(id, created) => { setEditing(null); if (created) navigate(`/menus/${id}`); }}
        open={editing !== null}
      />
      <DeleteMenuDialog menu={deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }} />
    </div>
  );
}

/**
 * Menus this browser kept before accounts existed, offered once: saved to the account one by
 * one (what is saved leaves the browser at once, so a retry never doubles up) or discarded.
 */
function LegacyMenusCard() {
  const [legacy, setLegacy] = useState<Menu[]>(() => readLegacyMenus());
  const [saving, setSaving] = useState(false);
  const actions = useMenuActions();
  if (!legacy.length) return null;
  const keep = (menus: Menu[]) => {
    writeLegacyMenus(menus);
    setLegacy(menus);
  };
  const save = async () => {
    setSaving(true);
    actions.clearError();
    // Oldest first, so the newest ends up at the top of the account's list.
    let remaining = legacy;
    for (const menu of [...legacy].reverse()) {
      const saved = await actions.createFrom(menu);
      if (!saved) break;
      remaining = remaining.filter((entry) => entry.id !== menu.id);
      keep(remaining);
    }
    setSaving(false);
  };
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold">Menus from before you signed in</h2>
            <p className="text-pretty text-xs text-muted-foreground">{plural(legacy.length, "menu")} kept in this browser: {legacy.map((menu) => menu.name).join(", ")}. Save them to your account to keep them, or let them go.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button disabled={saving} onClick={() => keep([])} size="sm" type="button" variant="ghost">Discard</Button>
            <Button disabled={saving} onClick={() => void save()} size="sm" type="button">{saving ? "Saving…" : "Save to my account"}</Button>
          </div>
        </div>
        <AccountActionError error={actions.error} onDismiss={actions.clearError} />
      </CardContent>
    </Card>
  );
}

/** Create or rename a menu: a name and how many are coming. */
function MenuDialog({ menu, open, onOpenChange, onSaved }: { menu: Menu | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (id: string, created: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {open ? <MenuForm key={menu?.id ?? "new"} menu={menu} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MenuForm({ menu, onSaved }: { menu: Menu | null; onSaved: (id: string, created: boolean) => void }) {
  const actions = useMenuActions();
  const [name, setName] = useState(menu?.name ?? "");
  const [occasion, setOccasion] = useState(menu?.occasion ?? "");
  const [people, setPeople] = useState(menu?.people ?? 4);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (menu) {
          if (await actions.update(menu.id, { name: name.trim() || menu.name, occasion: occasion.trim() || null, people })) onSaved(menu.id, false);
        } else {
          const created = await actions.create({ name: name.trim() || "Untitled menu", occasion: occasion.trim() || null, people });
          if (created) onSaved(created.id, true);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{menu ? "Edit menu" : "New menu"}</DialogTitle>
        <DialogDescription>{menu ? "Change the name, the occasion, or how many are coming; every recipe rescales." : "A name and a headcount are enough; add recipes next."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="menu-name">Name</Label>
          <Input autoFocus id="menu-name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Sunday lunch, poya dana, birthday tea…" value={name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="menu-occasion">Occasion <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="menu-occasion" maxLength={120} onChange={(event) => setOccasion(event.target.value)} placeholder="Family, almsgiving, office…" value={occasion} />
        </div>
        <div className="space-y-1.5">
          <Label>People</Label>
          <PeopleInput max={1000} onChange={setPeople} value={people} />
        </div>
        <AccountActionError error={actions.error} onDismiss={actions.clearError} />
      </div>
      <DialogFooter>
        <Button disabled={actions.pending} type="submit">{actions.pending ? "Saving…" : menu ? "Save" : "Create menu"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Deleting a menu is final: it and its recipes go together, after a confirmation. */
function DeleteMenuDialog({ menu, onOpenChange, onDeleted }: { menu: Menu | null; onOpenChange: (open: boolean) => void; onDeleted?: (() => void) | undefined }) {
  const actions = useMenuActions();
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) actions.clearError(); onOpenChange(open); }} open={menu !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{menu?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>The menu and its {plural(menu?.items.length ?? 0, "recipe")} are removed from your account. Your basket is not touched.</AlertDialogDescription>
        </AlertDialogHeader>
        <AccountActionError error={actions.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={actions.pending}
            onClick={async (event) => {
              // Stays open until the server has answered, so a refusal shows here.
              event.preventDefault();
              if (!menu) return;
              if (await actions.remove(menu.id)) {
                onOpenChange(false);
                onDeleted?.();
              }
            }}
          >
            {actions.pending ? "Deleting…" : "Delete menu"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Search the recipe catalogue and add dishes straight into the menu. */
function AddRecipesDialog({ menu, open, onOpenChange }: { menu: Menu; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useMenuActions();
  const [query, setQuery] = useState("");
  // Typing is debounced; a superseded request is cancelled through the query's signal; the last results stay while the next load.
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useQuery({ queryKey: ["recipes-pick", debounced], queryFn: ({ signal }) => fetchRecipes({ q: debounced || undefined, pageSize: 30 }, signal), enabled: open, placeholderData: keepPreviousData, staleTime: 60_000 });
  const inMenu = new Set(menu.items.map((item) => item.recipe_id));
  const settled = results.data && !results.isFetching;
  return (
    <CommandDialog description="Type a dish or an ingredient; Enter adds the highlighted one." onOpenChange={(next) => { if (!next) actions.clearError(); onOpenChange(next); }} open={open} title="Add recipes to the menu">
      {/* The server already matched names in three languages and ingredients; cmdk must not filter again by id. */}
      <Command shouldFilter={false}>
      <CommandInput onValueChange={setQuery} placeholder="Search dishes: parippu, pol sambol, chicken…" value={query} />
      <CommandList>
        {actions.error ? <div className="p-2"><AccountActionError error={actions.error} onDismiss={actions.clearError} /></div> : null}
        {results.isPending ? <div className="p-3 text-sm text-muted-foreground">Looking…</div> : null}
        {results.isError ? <div className="p-3 text-sm text-muted-foreground">The search did not answer. Try again in a moment.</div> : null}
        {settled && results.data.items.length === 0 ? <CommandEmpty>Nothing matches. Try another spelling or an ingredient.</CommandEmpty> : null}
        {results.data?.items.length ? (
          <CommandGroup heading={`${plural(results.data.total, "dish", "dishes")}${results.isFetching ? " · updating" : ""}`}>
            {results.data.items.map((dish) => {
              const added = inMenu.has(dish.id);
              return (
                <CommandItem
                  key={dish.id}
                  onSelect={() => {
                    if (added) void actions.removeRecipe(menu.id, dish.id);
                    else void actions.addRecipe(menu.id, { id: dish.id, label: dish.names.en });
                  }}
                  value={dish.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{dish.names.en}{dish.names.si ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{dish.names.si}</span> : null}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{dishCategoryLabel(dish.category)} · {dish.prep_minutes + dish.cook_minutes} min</p>
                  </div>
                  {added ? <Badge variant="secondary" className="text-[10px]">Added</Badge> : <Badge variant="outline" className="text-[10px]">Add</Badge>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** One menu: the headcount, each recipe with its own servings, totals per person, and the shopping list. */
export function MenuPage() {
  const { id = "" } = useParams();
  return (
    <RequireAccount description="Menus are kept on your account. Sign in to open this one." title="Sign in to open this menu">
      <MenuLoader id={id} />
    </RequireAccount>
  );
}

function MenuLoader({ id }: { id: string }) {
  const { menu, status, error, refetch } = useMenu(id);
  usePageTitle(menu ? `${menu.name} · menu for ${menu.people} · PriceLens` : "Menu · PriceLens");
  if (status === "loading") return <div className="space-y-4"><Skeleton className="h-6 w-40 rounded-md" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  if (status === "error") return <ErrorState error={error} fallback={{ to: "/menus", label: "All menus" }} onRetry={refetch} />;
  if (!menu) return <p className="py-16 text-center text-muted-foreground">This menu is not on your account. <Link to="/menus" className="underline">All menus</Link></p>;
  return <MenuDetail menu={menu} />;
}

function MenuDetail({ menu }: { menu: Menu }) {
  const navigate = useNavigate();
  const actions = useMenuActions();
  const totals = useQuery({
    queryKey: ["menu", menu.id, menu.people, menu.items.map((item) => `${item.recipe_id}:${item.servings ?? ""}`).join(",")],
    queryFn: async () => {
      const computed = await computeMenu({ id: menu.id, name: menu.name, occasion: menu.occasion, people: menu.people, items: menu.items.map((item) => ({ recipe_id: item.recipe_id, servings: item.servings })), created_at: menu.created_at });
      rememberDishLabels(computed.names);
      return computed;
    },
    enabled: menu.items.length > 0,
    placeholderData: keepPreviousData,
  });
  const data: MenuTotals | undefined = totals.data;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/menus" className="hover:text-primary">Menus</Link> › {menu.name}</nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">{menu.name}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{plural(menu.items.length, "recipe")}{menu.occasion ? ` · ${menu.occasion}` : ""} · saved for {plural(menu.people, "person", "people")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">People</span>
          <PeopleInput max={1000} onChange={(value) => void actions.update(menu.id, { people: value })} value={menu.people} />
          <Button onClick={() => setAdding(true)} size="sm"><RiSearchLine className="size-4" />Add recipes</Button>
          <Button aria-label="Edit menu" onClick={() => setEditing(true)} size="icon-sm" variant="ghost"><RiEditLine className="size-4" /></Button>
          <Button aria-label="Delete menu" onClick={() => setDeleting(true)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
        </div>
      </header>

      <AccountActionError error={actions.error} onDismiss={actions.clearError} />

      {menu.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-pretty text-sm text-muted-foreground">No recipes yet. Search the catalogue and add dishes to this menu, or use “Add to a menu” on any recipe page.</p>
            <Button onClick={() => setAdding(true)}><RiSearchLine className="size-4" />Add recipes</Button>
          </CardContent>
        </Card>
      ) : null}

      {totals.isError ? <ErrorState error={totals.error} onRetry={() => void totals.refetch()} retrying={totals.isFetching} /> : null}
      {menu.items.length > 0 && totals.isPending ? <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div> : null}

      {data ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Card className="border-primary/40">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cost for {plural(data.people, "person", "people")}</p>
              <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{data.total.cost !== null ? `${data.total.estimated ? "≈ " : ""}${rupees(data.total.cost)}` : "—"}</p>
              <p className="text-xs text-muted-foreground">{data.total.cost !== null ? <>{rupees(data.per_person.cost ?? 0)} per person · priced items only{data.total.estimated ? " · some prices older or missing" : ""}</> : "prices are not available right now"}</p>
            </CardContent>
          </Card>
          <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Per person</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{kcalLabel(data.per_person.nutrition.kcal)}</p><p className="text-xs text-muted-foreground">{gramsLabel(data.per_person.nutrition.protein_g)} protein · {gramsLabel(data.per_person.nutrition.fat_g)} fat · {gramsLabel(data.per_person.nutrition.carb_g)} carbs</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Whole meal</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{kcalLabel(data.total.nutrition.kcal)}</p><p className="text-xs text-muted-foreground">{data.shopping.length} things to buy{data.unknown.length ? ` · ${data.unknown.length} recipes no longer exist` : ""}</p></CardContent></Card>
        </section>
      ) : null}

      {menu.items.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div><h2 className="font-heading text-lg font-semibold">Recipes</h2><p className="text-xs text-muted-foreground">Each follows the headcount unless you set its own servings (a sambol for the table, a sweet for half the guests).</p></div>
              <Button onClick={() => setAdding(true)} size="sm" variant="outline"><RiSearchLine className="size-4" />Add recipes</Button>
            </div>
            <ul className="divide-y">
              {menu.items.map((item) => {
                const computed = data?.items.find((entry) => entry.recipe_id === item.recipe_id);
                const servings = item.servings ?? menu.people;
                const name = data?.names[item.recipe_id]?.en ?? item.label;
                return (
                  <li key={item.recipe_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
                    <div className="min-w-0">
                      <Link to={`/r/${item.recipe_id}?people=${servings}`} className="block truncate text-sm font-medium no-underline hover:text-primary">{name}</Link>
                      {computed ? <p className="text-[11px] text-muted-foreground tabular-nums">{kcalLabel(computed.nutrition.per_serving.kcal)} per serving{computed.cost?.lines.length ? ` · ${rupees(computed.cost.per_serving)} each` : ""}</p> : null}
                    </div>
                    <div className="text-right tabular-nums sm:order-none">
                      {computed?.cost?.lines.length ? (
                        <>
                          <p className="text-sm font-semibold">{computed.cost.estimated ? "≈ " : ""}{rupees(computed.cost.total)}</p>
                          <p className="text-[11px] text-muted-foreground">for {computed.servings}</p>
                        </>
                      ) : computed ? <p className="text-[11px] text-muted-foreground">not priced</p> : null}
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                      <div aria-label={`Servings of ${name}`} className="inline-flex items-center gap-0.5 rounded-lg border p-0.5" role="group">
                        <Button aria-label="Fewer servings" disabled={servings <= 1} onClick={() => void actions.setServings(menu.id, item.recipe_id, servings - 1)} size="icon-sm" variant="ghost"><RiSubtractLine className="size-3.5" /></Button>
                        <span className="w-10 text-center text-sm tabular-nums">{servings}</span>
                        <Button aria-label="More servings" onClick={() => void actions.setServings(menu.id, item.recipe_id, servings + 1)} size="icon-sm" variant="ghost"><RiAddLine className="size-3.5" /></Button>
                      </div>
                      {item.servings !== null ? <Button className="text-xs" onClick={() => void actions.setServings(menu.id, item.recipe_id, null)} size="sm" variant="ghost">Follow headcount</Button> : <Badge variant="outline" className="text-[10px]">all</Badge>}
                      <Button aria-label={`Remove ${name}`} onClick={() => void actions.removeRecipe(menu.id, item.recipe_id)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {data?.total.cost !== null && data?.total.cost !== undefined ? (
              <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
                <p className="text-sm font-semibold">Total for {plural(data.people, "person", "people")}</p>
                <p className="text-right tabular-nums"><span className="text-sm font-semibold">{data.total.estimated ? "≈ " : ""}{rupees(data.total.cost)}</span><span className="ml-2 text-[11px] text-muted-foreground">{rupees(data.per_person.cost ?? 0)} per person</span></p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data?.shopping.length ? (() => {
        const main = data.shopping.filter((line) => line.ref?.startsWith("product_"));
        const pantry = data.shopping.filter((line) => !line.ref?.startsWith("product_"));
        const pricedTotal = data.shopping.reduce((sum, line) => sum + (line.cost ?? 0), 0);
        const pricedLines = data.shopping.filter((line) => line.cost !== null).length;
        let number = 0;
        const row = (line: (typeof data.shopping)[number]) => {
          number += 1;
          return (
            <li key={`${line.ref ?? line.label}-${line.unit}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[1.75rem_minmax(0,1.4fr)_5.5rem_minmax(0,1fr)_6rem]">
              <span className="text-xs text-muted-foreground tabular-nums">{number}.</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.ref?.startsWith("product_") ? <Link to={`/p/${line.ref}`} className="no-underline hover:text-primary">{line.label}</Link> : line.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{line.recipes.length > 1 ? `in ${line.recipes.length} recipes` : `in ${data.names[line.recipes[0] ?? ""]?.en ?? "1 recipe"}`}</p>
              </div>
              <p className="text-right text-sm font-semibold tabular-nums">{amountLabel(line.quantity, line.unit)}</p>
              <div className="col-start-2 min-w-0 text-[11px] leading-snug text-muted-foreground sm:col-start-4 sm:text-xs">
                {line.cost !== null && line.unit_price !== null && line.price_unit ? (
                  <>
                    <p className="tabular-nums"><span className="text-foreground">{rupees(line.unit_price)} {unitLabel(line.price_unit)}</span><span className="sm:hidden"> · <span className="font-semibold text-foreground">{rupees(line.cost)}</span></span></p>
                    <p className="truncate">{line.sellers.join(", ")}{line.stale ? <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">older price</span> : null}</p>
                  </>
                ) : line.ref?.startsWith("product_") ? <p>No published price today</p> : <p><span className="rounded bg-muted px-1 py-px text-[10px]">pantry</span> not priced yet</p>}
              </div>
              <p className="hidden text-right text-sm font-semibold tabular-nums sm:block">{line.cost !== null ? rupees(line.cost) : <span className="font-normal text-muted-foreground">—</span>}</p>
            </li>
          );
        };
        return (
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div><h2 className="font-heading text-lg font-semibold">Shopping list</h2><p className="text-xs text-muted-foreground">Everything across the recipes, summed once per ingredient, at today's cheapest published sellers. Priced products can go to your basket in these amounts.</p></div>
                <Button
                  onClick={() => {
                    for (const line of data.shopping) {
                      if (!line.ref?.startsWith("product_")) continue;
                      const unit = line.unit === "piece" ? "piece" : line.unit === "ml" ? "l" : "kg";
                      const quantity = line.unit === "piece" ? Math.ceil(line.quantity) : Math.max(0.05, Math.round((line.quantity / 1000) * 100) / 100);
                      basketStore.add(line.ref, line.label, unit, quantity);
                    }
                  }}
                  size="sm"
                  variant="outline"
                >
                  Add priced items to basket
                </Button>
              </div>
              <div className="hidden grid-cols-[1.75rem_minmax(0,1.4fr)_5.5rem_minmax(0,1fr)_6rem] gap-x-3 border-b px-4 py-2 text-[11px] font-medium uppercase text-muted-foreground sm:grid">
                <span className="col-span-2">Ingredient</span>
                <span className="text-right">Amount</span>
                <span>Cheapest today</span>
                <span className="text-right">Price</span>
              </div>
              {main.length ? (
                <section>
                  <h3 className="border-b bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">Main ingredients</h3>
                  <ul className="divide-y">{main.map(row)}</ul>
                </section>
              ) : null}
              {pantry.length ? (
                <section>
                  <h3 className="border-y bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">Pantry and others</h3>
                  <ul className="divide-y">{pantry.map(row)}</ul>
                </section>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Estimated shopping cost</p>
                  <p className="text-[11px] text-muted-foreground">{pricedLines} of {data.shopping.length} lines priced{pantry.length ? `; ${pantry.length} pantry or unpriced not counted` : ""}</p>
                </div>
                <p className="text-right tabular-nums"><span className="text-base font-semibold">{data.total.estimated ? "≈ " : ""}{rupees(pricedTotal)}</span></p>
              </div>
            </CardContent>
          </Card>
        );
      })() : null}

      <MenuDialog menu={menu} onOpenChange={setEditing} onSaved={() => setEditing(false)} open={editing} />
      <AddRecipesDialog menu={menu} onOpenChange={setAdding} open={adding} />
      <DeleteMenuDialog menu={deleting ? menu : null} onDeleted={() => navigate("/menus")} onOpenChange={setDeleting} />
    </div>
  );
}
