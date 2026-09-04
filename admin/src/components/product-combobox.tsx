import { RiCheckLine, RiExpandUpDownLine } from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";

import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { compactNumber, rupees } from "@/components/charts";
import { fuzzySearch } from "@/lib/fuzzy";
import type { InsightsProduct, InsightsVariety } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ProductSelection = { product: string; item: string };

const popularCount = 8;

export function ProductCombobox({ products, varieties, productId, itemId, onSelect, loading = false, className }: {
  /** Products sorted by observation count, as the insights API returns them. */
  products: InsightsProduct[];
  varieties: InsightsVariety[];
  productId: string;
  itemId: string;
  onSelect: (selection: ProductSelection) => void;
  loading?: boolean;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 120);
  const selectedProduct = products.find((product) => product.id === productId) ?? products[0];
  const selectedVariety = varieties.find((variety) => variety.id === itemId);
  const varietyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const variety of varieties) counts.set(variety.product_id, (counts.get(variety.product_id) ?? 0) + 1);
    return counts;
  }, [varieties]);
  // Only products with more than one variety get variety rows; single-variety items would duplicate the product row.
  const searchableVarieties = useMemo(() => varieties.filter((variety) => (varietyCounts.get(variety.product_id) ?? 0) > 1), [varieties, varietyCounts]);
  const searching = debounced.trim().length > 0;
  const productResults = useMemo(() => fuzzySearch(debounced, products, (product) => [product.label, product.category], 8), [debounced, products]);
  const varietyResults = useMemo(() => fuzzySearch(debounced, searchableVarieties, (variety) => [variety.label, variety.label.split(" — ").at(-1) ?? "", variety.category], 6), [debounced, searchableVarieties]);
  // cmdk only auto-highlights the first row when it does the filtering itself; with our own
  // fuzzy results we keep the highlight controlled so Enter always picks the top match.
  const firstValue = searching ? productResults[0]?.item.id ?? varietyResults[0]?.item.id ?? "" : products[0]?.id ?? "";
  const [highlighted, setHighlighted] = useState(firstValue);
  useEffect(() => { setHighlighted(firstValue); }, [firstValue, debounced]);
  const choose = (selection: ProductSelection) => {
    onSelect(selection);
    setOpen(false);
  };
  const shortVariety = (variety: InsightsVariety) => variety.label.replace(`${products.find((product) => product.id === variety.product_id)?.label ?? ""} — `, "");

  return (
    <Popover onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }} open={open}>
      <PopoverTrigger asChild>
        <Button aria-expanded={open} aria-label="Choose a product" className={cn("h-9 w-full justify-start gap-2 pl-1.5 pr-2.5 font-normal lg:w-80", className)} role="combobox" variant="outline">
          {selectedProduct ? <ProductImage id={selectedProduct.id} label={selectedProduct.label} size="xs" /> : <span aria-hidden className="size-6 rounded-md bg-muted" />}
          <span className="flex-1 truncate text-left text-sm">
            {loading && !selectedProduct ? "Loading products…" : selectedProduct?.label ?? "Choose a product"}
            {selectedVariety ? <span className="text-muted-foreground"> · {shortVariety(selectedVariety)}</span> : null}
          </span>
          <RiExpandUpDownLine className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-80 p-0">
        <Command onValueChange={setHighlighted} shouldFilter={false} value={highlighted}>
          <CommandInput autoFocus onValueChange={setQuery} placeholder="Search products or varieties…" value={query} />
          <CommandList className="max-h-80">
            {searching ? (
              <>
                <CommandEmpty>Nothing matches “{debounced.trim()}”. Try another spelling or a category such as fruit.</CommandEmpty>
                {productResults.length ? (
                  <CommandGroup heading="Products">
                    {productResults.map(({ item: product }) => (
                      <ProductRow key={product.id} onSelect={() => choose({ product: product.id, item: "" })} product={product} selected={product.id === productId && !itemId} varieties={varietyCounts.get(product.id) ?? 1} />
                    ))}
                  </CommandGroup>
                ) : null}
                {varietyResults.length ? (
                  <CommandGroup heading="Varieties">
                    {varietyResults.map(({ item: variety }) => (
                      <CommandItem className="gap-2.5" key={variety.id} onSelect={() => choose({ product: variety.product_id, item: variety.id })} value={variety.id}>
                        <ProductImage id={variety.product_id} label={variety.label} size="xs" />
                        <span className="flex-1 truncate">{variety.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{rupees(variety.average)} avg</span>
                        {variety.id === itemId ? <RiCheckLine className="size-4 text-primary" /> : <span className="size-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            ) : (
              <>
                <CommandGroup heading="Most data">
                  {products.slice(0, popularCount).map((product) => (
                    <ProductRow key={product.id} onSelect={() => choose({ product: product.id, item: "" })} product={product} selected={product.id === productId && !itemId} varieties={varietyCounts.get(product.id) ?? 1} />
                  ))}
                </CommandGroup>
                <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Type to search all {products.length} products and {searchableVarieties.length} varieties.</p>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProductRow({ product, selected, varieties, onSelect }: { product: InsightsProduct; selected: boolean; varieties: number; onSelect: () => void }) {
  return (
    <CommandItem className="gap-2.5" onSelect={onSelect} value={product.id}>
      <ProductImage id={product.id} label={product.label} size="xs" />
      <span className="flex-1 truncate">{product.label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{varieties > 1 ? `${varieties} varieties · ` : ""}{compactNumber.format(product.observations)}</span>
      {selected ? <RiCheckLine className="size-4 text-primary" /> : <span className="size-4" />}
    </CommandItem>
  );
}
