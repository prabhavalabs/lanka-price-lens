import { RiArrowDownLine, RiArrowUpLine, RiCalendarLine, RiLineChartLine, RiMapPin2Line, RiPulseLine, RiScales3Line, RiShoppingBasket2Line } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { BasketIndexChart, compactNumber, formatDay, formatMonth, MarketCoverageChart, MarketPriceChart, PriceTrendChart, rupees, StatTile, wholeNumber } from "@/components/charts";
import { PageFrame } from "@/components/data-display";
import { DateRangeControl, describeRange } from "@/components/date-range-control";
import { ProductCombobox } from "@/components/product-combobox";
import { ProductImage } from "@/components/product-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, priceRangePresets, rangeQuery, type BasketIndex, type BasketMover, type Insights, type InsightsProduct, type PriceChange, type PriceRangePreset, type PriceSeries, type RangeSelection } from "@/lib/api";
import { cn } from "@/lib/utils";

const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

function readSelection(parameters: URLSearchParams): RangeSelection {
  const from = parameters.get("from") ?? "";
  const to = parameters.get("to") ?? "";
  if (isoDate.test(from) && isoDate.test(to) && from <= to) return { from, to };
  const days = Number(parameters.get("days") ?? 90);
  return { preset: priceRangePresets.includes(days as PriceRangePreset) ? (days as PriceRangePreset) : 90 };
}

const percent = (value: number) => `${Math.abs(value).toFixed(1)}%`;

