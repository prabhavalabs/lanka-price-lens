import { RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchOverview, fetchSearch, type ProductCard } from "@/lib/api";
import { categoryLabel, rupeeRange, unitLabel } from "@/lib/format";
import { fuzzySearch } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

/**
 * One search box for the whole site. Typing is matched at once against every product's names in
 * English, Sinhala, and Tamil (fuzzy, so "potatos" and "b onion" work), and after a short pause the
 * server adds products whose store or bulletin wording matches ("Bairaha", "B'Onion Imported").
 * Enter opens the highlighted product; every suggestion shows its photo and today's open-market price.
 */
export function SearchBox({ className, autoFocus = false }: { className?: string | undefined; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 220).trim();
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, staleTime: 5 * 60_000 });
  const remote = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) => fetchSearch(debounced, signal),
    enabled: open && debounced.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const index = useMemo(() => (overview.data?.products ?? []).map((product) => ({ id: product.id, label: product.label, terms: [product.label_si ?? "", product.label_ta ?? "", categoryLabel(product.category)].filter(Boolean), product })), [overview.data]);
  const byId = useMemo(() => new Map(index.map((entry) => [entry.id, entry.product])), [index]);
  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return (overview.data?.products ?? []).filter((product) => product.prices.length >= 2).slice(0, 8);
    const local = fuzzySearch(index, trimmed, 8).map((match) => match.item.product);
    const seen = new Set(local.map((product) => product.id));
    const fromServer = (remote.data ?? []).map((hit) => byId.get(hit.id)).filter((product): product is ProductCard => Boolean(product) && !seen.has(product!.id));
    return [...local, ...fromServer].slice(0, 10);
  }, [query, index, remote.data, byId, overview.data]);
  const firstId = results[0]?.id ?? "";
  const [highlighted, setHighlighted] = useState(firstId);
  useEffect(() => { setHighlighted(firstId); }, [firstId, debounced]);
  const choose = (id: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/p/${id}`);
  };

  return (
    <Popover onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }} open={open}>
      <PopoverTrigger asChild>
        <Button aria-expanded={open} aria-label="Search products" autoFocus={autoFocus} className={cn("h-10 w-full justify-start gap-2 rounded-full pl-3 pr-4 font-normal text-muted-foreground shadow-none", className)} role="combobox" variant="outline">
          <RiSearchLine className="size-4" />
          <span className="flex-1 truncate text-left text-sm">Search rice, dhal, chicken, potatoes…</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-80 p-0 sm:min-w-96">
        <Command onValueChange={setHighlighted} shouldFilter={false} value={highlighted}>
          <CommandInput autoFocus onValueChange={setQuery} placeholder="Type a product in any spelling…" value={query} />
          <CommandList className="max-h-96">
            {overview.isPending ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading products…</p> : null}
            {!overview.isPending && !results.length ? <CommandEmpty>Nothing matches “{query.trim()}”. Try another spelling or the name a store uses.</CommandEmpty> : null}
            {results.length ? (
              <CommandGroup heading={query.trim() ? "Products" : "Popular today"}>
                {results.map((product) => {
                  const headline = product.prices.find((price) => price.group === "retail_market") ?? product.prices[0];
                  return (
                    <CommandItem className="gap-3 py-2" key={product.id} onSelect={() => choose(product.id)} value={product.id}>
                      <ProductImage id={product.id} label={product.label} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{product.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {categoryLabel(product.category)}
                          {product.label_si ? ` · ${product.label_si}` : ""}
                          {product.label_ta ? ` · ${product.label_ta}` : ""}
                        </span>
                      </span>
                      {headline ? <span className="shrink-0 text-right text-xs tabular"><span className="block font-medium">{rupeeRange(headline.low, headline.high)}</span><span className="block text-[10px] text-muted-foreground">{unitLabel(headline.unit)}</span></span> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
