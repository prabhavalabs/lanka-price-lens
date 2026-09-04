import { RiArrowDownLine, RiArrowUpLine, RiScales3Line, RiShoppingBasket2Line, RiStore2Line, RiTrophyLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { formatDay, MarketSeriesChart, maxChartSeries, rupees, StatTile } from "@/components/charts";
import { PageFrame } from "@/components/data-display";
import { DateRangeControl, describeRange } from "@/components/date-range-control";
import { ProductImage } from "@/components/product-image";
import { ProductSearch } from "@/components/product-search";
import { SellerMark } from "@/components/seller-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, priceRangePresets, rangeQuery, type ExplorerDetail, type ExplorerGroup, type ExplorerLatest, type ExplorerProduct, type ExplorerSeries, type PriceRangePreset, type RangeSelection } from "@/lib/api";
import { cn } from "@/lib/utils";

const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

function readSelection(parameters: URLSearchParams): RangeSelection {
  const from = parameters.get("from") ?? "";
  const to = parameters.get("to") ?? "";
  if (isoDate.test(from) && isoDate.test(to) && from <= to) return { from, to };
  const days = Number(parameters.get("days") ?? 90);
  return { preset: priceRangePresets.includes(days as PriceRangePreset) ? (days as PriceRangePreset) : 90 };
}

const groupCopy: Record<ExplorerGroup, { title: string; short: string; description: string }> = {
  wholesale: { title: "Wholesale markets", short: "Wholesale", description: "Economic centres and wholesale markets from the HARTI and Central Bank bulletins" },
  retail_market: { title: "Retail markets", short: "Retail markets", description: "Open-market retail prices from the Central Bank daily report and the DCS weekly survey" },
  supermarket: { title: "Supermarkets", short: "Supermarkets", description: "Online store shelf prices captured every morning" },
};
const groupIcon: Record<ExplorerGroup, typeof RiStore2Line> = { wholesale: RiScales3Line, retail_market: RiShoppingBasket2Line, supermarket: RiStore2Line };
const percent = (value: number) => `${Math.abs(value).toFixed(1)}%`;
const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

export function PriceExplorerPage() {
  const [parameters, setParameters] = useSearchParams();
  const selection = readSelection(parameters);
  const productId = (parameters.get("product") ?? "").slice(0, 120);
  const varieties = (parameters.get("varieties") ?? "").slice(0, 2000);
  const query = rangeQuery(selection);
  if (varieties) query.set("varieties", varieties);
  const detail = useQuery({
    queryKey: ["explorer-product", productId, query.toString()],
    queryFn: ({ signal }) => api<ExplorerDetail>(`/v1/admin/explorer/products/${encodeURIComponent(productId)}?${query}`, { signal }),
    enabled: Boolean(productId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(parameters);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParameters(next, { replace: true });
  };
  const selectRange = (next: RangeSelection) => update("preset" in next ? { days: String(next.preset), from: "", to: "" } : { days: "", from: next.from, to: next.to });
  const selectProduct = (product: ExplorerProduct) => update({ product: product.id, varieties: "" });
  const data = detail.data;
  const selected: ExplorerProduct | null = data?.product ?? null;
  const fading = detail.isPlaceholderData ? "opacity-60" : "";
  const wholesale = data?.summary.find((entry) => entry.group === "wholesale");
  const retail = data?.summary.find((entry) => entry.group === "retail_market");
  const supermarket = data?.summary.find((entry) => entry.group === "supermarket");
  const groups = (["wholesale", "retail_market", "supermarket"] as const).map((group) => ({ group, series: data?.series.filter((entry) => entry.group === group) ?? [], latest: data?.latest.filter((entry) => entry.group === group) ?? [] }));
  const pooledVarieties = data ? data.selected.length : 0;
  const allSelected = data ? data.selected.length === data.product.varieties.length : false;

  return (
    <PageFrame
      description="Search any product and see what it costs today at wholesale markets, in open retail markets, and on each supermarket's shelf, with the trend for every seller over the period you choose."
      eyebrow="Intelligence"
      title="Price explorer"
    >
      <Card size="sm">
        <CardContent className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ProductSearch onSelect={selectProduct} selected={selected} />
          <DateRangeControl className="lg:ml-auto" earliest={data?.bounds.first} latest={data?.bounds.last} onChange={selectRange} value={selection} />
        </CardContent>
      </Card>

      {!productId ? (
        <Empty className="min-h-64">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RiStore2Line /></EmptyMedia>
            <EmptyTitle>Pick a product to explore</EmptyTitle>
            <EmptyDescription>Type a name in any spelling a bulletin or store uses. Try eggs, potato, red onion, samba, or dhal.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : detail.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-24 rounded-xl" key={index} />)}</div>
      ) : detail.isError ? (
        <Alert variant="destructive"><AlertTitle>Prices unavailable</AlertTitle><AlertDescription>{detail.error.message}</AlertDescription></Alert>
      ) : data ? (
        <div className={cn("flex flex-col gap-3.5 transition-opacity", fading)}>
          <div className="flex flex-wrap items-center gap-3">
            <ProductImage id={data.product.id} label={data.product.label} size="sm" />
            <div className="min-w-0">
              <h2 className="font-heading text-xl font-semibold tracking-tight">{data.product.label}</h2>
              <p className="text-xs text-muted-foreground">
                {data.product.category} · {plural(data.product.varieties.length, "variety", "varieties")} · {plural(data.latest.length, "seller")} · {describeRange(selection)}
                {data.product.aliases.length ? ` · also known as ${data.product.aliases.slice(0, 4).join(", ")}` : ""}
              </p>
            </div>
          </div>

          {data.product.varieties.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">{data.product.comparison === "pooled" ? "Varieties pooled per seller:" : "Different products under one name; compare one at a time:"}</span>
              <Button className="h-7 rounded-full px-3 text-xs" onClick={() => update({ varieties: "all" })} size="sm" variant={allSelected ? "default" : "outline"}>All varieties</Button>
              {data.product.varieties.map((variety) => {
                const active = !allSelected && data.selected.length === 1 && data.selected[0] === variety.id;
                return (
                  <Button className="h-7 rounded-full px-3 text-xs" key={variety.id} onClick={() => update({ varieties: variety.id })} size="sm" variant={active ? "default" : "outline"}>
                    {variety.qualifier}
                    <span className={cn("ml-1 font-mono text-[10px]", active ? "text-primary-foreground/70" : "text-muted-foreground")}>{variety.sellers}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[wholesale, retail, supermarket].map((summary) => summary ? (
              <StatTile
                hint={summary.average === null ? "No seller reports this product" : summary.lowest && summary.highest && summary.lowest.market_id !== summary.highest.market_id ? <>Lowest {summary.lowest.market_label} {rupees(summary.lowest.mid)} · highest {summary.highest.market_label} {rupees(summary.highest.mid)}</> : summary.lowest ? <>{summary.lowest.market_label} · {formatDay(summary.lowest.observed_on)}</> : null}
                icon={(() => { const Icon = groupIcon[summary.group]; return <Icon />; })()}
                key={summary.group}
                label={`${groupCopy[summary.group].short} · ${plural(summary.sellers, "seller")}`}
                value={summary.average === null ? "—" : `${rupees(summary.average)}${summary.unit ? `/${summary.unit}` : ""}`}
              />
            ) : null)}
            <StatTile
              hint={data.markup_pct === null ? "Needs wholesale and supermarket prices in the same unit" : "Supermarket average against the wholesale average, latest prices"}
              icon={<RiTrophyLine />}
              label="Shelf over wholesale"
              tone={data.markup_pct !== null && data.markup_pct > 100 ? "warning" : "default"}
              value={data.markup_pct === null ? "—" : `${data.markup_pct > 0 ? "+" : ""}${data.markup_pct.toFixed(1)}%`}
            />
          </div>

          <Card size="sm">
            <CardHeader>
              <CardTitle>How each seller prices it</CardTitle>
              <CardDescription>
                Latest price per seller{pooledVarieties > 1 ? `, pooling the ${pooledVarieties} varieties each seller reports` : ""}. A supermarket's price spans every brand and pack of the product on its shelf that day. Change compares the first and last day the seller reported within the selected period.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Seller</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Range that day</TableHead>
                    <TableHead>As of</TableHead>
                    <TableHead className="pr-4 text-right">Change over period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.flatMap(({ group, latest, series }) => {
                    const comparable = latest.filter((entry) => entry.unit === (data.summary.find((summary) => summary.group === group)?.unit ?? entry.unit));
                    const cheapest = comparable.length > 1 ? comparable.reduce((best, entry) => (entry.mid < best.mid ? entry : best)) : null;
                    return [...latest].sort((left, right) => left.mid - right.mid).map((entry) => <SellerRow cheapest={cheapest?.market_id === entry.market_id} entry={entry} key={`${entry.market_id}|${entry.price_type}|${entry.unit}`} pooled={pooledVarieties > 1} series={series.find((candidate) => candidate.market_id === entry.market_id && candidate.price_type === entry.price_type) ?? null} />);
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-3 xl:grid-cols-2">
            {groups.filter(({ series }) => series.length).map(({ group, series }) => {
              const units = [...new Set(series.map((entry) => entry.unit))];
              const unit = units.length === 1 ? units[0]! : null;
              const shown = unit ? series : series.filter((entry) => entry.unit === series[0]!.unit);
              return (
                <Card className={cn(group === "wholesale" && "xl:col-span-2")} key={group} size="sm">
                  <CardHeader>
                    <CardTitle>{groupCopy[group].title}</CardTitle>
                    <CardDescription>
                      {groupCopy[group].description}.{pooledVarieties > 1 ? " Each line is the seller's daily average across the pooled varieties." : ""}{shown.length > maxChartSeries ? ` Showing the ${maxChartSeries} sellers with the most days of data; the table above lists all ${shown.length}.` : ""}{units.length > 1 ? ` Only sellers priced per ${shown[0]!.unit} are drawn; others use a different unit.` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MarketSeriesChart series={shown} unit={shown[0]?.unit ?? unit} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {!data.series.length ? <Alert><AlertTitle>No prices in this period</AlertTitle><AlertDescription>Prices exist from {data.bounds.first ? formatDay(data.bounds.first) : "—"} to {data.bounds.last ? formatDay(data.bounds.last) : "—"}. Widen the period or choose another variety to see the trend.</AlertDescription></Alert> : null}
        </div>
      ) : null}
    </PageFrame>
  );
}

function SellerRow({ entry, series, cheapest, pooled }: { entry: ExplorerLatest; series: ExplorerSeries | null; cheapest: boolean; pooled: boolean }) {
  const change = series?.change_pct ?? null;
  const notes = [
    pooled && entry.varieties.length ? entry.varieties.join(" · ") : null,
    entry.products > 1 ? (entry.group === "supermarket" ? `${plural(entry.products, "product")} on the shelf` : plural(entry.products, "price")) : null,
  ].filter(Boolean);
  return (
    <TableRow>
      <TableCell className="pl-4 font-medium">
        <span className="flex items-center gap-2.5">
          <SellerMark label={entry.market_label} marketId={entry.market_id} type={entry.market_type} />
          <span className="min-w-0">
            <span className="block truncate">{entry.market_label}{cheapest ? <Badge className="ml-2" variant="secondary">Cheapest</Badge> : null}</span>
            {notes.length ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{notes.join(" · ")}</span> : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{groupCopy[entry.group].short}</TableCell>
      <TableCell className="text-right font-mono">{rupees(entry.mid)}<span className="text-muted-foreground">/{entry.unit}</span></TableCell>
      <TableCell className="text-right font-mono text-muted-foreground">{entry.low === entry.high ? "—" : `${rupees(entry.low)} – ${rupees(entry.high)}`}</TableCell>
      <TableCell className="text-muted-foreground">{formatDay(entry.observed_on)}</TableCell>
      <TableCell className="pr-4 text-right">
        {change === null ? <span className="text-muted-foreground">—</span> : (
          <span className={cn("inline-flex items-center gap-1 font-mono", change > 0 ? "text-amber-400" : change < 0 ? "text-primary" : "text-muted-foreground")}>
            {change > 0 ? <RiArrowUpLine className="size-3.5" /> : change < 0 ? <RiArrowDownLine className="size-3.5" /> : null}{percent(change)}
            <span className="text-[10px] text-muted-foreground">{series?.days} days</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
