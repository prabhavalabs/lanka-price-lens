import { RiAddLine, RiDeleteBinLine, RiEditLine, RiSubtractLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ErrorState } from "@/components/error-state";
import { PeopleInput } from "@/components/people-input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { computeMenu, type MenuTotals } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { amountLabel, gramsLabel, kcalLabel } from "@/lib/recipe-format";
import { basketStore } from "@/store/basket";
import { menuStore, useMenu, useMenus, type Menu } from "@/store/menus";

/** The household's menus: a meal for an occasion, with a headcount every recipe scales to. */
export function MenusPage() {
  usePageTitle("Your menus · PriceLens");
  const { menus } = useMenus();
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
      {menus.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {menus.map((menu) => (
            <Card key={menu.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/menus/${menu.id}`} className="min-w-0 no-underline">
                    <h2 className="truncate font-heading text-base font-semibold hover:text-primary">{menu.name}</h2>
                    <p className="text-xs text-muted-foreground">{menu.people} {menu.people === 1 ? "person" : "people"} · {menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}{menu.occasion ? ` · ${menu.occasion}` : ""}</p>
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
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="max-w-md text-pretty text-sm text-muted-foreground">No menus yet. Start one for the next meal you are planning, then add recipes from their pages or from inside the menu.</p>
            <Button onClick={() => setEditing("new")}><RiAddLine className="size-4" />New menu</Button>
          </CardContent>
        </Card>
      )}
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
  const [name, setName] = useState(menu?.name ?? "");
  const [occasion, setOccasion] = useState(menu?.occasion ?? "");
  const [people, setPeople] = useState(menu?.people ?? 4);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (menu) {
          menuStore.update(menu.id, { name: name.trim() || menu.name, occasion: occasion.trim() || null, people });
          onSaved(menu.id, false);
        } else {
          onSaved(menuStore.create({ name: name.trim() || "Untitled menu", occasion: occasion.trim() || null, people }), true);
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
      </div>
      <DialogFooter>
        <Button type="submit">{menu ? "Save" : "Create menu"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Deleting a menu is final: it and its recipes go together, after a confirmation. */
function DeleteMenuDialog({ menu, onOpenChange, onDeleted }: { menu: Menu | null; onOpenChange: (open: boolean) => void; onDeleted?: (() => void) | undefined }) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={menu !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{menu?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>The menu and its {menu?.items.length ?? 0} {menu?.items.length === 1 ? "recipe" : "recipes"} are removed from this browser. Your basket is not touched.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (menu) menuStore.remove(menu.id);
              onDeleted?.();
            }}
          >
            Delete menu
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One menu: the headcount, each recipe with its own servings, totals per person, and the shopping list. */
export function MenuPage() {
  const { id = "" } = useParams();
  const menu = useMenu(id);
  usePageTitle(menu ? `${menu.name} · menu for ${menu.people} · PriceLens` : "Menu · PriceLens");
  if (!menu) return <p className="py-16 text-center text-muted-foreground">This menu is not in this browser. <Link to="/menus" className="underline">All menus</Link></p>;
  return <MenuDetail menu={menu} />;
}

function MenuDetail({ menu }: { menu: Menu }) {
  const navigate = useNavigate();
  const totals = useQuery({
    queryKey: ["menu", menu.id, menu.people, menu.items.map((item) => `${item.recipe_id}:${item.servings ?? ""}`).join(",")],
    queryFn: () => computeMenu({ id: menu.id, name: menu.name, occasion: menu.occasion, people: menu.people, items: menu.items.map((item) => ({ recipe_id: item.recipe_id, servings: item.servings })), created_at: menu.created_at }),
    enabled: menu.items.length > 0,
    placeholderData: keepPreviousData,
  });
  const data: MenuTotals | undefined = totals.data;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/menus" className="hover:text-primary">Menus</Link> › {menu.name}</nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">{menu.name}</h1>
          <p className="text-sm text-muted-foreground">{menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}{menu.occasion ? ` · ${menu.occasion}` : ""} · saved for {menu.people} {menu.people === 1 ? "person" : "people"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">People</span>
          <PeopleInput max={1000} onChange={(value) => menuStore.update(menu.id, { people: value })} value={menu.people} />
          <Button aria-label="Edit menu" onClick={() => setEditing(true)} size="icon-sm" variant="ghost"><RiEditLine className="size-4" /></Button>
          <Button aria-label="Delete menu" onClick={() => setDeleting(true)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
        </div>
      </header>

      {menu.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-pretty text-sm text-muted-foreground">No recipes yet. Browse the <Link to="/recipes" className="underline">recipes</Link> and use “Add to a menu” on any of them.</p>
          </CardContent>
        </Card>
      ) : null}

      {totals.isError ? <ErrorState error={totals.error} onRetry={() => void totals.refetch()} retrying={totals.isFetching} /> : null}
      {menu.items.length > 0 && totals.isPending ? <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div> : null}

      {data ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Per person</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{kcalLabel(data.per_person.nutrition.kcal)}</p><p className="text-xs text-muted-foreground">{gramsLabel(data.per_person.nutrition.protein_g)} protein · {gramsLabel(data.per_person.nutrition.fat_g)} fat · {gramsLabel(data.per_person.nutrition.carb_g)} carbs</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cost per person</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{data.per_person.cost !== null ? `${data.total.estimated ? "≈ " : ""}${rupees(data.per_person.cost)}` : "—"}</p><p className="text-xs text-muted-foreground">{data.total.cost !== null ? `${rupees(data.total.cost)} for ${data.people}, priced items only` : "prices are not available right now"}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Whole meal</p><p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{kcalLabel(data.total.nutrition.kcal)}</p><p className="text-xs text-muted-foreground">{data.shopping.length} things to buy{data.unknown.length ? ` · ${data.unknown.length} recipes no longer exist` : ""}</p></CardContent></Card>
        </section>
      ) : null}

      {menu.items.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div><h2 className="font-heading text-lg font-semibold">Recipes</h2><p className="text-xs text-muted-foreground">Each follows the headcount unless you set its own servings (a sambol for the table, a sweet for half the guests).</p></div>
            </div>
            <ul className="divide-y">
              {menu.items.map((item) => {
                const computed = data?.items.find((entry) => entry.recipe_id === item.recipe_id);
                const servings = item.servings ?? menu.people;
                return (
                  <li key={item.recipe_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to={`/r/${item.recipe_id}?people=${servings}`} className="block truncate text-sm font-medium no-underline hover:text-primary">{data?.names[item.recipe_id]?.en ?? item.label}</Link>
                      {computed ? <p className="text-[11px] text-muted-foreground tabular-nums">{kcalLabel(computed.nutrition.per_serving.kcal)} per serving{computed.cost ? ` · ${computed.cost.estimated ? "≈ " : ""}${rupees(computed.cost.total)} for ${computed.servings}` : ""}</p> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <div aria-label={`Servings of ${item.label}`} className="inline-flex items-center gap-0.5 rounded-lg border p-0.5" role="group">
                        <Button aria-label="Fewer servings" disabled={servings <= 1} onClick={() => menuStore.setServings(menu.id, item.recipe_id, servings - 1)} size="icon-sm" variant="ghost"><RiSubtractLine className="size-3.5" /></Button>
                        <span className="w-10 text-center text-sm tabular-nums">{servings}</span>
                        <Button aria-label="More servings" onClick={() => menuStore.setServings(menu.id, item.recipe_id, servings + 1)} size="icon-sm" variant="ghost"><RiAddLine className="size-3.5" /></Button>
                      </div>
                      {item.servings !== null ? <Button className="text-xs" onClick={() => menuStore.setServings(menu.id, item.recipe_id, null)} size="sm" variant="ghost">Follow headcount</Button> : <Badge variant="outline" className="text-[10px]">all</Badge>}
                      <Button aria-label={`Remove ${item.label}`} onClick={() => menuStore.removeRecipe(menu.id, item.recipe_id)} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {data?.shopping.length ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div><h2 className="font-heading text-lg font-semibold">Shopping list</h2><p className="text-xs text-muted-foreground">Everything across the recipes, summed. Priced products can go to your basket in these amounts.</p></div>
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
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {data.shopping.map((line) => (
                <li key={`${line.ref ?? line.label}-${line.unit}`} className="flex items-center gap-3 border-b px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{line.ref?.startsWith("product_") ? <Link to={`/p/${line.ref}`} className="no-underline hover:text-primary">{line.label}</Link> : line.label}</span>
                  <span className="font-medium tabular-nums">{amountLabel(line.quantity, line.unit)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <MenuDialog menu={menu} onOpenChange={setEditing} onSaved={() => setEditing(false)} open={editing} />
      <DeleteMenuDialog menu={deleting ? menu : null} onDeleted={() => navigate("/menus")} onOpenChange={setDeleting} />
    </div>
  );
}
