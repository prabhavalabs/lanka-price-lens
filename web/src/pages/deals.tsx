import { RiArrowLeftSLine, RiArrowRightSLine, RiPriceTag3Line, RiSearchLine, RiVipCrownLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ErrorState } from "@/components/error-state";
import { SellerMark } from "@/components/seller-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchOffers, type Offer } from "@/lib/api";
import { relativeDay, rupees, unitLabel } from "@/lib/format";
import { labelWords, packWords } from "@/lib/offers";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";

const pageSize = 48;

/**
 * What each supermarket itself marks down today, in the store's own wording: the offer price,
 * the store's regular price struck through, the cut, and who the price is for. Filters live in
 * the address, so a view can be shared; the search waits for a pause before it asks the server.
 */
export function DealsPage() {
  usePageTitle("Supermarket offers today · PriceLens");
  const [params, setParams] = useSearchParams();
  const market = params.get("store") ?? "";
  const audience = params.get("for") === "everyone" || params.get("for") === "members" ? (params.get("for") as "everyone" | "members") : "";
  const catalogue = params.get("catalogue") === "1";
  const query = (params.get("q") ?? "").trim();
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [typed, setTyped] = useState(query);
  useEffect(() => setTyped(query), [query]);
  useEffect(() => {
    if (typed.trim() === query) return;
    const timer = window.setTimeout(() => setParams(withParams(params, { q: typed.trim(), page: "" }), { replace: true }), 350);
    return () => window.clearTimeout(timer);
  }, [typed, query, params, setParams]);

  const offers = useQuery({
    queryKey: ["offers", { market, audience, catalogue, query, page }],
    queryFn: ({ signal }) => fetchOffers({ market, audience, catalogue, q: query, page, pageSize }, signal),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  // The store chips keep their counts while a filter narrows the list, so they come from the unfiltered first page.
  const stores = useQuery({ queryKey: ["offers", "stores"], queryFn: ({ signal }) => fetchOffers({ pageSize: 1 }, signal), staleTime: 5 * 60_000 });
  // The stores mark down their whole range; on the first, unfiltered page the food this site tracks leads.
  const unfiltered = !market && !audience && !catalogue && !query && page === 1;
  const tracked = useQuery({ queryKey: ["offers", "tracked"], queryFn: ({ signal }) => fetchOffers({ catalogue: true, pageSize: 6 }, signal), staleTime: 5 * 60_000, enabled: unfiltered });

  if (offers.isError && !offers.data) return <ErrorState error={offers.error} onRetry={() => void offers.refetch()} retrying={offers.isFetching} />;
  const data = offers.data;
  const storeList = stores.data?.stores ?? data?.stores ?? [];
  const everything = storeList.reduce((sum, store) => sum + store.offers, 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const set = (changes: Record<string, string>) => setParams(withParams(params, { ...changes, page: changes.page ?? "" }));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Supermarket offers today</h1>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
          What the stores themselves mark down, against their own regular price, read from their online shelves every morning.
          {data?.as_of ? ` Latest ${relativeDay(data.as_of)}.` : ""}
        </p>
      </section>

      <section className="space-y-3">
        <ScrollArea className="-mx-4 sm:mx-0">
          <div className="flex gap-2 px-4 pb-3 sm:px-0">
            <Chip active={!market} onClick={() => set({ store: "" })}>{`All stores${everything ? ` · ${everything.toLocaleString("en-LK")}` : ""}`}</Chip>
            {storeList.map((store) => (
              <Chip active={market === store.market_id} key={store.market_id} onClick={() => set({ store: store.market_id })}>{`${store.market.replace(/ Online$/u, "")} · ${store.offers.toLocaleString("en-LK")}`}</Chip>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <RiSearchLine aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search the offers" className="pl-8" onChange={(event) => setTyped(event.target.value)} placeholder="Search the offers…" type="search" value={typed} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={catalogue} onClick={() => set({ catalogue: catalogue ? "" : "1" })}>Food we track</Chip>
            <Chip active={audience === "everyone"} onClick={() => set({ for: audience === "everyone" ? "" : "everyone" })}>For everyone</Chip>
            <Chip active={audience === "members"} onClick={() => set({ for: audience === "members" ? "" : "members" })}>Members' prices</Chip>
          </div>
        </div>
      </section>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <Skeleton className="h-28 rounded-xl" key={index} />)}</div>
      ) : data.items.length === 0 ? (
        <p className="py-12 text-center text-pretty text-muted-foreground">
          {storeList.length === 0 ? "No store offers have been read yet. They arrive with the morning's capture." : "No offer matches. Try another spelling or clear a filter."}
        </p>
      ) : (
        <>
          {unfiltered && tracked.data?.items.length ? (
            <section aria-labelledby="tracked-offers" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold leading-tight" id="tracked-offers">On food we track</h2>
                {tracked.data.total > tracked.data.items.length ? <Button className="h-auto p-0 text-sm" onClick={() => set({ catalogue: "1" })} type="button" variant="link">See all {tracked.data.total}</Button> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tracked.data.items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}</div>
              <h2 className="pt-3 font-heading text-lg font-semibold leading-tight">Every offer</h2>
            </section>
          ) : null}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {data.total.toLocaleString("en-LK")} {data.total === 1 ? "offer" : "offers"}, deepest cut first{pages > 1 ? ` · page ${data.page} of ${pages}` : ""}
          </p>
          <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", offers.isPlaceholderData && "opacity-60")}>
            {data.items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
          </div>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-center gap-2 pt-2">
              <Button disabled={page <= 1} onClick={() => set({ page: page - 1 > 1 ? String(page - 1) : "" })} size="sm" type="button" variant="outline"><RiArrowLeftSLine className="size-4" />Previous</Button>
              <span className="px-2 text-sm tabular-nums text-muted-foreground">{page} / {pages}</span>
              <Button disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} size="sm" type="button" variant="outline">Next<RiArrowRightSLine className="size-4" /></Button>
            </nav>
          ) : null}
        </>
      )}

      <p className="max-w-2xl text-pretty text-xs text-muted-foreground">
        Offers are the stores' own claims, read from keellssuper.com, cargillsonline.com, glomark.lk, and spar2u.lk: a regular price beside the price with the offer. Cargills compares with the pack's maximum retail price.
        A members' price needs the store's loyalty card. Card-only, promo-code, and buy-several offers are left out. Check the store before you travel for one.
      </p>
    </div>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const members = offer.audience === "members";
  const body = (
    <CardContent className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {offer.market_id ? <SellerMark label={offer.market} marketId={offer.market_id} type="online_store" /> : null}
          <span className="truncate text-xs text-muted-foreground">{offer.market.replace(/ Online$/u, "")}</span>
        </div>
        <Badge className="shrink-0 tabular-nums" variant="default">{Math.round(Math.abs(offer.pct))}% off</Badge>
      </div>
      <p className="line-clamp-2 text-pretty text-sm font-medium leading-snug">{labelWords(offer.label)}</p>
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-heading text-lg font-semibold tabular-nums">{rupees(offer.offer)}</span>
        <span className="text-sm tabular-nums text-muted-foreground line-through">{rupees(offer.list)}</span>
        <span className="text-xs text-muted-foreground">{packWords(offer.pack)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {members ? <Badge className="gap-1" variant="secondary"><RiVipCrownLine aria-hidden className="size-3" />{offer.offer_label ?? "Members"} price</Badge> : null}
        {members ? <span>Shelf price {rupees(offer.price)}</span> : null}
        {offer.max_quantity ? <span>Up to {offer.max_quantity} a shopper</span> : null}
        {offer.product ? <span className="inline-flex items-center gap-1 text-primary"><RiPriceTag3Line aria-hidden className="size-3" />{offer.product.label}: {rupees(offer.product.offer)} {unitLabel(offer.product.unit)}</span> : null}
      </div>
    </CardContent>
  );
  return (
    <Card className={cn("h-full gap-0 py-0", offer.product && "transition-colors hover:border-primary/40")}>
      {offer.product ? <Link aria-label={`${labelWords(offer.label)}: compare ${offer.product.label} across stores`} className="block h-full no-underline" to={`/p/${offer.product.id}`}>{body}</Link> : body}
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button aria-pressed={active} className={cn("shrink-0 rounded-full", active && "shadow-sm")} onClick={onClick} size="sm" type="button" variant={active ? "default" : "outline"}>{children}</Button>;
}

function withParams(params: URLSearchParams, changes: Record<string, string>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
