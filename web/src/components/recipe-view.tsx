import { RiAddLine, RiCheckLine, RiSubtractLine } from "@remixicon/react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Lang, RecipeView } from "@/lib/api";
import { minutesLabel, rupees } from "@/lib/format";
import { amountLabel, gramsLabel, ingredientName, kcalLabel, localized, macroShares, tagLabel } from "@/lib/recipe-format";
import { cn } from "@/lib/utils";
import { languageNames, languageStore, useLanguage } from "@/store/language";
import { menuStore, useMenus } from "@/store/menus";

/**
 * The full recipe: pick how many people, and every quantity, the nutrition, and the cost follow.
 * Times stay put: a pot for twenty simmers as long as a pot for four. The method reads in the
 * language the reader chooses; machine-drafted Sinhala or Tamil says so until a person has
 * reviewed it.
 */
export function RecipeViewSection({ dishId, dishName, recipe, servings, onServings, loading }: { dishId: string; dishName: string; recipe: RecipeView; servings: number; onServings: (value: number) => void; loading: boolean }) {
  const lang = useLanguage();
  const language: Lang = recipe.languages.includes(lang) ? lang : "en";
  const steps = recipe.steps[language] ?? recipe.steps.en;
  const nutrition = recipe.nutrition.per_serving;
  const shares = macroShares(nutrition);
  const cost = recipe.cost;
  const machine = language !== "en" && !recipe.review[language];
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Cooking for</span>
            <div aria-label="Number of people" className="inline-flex items-center gap-0.5 rounded-lg border border-primary/40 bg-primary/5 p-0.5" role="group">
              <Button aria-label="Fewer people" disabled={servings <= 1} onClick={() => onServings(servings - 1)} size="icon-sm" variant="ghost"><RiSubtractLine className="size-3.5" /></Button>
              <Input aria-label="People" className="h-7 w-14 border-0 bg-transparent text-center text-sm font-semibold tabular-nums shadow-none focus-visible:ring-0" inputMode="numeric" onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 500) onServings(Math.round(value)); }} value={servings} />
              <Button aria-label="More people" disabled={servings >= 500} onClick={() => onServings(servings + 1)} size="icon-sm" variant="ghost"><RiAddLine className="size-3.5" /></Button>
            </div>
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
        <Card>
          <CardContent className="p-4">
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
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cost per serving</p>
            <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{cost?.lines.length ? `${cost.estimated ? "≈ " : ""}${rupees(cost.per_serving)}` : "—"}</p>
            <p className="text-xs text-muted-foreground">{cost?.lines.length ? `${rupees(cost.total)} for ${servings}, at today's cheapest sellers${cost.unpriced.length ? ", priced items only" : ""}` : cost ? "none of the ingredients has a published price yet" : "prices are not available right now"}</p>
            {cost?.unpriced.length ? <p className="mt-2 text-[11px] text-muted-foreground">Not priced yet: {cost.unpriced.join(", ")}</p> : null}
            {cost?.lines.some((line) => line.stale) ? <p className="mt-1 text-[11px] text-muted-foreground">Some prices are older than a week.</p> : null}
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div><h2 className="font-heading text-lg font-semibold">Ingredients for {servings}</h2><p className="text-xs text-muted-foreground">As bought, before trimming. Salt, oil, and whole spices grow a little slower than the headcount.</p></div>
            <AddToMenu dishId={dishId} dishName={dishName} />
          </div>
          <ul className={cn("divide-y transition-opacity", loading && "opacity-60")}>
            {recipe.ingredients.map((line, index) => {
              const name = ingredientName(line, language);
              const preparation = localized(line.preparation, language);
              return (
                <li key={`${line.ref ?? line.label.en}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {line.ref?.startsWith("product_") ? <Link to={`/p/${line.ref}`} className="no-underline hover:text-primary">{name}</Link> : name}
                      {line.optional ? <span className="ml-1 text-xs text-muted-foreground">(optional)</span> : null}
                    </p>
                    {preparation ? <p className="text-[11px] text-muted-foreground">{preparation}</p> : null}
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-semibold">{amountLabel(line.quantity, line.unit)}</p>
                    {line.household ? <p className="text-[11px] text-muted-foreground">{line.household}</p> : null}
                  </div>
                  {line.priced ? <RiCheckLine aria-label="Priced today" className="size-4 shrink-0 text-primary" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold">Method</h2>
            {machine ? <span className="text-[11px] text-muted-foreground">{languageNames[language]} text is machine drafted and awaits review.</span> : null}
          </div>
          <ol className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-pretty text-sm leading-relaxed">{step.text}</p>
                  {step.minutes ? <p className="text-[11px] text-muted-foreground">{minutesLabel(step.minutes)}</p> : null}
                </div>
              </li>
            ))}
          </ol>
          {recipe.equipment.length ? <p className="mt-4 text-xs text-muted-foreground">You need: {recipe.equipment.join(", ")}.</p> : null}
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

/** "Add to a menu": pick one of the household's menus or start a new one from here. */
function AddToMenu({ dishId, dishName }: { dishId: string; dishName: string }) {
  const { menus } = useMenus();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [people, setPeople] = useState(6);
  const inMenus = menus.filter((menu) => menu.items.some((item) => item.recipe_id === dishId));
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={inMenus.length ? "secondary" : "outline"}>{inMenus.length ? `In ${inMenus.length} ${inMenus.length === 1 ? "menu" : "menus"}` : "Add to a menu"}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {menus.length ? (
          <ul className="space-y-1">
            {menus.map((menu) => {
              const added = menu.items.some((item) => item.recipe_id === dishId);
              return (
                <li key={menu.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{menu.name}</p><p className="text-[11px] text-muted-foreground">{menu.people} people · {menu.items.length} {menu.items.length === 1 ? "recipe" : "recipes"}</p></div>
                  {added ? <Button onClick={() => menuStore.removeRecipe(menu.id, dishId)} size="sm" variant="ghost">Remove</Button> : <Button onClick={() => menuStore.addRecipe(menu.id, { id: dishId, label: dishName })} size="sm" variant="outline">Add</Button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">A menu is a meal for an occasion: name it, say how many are coming, and every recipe in it scales to them.</p>}
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const id = menuStore.create({ name: name.trim() || `${dishName} menu`, people });
            menuStore.addRecipe(id, { id: dishId, label: dishName });
            setName("");
            setOpen(false);
          }}
        >
          <p className="text-xs font-medium">New menu</p>
          <Input aria-label="Menu name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Sunday lunch, poya dana…" value={name} />
          <div className="flex items-center gap-2">
            <Input aria-label="People" className="w-20" inputMode="numeric" max={1000} min={1} onChange={(event) => setPeople(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} type="number" value={people} />
            <span className="text-xs text-muted-foreground">people</span>
            <Button className="ml-auto" size="sm" type="submit">Create and add</Button>
          </div>
        </form>
        {menus.length ? <Link className="block text-xs underline" onClick={() => setOpen(false)} to="/menus">All menus</Link> : null}
      </PopoverContent>
    </Popover>
  );
}
