import type { Group } from "./api.ts";

const rupeeFormat = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });
const rupeeFormatFine = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Rs 1,250" for whole rupees, "Rs 12.50" when the cents matter. */
export function rupees(value: number): string {
  const formatter = Number.isInteger(value) || value >= 100 ? rupeeFormat : rupeeFormatFine;
  return `Rs ${formatter.format(value)}`;
}

/** "Rs 180 – 220" or "Rs 200" when low and high agree. */
export function rupeeRange(low: number, high: number): string {
  if (Math.round(low * 100) === Math.round(high * 100)) return rupees(low);
  return `${rupees(low)} – ${rupeeFormatOnly(high)}`;
}

function rupeeFormatOnly(value: number): string {
  return rupees(value).replace(/^Rs /u, "");
}

const unitLabels: Record<string, string> = { kg: "per kg", g: "per g", l: "per litre", ml: "per ml", piece: "each", pack: "per pack", bunch: "per bunch", dozen: "per dozen" };

export function unitLabel(unit: string): string {
  return unitLabels[unit] ?? `per ${unit}`;
}

const groupLabels: Record<Group, string> = { retail_market: "Open markets", supermarket: "Supermarkets", wholesale: "Wholesale markets" };

export function groupLabel(group: Group): string {
  return groupLabels[group];
}

export const groupNotes: Record<Group, string> = {
  retail_market: "Retail prices surveyed at open markets by the Central Bank and the Department of Census and Statistics.",
  supermarket: "Shelf prices captured from the retailers' online stores every morning.",
  wholesale: "Wholesale prices from the HARTI daily bulletin.",
};

/** "vegetable" to "Vegetables", "meat_and_poultry" to "Meat and poultry". */
export function categoryLabel(category: string): string {
  const words = category.split("_").join(" ");
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return category === "vegetable" || category === "fruit" || category === "pulse" ? `${label}s` : label;
}

/** "today", "yesterday", "3 days ago", or the date once it is more than a week old. */
export function relativeDay(date: string, today: Date = new Date()): string {
  const [year, month, day] = date.split("-").map(Number);
  const then = Date.UTC(year!, month! - 1, day!);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((now - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "▲ 12%" for a rise, "▼ 4%" for a fall, "steady" within a percent. */
export function changeLabel(pct: number | null): { text: string; direction: "rise" | "fall" | "steady" } | null {
  if (pct === null) return null;
  if (Math.abs(pct) < 1) return { text: "steady", direction: "steady" };
  return pct > 0 ? { text: `▲ ${Math.round(pct)}%`, direction: "rise" } : { text: `▼ ${Math.abs(Math.round(pct))}%`, direction: "fall" };
}

export function shortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
