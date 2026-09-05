import { RiArrowLeftSLine, RiArrowRightSLine, RiBookOpenLine, RiExternalLinkLine, RiFireLine, RiLeafLine, RiPriceTag3Line, RiTimeLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { rupees, StatTile } from "@/components/charts";
import { PageFrame, Pagination } from "@/components/data-display";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type DishDetail, type DishSummary, type Page, type RecipeOverview, type RecipeReferences } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The recipe corpus: an original catalogue of Sri Lankan dishes, searchable by any
 * name, filterable by what a cook cares about, with what the warehouse can already
 * price for each dish. Quantities and method text follow in the recipe layer; this
 * page is where the vocabulary is reviewed.
 */

const categoryLabels: Record<string, string> = {
  rice_and_grains: "Rice and grains",
  vegetable: "Vegetables",
  pulses_and_eggs: "Pulses and eggs",
  sambol_and_condiment: "Sambols and condiments",
  fish_and_seafood: "Fish and seafood",
  meat_and_poultry: "Meat and poultry",
  snack: "Snacks and short eats",
  sweet: "Sweets",
  drink: "Drinks",
};
const label = (value: string, table: Record<string, string> = {}) => table[value] ?? value.replaceAll("_", " ").replace(/^\w/u, (character) => character.toUpperCase());
const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;
const meals = ["breakfast", "lunch", "dinner", "tea", "snack"];
const proteins = ["chicken", "fish", "seafood", "egg", "dhal", "pulses", "dairy", "soya", "beef", "pork", "mutton", "none"];
const diets = ["vegetarian", "vegan", "gluten_free", "contains_egg", "contains_dairy", "contains_fish", "contains_meat"];
const regions = ["island_wide", "up_country", "coastal", "southern", "northern", "eastern", "kandyan", "muslim", "burgher", "malay"];
const popularityCopy: Record<number, string> = { 1: "Everyday", 2: "Common", 3: "Occasional" };
const filterKeys = ["category", "meal", "protein", "diet", "region"] as const;

