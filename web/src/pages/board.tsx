import { RiArrowDownLine, RiArrowUpLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ProductImage } from "@/components/product-image";
import { QuantityControl } from "@/components/quantity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { fetchOverview, type GroupPrice, type ProductCard } from "@/lib/api";
import { useBasketLine } from "@/store/basket";
import { categoryLabel, changeLabel, groupLabel, relativeDay, rupeeRange, rupees, unitLabel } from "@/lib/format";
import { fuzzySearch } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

const categoryOrder = ["vegetable", "fruit", "grain", "pulse", "fish", "meat", "dairy", "other"];

/** The headline line of a card: what a shopper pays at the market, else at a supermarket, else wholesale. */
export function headlineOf(product: ProductCard): GroupPrice | undefined {
  return product.prices.find((price) => price.group === "retail_market") ?? product.prices.find((price) => price.group === "supermarket") ?? product.prices[0];
}

export function BoardPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const category = params.get("category") ?? "";
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  const products = overview.data?.products ?? [];

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))].sort((left, right) => rank(left) - rank(right)), [products]);
  const shown = useMemo(() => {
    const inCategory = category ? products.filter((product) => product.category === category) : products;
    if (!query) return inCategory;
    const index = inCategory.map((product) => ({ id: product.id, label: product.label, terms: [product.label_si ?? "", product.label_ta ?? ""].filter(Boolean), product }));
    return fuzzySearch(index, query, 60).map((match) => match.item.product);
  }, [products, category, query]);
  const movers = useMemo(() => {
    const scored = products
      .map((product) => ({ product, price: headlineOf(product) }))
      .filter((entry): entry is { product: ProductCard; price: GroupPrice } => Boolean(entry.price) && entry.price!.change_30d_pct !== null && Math.abs(entry.price!.change_30d_pct!) >= 5);
    const up = scored.filter((entry) => entry.price.change_30d_pct! > 0).sort((left, right) => right.price.change_30d_pct! - left.price.change_30d_pct!).slice(0, 4);
    const down = scored.filter((entry) => entry.price.change_30d_pct! < 0).sort((left, right) => left.price.change_30d_pct! - right.price.change_30d_pct!).slice(0, 4);
    return { up, down };
  }, [products]);

  if (overview.isError) return <p className="py-16 text-center text-destructive">Prices are not available right now. Please try again in a few minutes.</p>;
  if (overview.isPending) return <BoardSkeleton />;

  const data = overview.data;
  const supermarkets = data.sources.filter((source) => source.kind === "supermarket").length;
  const filtering = Boolean(query || category);
  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Food prices today</h1>
          <p className="mt-1 max-w-xl text-pretty text-sm text-muted-foreground sm:text-base">
            Open markets and supermarkets side by side, from official bulletins and store shelves.
            {data.as_of ? ` Latest observations ${relativeDay(data.as_of)}.` : ""}
          </p>
        </div>
        <dl className="flex gap-6 text-sm">
          <Stat label="Products" value={String(products.length)} />
          <Stat label="Supermarkets" value={String(supermarkets)} />
          <Stat label="Official sources" value={String(data.sources.length - supermarkets)} />
        </dl>
      </section>

      {!filtering && (movers.up.length || movers.down.length) ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <MoverCard title="Rising this month" tone="rise" entries={movers.up} />
          <MoverCard title="Falling this month" tone="fall" entries={movers.down} />
        </section>
      ) : null}

      <section className="space-y-4">
        <ScrollArea className="-mx-4 sm:mx-0">
          <div className="flex gap-2 px-4 pb-3 sm:px-0">
            <Chip active={!category} onClick={() => setParams(withParam(params, "category", ""))}>All</Chip>
            {categories.map((entry) => (
              <Chip key={entry} active={category === entry} onClick={() => setParams(withParam(params, "category", entry))}>{categoryLabel(entry)}</Chip>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        {query ? <p className="text-sm text-muted-foreground">{shown.length} {shown.length === 1 ? "result" : "results"} for “{query}” · <Link to={category ? `/?category=${category}` : "/"} className="underline">clear</Link></p> : null}
        {shown.length === 0 ? <p className="py-12 text-center text-muted-foreground">Nothing matches. Try another spelling or clear the filter.</p> : null}

        {filtering ? (
          <ProductGrid products={shown} />
        ) : (
          categories.map((entry) => {
            const inCategory = shown.filter((product) => product.category === entry);
            if (!inCategory.length) return null;
            return (
              <section key={entry} className="space-y-3">
                <CategoryHeader category={entry} products={inCategory} />
                <ProductGrid products={inCategory} />
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}

function rank(category: string): number {
  const index = categoryOrder.indexOf(category);
  return index < 0 ? categoryOrder.length : index;
}

function withParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="m-0 font-heading text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <Button className={cn("shrink-0 rounded-full", active && "shadow-sm")} onClick={onClick} size="sm" type="button" variant={active ? "default" : "outline"}>{children}</Button>
  );
}

function CategoryHeader({ category, products }: { category: string; products: ProductCard[] }) {
  const faces = products.slice(0, 4);
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {faces.map((product) => <ProductImage key={product.id} id={product.id} label={product.label} size="sm" className="ring-2 ring-background" />)}
      </div>
      <div>
        <h2 className="font-heading text-lg font-semibold leading-tight">{categoryLabel(category)}</h2>
        <p className="text-xs text-muted-foreground">{products.length} {products.length === 1 ? "product" : "products"}</p>
      </div>
      <Link to={`/?category=${category}`} className="ml-auto text-xs text-muted-foreground hover:text-primary">See all</Link>
    </div>
  );
}

function MoverCard({ title, tone, entries }: { title: string; tone: "rise" | "fall"; entries: Array<{ product: ProductCard; price: GroupPrice }> }) {
  if (!entries.length) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {tone === "rise" ? <RiArrowUpLine className="size-4 text-status-critical" /> : <RiArrowDownLine className="size-4 text-status-good" />}
          {title}
          <span className="font-normal text-muted-foreground">· 30 days</span>
        </h2>
        <ul className="mt-3 divide-y divide-border/60">
          {entries.map(({ product, price }) => (
            <li key={product.id}>
              <Link to={`/p/${product.id}`} className="flex items-center gap-3 py-2 no-underline">
                <ProductImage id={product.id} label={product.label} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{product.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{groupLabel(price.group)} · {rupees(price.mid)} {unitLabel(price.unit)}</span>
                </span>
                <span className={cn("text-sm font-semibold tabular-nums", tone === "rise" ? "text-status-critical" : "text-status-good")}>{changeLabel(price.change_30d_pct)?.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => <ProductTile key={product.id} product={product} />)}
    </div>
  );
}

function ProductTile({ product }: { product: ProductCard }) {
  const line = useBasketLine(product.id);
  const headline = headlineOf(product);
  const change = changeLabel(headline?.change_30d_pct ?? null);
  return (
    <Card className={cn("group relative overflow-hidden transition-all hover:border-primary/50", line && "border-primary/60 ring-2 ring-primary/30")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Link to={`/p/${product.id}`} className="shrink-0"><ProductImage id={product.id} label={product.label} size="lg" /></Link>
          <div className="min-w-0 flex-1">
            <Link to={`/p/${product.id}`} className="no-underline">
              <h3 className="truncate font-heading text-base font-semibold leading-tight hover:text-primary">{product.label}</h3>
            </Link>
            {product.label_si || product.label_ta ? <p className="truncate text-xs text-muted-foreground">{[product.label_si, product.label_ta].filter(Boolean).join(" · ")}</p> : null}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">{categoryLabel(product.category)}</Badge>
              {change ? <Badge className={cn("text-[10px]", change.direction === "rise" ? "bg-status-critical/10 text-status-critical" : change.direction === "fall" ? "bg-status-good/10 text-status-good" : "")} variant="outline" title="Change over 30 days">{change.text}</Badge> : null}
            </div>
          </div>
          <div className="shrink-0"><QuantityControl id={product.id} label={product.label} unit={headline?.unit ?? "kg"} /></div>
        </div>
        <dl className="mt-3 space-y-1.5">
          {product.prices.map((price) => <PriceLine key={price.group} price={price} />)}
        </dl>
      </CardContent>
    </Card>
  );
}

function PriceLine({ price }: { price: GroupPrice }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{groupLabel(price.group)}</dt>
      <dd className="m-0 text-right">
        <span className="font-medium tabular-nums">{rupeeRange(price.low, price.high)}</span>
        <span className="text-muted-foreground"> {unitLabel(price.unit)}</span>
        <span className="block text-[11px] text-muted-foreground">{price.sellers} {price.sellers === 1 ? "seller" : "sellers"} · {relativeDay(price.observed_on)}</span>
      </dd>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2"><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-96" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
      </div>
    </div>
  );
}
