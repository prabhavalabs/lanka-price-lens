import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { fetchOverview, type GroupPrice, type ProductCard } from "../lib/api.ts";
import { categoryLabel, changeLabel, groupLabel, relativeDay, rupeeRange, unitLabel } from "../lib/format.ts";

export function BoardPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const category = params.get("category") ?? "";
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });

  const categories = useMemo(() => [...new Set(overview.data?.products.map((product) => product.category) ?? [])].sort(), [overview.data]);
  const products = useMemo(() => {
    const all = overview.data?.products ?? [];
    return all.filter((product) => {
      if (category && product.category !== category) return false;
      if (!query) return true;
      return [product.label, product.label_si ?? "", product.label_ta ?? ""].some((label) => label.toLowerCase().includes(query));
    });
  }, [overview.data, category, query]);

  if (overview.isPending) return <p className="py-16 text-center text-ink-soft">Loading today's prices…</p>;
  if (overview.isError) return <p className="py-16 text-center text-rise">Prices are not available right now. Please try again in a few minutes.</p>;

  const asOf = overview.data.as_of;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Food prices today</h1>
          <p className="text-sm text-ink-soft">
            {asOf ? `Latest observations ${relativeDay(asOf)} · ` : ""}
            open markets and supermarkets side by side, in rupees per unit.
          </p>
        </div>
        {query ? <p className="text-sm text-ink-soft">{products.length} results for “{params.get("q")}” · <Link to="/" className="underline">clear</Link></p> : null}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
        <Chip active={!category} onClick={() => setParams(withParam(params, "category", ""))}>All</Chip>
        {categories.map((entry) => (
          <Chip key={entry} active={category === entry} onClick={() => setParams(withParam(params, "category", entry))}>{categoryLabel(entry)}</Chip>
        ))}
      </div>

      {products.length === 0 ? <p className="py-12 text-center text-ink-soft">Nothing matches. Try another spelling or clear the filter.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => <Card key={product.id} product={product} />)}
      </div>
    </div>
  );
}

function withParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-soft hover:border-brand"}`}
    >
      {children}
    </button>
  );
}

function Card({ product }: { product: ProductCard }) {
  const headline = product.prices.find((price) => price.group === "retail_market") ?? product.prices.find((price) => price.group === "supermarket") ?? product.prices[0];
  const change = changeLabel(headline?.change_30d_pct ?? null);
  return (
    <Link to={`/p/${product.id}`} className="block rounded-xl border border-line bg-white p-4 no-underline hover:border-brand hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold leading-tight">{product.label}</h2>
          {product.label_si || product.label_ta ? <p className="text-xs text-ink-soft">{[product.label_si, product.label_ta].filter(Boolean).join(" · ")}</p> : null}
        </div>
        {change ? <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${change.direction === "rise" ? "bg-red-50 text-rise" : change.direction === "fall" ? "bg-brand-soft text-fall" : "bg-paper text-ink-soft"}`} title="Change over 30 days">{change.text}</span> : null}
      </div>
      <dl className="mt-3 space-y-1.5">
        {product.prices.map((price) => <PriceLine key={price.group} price={price} />)}
      </dl>
    </Link>
  );
}

function PriceLine({ price }: { price: GroupPrice }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-ink-soft">{groupLabel(price.group)}</dt>
      <dd className="m-0 text-right">
        <span className="font-medium">{rupeeRange(price.low, price.high)}</span>
        <span className="text-ink-soft"> {unitLabel(price.unit)}</span>
        <span className="block text-[11px] text-ink-soft">{price.sellers} {price.sellers === 1 ? "seller" : "sellers"} · {relativeDay(price.observed_on)}</span>
      </dd>
    </div>
  );
}
