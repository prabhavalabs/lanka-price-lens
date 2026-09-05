import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { ProductImage } from "@/components/product-image";
import { SearchBox } from "@/components/search-box";
import { SellerMark } from "@/components/seller-mark";
import { ShareButtons } from "@/components/share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchBasket, type BasketProduct, type Group } from "@/lib/api";
import { useBasket } from "@/lib/basket";
import { groupLabel, relativeDay, rupees, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type StoreTotal = { market_id: string; market_label: string; group: Group; total: number; covered: number; missing: string[]; observed_on: string };

/**
 * The shopper's list priced at every seller: which supermarket or market comes out cheapest for the
 * whole basket, how much of the list each one carries, and what it would cost there today.
 */
export function BasketPage() {
  const basket = useBasket();
  const ids = basket.lines.map((line) => line.id);
  const priced = useQuery({ queryKey: ["basket", ids.join(",")], queryFn: () => fetchBasket(ids), enabled: ids.length > 0 });
  const products = useMemo(() => new Map((priced.data ?? []).map((product) => [product.id, product])), [priced.data]);
  const totals = useMemo(() => totalsFor(basket.lines, products), [basket.lines, products]);
  const best = totals.find((store) => store.covered === basket.lines.length) ?? totals[0];
  const shareText = best
    ? `My basket (${basket.lines.length} items) is cheapest at ${sellerName(best.market_label)}: ${rupees(best.total)} today. ${totals.slice(1, 3).map((store) => `${sellerName(store.market_label)} ${rupees(store.total)}`).join(", ")}`
    : "My shopping basket on PriceLens";

  if (!basket.lines.length) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-8 text-center">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Your basket</h1>
        <p className="text-muted-foreground">Add the things you buy every week and see which store comes out cheapest for the whole list, today.</p>
        <SearchBox className="mx-auto max-w-md" />
        <p className="text-sm text-muted-foreground">Or tap the <RiAddLine className="inline size-4 align-text-bottom" /> on any product on the <Link to="/" className="underline">price board</Link>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Your basket</h1>
          <p className="mt-1 text-sm text-muted-foreground">{basket.lines.length} {basket.lines.length === 1 ? "item" : "items"} · priced at every seller with today's observations. Quantities are in the unit each price is quoted in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ShareButtons title="My basket on PriceLens" text={shareText} />
          <Button onClick={basket.clear} size="sm" variant="ghost"><RiDeleteBinLine className="size-4" />Clear</Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">Where it costs least</h2><p className="text-xs text-muted-foreground">Stores that carry the whole list first, then by total.</p></div>
            {priced.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : null}
            {priced.isError ? <p className="p-4 text-sm text-destructive">{priced.error.message}</p> : null}
            {priced.data ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seller</TableHead>
                    <TableHead className="hidden sm:table-cell">Carries</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.map((store, index) => (
                    <TableRow key={`${store.market_id}|${store.group}`} className={cn(index === 0 && "bg-primary/5")}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <SellerMark marketId={store.market_id} label={store.market_label} type={marketType(store.group)} size="sm" />
                          <div>
                            <p className="flex items-center gap-2 font-medium">{sellerName(store.market_label)}{index === 0 ? <Badge className="text-[10px]" variant="default">cheapest</Badge> : null}</p>
                            <p className="text-[11px] text-muted-foreground">{groupLabel(store.group)} · {relativeDay(store.observed_on)}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="tabular">{store.covered}/{basket.lines.length}</span>
                        {store.missing.length ? <span className="block max-w-56 truncate text-[11px] text-muted-foreground" title={store.missing.join(", ")}>missing {store.missing.join(", ")}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold tabular">{rupees(store.total)}</p>
                        {store.covered < basket.lines.length ? <p className="text-[11px] text-muted-foreground">{store.covered} of {basket.lines.length} items</p> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3"><h2 className="font-heading text-lg font-semibold">Your list</h2></div>
            <ul className="divide-y">
              {basket.lines.map((line) => {
                const product = products.get(line.id);
                const unit = product?.sellers[0]?.unit;
                return (
                  <li key={line.id} className="flex items-center gap-3 px-4 py-2.5">
                    <ProductImage id={line.id} label={line.label} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/p/${line.id}`} className="block truncate text-sm font-medium no-underline hover:text-primary">{product?.label ?? line.label}</Link>
                      <p className="text-[11px] text-muted-foreground">{product ? `${product.sellers.length} sellers${unit ? ` · ${unitLabel(unit)}` : ""}` : priced.isPending ? "pricing…" : "no published price yet"}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button aria-label="Less" onClick={() => basket.setQuantity(line.id, line.quantity - 1)} size="icon-sm" variant="outline"><RiSubtractLine className="size-3.5" /></Button>
                      <span className="w-6 text-center text-sm tabular">{line.quantity}</span>
                      <Button aria-label="More" onClick={() => basket.setQuantity(line.id, line.quantity + 1)} size="icon-sm" variant="outline"><RiAddLine className="size-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t p-3"><SearchBox /></div>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">A seller's total uses its average price for each item; supermarket items pool the store's product labels. Sellers are shown when they carry at least one item on the list with a price from the last {staleAfterDays} days.</p>
    </div>
  );
}

/** Sellers whose newest price is older than this many days are not totalled: a December price says nothing about today's shop. */
const staleAfterDays = 30;

function totalsFor(lines: Array<{ id: string; label: string; quantity: number }>, products: Map<string, BasketProduct>): StoreTotal[] {
  const stores = new Map<string, StoreTotal>();
  const newest = [...products.values()].flatMap((product) => product.sellers.map((seller) => seller.observed_on)).sort().at(-1);
  const cutoff = newest ? new Date(Date.parse(newest) - staleAfterDays * 86_400_000).toISOString().slice(0, 10) : "";
  const fresh = (observedOn: string) => observedOn >= cutoff;
  for (const line of lines) {
    const product = products.get(line.id);
    for (const seller of (product?.sellers ?? []).filter((candidate) => fresh(candidate.observed_on))) {
      const key = `${seller.market_id}|${seller.group}`;
      const store = stores.get(key) ?? { market_id: seller.market_id, market_label: seller.market_label, group: seller.group, total: 0, covered: 0, missing: [], observed_on: seller.observed_on };
      store.total += seller.mid * line.quantity;
      store.covered += 1;
      if (seller.observed_on < store.observed_on) store.observed_on = seller.observed_on;
      stores.set(key, store);
    }
  }
  for (const store of stores.values()) {
    store.missing = lines.filter((line) => !(products.get(line.id)?.sellers ?? []).some((seller) => fresh(seller.observed_on) && `${seller.market_id}|${seller.group}` === `${store.market_id}|${store.group}`)).map((line) => products.get(line.id)?.label ?? line.label);
    store.total = Math.round(store.total * 100) / 100;
  }
  return [...stores.values()].sort((left, right) => right.covered - left.covered || left.total - right.total);
}

function marketType(group: Group): string {
  return group === "retail_market" ? "retail_market" : group === "supermarket" ? "online_store" : "wholesale_market";
}

function sellerName(label: string): string {
  return label.replace(/\s*\((retail|wholesale)\)\s*$/iu, "");
}
