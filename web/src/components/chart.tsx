import type { Point } from "../lib/api.ts";
import { rupees, shortDate } from "../lib/format.ts";

export type ChartSeries = { key: string; label: string; color: string; points: Point[] };

const width = 640;
const height = 260;
const margin = { top: 12, right: 12, bottom: 28, left: 56 };

/** A plain SVG line chart: one line per seller, dates on x, rupees on y. Light enough for a phone on a slow connection. */
export function PriceChart({ series }: { series: ChartSeries[] }) {
  const dates = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.date)))].sort();
  const values = series.flatMap((entry) => entry.points.map((point) => point.mid));
  if (!dates.length || !values.length) return <p className="text-sm text-ink-soft">No history in this range yet.</p>;
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
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Price history">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke="#e3e8e5" />
            <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#5b6863">{rupees(tick)}</text>
          </g>
        ))}
        {xTicks.map((date) => (
          <text key={date} x={x(date)} y={height - 8} textAnchor="middle" fontSize="11" fill="#5b6863">{shortDate(date)}</text>
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
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export const palette = ["#0f7a54", "#d95926", "#2a7de1", "#b8860b", "#8e44ad", "#e84393", "#00a8b5", "#7f8c8d", "#b5651d", "#5d6d7e", "#2e8b57", "#c0392b"];
