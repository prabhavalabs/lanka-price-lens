import { RiCheckLine, RiTimeLine } from "@remixicon/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { PriceChart, type ChartSeries } from "@/components/chart";
import { ProductImage } from "@/components/product-image";
import { QuantityControl } from "@/components/quantity";
import { SellerMark, sellerColor } from "@/components/seller-mark";
import { ShareButtons } from "@/components/share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchProduct, type Group, type Latest } from "@/lib/api";
import { ageLabel, categoryLabel, groupLabel, groupNotes, relativeDay, rupeeRange, rupees, shortDate, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const ranges = ["30", "90", "365"] as const;
type Range = (typeof ranges)[number];
const groupOrder: Group[] = ["retail_market", "supermarket", "wholesale"];
const defaultGroups: Group[] = ["retail_market", "supermarket"];

/**
 * One product: today's sellers by group with stale prices marked, and its history. The range and
 * the groups drawn are in the URL (`?days=90&groups=supermarket,wholesale`) so a view can be shared,
 * and changing them refreshes only the chart card.
 */
export function ProductPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const days: Range = (ranges as readonly string[]).includes(params.get("days") ?? "") ? (params.get("days") as Range) : "30";
  const shown = useMemo<Group[]>(() => {
    const requested = (params.get("groups") ?? "").split(",").filter((group): group is Group => (groupOrder as string[]).includes(group));
    return requested.length ? requested : defaultGroups;
  }, [params]);
  const update = (next: { days?: Range; groups?: Group[] }) => {
    const search = new URLSearchParams(params);
    if (next.days) {
      if (next.days === "30") search.delete("days");
      else search.set("days", next.days);
    }
    if (next.groups) {
      const same = next.groups.length === defaultGroups.length && defaultGroups.every((group) => next.groups!.includes(group));
      if (same) search.delete("groups");
      else search.set("groups", groupOrder.filter((group) => next.groups!.includes(group)).join(","));
    }
    setParams(search, { replace: true, preventScrollReset: true });
  };
  const detail = useQuery({ queryKey: ["product", id, days], queryFn: () => fetchProduct(id, Number(days)), enabled: Boolean(id), placeholderData: keepPreviousData });

  if (detail.isError) return <p className="py-16 text-center text-destructive">{detail.error.message}</p>;
  if (detail.isPending) return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  const data = detail.data;
  const groups = groupOrder.filter((group) => data.latest.some((row) => row.group === group));
  const chartSeries: ChartSeries[] = data.series
    .filter((series) => shown.includes(series.group))
    .map((series) => ({ key: series.key, label: seriesName(series.market_label, series.group), color: sellerColor(series.market_id), unit: series.unit, points: series.points }));
  const market = data.summary.find((entry) => entry.group === "retail_market");
  const supermarket = data.summary.find((entry) => entry.group === "supermarket");
  const wholesale = data.summary.find((entry) => entry.group === "wholesale");
  const shareText = [
    `${data.product.label} today:`,
    market?.lowest ? `open market from ${rupees(market.lowest.low)} ${unitLabel(market.lowest.unit)} (${sellerName(market.lowest)})` : null,
    supermarket?.lowest ? `supermarkets from ${rupees(supermarket.lowest.low)} ${unitLabel(supermarket.lowest.unit)} (${sellerName(supermarket.lowest)})` : null,
  ].filter(Boolean).join(" · ");
  const toggleGroup = (group: Group) => {
    const next = shown.includes(group) ? shown.filter((entry) => entry !== group) : [...shown, group];
    if (next.length) update({ groups: next });
  };

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground"><Link to="/" className="hover:text-primary">All prices</Link> › <Link to={`/?category=${data.product.category}`} className="hover:text-primary">{categoryLabel(data.product.category)}</Link></nav>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ProductImage id={data.product.id} label={data.product.label} size="xl" className="shadow-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{data.product.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.product.sellers} {data.product.sellers === 1 ? "seller" : "sellers"}
            {data.bounds.last ? ` · latest ${relativeDay(data.bounds.last)}` : ""}
          </p>
          {data.product.varieties.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {data.product.varieties.map((variety) => (
                <Badge key={variety.id} variant={data.selected.includes(variety.id) ? "secondary" : "outline"} className="text-[11px]">{variety.qualifier}</Badge>
              ))}
              <span className="text-[11px] text-muted-foreground">{data.product.comparison === "pooled" ? "varieties pooled" : "base variety shown"}</span>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <QuantityControl id={data.product.id} label={data.product.label} size="md" />
            <ShareButtons title={`${data.product.label} price today`} text={shareText} />
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard title="Open markets" summary={market} />
        <SummaryCard title="Supermarkets" summary={supermarket} note={data.markup_pct !== null ? `${data.markup_pct > 0 ? `${data.markup_pct}% above` : `${Math.abs(data.markup_pct)}% below`} wholesale` : undefined} />
        <SummaryCard title="Wholesale" summary={wholesale} />
      </section>

      {groups.map((group) => <SellerTable key={group} group={group} rows={data.latest.filter((row) => row.group === group)} />)}

      <Card id="history" className={cn("transition-opacity duration-300", detail.isFetching && "opacity-70")}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">Price history</h2>
            <Tabs onValueChange={(value) => update({ days: value as Range })} value={days}>
              <TabsList>
                <TabsTrigger value="30">30 days</TabsTrigger>
                <TabsTrigger value="90">90 days</TabsTrigger>
                <TabsTrigger value="365">1 year</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Seller groups">
            {groupOrder.filter((group) => data.series.some((series) => series.group === group)).map((group) => {
              const on = shown.includes(group);
              return (
                <Button aria-pressed={on} className={cn("gap-1.5 rounded-full", !on && "text-muted-foreground")} key={group} onClick={() => toggleGroup(group)} size="sm" variant={on ? "default" : "outline"}>
                  {on ? <RiCheckLine className="size-3.5" /> : null}{groupLabel(group)}
                </Button>
              );
            })}
          </div>
          <div className="mt-4" key={days}>
            <PriceChart series={chartSeries} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {data.series.filter((series) => shown.includes(series.group)).map((series) => (
              <li key={series.key} className="inline-flex items-center gap-1.5">
                <SellerMark marketId={series.market_id} label={series.market_label} type={series.market_type} size="xs" />
                {seriesName(series.market_label, series.group)}
                {series.change_pct !== null ? <span className={cn("tabular", series.change_pct > 0 ? "text-status-critical" : series.change_pct < 0 ? "text-status-good" : "")}>{series.change_pct > 0 ? "+" : ""}{series.change_pct}%</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Each line is a seller's daily average; supermarket lines pool the store's product labels for this item. Hover or tap a day for every seller's price on it. Prices are as observed on the day and may differ in store.</p>
        </CardContent>
      </Card>

      {data.product.aliases.length ? <p className="text-xs text-muted-foreground">Also listed as: {data.product.aliases.join(", ")}.</p> : null}
    </div>
  );
}

function SummaryCard({ title, summary, note }: { title: string; summary: { sellers: number; average: number | null; unit: string | null; lowest: Latest | null } | undefined; note?: string | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
        {summary?.lowest ? (
          <>
            <p className="mt-1 font-heading text-2xl font-semibold tabular">{rupees(summary.lowest.low)} <span className="text-sm font-normal text-muted-foreground">{unitLabel(summary.lowest.unit)}</span></p>
            <p className="text-xs text-muted-foreground">cheapest at {sellerName(summary.lowest)}{summary.average !== null ? ` · average ${rupees(summary.average)}` : ""} · {summary.sellers} {summary.sellers === 1 ? "seller" : "sellers"}</p>
            {summary.lowest.stale ? <p className="mt-1 inline-flex items-center gap-1 text-xs text-status-warning"><RiTimeLine className="size-3.5" />last seen {ageLabel(summary.lowest.observed_on)}</p> : null}
            {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No price yet</p>
        )}
      </CardContent>
    </Card>
  );
}

function SellerTable({ group, rows }: { group: Group; rows: Latest[] }) {
  const fresh = rows.filter((row) => !row.stale);
  const pool = fresh.length ? fresh : rows;
  const unit = mostCommonUnit(pool);
  const comparable = pool.filter((row) => row.unit === unit);
  const cheapest = comparable.length > 1 ? comparable.reduce((best, row) => (row.mid < best.mid ? row : best)) : null;
  const staleCount = rows.length - fresh.length;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3">
          <h2 className="font-heading text-lg font-semibold">{groupLabel(group)}</h2>
          <p className="text-xs text-muted-foreground">{groupNotes[group]}{staleCount ? ` ${staleCount} ${staleCount === 1 ? "seller has" : "sellers have"} not reported recently; those prices are shown for reference only.` : ""}</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seller</TableHead>
              <TableHead className="hidden sm:table-cell">Observed</TableHead>
              <TableHead className="text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...rows].sort((left, right) => Number(left.stale) - Number(right.stale) || left.mid - right.mid).map((row) => (
              <TableRow key={`${row.market_id}|${row.price_type}|${row.unit}`} className={cn(row.stale && "text-muted-foreground")}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <SellerMark className={cn(row.stale && "opacity-60 grayscale")} marketId={row.market_id} label={row.market_label} type={row.market_type} size="sm" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {sellerName(row)}
                        {cheapest && cheapest.market_id === row.market_id ? <Badge className="text-[10px]" variant="secondary">cheapest</Badge> : null}
                        {row.stale ? <Badge className="gap-1 border-status-warning/40 text-[10px] text-status-warning" variant="outline"><RiTimeLine className="size-3" />outdated</Badge> : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground sm:hidden">{observedLabel(row)}{row.varieties.length > 1 ? ` · ${row.varieties.join(", ")}` : ""}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {observedLabel(row)}
                  {row.products > 1 ? ` · ${row.products} products` : ""}
                  {row.varieties.length > 1 ? ` · ${row.varieties.join(", ")}` : ""}
                </TableCell>
                <TableCell className="text-right">
                  <p className={cn("font-medium tabular", row.stale && "line-through decoration-muted-foreground/50")}>{rupeeRange(row.low, row.high)}</p>
                  <p className="text-[11px] text-muted-foreground">{unitLabel(row.unit)}{row.low !== row.high ? ` · avg ${rupees(row.mid)}` : ""}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** "yesterday" for a fresh price; "25 Nov · 284 days ago" for one that has not moved in a while. */
function observedLabel(row: Latest): string {
  return row.stale ? `${shortDate(row.observed_on)} · ${ageLabel(row.observed_on)}` : relativeDay(row.observed_on);
}

/** The section already says which kind of price this is, so "Pettah (retail)" reads as "Pettah". */
export function sellerName(row: { market_label: string }): string {
  return row.market_label.replace(/\s*\((retail|wholesale)\)\s*$/iu, "");
}

function seriesName(label: string, group: Group): string {
  const plain = label.replace(/\s*\((retail|wholesale)\)\s*$/iu, "");
  return group === "retail_market" ? `${plain} market` : plain;
}

function mostCommonUnit(rows: Latest[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.unit, (counts.get(row.unit) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}
