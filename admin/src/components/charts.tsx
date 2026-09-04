import { RiArrowDownLine, RiArrowRightLine, RiArrowUpLine } from "@remixicon/react";
import type { ReactNode } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { BasketPoint, InsightsIndexStatus, InsightsMarket, InsightsMonth, InsightsRunDay, PriceMarket, PricePoint } from "@/lib/api";
import { cn } from "@/lib/utils";

export const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
export const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export function rupees(value: number): string {
  return `Rs ${wholeNumber.format(value)}`;
}

export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

export function formatDay(day: string): string {
  return dayFormatter.format(new Date(`${day}T00:00:00Z`));
}

/** A 2px gap in the surface colour separates touching marks instead of a drawn border. */
const surfaceGap = { stroke: "var(--card)", strokeWidth: 2 } as const;
const axisTick = { fontSize: 11 } as const;

export function Sparkline({ points, className }: { points: number[]; className?: string | undefined }) {
  const data = points.map((value, index) => ({ index, value }));
  const last = data.at(-1);
  if (data.length < 2) return null;
  return (
    <ChartContainer className={cn("aspect-auto h-10 w-full", className)} config={{ value: { label: "Trend", color: "var(--chart-muted)" } }}>
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
        <Line dataKey="value" dot={false} isAnimationActive={false} stroke="var(--color-value)" strokeLinecap="round" strokeWidth={2} type="monotone" />
        {last ? <ReferenceDot fill="var(--primary)" r={4} stroke="var(--card)" strokeWidth={2} x={last.index} y={last.value} /> : null}
      </LineChart>
    </ChartContainer>
  );
}

export type StatDelta = { value: number; label: string; upIsGood?: boolean | null; format?: (value: number) => string };

export function StatTile({ label, value, hint, delta, trend, icon, media, tone = "default" }: {
  label: string;
  value: string;
  hint?: ReactNode;
  delta?: StatDelta | null | undefined;
  trend?: number[] | undefined;
  icon?: ReactNode;
  /** Rendered as-is in the icon slot, for photos and other pre-sized media. */
  media?: ReactNode;
  tone?: "default" | "warning" | "critical" | undefined;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex h-full flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          {media ? media : icon ? <span className={cn("grid size-6 place-items-center rounded-md border [&_svg]:size-3.5", tone === "critical" ? "border-destructive/25 bg-destructive/10 text-destructive" : tone === "warning" ? "border-amber-500/25 bg-amber-500/10 text-amber-400" : "border-primary/25 bg-primary/10 text-primary")}>{icon}</span> : null}
        </div>
        <p className="font-heading text-2xl font-semibold leading-none tracking-tight">{value}</p>
        {trend && trend.length > 1 ? <Sparkline className="-mx-1 h-8" points={trend} /> : null}
        <div className="mt-auto flex flex-col gap-1">
          {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
          {delta ? <DeltaLine delta={delta} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaLine({ delta }: { delta: StatDelta }) {
  const direction = delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat";
  const good = delta.upIsGood === null || delta.upIsGood === undefined || direction === "flat" ? null : (direction === "up") === delta.upIsGood;
  const Icon = direction === "up" ? RiArrowUpLine : direction === "down" ? RiArrowDownLine : RiArrowRightLine;
  const format = delta.format ?? ((value: number) => wholeNumber.format(Math.abs(value)));
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("inline-flex items-center gap-0.5 font-medium", good === true ? "text-primary" : good === false ? "text-destructive" : "text-foreground")}>
        <Icon aria-hidden className="size-3" />
        {direction === "flat" ? "No change" : `${direction === "up" ? "+" : "−"}${format(delta.value)}`}
      </span>
      <span>{delta.label}</span>
    </p>
  );
}

const growthConfig = {
  discovered: { label: "Discovered", color: "var(--chart-ordinal-1)" },
  archived: { label: "Archived", color: "var(--chart-ordinal-2)" },
  canonicalized: { label: "Canonicalized", color: "var(--chart-ordinal-3)" },
} satisfies ChartConfig;

export function DocumentsGrowthChart({ months }: { months: InsightsMonth[] }) {
  return (
    <ChartContainer className="aspect-auto h-56 w-full" config={growthConfig}>
      <BarChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="month" minTickGap={20} tick={axisTick} tickFormatter={formatMonth} tickLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} axisLine={false} tick={axisTick} tickFormatter={(value: number) => compactNumber.format(value)} tickLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => formatMonth(String(label))} />} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
        <Bar dataKey="discovered" fill="var(--color-discovered)" maxBarSize={24} radius={[3, 3, 0, 0]} stackId="documents" {...surfaceGap} />
        <Bar dataKey="archived" fill="var(--color-archived)" maxBarSize={24} radius={[3, 3, 0, 0]} stackId="documents" {...surfaceGap} />
        <Bar dataKey="canonicalized" fill="var(--color-canonicalized)" maxBarSize={24} radius={[3, 3, 0, 0]} stackId="documents" {...surfaceGap} />
      </BarChart>
    </ChartContainer>
  );
}

