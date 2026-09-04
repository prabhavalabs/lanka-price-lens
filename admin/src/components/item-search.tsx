import { RiCheckLine, RiSearchLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api, type ExplorerItem } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Searches the warehouse's items by any label a source uses for them ("eggs",
 * "bandakka", "B'Onion Imported"). Results come from the API so every alias is
 * searchable without shipping the whole vocabulary to the browser.
 */
export function ItemSearch({ selected, onSelect, className }: { selected: ExplorerItem | null; onSelect: (item: ExplorerItem) => void; className?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 180).trim();
  const results = useQuery({
    queryKey: ["explorer-search", debounced],
    queryFn: ({ signal }) => api<ExplorerItem[]>(`/v1/admin/explorer/search?${new URLSearchParams({ q: debounced, limit: "20" })}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: open,
  });
  const items = results.data ?? [];
  // cmdk only auto-highlights the first row when it filters itself; with server results the highlight is kept in sync by hand.
  const firstValue = items[0]?.id ?? "";
  const [highlighted, setHighlighted] = useState(firstValue);
  useEffect(() => { setHighlighted(firstValue); }, [firstValue, debounced]);
  const choose = (item: ExplorerItem) => {
    onSelect(item);
    setOpen(false);
  };

  return (
    <Popover onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }} open={open}>
      <PopoverTrigger asChild>
        <Button aria-expanded={open} aria-label="Search for an item" className={cn("h-9 w-full justify-start gap-2 pl-1.5 pr-2.5 font-normal lg:w-96", className)} role="combobox" variant="outline">
          {selected ? <ProductImage id={selected.product_id} label={selected.display} size="xs" /> : <span aria-hidden className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground"><RiSearchLine className="size-3.5" /></span>}
          <span className="flex-1 truncate text-left text-sm">{selected ? selected.display : "Search an item, for example eggs, carrot, or samba rice"}</span>
          {selected ? <span className="font-mono text-[10px] text-muted-foreground">{selected.markets} sellers</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-96 p-0">
        <Command onValueChange={setHighlighted} shouldFilter={false} value={highlighted}>
          <CommandInput autoFocus onValueChange={setQuery} placeholder="Type an item name in any spelling…" value={query} />
          <CommandList className="max-h-96">
            {results.isPending && !items.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</p> : null}
            {results.isError ? <p className="px-3 py-6 text-center text-sm text-destructive">{results.error.message}</p> : null}
            {!results.isPending && !items.length ? <CommandEmpty>Nothing matches “{debounced}”. Try another spelling, a variety, or the name a store uses.</CommandEmpty> : null}
            {items.length ? (
              <CommandGroup heading={debounced ? "Matches" : "Most sellers"}>
                {items.map((item) => (
                  <CommandItem className="gap-2.5" key={item.id} onSelect={() => choose(item)} value={item.id}>
                    <ProductImage id={item.product_id} label={item.display} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.display}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.category}
                        {item.aliases.length ? ` · also ${item.aliases.filter((alias) => alias.toLowerCase() !== item.label.toLowerCase()).slice(0, 3).join(", ")}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.markets ? `${item.markets} sellers` : "no prices yet"}</span>
                    {selected?.id === item.id ? <RiCheckLine className="size-4 text-primary" /> : <span className="size-4" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
