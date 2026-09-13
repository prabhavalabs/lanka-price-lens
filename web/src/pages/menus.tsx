import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [name, setName] = useState("");
  const [people, setPeople] = useState(6);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Menus</h1>
        <p className="mt-1 max-w-xl text-pretty text-muted-foreground">A menu is a meal for an occasion. Name it, say how many are coming, add <Link to="/recipes" className="underline">recipes</Link>, and every quantity, the calories per person, the cost, and the shopping list follow.</p>
      </header>
      <Card>
        <CardContent className="p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const id = menuStore.create({ name: name.trim() || "Untitled menu", people });
              setName("");
              navigate(`/menus/${id}`);
            }}
          >
            <label className="flex-1 text-xs font-medium">Name<Input className="mt-1" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Sunday lunch, poya dana, birthday tea…" value={name} /></label>
            <label className="text-xs font-medium">People<Input className="mt-1 w-24" inputMode="numeric" max={1000} min={1} onChange={(event) => setPeople(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} type="number" value={people} /></label>
            <Button type="submit">New menu</Button>
          </form>
        </CardContent>
      </Card>
      {menus.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {menus.map((menu) => (
            <Link key={menu.id} to={`/menus/${menu.id}`} className="block no-underline">
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="p-4">
                  <h2 className="font-heading text-base font-semibold">{menu.name}</h2>
                  <p className="text-xs text-muted-foreground">{menu.people} people · {menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}{menu.occasion ? ` · ${menu.occasion}` : ""}</p>
                  {menu.items.length ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{menu.items.map((item) => item.label).join(", ")}</p> : <p className="mt-2 text-xs text-muted-foreground">No recipes yet.</p>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : <p className="py-8 text-center text-sm text-muted-foreground">No menus yet. Make one above, or open any recipe and use “Add to a menu”.</p>}
    </div>
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
  const [name, setName] = useState(menu.name);
  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/menus" className="hover:text-primary">Menus</Link> › {menu.name}</nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); menuStore.update(menu.id, { name }); setEditing(false); }}>
              <Input aria-label="Menu name" autoFocus maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
              <Button size="sm" type="submit">Save</Button>
            </form>
          ) : (
            <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight"><button className="text-left hover:text-primary" onClick={() => setEditing(true)} type="button">{menu.name}</button></h1>
          )}
          <p className="text-sm text-muted-foreground">{menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}{menu.occasion ? ` · ${menu.occasion}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">People</span>
          <div aria-label="Number of people" className="inline-flex items-center gap-0.5 rounded-lg border border-primary/40 bg-primary/5 p-0.5" role="group">
            <Button aria-label="Fewer people" disabled={menu.people <= 1} onClick={() => menuStore.update(menu.id, { people: menu.people - 1 })} size="icon-sm" variant="ghost"><RiSubtractLine className="size-3.5" /></Button>
            <Input aria-label="People" className="h-7 w-16 border-0 bg-transparent text-center text-sm font-semibold tabular-nums shadow-none focus-visible:ring-0" inputMode="numeric" onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1) menuStore.update(menu.id, { people: value }); }} value={menu.people} />
            <Button aria-label="More people" onClick={() => menuStore.update(menu.id, { people: menu.people + 1 })} size="icon-sm" variant="ghost"><RiAddLine className="size-3.5" /></Button>
          </div>
          <Button aria-label="Delete menu" onClick={() => { if (window.confirm(`Delete “${menu.name}”?`)) { menuStore.remove(menu.id); navigate("/menus"); } }} size="icon-sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
        </div>
      </header>

      {menu.items.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No recipes yet. Browse the <Link to="/recipes" className="underline">recipes</Link> and use “Add to a menu” on any of them.</CardContent></Card>
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
            <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">Recipes</h2><p className="text-xs text-muted-foreground">Each follows the headcount unless you set its own servings (a sambol for the table, a sweet for half the guests).</p></div>
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
    </div>
  );
}
