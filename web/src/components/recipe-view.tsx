import { RiAddLine, RiCheckLine, RiShoppingBasketLine, RiTimeLine, RiToolsLine } from "@remixicon/react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { AccountActionError, signInPath } from "@/components/account-notice";
import { IngredientImage } from "@/components/ingredient-image";
import { PeopleInput } from "@/components/people-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Lang, RecipeView } from "@/lib/api";
import { minutesLabel, rupees, unitLabel } from "@/lib/format";
import { amountLabel, disambiguator, gramsLabel, ingredientName, kcalLabel, localized, macroShares, partLabel, tagLabel } from "@/lib/recipe-format";
import { cn } from "@/lib/utils";
import { QuantityControl } from "@/components/quantity";
import { WatchStar } from "@/components/watch-star";
import { basketStore, formatQuantity, useBasket } from "@/store/basket";
import { useAccount } from "@/store/account";
import { languageNames, languageStore, useLanguage } from "@/store/language";
import { useMenuActions, useMenus } from "@/store/menus";

/**
 * The full recipe: pick how many people, and every quantity, the nutrition, and the cost follow.
 * Times stay put: a pot for twenty simmers as long as a pot for four. The method reads in the
 * language the reader chooses; machine-drafted Sinhala or Tamil says so until a person has
 * reviewed it.
 */
