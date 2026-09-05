import { useMemo, useRef, useState } from "react";

import type { Point } from "@/lib/api";
import { rupees, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChartSeries = { key: string; label: string; color: string; unit: string; points: Point[] };

const width = 640;
const height = 260;
const margin = { top: 12, right: 12, bottom: 28, left: 56 };

/**
 * A plain SVG line chart in the site's tokens: one line per seller, dates on x, rupees on y.
 * Hover or tap a day to see every seller's exact price on it; tap again to unpin. Light enough for
 * a phone on a slow connection.
 */
export function PriceChart({ series, className }: { series: ChartSeries[]; className?: string | undefined }) {
  const dates = useMemo(() => [...new Set(series.flatMap((entry) => entry.points.map((point) => point.date)))].sort(), [series]);
  const values = series.flatMap((entry) => entry.points.map((point) => point.mid));
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!dates.length || !values.length) return <p className="py-8 text-center text-sm text-muted-foreground">No history in this range yet.</p>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.1 || high * 0.1 || 1;
  const yMin = Math.max(0, low - pad);
  const yMax = high + pad;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xAt = (index: number) => margin.left + (dates.length === 1 ? innerWidth / 2 : (index / (dates.length - 1)) * innerWidth);
  const x = (date: string) => xAt(dates.indexOf(date));
  const y = (value: number) => margin.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const ticks = [0, 1, 2, 3].map((step) => yMin + ((yMax - yMin) * step) / 3);
  const xTicks = dates.length <= 3 ? dates : [dates[0]!, dates[Math.floor(dates.length / 2)]!, dates.at(-1)!];
  const active = pinned ?? hover;
  const activeDate = active === null ? null : dates[active]!;
  const readings = activeDate === null ? [] : series
    .map((entry) => ({ entry, point: entry.points.find((point) => point.date === activeDate) }))
    .filter((reading): reading is { entry: ChartSeries; point: Point } => Boolean(reading.point))
    .sort((left, right) => left.point.mid - right.point.mid);

  const locate = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    const relative = ((clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.min(1, Math.max(0, (relative - margin.left) / innerWidth));
    return Math.round(ratio * (dates.length - 1));
  };
  const tooltipLeft = active === null ? 0 : (xAt(active) / width) * 100;

  return (
    <figure className={cn("relative m-0", className)}>
      <svg
        aria-label="Price history"
        className="h-auto w-full touch-pan-y select-none"
        onClick={(event) => { const index = locate(event.clientX); setPinned((current) => (current === index ? null : index)); }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => setHover(locate(event.clientX))}
        onTouchStart={(event) => { const touch = event.touches[0]; if (touch) setHover(locate(touch.clientX)); }}
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="text-border" stroke="currentColor" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="text-muted-foreground" fill="currentColor" fontSize="11" textAnchor="end" x={margin.left - 8} y={y(tick) + 4}>{rupees(tick)}</text>
          </g>
        ))}
        {xTicks.map((date) => (
          <text className="text-muted-foreground" fill="currentColor" fontSize="11" key={date} textAnchor="middle" x={x(date)} y={height - 8}>{shortDate(date)}</text>
        ))}
        {series.map((entry) => {
          const path = entry.points.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)} ${y(point.mid).toFixed(1)}`).join(" ");
          return (
            <g className="animate-in fade-in duration-500" key={entry.key}>
              <path d={path} fill="none" stroke={entry.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              {entry.points.length === 1 ? <circle cx={x(entry.points[0]!.date)} cy={y(entry.points[0]!.mid)} fill={entry.color} r="4" /> : null}
            </g>
          );
        })}
        {activeDate !== null ? (
          <g>
            <line className="text-muted-foreground/60" stroke="currentColor" strokeDasharray="3 3" x1={x(activeDate)} x2={x(activeDate)} y1={margin.top} y2={height - margin.bottom} />
            {readings.map(({ entry, point }) => <circle cx={x(point.date)} cy={y(point.mid)} fill={entry.color} key={entry.key} r="4.5" stroke="var(--background)" strokeWidth="2" />)}
          </g>
        ) : null}
      </svg>
      {activeDate !== null && readings.length ? (
        <div
          className={cn("pointer-events-none absolute top-2 z-10 w-56 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md animate-in fade-in duration-150", tooltipLeft > 60 ? "-translate-x-full" : "")}
          style={{ left: `${tooltipLeft}%`, marginLeft: tooltipLeft > 60 ? -12 : 12 }}
        >
          <p className="mb-1.5 flex items-center justify-between font-medium">
            <span>{shortDate(activeDate)}</span>
            {pinned !== null ? <span className="text-[10px] font-normal text-muted-foreground">pinned · tap to release</span> : null}
          </p>
          <ul className="space-y-1">
            {readings.map(({ entry, point }) => (
              <li className="flex items-center gap-1.5" key={entry.key}>
                <span className="inline-block size-2 rounded-full" style={{ background: entry.color }} />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <span className="tabular font-medium">{point.low !== point.high ? `${rupees(point.low)}–${rupees(point.high).replace(/^Rs /u, "")}` : rupees(point.mid)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </figure>
  );
}
