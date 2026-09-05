import type { Point } from "@/lib/api";
import { rupees, shortDate } from "@/lib/format";

export type ChartSeries = { key: string; label: string; color: string; points: Point[] };

const width = 640;
const height = 260;
const margin = { top: 12, right: 12, bottom: 28, left: 56 };

/** A plain SVG line chart in the site's tokens: one line per seller, dates on x, rupees on y. Light enough for a phone on a slow connection. */
export function PriceChart({ series }: { series: ChartSeries[] }) {
  const dates = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.date)))].sort();
  const values = series.flatMap((entry) => entry.points.map((point) => point.mid));
  if (!dates.length || !values.length) return <p className="py-8 text-center text-sm text-muted-foreground">No history in this range yet.</p>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.1 || high * 0.1 || 1;
  const yMin = Math.max(0, low - pad);
  const yMax = high + pad;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = (date: string) => margin.left + (dates.length === 1 ? innerWidth / 2 : (dates.indexOf(date) / (dates.length - 1)) * innerWidth);
  const y = (value: number) => margin.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const ticks = [0, 1, 2, 3].map((step) => yMin + ((yMax - yMin) * step) / 3);
  const xTicks = dates.length <= 3 ? dates : [dates[0]!, dates[Math.floor(dates.length / 2)]!, dates.at(-1)!];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Price history">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-border" />
            <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-muted-foreground">{rupees(tick)}</text>
          </g>
        ))}
        {xTicks.map((date) => (
          <text key={date} x={x(date)} y={height - 8} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground">{shortDate(date)}</text>
        ))}
        {series.map((entry) => {
          const path = entry.points.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)} ${y(point.mid).toFixed(1)}`).join(" ");
          return (
            <g key={entry.key}>
              <path d={path} fill="none" stroke={entry.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {entry.points.length === 1 ? <circle cx={x(entry.points[0]!.date)} cy={y(entry.points[0]!.mid)} r="4" fill={entry.color} /> : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