export function InsightsPage() {
  const [parameters, setParameters] = useSearchParams();
  const selection = readSelection(parameters);
  const product = (parameters.get("product") ?? "").slice(0, 100);
  const item = (parameters.get("item") ?? "").slice(0, 100);
  const query = rangeQuery(selection);
  const insights = useQuery({ queryKey: ["insights"], queryFn: ({ signal }) => api<Insights>("/v1/admin/insights", { signal }), staleTime: 60_000 });
  const series = useQuery({
    queryKey: ["price-series", product, item, query.toString()],
    queryFn: ({ signal }) => api<PriceSeries>(`/v1/admin/insights/prices?${new URLSearchParams([...(product ? [["product", product]] : []), ...(item ? [["item", item]] : []), ...query])}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const basket = useQuery({
    queryKey: ["basket-index", query.toString()],
    queryFn: ({ signal }) => api<BasketIndex>(`/v1/admin/insights/basket?${query}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(parameters);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParameters(next, { replace: true });
  };
  const selectRange = (next: RangeSelection) => update("preset" in next ? { days: String(next.preset), from: "", to: "" } : { days: "", from: next.from, to: next.to });
  const products = insights.data?.products ?? [];
  const selected = series.data?.product.id ?? product;
  const data = series.data;
  const varieties = data?.varieties ?? [];
  const subject = data ? (data.variety ? data.variety.label : varieties.length > 1 ? `${data.product.label} (all varieties)` : data.product.label) : "";
  const points = data?.points ?? [];
  const latest = data?.latest ?? null;
  const unit = data?.unit ? `/${data.unit}` : "";
  const cheapest = data?.by_market.at(-1) ?? null;
  const priciest = data?.by_market[0] ?? null;
  const fading = series.isPlaceholderData ? "opacity-60" : "";
  const subjectKey = `${data?.product.id ?? ""}:${data?.variety?.id ?? ""}:${data?.range.from ?? ""}:${data?.range.to ?? ""}`;
  const volatility = data?.volatility_pct ?? null;
  const volatilityLabel = volatility === null ? "Not enough data" : volatility < 5 ? "Steady" : volatility < 12 ? "Moderate swings" : "Volatile";

  return (
    <PageFrame
      description="Daily HARTI wholesale prices averaged across the monitored markets. Pick a product and a period; every chart and figure below follows the same selection."
      eyebrow="Intelligence"
      title="Wholesale price insights"
    >
      <Card size="sm">
        <CardContent className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ProductCombobox itemId={data?.variety?.id ?? item} loading={insights.isPending} onSelect={(next) => update({ product: next.product, item: next.item })} productId={selected} products={products} varieties={insights.data?.varieties ?? []} />
          <Select disabled={varieties.length <= 1} onValueChange={(value) => update({ item: value === "all" ? "" : value })} value={varieties.length <= 1 ? "all" : data?.variety?.id ?? "all"}>
            <SelectTrigger aria-label="Variety" className="w-full data-[size=default]:h-9 lg:w-56"><SelectValue placeholder="Variety">{varieties.length <= 1 ? "Single variety" : data?.variety ? data.variety.label.replace(`${data.product.label} — `, "") : "All varieties combined"}</SelectValue></SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectLabel>Variety</SelectLabel>
                <SelectItem value="all">All varieties combined</SelectItem>
                {varieties.map((variety) => <SelectItem key={variety.id} value={variety.id}>{variety.label.replace(`${data?.product.label} — `, "")}<span className="ml-1 font-mono text-[10px] text-muted-foreground">{rupees(variety.average)} avg</span></SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <DateRangeControl earliest={insights.data?.observations.first_observed} latest={insights.data?.observations.last_observed} onChange={selectRange} value={selection} />
          {insights.data?.observations.first_observed ? (
            <p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground lg:ml-auto"><RiCalendarLine className="size-3.5" />Data {formatDay(insights.data.observations.first_observed)} – {formatDay(insights.data.observations.last_observed ?? insights.data.observations.first_observed)}</p>
          ) : null}
        </CardContent>
      </Card>

      {data && varieties.length > 1 && !data.variety ? (
        <Alert className="items-center *:[svg]:self-center *:[svg]:translate-y-0">
          <RiScales3Line />
          <AlertTitle>{data.product.label} comes in {varieties.length} varieties with different prices</AlertTitle>
          <AlertDescription>The combined line averages {varieties.map((variety) => `${variety.label.replace(`${data.product.label} — `, "")} (${rupees(variety.average)})`).join(", ")}. A variety appearing or disappearing from the bulletins moves that average even when prices did not, so pick one variety for a cleaner picture.</AlertDescription>
        </Alert>
      ) : null}
      {series.isError ? <Alert variant="destructive"><AlertTitle>Price series unavailable</AlertTitle><AlertDescription>{series.error.message}</AlertDescription></Alert> : null}
      {insights.isError ? <Alert variant="destructive"><AlertTitle>Insights unavailable</AlertTitle><AlertDescription>{insights.error.message}</AlertDescription></Alert> : null}

      {series.isPending ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-28 rounded-xl" key={index} />)}</div>
      ) : data ? (
        <>
          <section aria-label="Latest prices" className={cn("grid gap-2.5 transition-opacity duration-300 animate-in fade-in-0 sm:grid-cols-2 xl:grid-cols-4", fading)} key={`latest-${subjectKey}`}>
            <StatTile
              delta={data.changes.d7 ? changeDelta(data.changes.d7) : null}
              hint={latest ? `${formatDay(latest.date)} · ${latest.markets} market${latest.markets === 1 ? "" : "s"} reporting` : "No prices in this period"}
              media={<ProductImage className="rounded-md" id={data.product.id} label={data.product.label} size="sm" />}
              label={`${subject} · latest average${unit}`}
              trend={points.slice(-14).map((point) => point.average)}
              value={latest ? rupees(latest.average) : "—"}
            />
            <StatTile hint={cheapest ? `${cheapest.label} · last 7 trading days` : "No market data"} icon={<RiArrowDownLine className="size-4" />} label="Cheapest market" value={cheapest ? rupees(cheapest.average) : "—"} />
            <StatTile hint={priciest ? `${priciest.label} · last 7 trading days` : "No market data"} icon={<RiArrowUpLine className="size-4" />} label="Dearest market" tone={priciest && cheapest && priciest.average > cheapest.average * 1.5 ? "warning" : "default"} value={priciest ? rupees(priciest.average) : "—"} />
            <StatTile hint={latest ? `${rupees(latest.low)} to ${rupees(latest.high)} on ${formatDay(latest.date)}` : "No market data"} icon={<RiScales3Line className="size-4" />} label="Gap between markets" value={latest ? rupees(latest.high - latest.low) : "—"} />
          </section>

          <section aria-label="Price movement" className={cn("grid gap-2.5 transition-opacity duration-300 animate-in fade-in-0 sm:grid-cols-2 xl:grid-cols-4", fading)} key={`movement-${subjectKey}`}>
            <ChangeTile change={data.changes.d30} label="30-day change" />
            <ChangeTile change={data.changes.d90} label="90-day change" />
            <StatTile
              hint={data.trend ? `${data.trend.change_pct_per_30_days > 0 ? "+" : ""}${data.trend.change_pct_per_30_days.toFixed(1)}% per month, fitted over ${data.trend.points} trading days` : "Needs at least five trading days"}
              icon={<RiLineChartLine className="size-4" />}
              label="Direction this period"
              tone={data.trend?.direction === "rising" ? "warning" : "default"}
              value={data.trend ? { rising: "Rising", falling: "Falling", stable: "Stable" }[data.trend.direction] : "—"}
            />
            <StatTile
              hint={volatility === null ? "Needs at least five trading days" : `Day-to-day swing of ${volatility.toFixed(1)}% around the 30-day average`}
              icon={<RiPulseLine className="size-4" />}
              label="Price stability"
              tone={volatility !== null && volatility >= 12 ? "warning" : "default"}
              value={volatilityLabel}
            />
          </section>

          <Card className={cn("transition-opacity duration-300", fading)}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <ProductImage id={data.product.id} label={data.product.label} size="sm" />
                <div className="min-w-0">
                  <CardTitle>{subject} · wholesale price</CardTitle>
                  <CardDescription className="mt-1">{describeRange(selection)} · average of every market's mid price per trading day, its 7-day average, and the lowest-to-highest market band.</CardDescription>
                </div>
              </div>
              <CardAction className="flex items-center gap-2">
                <Badge className="capitalize" variant="outline">{data.product.category}</Badge>
                <Badge variant="secondary">{points.length} trading days</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {points.length ? (
                <Tabs defaultValue="chart">
                  <TabsList aria-label="Trend views" className="mb-3" variant="line"><TabsTrigger value="chart">Chart</TabsTrigger><TabsTrigger value="months">By month</TabsTrigger><TabsTrigger value="table">Every day</TabsTrigger></TabsList>
                  <TabsContent value="chart"><PriceTrendChart points={points} unit={data.unit} /></TabsContent>
                  <TabsContent value="months">
                    <div className="overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Average</TableHead><TableHead className="text-right">Lowest</TableHead><TableHead className="text-right">Highest</TableHead><TableHead className="text-right">Trading days</TableHead><TableHead className="text-right">Change vs previous month</TableHead></TableRow></TableHeader>
                        <TableBody>{data.monthly.map((month) => <TableRow key={month.month}><TableCell className="font-medium">{formatMonth(month.month)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(month.average)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(month.low)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(month.high)}</TableCell><TableCell className="text-right font-mono tabular">{month.trading_days}</TableCell><TableCell className="text-right"><ChangeBadge value={month.change_pct} /></TableCell></TableRow>)}</TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  <TabsContent value="table">
                    <div className="max-h-72 overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Average</TableHead><TableHead className="text-right">7-day average</TableHead><TableHead className="text-right">Lowest</TableHead><TableHead className="text-right">Highest</TableHead><TableHead className="text-right">Index</TableHead><TableHead className="text-right">Markets</TableHead></TableRow></TableHeader>
                        <TableBody>{[...points].reverse().map((point) => <TableRow key={point.date}><TableCell>{formatDay(point.date)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(point.average)}</TableCell><TableCell className="text-right font-mono tabular text-muted-foreground">{point.moving_average === null ? "—" : rupees(point.moving_average)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(point.low)}</TableCell><TableCell className="text-right font-mono tabular">{rupees(point.high)}</TableCell><TableCell className="text-right font-mono tabular text-muted-foreground">{point.index === null ? "—" : point.index.toFixed(1)}</TableCell><TableCell className="text-right font-mono tabular">{point.markets}</TableCell></TableRow>)}</TableBody>
                      </Table>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">Index = 100 during the first trading week of the period.</p>
                  </TabsContent>
                </Tabs>
              ) : (
                <Empty className="min-h-64">
                  <EmptyHeader><EmptyMedia variant="icon"><RiLineChartLine /></EmptyMedia><EmptyTitle>No prices for {subject} in this period</EmptyTitle><EmptyDescription>Try a wider date range, or process more bulletins from the Knowledge Base.</EmptyDescription></EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card className={cn("transition-opacity duration-300", basket.isPlaceholderData && "opacity-60")}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary"><RiShoppingBasket2Line className="size-4.5" /></span>
            <div>
              <CardTitle>All-produce basket · {describeRange(selection)}</CardTitle>
              <CardDescription className="mt-1">One number for the whole market: every variety's price relative to the first trading week of the period (= 100), combined equally. Above 100 means produce got dearer overall; below 100, cheaper. Each variety is indexed on its own, so a variety dropping out of the bulletins does not move the number.</CardDescription>
            </div>
          </div>
          {basket.data ? <CardAction><Badge variant="outline">{basket.data.products_included} varieties</Badge></CardAction> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className={cn("grid gap-2.5 sm:grid-cols-2", basket.data?.change_pct_30d === null || basket.data?.change_pct_30d === undefined ? "xl:grid-cols-3" : "xl:grid-cols-4")}>
            <BasketFigure hint={basket.data?.latest ? `on ${formatDay(basket.data.latest.date)} · 100 = first week of the period` : "—"} label="Basket index now" value={basket.data?.latest ? basket.data.latest.index.toFixed(1) : "—"} />
            <BasketFigure change={basket.data?.change_pct_7d ?? null} hint="produce prices overall, week on week" label="Last 7 days" />
            {basket.data?.change_pct_30d === null || basket.data?.change_pct_30d === undefined ? null : <BasketFigure change={basket.data.change_pct_30d} hint="produce prices overall" label="Last 30 days" />}
            <BasketFigure change={basket.data?.change_pct_window ?? null} hint="since the start of the period" label="Whole period" />
          </div>
          {basket.isPending ? <Skeleton className="h-52 rounded-lg" /> : basket.data?.points.length ? <BasketIndexChart points={basket.data.points} /> : <Empty className="min-h-48"><EmptyHeader><EmptyTitle>Not enough products with prices in this period</EmptyTitle><EmptyDescription>The basket needs at least five products with five trading days each.</EmptyDescription></EmptyHeader></Empty>}
          <div className="grid gap-3 md:grid-cols-2">
            <MoverList emptyText="Nothing rose this period." items={basket.data?.risers ?? []} onSelect={(mover) => update({ product: mover.product_id, item: mover.item_id })} title="Rose the most" tone="up" />
            <MoverList emptyText="Nothing fell this period." items={basket.data?.fallers ?? []} onSelect={(mover) => update({ product: mover.product_id, item: mover.item_id })} title="Fell the most" tone="down" />
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 xl:grid-cols-2">
        <Card className={cn("transition-opacity duration-300", fading)}>
          <CardHeader>
            <CardTitle>Price by market</CardTitle>
            <CardDescription>Where {data?.product.label ?? "this product"} was dearest and cheapest over the last seven trading days.</CardDescription>
            <CardAction><RiMapPin2Line className="size-4 text-muted-foreground" /></CardAction>
          </CardHeader>
          <CardContent>
            {series.isPending ? <Skeleton className="h-52 rounded-lg" /> : data?.by_market.length ? <MarketPriceChart markets={data.by_market} unit={data.unit} /> : <Empty className="min-h-48"><EmptyHeader><EmptyTitle>No market prices in the last week</EmptyTitle><EmptyDescription>The latest bulletins for this product have not been processed yet.</EmptyDescription></EmptyHeader></Empty>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How much data each market contributes</CardTitle>
            <CardDescription>Price rows and distinct products captured per market across the whole archive.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.isPending ? <Skeleton className="h-52 rounded-lg" /> : insights.data?.markets.length ? <MarketCoverageChart markets={insights.data.markets} /> : <Empty className="min-h-48"><EmptyHeader><EmptyTitle>No markets recorded</EmptyTitle></EmptyHeader></Empty>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>All products</CardTitle>
          <CardDescription>Every product with wholesale prices in the database. Click a row to explore it.</CardDescription>
          <CardAction><Badge variant="outline">{products.length} products</Badge></CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {insights.isPending ? <Skeleton className="m-5 h-48 rounded-lg" /> : (
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Price rows</TableHead><TableHead className="text-right">Share of all rows</TableHead></TableRow></TableHeader>
                <TableBody>{products.map((item) => <ProductRow item={item} key={item.id} onSelect={() => update({ product: item.id })} selected={item.id === selected} total={insights.data?.observations.total ?? 0} />)}</TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageFrame>
  );
}

function changeDelta(change: NonNullable<PriceChange>) {
  return { value: change.change_pct, label: `since ${formatDay(change.from_date)} (${rupees(change.from_average)})`, upIsGood: false, format: percent };
}

function ChangeTile({ change, label }: { change: PriceChange; label: string }) {
  const tone = change && change.change_pct >= 10 ? "warning" : "default";
  return (
    <StatTile
      delta={change ? { value: change.change, label: `${rupees(change.from_average)} → ${rupees(change.from_average + change.change)}`, upIsGood: false, format: (value) => rupees(Math.abs(value)) } : null}
      hint={change ? `Compared with ${formatDay(change.from_date)}. Red means dearer for buyers.` : "Not enough history yet"}
      icon={change && change.change_pct > 0 ? <RiArrowUpLine className="size-4" /> : <RiArrowDownLine className="size-4" />}
      label={label}
      tone={tone}
      value={change ? `${change.change_pct > 0 ? "+" : change.change_pct < 0 ? "−" : ""}${percent(change.change_pct)}` : "—"}
    />
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">First month</span>;
  const Icon = value > 0 ? RiArrowUpLine : value < 0 ? RiArrowDownLine : null;
  return <Badge className={cn("font-mono tabular", value > 0 ? "border-destructive/30 bg-destructive/10 text-destructive" : value < 0 ? "border-primary/30 bg-primary/10 text-primary" : "")} variant="outline">{Icon ? <Icon data-icon="inline-start" /> : null}{value > 0 ? "+" : ""}{value.toFixed(1)}%</Badge>;
}

function BasketFigure({ label, value, change, hint }: { label: string; value?: string; change?: number | null; hint: string }) {
  const display = value ?? (change === null || change === undefined ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${percent(change)}`);
  const tone = change === null || change === undefined || value ? "text-foreground" : change > 0 ? "text-destructive" : change < 0 ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-lg border bg-background/40 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-heading text-xl font-semibold tracking-tight", tone)}>{display}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function MoverList({ title, items, tone, emptyText, onSelect }: { title: string; items: BasketMover[]; tone: "up" | "down"; emptyText: string; onSelect: (mover: BasketMover) => void }) {
  const textTone = tone === "up" ? "text-destructive" : "text-primary";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <p className="flex items-center gap-1.5 text-xs font-medium">{tone === "up" ? <RiArrowUpLine className={cn("size-3.5", textTone)} /> : <RiArrowDownLine className={cn("size-3.5", textTone)} />}{title}</p>
        <p className="text-[10px] text-muted-foreground">last 3 trading days vs first week</p>
      </div>
      {items.length ? (
        <ItemGroup className="gap-0 divide-y overflow-hidden rounded-lg border">
          {items.map((mover) => (
            <Item asChild className="rounded-none px-2.5 py-1.5 hover:bg-muted/60" key={mover.item_id} size="xs">
              <button className="w-full text-left" onClick={() => onSelect(mover)} type="button">
                <ItemMedia><ProductImage id={mover.product_id} label={mover.label} size="sm" /></ItemMedia>
                <ItemContent className="gap-0.5">
                  <ItemTitle className="truncate text-xs">{mover.label}</ItemTitle>
                  <ItemDescription className="font-mono text-[10px] tabular">{rupees(mover.from_average)} → {rupees(mover.to_average)} · {mover.days} trading days</ItemDescription>
                </ItemContent>
                <ItemActions><span className={cn("font-mono text-xs font-semibold tabular", textTone)}>{mover.change_pct > 0 ? "+" : "−"}{percent(mover.change_pct)}</span></ItemActions>
              </button>
            </Item>
          ))}
        </ItemGroup>
      ) : <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{emptyText}</p>}
    </div>
  );
}

function ProductRow({ item, onSelect, selected, total }: { item: InsightsProduct; onSelect: () => void; selected: boolean; total: number }) {
  return (
    <TableRow className={cn("cursor-pointer", selected && "bg-primary/5")} onClick={onSelect}>
      <TableCell><span className="flex items-center gap-2.5"><ProductImage id={item.id} label={item.label} size="sm" /><span className="font-medium">{item.label}</span>{selected ? <Badge variant="secondary">Selected</Badge> : null}</span></TableCell>
      <TableCell className="capitalize text-muted-foreground">{item.category}</TableCell>
      <TableCell className="text-right font-mono tabular">{wholeNumber.format(item.observations)}</TableCell>
      <TableCell className="text-right font-mono tabular text-muted-foreground">{total ? `${((item.observations / total) * 100).toFixed(1)}%` : "0%"}</TableCell>
    </TableRow>
  );
}

export function InfoTip({ children }: { children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><span className="cursor-help underline decoration-dotted underline-offset-4">?</span></TooltipTrigger><TooltipContent>{children}</TooltipContent></Tooltip>;
}
