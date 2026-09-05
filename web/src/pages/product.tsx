import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { palette, PriceChart, type ChartSeries } from "../components/chart.tsx";
import { fetchProduct, type Group, type Latest } from "../lib/api.ts";
import { categoryLabel, groupLabel, groupNotes, relativeDay, rupeeRange, rupees, unitLabel } from "../lib/format.ts";

const ranges = [30, 90, 365] as const;
const groupOrder: Group[] = ["retail_market", "supermarket", "wholesale"];

export function ProductPage() {
  const { id = "" } = useParams();
  const [days, setDays] = useState<(typeof ranges)[number]>(30);
  const [shown, setShown] = useState<Set<Group>>(new Set(["retail_market", "supermarket"]));
  const detail = useQuery({ queryKey: ["product", id, days], queryFn: () => fetchProduct(id, days), enabled: Boolean(id) });

  if (detail.isPending) return <p className="py-16 text-center text-ink-soft">Loading…</p>;
  if (detail.isError) return <p className="py-16 text-center text-rise">{detail.error.message}</p>;
  const data = detail.data;
  const groups = groupOrder.filter((group) => data.latest.some((row) => row.group === group));
  const chartSeries: ChartSeries[] = data.series
    .filter((series) => shown.has(series.group))
    .map((series, index) => ({ key: series.key, label: series.market_label.replace(/\s*\((retail|wholesale)\)\s*$/iu, series.group === "retail_market" ? " (market)" : ""), color: palette[index % palette.length]!, points: series.points }));
  const toggle = (group: Group) => setShown((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });

  return (
    <div className="space-y-6">
      <nav className="text-sm text-ink-soft"><Link to="/" className="hover:text-brand">All prices</Link> › {categoryLabel(data.product.category)}</nav>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{data.product.label}</h1>
        <p className="text-sm text-ink-soft">
          {data.product.sellers} {data.product.sellers === 1 ? "seller" : "sellers"}
          {data.bounds.last ? ` · latest ${relativeDay(data.bounds.last)}` : ""}
          {data.product.varieties.length > 1 ? ` · ${data.product.comparison === "pooled" ? "varieties pooled" : "shown by variety"}: ${data.product.varieties.filter((variety) => data.selected.includes(variety.id)).map((variety) => variety.qualifier).join(", ")}` : ""}
        </p>
        {data.markup_pct !== null ? <p className="mt-1 text-sm">Supermarkets average <strong>{data.markup_pct > 0 ? `${data.markup_pct}% above` : `${Math.abs(data.markup_pct)}% below`}</strong> the wholesale average.</p> : null}
      </header>

      {groups.map((group) => <SellerTable key={group} group={group} rows={data.latest.filter((row) => row.group === group)} />)}

      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Price history</h2>
          <div className="flex gap-1">
            {ranges.map((range) => (
              <button key={range} type="button" onClick={() => setDays(range)} className={`rounded-md px-2.5 py-1 text-sm ${days === range ? "bg-brand text-white" : "text-ink-soft hover:bg-paper"}`}>
                {range === 365 ? "1 year" : `${range} days`}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {groupOrder.filter((group) => data.series.some((series) => series.group === group)).map((group) => (
            <label key={group} className="inline-flex items-center gap-1.5 text-ink-soft">
              <input type="checkbox" checked={shown.has(group)} onChange={() => toggle(group)} className="accent-brand" />
              {groupLabel(group)}
            </label>
          ))}
        </div>
        <div className="mt-3">
          <PriceChart series={chartSeries} />
        </div>
      </section>

      <section className="text-xs text-ink-soft space-y-1">
        <p>Each line is a seller's daily average; supermarket lines pool the store's product labels for this item. Prices are as observed on the day and may differ in store.</p>
        {data.product.aliases.length ? <p>Also listed as: {data.product.aliases.join(", ")}.</p> : null}
      </section>
    </div>
  );
}

function SellerTable({ group, rows }: { group: Group; rows: Latest[] }) {
  const unit = mostCommonUnit(rows);
  const comparable = rows.filter((row) => row.unit === unit);
  const cheapest = comparable.length > 1 ? comparable.reduce((best, row) => (row.mid < best.mid ? row : best)) : null;
  return (
    <section className="rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">{groupLabel(group)}</h2>
        <p className="text-xs text-ink-soft">{groupNotes[group]}</p>
      </div>
      <ul className="divide-y divide-line">
        {[...rows].sort((left, right) => left.mid - right.mid).map((row) => (
          <li key={`${row.market_id}|${row.price_type}|${row.unit}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium">
                {sellerName(row)}
                {cheapest && cheapest.market_id === row.market_id ? <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">cheapest</span> : null}
              </p>
              <p className="text-xs text-ink-soft">
                {relativeDay(row.observed_on)}
                {row.products > 1 ? ` · ${row.products} products` : ""}
                {row.varieties.length > 1 ? ` · ${row.varieties.join(", ")}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium">{rupeeRange(row.low, row.high)}</p>
              <p className="text-xs text-ink-soft">{unitLabel(row.unit)}{row.low !== row.high ? ` · avg ${rupees(row.mid)}` : ""}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The section already says which kind of price this is, so "Pettah (retail)" reads as "Pettah". */
function sellerName(row: Latest): string {
  return row.market_label.replace(/\s*\((retail|wholesale)\)\s*$/iu, "");
}

function mostCommonUnit(rows: Latest[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.unit, (counts.get(row.unit) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}