export function RecipeViewSection({ dishId, dishName, recipe, servings, onServings, loading, addToMenu = true }: { dishId: string; dishName: string; recipe: RecipeView; servings: number; onServings: (value: number) => void; loading: boolean; /** False for a person's own recipe, which a menu cannot hold yet. */ addToMenu?: boolean | undefined }) {
  const lang = useLanguage();
  const language: Lang = recipe.languages.includes(lang) ? lang : "en";
  const steps = recipe.steps[language] ?? recipe.steps.en;
  const nutrition = recipe.nutrition.per_serving;
  const shares = macroShares(nutrition);
  const cost = recipe.cost;
  const machine = language !== "en" && !recipe.review[language];
  const basket = useBasket();
  const have = new Set(basket.lines.map((line) => line.id));
  const buyable = recipe.ingredients.filter((line) => line.purchase && line.ref);
  const inBasket = buyable.filter((line) => have.has(line.ref!));
  const toBuy = buyable.filter((line) => !have.has(line.ref!));
  const toBuyCost = toBuy.reduce((sum, line) => sum + (line.cost?.cost ?? 0), 0);
  const addAll = () => {
    for (const line of toBuy) if (line.ref && line.purchase) basketStore.add(line.ref, line.names?.en ?? line.label.en, line.purchase.unit, line.purchase.quantity);
  };
  // Lines grouped by the part of the dish they belong to, in order of first appearance; indices stay the recipe's own so the steps can point at them.
  const groups: Array<{ part: string; lines: Array<{ line: (typeof recipe.ingredients)[number]; index: number }> }> = [];
  recipe.ingredients.forEach((line, index) => {
    const group = groups.find((entry) => entry.part === line.part);
    if (group) group.lines.push({ line, index });
    else groups.push({ part: line.part, lines: [{ line, index }] });
  });
  const totalMinutes = recipe.times.prep_minutes + recipe.times.cook_minutes + recipe.times.passive_minutes;
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Cooking for</span>
            <PeopleInput onChange={onServings} value={servings} />
            <span className="text-sm text-muted-foreground">{servings === 1 ? "person" : "people"}</span>
          </div>
          <div className="flex flex-wrap gap-1">{[4, 6, 10, 20].map((preset) => <Button key={preset} className="rounded-full" onClick={() => onServings(preset)} size="sm" variant={servings === preset ? "default" : "outline"}>{preset}</Button>)}</div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Read in</span>
            <ToggleGroup aria-label="Recipe language" onValueChange={(value) => { if (value === "en" || value === "si" || value === "ta") languageStore.set(value); }} size="sm" type="single" value={language} variant="outline">
              {recipe.languages.map((code) => <ToggleGroupItem key={code} aria-label={languageNames[code]} value={code}>{languageNames[code]}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="sm:col-span-2">
          <CardContent className="grid gap-5 p-4 sm:grid-cols-2 sm:gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Per serving</p>
              <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{kcalLabel(nutrition.kcal)}</p>
              <p className="text-xs text-muted-foreground">{recipe.serving.portion_g} g cooked{localized(recipe.serving.description, language) ? ` · ${localized(recipe.serving.description, language)}` : ""}</p>
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="bg-primary" style={{ width: `${shares.protein}%` }} />
                <span className="bg-amber-500/80" style={{ width: `${shares.fat}%` }} />
                <span className="bg-sky-500/70" style={{ width: `${shares.carb}%` }} />
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-xs tabular-nums">
                <div><dt className="text-muted-foreground">Protein</dt><dd className="font-medium">{gramsLabel(nutrition.protein_g)}</dd></div>
                <div><dt className="text-muted-foreground">Fat</dt><dd className="font-medium">{gramsLabel(nutrition.fat_g)}</dd></div>
                <div><dt className="text-muted-foreground">Carbs</dt><dd className="font-medium">{gramsLabel(nutrition.carb_g)}</dd></div>
                {nutrition.fibre_g !== null ? <div><dt className="text-muted-foreground">Fibre</dt><dd className="font-medium">{gramsLabel(nutrition.fibre_g)}</dd></div> : null}
                {nutrition.sodium_mg !== null ? <div><dt className="text-muted-foreground">Sodium</dt><dd className="font-medium">{gramsLabel(nutrition.sodium_mg, "mg")}</dd></div> : null}
              </dl>
              {recipe.nutrition.coverage.missing.length ? <p className="mt-2 text-[11px] text-muted-foreground">Not counted: {recipe.nutrition.coverage.missing.join(", ")}</p> : null}
            </div>
            <div className="border-t pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cost for {servings} {servings === 1 ? "person" : "people"}</p>
              <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{cost?.lines.length ? `${cost.estimated ? "≈ " : ""}${rupees(cost.total)}` : "—"}</p>
              <p className="text-xs text-muted-foreground">{cost?.lines.length ? <><span className="font-medium text-foreground">{rupees(cost.per_serving)}</span> per serving, at today's cheapest sellers{cost.unpriced.length ? ", priced items only" : ""}</> : cost ? "none of the ingredients has a published price yet" : "prices are not available right now"}</p>
              {buyable.length ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <RiShoppingBasketLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {inBasket.length ? `${inBasket.length} of ${buyable.length} priced ingredients already in your basket` : `none of the ${buyable.length} priced ingredients in your basket yet`}
                    {toBuy.length === 0 ? "; nothing left to buy" : inBasket.length && toBuy.some((line) => line.cost) ? `; ≈ ${rupees(toBuyCost)} still to buy` : ""}
                  </span>
                </p>
              ) : null}
              {cost?.unpriced.length ? <p className="mt-2 text-[11px] text-muted-foreground">Not priced yet: {cost.unpriced.join(", ")}</p> : null}
              {cost?.lines.some((line) => line.stale) ? <p className="mt-1 text-[11px] text-muted-foreground">Some prices are older than a week.</p> : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Time</p>
            <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{minutesLabel(recipe.times.prep_minutes + recipe.times.cook_minutes + recipe.times.passive_minutes)}</p>
            <p className="text-xs text-muted-foreground">{recipe.times.prep_minutes} min prep · {recipe.times.cook_minutes} min cooking{recipe.times.passive_minutes ? ` · ${recipe.times.passive_minutes} min waiting` : ""}. Same for {servings === 1 ? "one" : servings}.</p>
            <div className="mt-2 flex flex-wrap gap-1">{recipe.tags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tagLabel(tag)}</Badge>)}</div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-balance font-heading text-lg font-semibold">Ingredients for {servings}</h2>
              <p className="text-pretty text-xs text-muted-foreground">{recipe.ingredients.length} items · {buyable.length} priced today{inBasket.length ? ` · ${inBasket.length} in your basket` : ""}{cost?.lines.length ? ` · ${cost.estimated ? "≈ " : ""}${rupees(cost.total)} for ${servings} (${rupees(cost.per_serving)} per person), priced items only` : ""}. Amounts as bought, before trimming.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {toBuy.length ? <Button onClick={addAll} size="sm">Add {toBuy.length === buyable.length ? "all" : "the rest"} to basket</Button> : null}
              {addToMenu ? <AddToMenu dishId={dishId} dishName={dishName} /> : null}
            </div>
          </div>
          <div className="hidden grid-cols-[2.75rem_minmax(0,1.3fr)_6rem_minmax(0,1fr)_6rem_8.5rem] gap-x-4 border-b px-5 py-2 text-[11px] font-medium uppercase text-muted-foreground sm:grid">
            <span className="col-span-2">Ingredient</span>
            <span className="text-right">Amount</span>
            <span>Cheapest today</span>
            <span className="text-right">Price for {servings}</span>
            <span className="text-right">Basket</span>
          </div>
          <div className={cn("transition-opacity", loading && "opacity-60")}>
            {groups.map((group) => (
              <section key={group.part}>
                {groups.length > 1 ? <h3 className="border-b bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase text-muted-foreground sm:px-5">{partLabel(group.part)}</h3> : null}
                <ul className="divide-y">
                  {group.lines.map(({ line, index }) => {
                    const name = ingredientName(line, language);
                    const preparation = localized(line.preparation, language);
                    const owned = Boolean(line.ref && have.has(line.ref));
                    const displayName = line.names?.en ?? line.label.en;
                    return (
                      <li key={index} className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[2.75rem_minmax(0,1.3fr)_6rem_minmax(0,1fr)_6rem_8.5rem] sm:gap-x-4 sm:px-5", owned && "bg-primary/[0.04]")}>
                        <IngredientImage id={line.ref} label={name} size="md" className="row-span-2 self-start sm:row-span-1 sm:self-center" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium leading-tight">
                            {line.ref?.startsWith("product_") ? <Link to={`/p/${line.ref}`} className="no-underline hover:text-primary">{name}</Link> : name}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                            {owned ? <InBasketBadge /> : null}
                            {preparation ? <span className="truncate">{preparation}</span> : null}
                            {line.optional ? <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">optional</Badge> : null}
                            {line.part === "frying" ? <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">absorbed share counted</Badge> : null}
                          </p>
                        </div>
                        <div className="text-right tabular-nums">
                          <p className="text-sm font-semibold leading-tight">{amountLabel(line.quantity, line.unit)}</p>
                          {line.household ? <p className="text-[11px] text-muted-foreground">{line.household}</p> : null}
                        </div>
                        <div className="col-start-2 min-w-0 text-[11px] leading-snug text-muted-foreground sm:col-start-4 sm:text-xs">
                          {line.cost ? (
                            <>
                              <p className="tabular-nums"><span className="text-foreground">{rupees(line.cost.unit_price)} {unitLabel(line.cost.price_unit)}</span><span className="sm:hidden"> · <span className="font-semibold text-foreground">{rupees(line.cost.cost)}</span> for {servings}</span></p>
                              <p className="truncate">{line.cost.seller}{line.cost.stale ? <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">older price</span> : null}</p>
                            </>
                          ) : line.ref?.startsWith("product_") ? <p>No published price today</p> : <p><span className="rounded bg-muted px-1 py-px text-[10px]">pantry</span> not priced yet</p>}
                        </div>
                        <div className="hidden text-right text-sm font-semibold tabular-nums sm:block">{line.cost ? rupees(line.cost.cost) : <span className="font-normal text-muted-foreground">—</span>}</div>
                        <div className="col-start-3 row-start-2 flex items-center justify-end gap-1.5 sm:col-start-6 sm:row-start-auto">
                          {line.ref?.startsWith("product_") ? <WatchStar label={displayName} productId={line.ref} /> : null}
                          {line.ref && line.purchase ? (
                            owned ? (
                              <QuantityControl id={line.ref} label={displayName} unit={line.purchase.unit} />
                            ) : (
                              <Button aria-label={`Add ${formatQuantity(line.purchase.quantity, line.purchase.unit)} of ${displayName} to basket`} className="tabular-nums" onClick={() => basketStore.add(line.ref!, displayName, line.purchase!.unit, line.purchase!.quantity)} size="sm" variant="outline">
                                <RiAddLine className="size-3.5" />
                                {formatQuantity(line.purchase.quantity, line.purchase.unit)}
                              </Button>
                            )
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {cost ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t bg-muted/30 px-4 py-3 sm:grid-cols-[2.75rem_minmax(0,1.3fr)_6rem_minmax(0,1fr)_6rem_8.5rem] sm:gap-x-4 sm:px-5">
                <div className="sm:col-span-4">
                  <p className="text-sm font-semibold">Total for {servings} {servings === 1 ? "person" : "people"}</p>
                  <p className="text-[11px] text-muted-foreground">{cost.lines.length} priced {cost.lines.length === 1 ? "item" : "items"} at today's cheapest sellers{cost.unpriced.length ? `; ${cost.unpriced.length} without a price not counted` : ""}{cost.lines.some((line) => line.stale) ? "; some prices are older than a week" : ""}. Per-person figures shift a little with the headcount because amounts round to what a kitchen can measure.</p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="text-base font-semibold">{cost.estimated ? "≈ " : ""}{rupees(cost.total)}</p>
                  <p className="text-[11px] text-muted-foreground">{rupees(cost.per_serving)} per person</p>
                </div>
                <span className="hidden sm:block" />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-balance font-heading text-lg font-semibold">Method</h2>
              <p className="text-xs text-muted-foreground">{steps.length} steps · about {minutesLabel(totalMinutes)} · amounts shown for {servings}</p>
            </div>
            {machine ? <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">{languageNames[language]} machine drafted, awaiting review</Badge> : null}
          </div>
          <ol className="mt-5">
            {steps.map((step, index) => {
              const last = index === steps.length - 1;
              return (
                <li key={index} className="relative flex gap-4 pb-6 last:pb-0">
                  {!last ? <span aria-hidden className="absolute left-3.5 top-8 bottom-0 w-px bg-border" /> : null}
                  <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">{index + 1}</span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-pretty text-[15px] leading-relaxed">{step.text}</p>
                    {step.minutes || step.uses.length ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {step.minutes ? <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums"><RiTimeLine className="size-3" />{minutesLabel(step.minutes)}</span> : null}
                        {step.uses.map((use) => {
                          const line = recipe.ingredients[use];
                          if (!line) return null;
                          const twin = disambiguator(line, language, recipe.ingredients);
                          return (
                            <span key={use} className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 py-0.5 pl-0.5 pr-2 text-[11px]">
                              <IngredientImage id={line.ref} label={ingredientName(line, language)} size="xs" />
                              <span className="truncate">{ingredientName(line, language)}{twin ? <span className="text-muted-foreground"> ({twin})</span> : null}</span>
                              <span className="font-medium tabular-nums">{amountLabel(line.quantity, line.unit)}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {recipe.equipment.length ? (
            <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
              <RiToolsLine className="size-3.5" />
              <span>You need</span>
              {recipe.equipment.map((item) => <Badge key={item} variant="outline" className="font-normal">{item}</Badge>)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {localized(recipe.tips, language) || localized(recipe.health_note, language) ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {localized(recipe.tips, language) ? <Card><CardContent className="p-4"><h2 className="font-heading text-base font-semibold">Tips</h2><p className="mt-1 text-pretty text-sm text-muted-foreground">{localized(recipe.tips, language)}</p></CardContent></Card> : null}
          {localized(recipe.health_note, language) ? <Card><CardContent className="p-4"><h2 className="font-heading text-base font-semibold">Good to know</h2><p className="mt-1 text-pretty text-sm text-muted-foreground">{localized(recipe.health_note, language)}</p></CardContent></Card> : null}
        </section>
      ) : null}
    </div>
  );
}

/** "Add to a menu": a visitor is asked to sign in; a signed-in person picks one of the account's menus or starts a new one from here. */
/** A small mark on an ingredient line that is already in the basket, next to its name so it reads on a phone too. */
export function InBasketBadge({ className }: { className?: string | undefined }) {
  return (
    <Badge className={cn("h-4 gap-0.5 border-primary/40 bg-primary/10 px-1 text-[10px] font-medium text-primary", className)} variant="outline">
      <RiCheckLine aria-hidden className="size-3" />
      In your basket
    </Badge>
  );
}

function AddToMenu({ dishId, dishName }: { dishId: string; dishName: string }) {
  const account = useAccount();
  const location = useLocation();
  if (account.status === "loading") return <Button disabled size="sm" variant="outline">Add to a menu</Button>;
  if (account.status === "signed_out") return <Button asChild size="sm" variant="outline"><Link to={signInPath(`${location.pathname}${location.search}`)}>Sign in to add to a menu</Link></Button>;
  return <AddToMenuPopover dishId={dishId} dishName={dishName} />;
}

function AddToMenuPopover({ dishId, dishName }: { dishId: string; dishName: string }) {
  const { menus, status } = useMenus();
  const actions = useMenuActions();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [people, setPeople] = useState(6);
  const inMenus = menus.filter((menu) => menu.items.some((item) => item.recipe_id === dishId));
  return (
    <Popover onOpenChange={(next) => { if (!next) actions.clearError(); setOpen(next); }} open={open}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={inMenus.length ? "secondary" : "outline"}>{inMenus.length ? `In ${inMenus.length} ${inMenus.length === 1 ? "menu" : "menus"}` : "Add to a menu"}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <AccountActionError error={actions.error} onDismiss={actions.clearError} />
        {status === "loading" ? <p className="text-sm text-muted-foreground">Fetching your menus…</p> : null}
        {menus.length ? (
          <ul className="space-y-1">
            {menus.map((menu) => {
              const added = menu.items.some((item) => item.recipe_id === dishId);
              return (
                <li key={menu.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{menu.name}</p><p className="text-[11px] text-muted-foreground tabular-nums">{menu.people} people · {menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}</p></div>
                  {added ? <Button onClick={() => void actions.removeRecipe(menu.id, dishId)} size="sm" type="button" variant="ghost">Remove</Button> : <Button onClick={() => void actions.addRecipe(menu.id, { id: dishId, label: dishName })} size="sm" type="button" variant="outline">Add</Button>}
                </li>
              );
            })}
          </ul>
        ) : status === "ready" ? <p className="text-sm text-muted-foreground">A menu is a meal for an occasion: name it, say how many are coming, and every recipe in it scales to them.</p> : null}
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const created = await actions.create({ name: name.trim() || `${dishName} menu`, people, items: [{ id: dishId, label: dishName }] });
            if (!created) return;
            setName("");
            setOpen(false);
          }}
        >
          <p className="text-xs font-medium">New menu</p>
          <Input aria-label="Menu name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Sunday lunch, poya dana…" value={name} />
          <div className="flex items-center gap-2">
            <PeopleInput max={1000} onChange={setPeople} value={people} />
            <span className="text-xs text-muted-foreground">people</span>
            <Button className="ml-auto" disabled={actions.pending} size="sm" type="submit">{actions.pending ? "Saving…" : "Create and add"}</Button>
          </div>
        </form>
        {menus.length ? <Link className="block text-xs underline" onClick={() => setOpen(false)} to="/menus">All menus</Link> : null}
      </PopoverContent>
    </Popover>
  );
}
