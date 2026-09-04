import { RiCheckLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api, type ExplorerProduct } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Searches the warehouse's products by any label a source uses for them or their
 * varieties ("potato", "bandakka", "B'Onion Imported"). One row per product, so a
 * shopper typing "potato" sees potatoes once, not five kinds of potato; the
 * varieties are chosen on the product page.
 */
export function ProductSearch({ selected, onSelect, className }: { selected: ExplorerProduct | null; onSelect: (product: ExplorerProduct) => void; className?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 180).trim();
  const results = useQuery({
    queryKey: ["explorer-search", debounced],
    queryFn: ({ signal }) => api<ExplorerProduct[]>(`/v1/admin/explorer/search?${new URLSearchParams({ q: debounced, limit: "20" })}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: open,
  });
  const products = results.data ?? [];
  // cmdk only auto-highlights the first row when it filters itself; with server results the highlight is kept in sync by hand.
  const firstValue = products[0]?.id ?? "";
  const [highlighted, setHighlighted] = useState(firstValue);
  useEffect(() => { setHighlighted(firstValue); }, [firstValue, debounced]);
  const choose = (product: ExplorerProduct) => {
    onSelect(product);
    setOpen(false);
  };

  return (
    <Popover onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }} open={open}>
      <PopoverTrigger asChild>
        <Button aria-expanded={open} aria-label="Search for a product" className={cn("h-9 w-full justify-start gap-2 pl-1.5 pr-2.5 font-normal lg:w-96", className)} role="combobox" variant="outline">
          {selected ? <ProductImage id={selected.id} label={selected.label} size="xs" /> : <span aria-hidden className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground"><RiSearchLine className="size-3.5" /></span>}
          <span className="flex-1 truncate text-left text-sm">{selected ? selected.label : "Search a product, for example eggs, potato, or samba rice"}</span>
          {selected ? <span className="font-mono text-[10px] text-muted-foreground">{selected.sellers} sellers</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-96 p-0">
        <Command onValueChange={setHighlighted} shouldFilter={false} value={highlighted}>
          <CommandInput autoFocus onValueChange={setQuery} placeholder="Type a product name in any spelling…" value={query} />
          <CommandList className="max-h-96">
            {results.isPending && !products.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</p> : null}
            {results.isError ? <p className="px-3 py-6 text-center text-sm text-destructive">{results.error.message}</p> : null}
            {!results.isPending && !products.length ? <CommandEmpty>Nothing matches “{debounced}”. Try another spelling, a variety, or the name a store uses.</CommandEmpty> : null}
            {products.length ? (
              <CommandGroup heading={debounced ? "Matches" : "Most sellers"}>
                {products.map((product) => {
                  const aliases = product.aliases.filter((alias) => alias.toLowerCase() !== product.label.toLowerCase()).slice(0, 3);
                  return (
                    <CommandItem className="gap-2.5" key={product.id} onSelect={() => choose(product)} value={product.id}>
                      <ProductImage id={product.id} label={product.label} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{product.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {product.category}
                          {product.varieties.length > 1 ? ` · ${product.varieties.length} varieties` : ""}
                          {aliases.length ? ` · also ${aliases.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{product.sellers ? `${product.sellers} sellers` : "no prices yet"}</span>
                      {selected?.id === product.id ? <RiCheckLine className="size-4 text-primary" /> : <span className="size-4" />}
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
