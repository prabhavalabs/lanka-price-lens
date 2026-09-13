import { RiCloseLine, RiEqualizerLine, RiSearchLine } from "@remixicon/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dishCategoryLabel, rupees } from "@/lib/format";
import { filterTags, tagLabel } from "@/lib/recipe-format";
import { activeFilterCount, costOptions, emptySearch, kcalOptions, minutesOptions, proteinOptions, sortOptions, type RecipeSearch } from "@/lib/recipe-search";
import { cn } from "@/lib/utils";

const categories = ["rice_and_grains", "vegetable", "pulses_and_eggs", "sambol_and_condiment", "fish_and_seafood", "meat_and_poultry", "snack", "sweet", "drink"];

/**
 * One search bar for the recipes: the text, a Filters panel (category, what the dish is good
 * for, calories, protein, time, cost per serving), and the sort, with every active filter shown
 * as a chip that can be taken off. The bar only edits the search object; the page owns the
 * address and the request.
 */
export function RecipeSearchBar({ search, onChange, total, fetching }: { search: RecipeSearch; onChange: (next: RecipeSearch) => void; total: number | null; fetching: boolean }) {
  const [open, setOpen] = useState(false);
  const filters = activeFilterCount(search);
  const set = (patch: Partial<RecipeSearch>) => onChange({ ...search, ...patch, page: 1 });
  const toggleTag = (tag: string) => set({ tags: search.tags.includes(tag) ? search.tags.filter((entry) => entry !== tag) : [...search.tags, tag] });
  const chips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(search.category ? [{ key: "category", label: dishCategoryLabel(search.category), clear: () => set({ category: "" }) }] : []),
    ...search.tags.map((tag) => ({ key: `tag-${tag}`, label: tagLabel(tag), clear: () => toggleTag(tag) })),
    ...(search.max_kcal ? [{ key: "kcal", label: `Under ${search.max_kcal} kcal`, clear: () => set({ max_kcal: null }) }] : []),
    ...(search.min_protein ? [{ key: "protein", label: `${search.min_protein} g protein or more`, clear: () => set({ min_protein: null }) }] : []),
    ...(search.max_minutes ? [{ key: "minutes", label: `Under ${search.max_minutes} min`, clear: () => set({ max_minutes: null }) }] : []),
    ...(search.max_cost ? [{ key: "cost", label: `Under ${rupees(search.max_cost)} a serving`, clear: () => set({ max_cost: null }) }] : []),
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <RiSearchLine aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search recipes" className="h-10 pl-9 pr-9" onChange={(event) => set({ q: event.target.value })} placeholder="Search dishes or ingredients: parippu, pol sambol, chicken, කිරිබත්…" value={search.q} />
          {search.q ? <Button aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => set({ q: "" })} size="icon-sm" variant="ghost"><RiCloseLine className="size-4" /></Button> : null}
        </div>
        <div className="flex gap-2">
          <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>
              <Button className="h-10 gap-1.5" variant={filters ? "secondary" : "outline"}>
                <RiEqualizerLine className="size-4" />
                Filters
                {filters ? <Badge className="ml-0.5 h-5 min-w-5 justify-center px-1 tabular-nums">{filters}</Badge> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(92vw,40rem)] p-0">
              <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
                <FilterGroup title="Category">
                  <Chip active={!search.category} onClick={() => set({ category: "" })}>All</Chip>
                  {categories.map((category) => <Chip active={search.category === category} key={category} onClick={() => set({ category: search.category === category ? "" : category })}>{dishCategoryLabel(category)}</Chip>)}
                </FilterGroup>
                <FilterGroup title="Good for">
                  {filterTags.map((tag) => <Chip active={search.tags.includes(tag)} key={tag} onClick={() => toggleTag(tag)}>{tagLabel(tag)}</Chip>)}
                </FilterGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FilterGroup title="Calories per serving">
                    <Chip active={!search.max_kcal} onClick={() => set({ max_kcal: null })}>Any</Chip>
                    {kcalOptions.map((value) => <Chip active={search.max_kcal === value} key={value} onClick={() => set({ max_kcal: search.max_kcal === value ? null : value })}>Under {value}</Chip>)}
                  </FilterGroup>
                  <FilterGroup title="Protein per serving">
                    <Chip active={!search.min_protein} onClick={() => set({ min_protein: null })}>Any</Chip>
                    {proteinOptions.map((value) => <Chip active={search.min_protein === value} key={value} onClick={() => set({ min_protein: search.min_protein === value ? null : value })}>{value} g or more</Chip>)}
                  </FilterGroup>
                  <FilterGroup title="Time">
                    <Chip active={!search.max_minutes} onClick={() => set({ max_minutes: null })}>Any</Chip>
                    {minutesOptions.map((value) => <Chip active={search.max_minutes === value} key={value} onClick={() => set({ max_minutes: search.max_minutes === value ? null : value })}>Under {value} min</Chip>)}
                  </FilterGroup>
                  <FilterGroup title="Cost per serving">
                    <Chip active={!search.max_cost} onClick={() => set({ max_cost: null })}>Any</Chip>
                    {costOptions.map((value) => <Chip active={search.max_cost === value} key={value} onClick={() => set({ max_cost: search.max_cost === value ? null : value })}>Under Rs {value}</Chip>)}
                  </FilterGroup>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
                <Button disabled={!filters} onClick={() => onChange({ ...emptySearch, q: search.q, sort: search.sort })} size="sm" variant="ghost">Clear filters</Button>
                <Button onClick={() => setOpen(false)} size="sm">Done</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Select onValueChange={(value) => set({ sort: value === "relevance" ? "" : value })} value={search.sort || "relevance"}>
            <SelectTrigger aria-label="Sort" className="h-10 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{sortOptions.map((option) => <SelectItem key={option.value || "relevance"} value={option.value || "relevance"}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {chips.map((chip) => (
          <button key={chip.key} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:border-primary" onClick={chip.clear} type="button">
            {chip.label}
            <RiCloseLine aria-hidden className="size-3 text-muted-foreground" />
            <span className="sr-only">Remove {chip.label}</span>
          </button>
        ))}
        {chips.length ? <button className="text-xs underline" onClick={() => onChange({ ...emptySearch, q: search.q, sort: search.sort })} type="button">Clear all</button> : null}
        <span className={cn("ml-auto tabular-nums transition-opacity", fetching && "opacity-60")}>{total === null ? "" : `${total} ${total === 1 ? "dish" : "dishes"}${search.q.trim() ? ` for “${search.q.trim()}”` : ""}`}</span>
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium uppercase text-muted-foreground">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button aria-pressed={active} className="h-7 rounded-full px-2.5 text-xs" onClick={onClick} size="sm" type="button" variant={active ? "default" : "outline"}>
      {children}
    </Button>
  );
}