export function RecipesPage() {
  const [parameters, setParameters] = useSearchParams();
  const page = Math.max(1, Number(parameters.get("page") ?? 1) || 1);
  const pageSize = [10, 20, 50].includes(Number(parameters.get("pageSize"))) ? Number(parameters.get("pageSize")) : 20;
  const search = (parameters.get("search") ?? "").slice(0, 100);
  const dishId = (parameters.get("dish") ?? "").slice(0, 120);
  const filters = Object.fromEntries(filterKeys.map((key) => [key, (parameters.get(key) ?? "").slice(0, 40)])) as Record<(typeof filterKeys)[number], string>;
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(parameters);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParameters(next, { replace: true });
  };
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, ...filters });
  for (const [key, value] of [...query.entries()]) if (!value) query.delete(key);

  const overview = useQuery({ queryKey: ["recipes-overview"], queryFn: ({ signal }) => api<RecipeOverview>("/v1/admin/recipes/overview", { signal }), staleTime: 300_000 });
  const references = useQuery({ queryKey: ["recipes-references"], queryFn: ({ signal }) => api<RecipeReferences>("/v1/admin/recipes/references", { signal }), staleTime: 300_000 });
  const dishes = useQuery({
    queryKey: ["recipes-dishes", query.toString()],
    queryFn: ({ signal }) => api<Page<DishSummary>>(`/v1/admin/recipes/dishes?${query}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: ["recipes-dish", dishId],
    queryFn: ({ signal }) => api<DishDetail>(`/v1/admin/recipes/dishes/${encodeURIComponent(dishId)}`, { signal }),
    enabled: Boolean(dishId),
    staleTime: 60_000,
  });
  const filtered = Boolean(search || Object.values(filters).some(Boolean));

  return (
    <PageFrame
      description="An original catalogue of Sri Lankan dishes, the vocabulary every recipe and menu plan will share. Each dish points at the products the warehouse prices, so the gaps in the pantry are visible before a single quantity is written."
      eyebrow="Intelligence"
      title="Recipes"
    >
      {overview.isError ? (
        <Empty className="min-h-48"><EmptyHeader><EmptyTitle>Recipe catalogue unavailable</EmptyTitle><EmptyDescription>{overview.error.message}</EmptyDescription></EmptyHeader></Empty>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile hint={overview.data ? `${overview.data.by_category.length} categories · reviewed ${overview.data.reviewed_at}` : "Loading"} icon={<RiBookOpenLine />} label="Dishes catalogued" value={overview.data ? String(overview.data.dishes) : "—"} />
        <StatTile
          hint={overview.data?.coverage ? `${overview.data.coverage.priced} of ${overview.data.coverage.products} distinct key ingredients have a price today` : "Needs the warehouse"}
          icon={<RiPriceTag3Line />}
          label="Dishes fully priceable"
          value={overview.data?.coverage ? String(overview.data.coverage.dishes_fully_priced) : "—"}
        />
        <StatTile hint="Named in the catalogue but not yet in the price vocabulary; the pantry mapping backlog" icon={<RiLeafLine />} label="Unpriced ingredients" value={overview.data ? String(overview.data.unpriced_ingredients.length) : "—"} />
        <StatTile hint={overview.data ? `${overview.data.references.channels} channels · ${overview.data.references.blogs} blogs · ${overview.data.references.institutional} institutional` : "Loading"} icon={<RiExternalLinkLine />} label="Reference sources" value={overview.data ? String(overview.data.references.channels + overview.data.references.blogs + overview.data.references.institutional) : "—"} />
      </div>

      <Card size="sm">
        <CardContent className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); update({ search: (new FormData(event.currentTarget).get("search") as string).trim(), page: "" }); }}>
            <Input aria-label="Search dishes" className="h-9 lg:max-w-sm" defaultValue={search} key={search} name="search" placeholder="Search a dish in any name or an ingredient" />
            <Button size="sm" type="submit" variant="secondary">Search</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Category" onChange={(value) => update({ category: value, page: "" })} options={Object.keys(categoryLabels).map((value) => [value, categoryLabels[value]!])} value={filters.category} />
            <FilterSelect label="Meal" onChange={(value) => update({ meal: value, page: "" })} options={meals.map((value) => [value, label(value)])} value={filters.meal} />
            <FilterSelect label="Protein" onChange={(value) => update({ protein: value, page: "" })} options={proteins.map((value) => [value, label(value)])} value={filters.protein} />
            <FilterSelect label="Diet" onChange={(value) => update({ diet: value, page: "" })} options={diets.map((value) => [value, label(value)])} value={filters.diet} />
            <FilterSelect label="Region" onChange={(value) => update({ region: value, page: "" })} options={regions.map((value) => [value, label(value)])} value={filters.region} />
            {filtered ? <Button onClick={() => update({ search: "", category: "", meal: "", protein: "", diet: "", region: "", page: "" })} size="sm" variant="ghost">Clear</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="px-0">
          {dishes.isPending ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton className="h-10" key={index} />)}</div> : dishes.isError ? (
            <p className="p-4 text-sm text-destructive">{dishes.error.message}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Dish</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Meals</TableHead>
                    <TableHead>Protein</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead className="pr-4 text-right">Priced ingredients</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={cn(dishes.isPlaceholderData && "opacity-60")}>
                  {dishes.data.items.map((dish) => (
                    <TableRow className="cursor-pointer" key={dish.id} onClick={() => update({ dish: dish.id })}>
                      <TableCell className="pl-4">
                        <span className="block font-medium">{dish.names.en}</span>
                        <span className="block text-[11px] text-muted-foreground">{[dish.names.si_latn, dish.names.si, dish.names.ta_latn].filter(Boolean).join(" · ") || dish.summary}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{label(dish.category, categoryLabels)}<span className="block text-[11px]">{popularityCopy[dish.popularity]} · {label(dish.region)}</span></TableCell>
                      <TableCell className="text-muted-foreground">{dish.meal_slots.map((value) => label(value)).join(", ")}</TableCell>
                      <TableCell className="text-muted-foreground">{dish.protein_source.filter((source) => source !== "none").map((value) => label(value)).join(", ") || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{dish.prep_minutes + dish.cook_minutes} min</TableCell>
                      <TableCell className="pr-4 text-right font-mono">{dish.coverage ? <span className={cn(dish.coverage.total && dish.coverage.priced === dish.coverage.total ? "text-primary" : dish.coverage.priced ? "text-amber-400" : "text-muted-foreground")}>{dish.coverage.priced}/{dish.coverage.total}</span> : <span className="text-muted-foreground">{dish.key_ingredients.length}</span>}</TableCell>
                    </TableRow>
                  ))}
                  {!dishes.data.items.length ? <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={6}>No dish matches. Try another spelling or clear the filters.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
              <Pagination page={dishes.data.page} pageSize={dishes.data.pageSize} pages={dishes.data.pages} pending={dishes.isPlaceholderData} total={dishes.data.total} />
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="flex flex-col" size="sm">
          <CardHeader><CardTitle>Pantry backlog</CardTitle><CardDescription>Ingredients the catalogue names most often that the price vocabulary does not carry yet. Mapping these makes more dishes fully priceable.</CardDescription></CardHeader>
          <CardContent className="flex flex-1 flex-col px-0">
            {overview.data ? (
              <PagedList
                items={overview.data.unpriced_ingredients}
                pageSize={11}
                render={(entry, index) => (
                  <div className="flex items-center gap-3 px-4 py-1.5 text-sm" key={entry.ingredient}>
                    <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                    <span className="flex-1 truncate">{entry.ingredient}</span>
                    <span className="font-mono text-xs text-muted-foreground">{plural(entry.dishes, "dish", "dishes")}</span>
                  </div>
                )}
              />
            ) : <Skeleton className="mx-4 h-6" />}
          </CardContent>
        </Card>
        <Card className="flex flex-col" size="sm">
          <CardHeader><CardTitle>Where cooks publish</CardTitle><CardDescription>Sri Lankan cookery channels, blogs, and institutional sources the corpus consults and links to. Method text in this product is always our own.</CardDescription></CardHeader>
          <CardContent className="flex flex-1 flex-col px-0">
            {references.data ? (
              <PagedList
                items={[...references.data.channels.map((entry) => ({ ...entry, kind: "YouTube" })), ...references.data.blogs.map((entry) => ({ ...entry, kind: "Blog" })), ...references.data.institutional.map((entry) => ({ ...entry, kind: label(entry.kind), languages: [] as string[], focus: entry.notes }))]}
                pageSize={8}
                render={(entry) => (
                  <a className="flex items-start gap-2 px-4 py-1 text-sm hover:bg-muted/60" href={entry.url} key={entry.id} rel="noreferrer" target="_blank">
                    <Badge className="mt-0.5 w-16 shrink-0 justify-center" variant="secondary">{entry.kind}</Badge>
                    <span className="min-w-0"><span className="block truncate font-medium">{entry.name}{entry.languages.length ? <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">{entry.languages.join(" ")}</span> : null}</span><span className="block truncate text-[11px] text-muted-foreground">{entry.focus}</span></span>
                  </a>
                )}
              />
            ) : <Skeleton className="mx-4 h-6" />}
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={(open) => { if (!open) update({ dish: "" }); }} open={Boolean(dishId)}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-2xl">
          <ScrollArea className="[&_[data-slot=scroll-area-viewport]]:max-h-[85vh]">
            <div className="p-6">
            {detail.data ? <DishSheet dish={detail.data} onOpen={(id) => update({ dish: id })} /> : <DialogHeader><DialogTitle>{detail.isError ? "Dish unavailable" : "Loading"}</DialogTitle><DialogDescription>{detail.isError ? detail.error.message : "Fetching the dish."}</DialogDescription></DialogHeader>}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}

/** A fixed number of rows per page with a small pager, so two cards side by side stay the same height whatever their lists hold. */
function PagedList<T>({ items, pageSize, render }: { items: T[]; pageSize: number; render: (item: T, index: number) => ReactNode }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return (
    <>
      <div className="flex-1 divide-y divide-white/[0.05]">
        {slice.map((item, index) => render(item, start + index))}
        {!slice.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing to show.</p> : null}
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.07] px-4 pt-2.5 text-xs text-muted-foreground">
        <span>{items.length ? `${start + 1}–${Math.min(start + pageSize, items.length)} of ${items.length}` : "0 of 0"}</span>
        <span className="flex items-center gap-1">
          <Button aria-label="Previous page" className="size-7" disabled={current <= 1} onClick={() => setPage(current - 1)} size="icon" variant="ghost"><RiArrowLeftSLine className="size-4" /></Button>
          <span className="font-mono">{current}/{pages}</span>
          <Button aria-label="Next page" className="size-7" disabled={current >= pages} onClick={() => setPage(current + 1)} size="icon" variant="ghost"><RiArrowRightSLine className="size-4" /></Button>
        </span>
      </div>
    </>
  );
}

function FilterSelect({ label: name, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <Select onValueChange={(next) => onChange(next === "all" ? "" : next)} value={value || "all"}>
      <SelectTrigger aria-label={name} className="h-9 w-40" size="sm"><SelectValue placeholder={name} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{name}: all</SelectItem>
        {options.map(([option, text]) => <SelectItem key={option} value={option}>{text}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function DishSheet({ dish, onOpen }: { dish: DishDetail; onOpen: (id: string) => void }) {
  const names = [dish.names.si, dish.names.si_latn, dish.names.ta, dish.names.ta_latn].filter(Boolean).join(" · ");
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="font-heading text-xl">{dish.names.en}</DialogTitle>
        <DialogDescription>{names || label(dish.category, categoryLabels)}</DialogDescription>
      </DialogHeader>
      <p className="text-sm leading-relaxed">{dish.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{label(dish.category, categoryLabels)}</Badge>
        <Badge variant="outline">{popularityCopy[dish.popularity]}</Badge>
        <Badge variant="outline">{label(dish.region)}</Badge>
        <Badge variant="outline"><RiTimeLine className="mr-1 size-3" />{dish.prep_minutes + dish.cook_minutes} min · {dish.difficulty}</Badge>
        <Badge variant="outline"><RiFireLine className="mr-1 size-3" />{dish.spice}</Badge>
        {dish.diet.map((tag) => <Badge key={tag} variant="outline">{label(tag)}</Badge>)}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Meals</dt><dd>{dish.meal_slots.map((value) => label(value)).join(", ")}</dd>
        <dt className="text-muted-foreground">Role</dt><dd>{dish.roles.map((value) => label(value)).join(", ")}</dd>
        <dt className="text-muted-foreground">Protein</dt><dd>{dish.protein_source.map((value) => label(value)).join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Occasions</dt><dd>{dish.occasions.map((value) => label(value)).join(", ") || "—"}</dd>
        {dish.variants.length ? <><dt className="text-muted-foreground">Variants</dt><dd>{dish.variants.join(", ")}</dd></> : null}
      </dl>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Key ingredients {dish.coverage ? <span className="font-mono text-xs text-muted-foreground">{dish.coverage.priced}/{dish.coverage.total} priced today</span> : null}</h3>
        <ul className="space-y-1.5">
          {dish.ingredients.map((ingredient) => (
            <li className="flex items-center gap-2.5 text-sm" key={ingredient.product_id}>
              <ProductImage id={ingredient.product_id} label={ingredient.label ?? ingredient.product_id} size="xs" />
              <span className="flex-1 truncate">{ingredient.label ?? ingredient.product_id.replace(/^product_/u, "").replaceAll("_", " ")}</span>
              {ingredient.price ? <span className="font-mono text-xs text-muted-foreground">from {rupees(ingredient.price.cheapest)}/{ingredient.price.unit} · {plural(ingredient.price.sellers, "seller")}</span> : <span className="text-xs text-muted-foreground">no price today</span>}
            </li>
          ))}
        </ul>
        {dish.other_ingredients.length ? <p className="text-xs text-muted-foreground">Also: {dish.other_ingredients.join(", ")}</p> : null}
      </section>
      {dish.pairs.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Usually served with</h3>
          <div className="flex flex-wrap gap-1.5">{dish.pairs.map((pair) => <Button className="h-7 rounded-full px-3 text-xs" key={pair.id} onClick={() => onOpen(pair.id)} size="sm" variant="outline">{pair.label}</Button>)}</div>
        </section>
      ) : null}
    </div>
  );
}