const runConfig = {
  succeeded: { label: "Succeeded", color: "var(--chart-muted)" },
  failed: { label: "Failed", color: "var(--status-critical)" },
} satisfies ChartConfig;

export function RunOutcomesChart({ days }: { days: InsightsRunDay[] }) {
  return (
    <ChartContainer className="aspect-auto h-48 w-full" config={runConfig}>
      <BarChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="day" minTickGap={28} tick={axisTick} tickFormatter={formatDay} tickLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} axisLine={false} tick={axisTick} tickFormatter={(value: number) => compactNumber.format(value)} tickLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => formatDay(String(label))} />} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
        <Bar dataKey="succeeded" fill="var(--color-succeeded)" maxBarSize={24} radius={[3, 3, 0, 0]} stackId="runs" {...surfaceGap} />
        <Bar dataKey="failed" fill="var(--color-failed)" maxBarSize={24} radius={[3, 3, 0, 0]} stackId="runs" {...surfaceGap} />
      </BarChart>
    </ChartContainer>
  );
}

const coverageConfig = {
  indexed: { label: "Indexed", color: "var(--chart-1)" },
  indexing: { label: "Indexing", color: "var(--chart-3)" },
  failed: { label: "Index failed", color: "#e66767" },
  not_indexed: { label: "Not indexed", color: "var(--chart-muted)" },
} satisfies ChartConfig;
const coverageOrder = ["indexed", "indexing", "failed", "not_indexed"] as const;

export function IndexCoverageChart({ statuses }: { statuses: InsightsIndexStatus[] }) {
  const total = statuses.reduce((sum, row) => sum + row.count, 0);
  const row = Object.fromEntries(statuses.map((status) => [status.status, status.count])) as Record<(typeof coverageOrder)[number], number>;
  return (
    <div className="flex flex-col gap-4">
      <ChartContainer className="aspect-auto h-8 w-full" config={coverageConfig}>
        <BarChart barCategoryGap={0} data={[{ name: "coverage", ...row }]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis domain={[0, Math.max(total, 1)]} hide type="number" />
          <YAxis dataKey="name" hide type="category" />
          <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
          {coverageOrder.map((status, index) => (
            <Bar
              dataKey={status}
              fill={`var(--color-${status})`}
              key={status}
              radius={index === 0 ? [4, 0, 0, 4] : index === coverageOrder.length - 1 ? [0, 4, 4, 0] : 0}
              stackId="coverage"
              {...surfaceGap}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <ul className="flex flex-col gap-2 text-xs">
        {coverageOrder.map((status) => (
          <li className="flex items-center gap-2" key={status}>
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: coverageConfig[status].color }} />
            <span className="flex-1 truncate text-muted-foreground">{coverageConfig[status].label}</span>
            <span className="font-mono tabular-nums">{wholeNumber.format(row[status] ?? 0)}</span>
            <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">{total ? `${Math.round(((row[status] ?? 0) / total) * 100)}%` : "0%"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const priceConfig = {
  average: { label: "Daily average", color: "var(--chart-1)" },
  moving_average: { label: "7-day average", color: "var(--chart-muted)" },
  range: { label: "Lowest to highest market", color: "var(--chart-1)" },
} satisfies ChartConfig;

function TooltipRow({ color, label, value, dashed = false }: { color: string; label: ReactNode; value: ReactNode; dashed?: boolean }) {
  return (
    <div className="flex flex-1 items-center gap-2">
      <span aria-hidden className={cn("h-2.5 w-1 shrink-0 rounded-[1px]", dashed && "opacity-40")} style={{ backgroundColor: color }} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function PriceTrendChart({ points, unit }: { points: PricePoint[]; unit: string | null }) {
  const data = points.map((point) => ({ ...point, range: [point.low, point.high] }));
  const unitLabel = unit ? `/${unit}` : "";
  return (
    <ChartContainer className="aspect-auto h-60 w-full" config={priceConfig}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="date" minTickGap={32} tick={axisTick} tickFormatter={formatDay} tickLine={false} tickMargin={8} />
        <YAxis axisLine={false} domain={["auto", "auto"]} tick={axisTick} tickFormatter={(value: number) => compactNumber.format(value)} tickLine={false} width={44} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => {
                if (name === "range" && Array.isArray(value)) return <TooltipRow color={priceConfig.range.color} dashed label="Market range" value={`${rupees(Number(value[0]))} – ${rupees(Number(value[1]))}`} />;
                if (name === "moving_average") return <TooltipRow color={priceConfig.moving_average.color} label="7-day average" value={value === null || value === undefined ? "—" : `${rupees(Number(value))}${unitLabel}`} />;
                return <TooltipRow color={priceConfig.average.color} label="Daily average" value={`${rupees(Number(value))}${unitLabel}`} />;
              }}
              labelFormatter={(label) => formatDay(String(label))}
            />
          }
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
        <Area activeDot={false} dataKey="range" fill="var(--color-range)" fillOpacity={0.12} animationDuration={600} animationEasing="ease-out" stroke="none" type="monotone" />
        <Line connectNulls dataKey="moving_average" dot={false} animationDuration={600} animationEasing="ease-out" stroke="var(--color-moving_average)" strokeLinecap="round" strokeWidth={2} type="monotone" />
        <Line activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} dataKey="average" dot={false} animationDuration={600} animationEasing="ease-out" stroke="var(--color-average)" strokeLinecap="round" strokeWidth={2} type="monotone" />
      </ComposedChart>
    </ChartContainer>
  );
}

export function MarketPriceChart({ markets, unit }: { markets: PriceMarket[]; unit: string | null }) {
  const unitLabel = unit ? `/${unit}` : "";
  return (
    <ChartContainer className="aspect-auto w-full" config={{ average: { label: "Average price", color: "var(--chart-1)" } }} style={{ height: Math.max(markets.length, 3) * 26 + 12 }}>
      <BarChart barCategoryGap={6} data={markets} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }}>
        <XAxis domain={[0, "dataMax"]} hide type="number" />
        <YAxis axisLine={false} dataKey="label" tick={axisTick} tickLine={false} type="category" width={108} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value, _name, item) => <TooltipRow color="var(--chart-1)" label={`${rupees(Number((item.payload as PriceMarket).low))} – ${rupees(Number((item.payload as PriceMarket).high))}`} value={`${rupees(Number(value))}${unitLabel}`} />} hideLabel />}
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
        />
        <Bar dataKey="average" fill="var(--color-average)" maxBarSize={18} radius={[0, 4, 4, 0]} {...surfaceGap}>
          <LabelList className="fill-foreground" dataKey="average" fontSize={11} formatter={(value: unknown) => rupees(Number(value))} offset={8} position="right" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function MarketCoverageChart({ markets }: { markets: InsightsMarket[] }) {
  return (
    <ChartContainer className="aspect-auto w-full" config={{ observations: { label: "Canonical observations", color: "var(--chart-3)" } }} style={{ height: Math.max(markets.length, 3) * 26 + 12 }}>
      <BarChart barCategoryGap={6} data={markets} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 0 }}>
        <XAxis domain={[0, "dataMax"]} hide type="number" />
        <YAxis axisLine={false} dataKey="label" tick={axisTick} tickLine={false} type="category" width={108} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value, _name, item) => <TooltipRow color="var(--chart-3)" label={`${(item.payload as InsightsMarket).products} products`} value={`${wholeNumber.format(Number(value))} observations`} />} hideLabel />}
          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
        />
        <Bar dataKey="observations" fill="var(--color-observations)" maxBarSize={18} radius={[0, 4, 4, 0]} {...surfaceGap}>
          <LabelList className="fill-foreground" dataKey="observations" fontSize={11} formatter={(value: unknown) => compactNumber.format(Number(value))} offset={8} position="right" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function BasketIndexChart({ points }: { points: BasketPoint[] }) {
  return (
    <ChartContainer className="aspect-auto h-52 w-full" config={{ index: { label: "Basket index", color: "var(--chart-1)" } }}>
      <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="date" minTickGap={32} tick={axisTick} tickFormatter={formatDay} tickLine={false} tickMargin={8} />
        <YAxis axisLine={false} domain={["auto", "auto"]} tick={axisTick} tickFormatter={(value: number) => value.toFixed(0)} tickLine={false} width={40} />
        <ReferenceLine stroke="var(--muted-foreground)" strokeOpacity={0.6} y={100} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value, _name, item) => <TooltipRow color="var(--chart-1)" label={`${(item.payload as BasketPoint).products} products`} value={Number(value).toFixed(1)} />} labelFormatter={(label) => formatDay(String(label))} />}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <Area activeDot={false} baseValue={100} dataKey="index" fill="var(--color-index)" fillOpacity={0.1} animationDuration={600} animationEasing="ease-out" stroke="none" type="monotone" />
        <Line activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} dataKey="index" dot={false} animationDuration={600} animationEasing="ease-out" stroke="var(--color-index)" strokeLinecap="round" strokeWidth={2} type="monotone" />
      </ComposedChart>
    </ChartContainer>
  );
}
