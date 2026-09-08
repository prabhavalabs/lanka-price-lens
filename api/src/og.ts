import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import type { PublicOverview, PublicProductCard } from "./public.ts";

/**
 * Social preview cards: the 1200×630 image a link shows on X, Facebook, LinkedIn, WhatsApp, and
 * the rest. Drawn as SVG and rendered on the server with resvg and the site's own font, from
 * today's data, so a shared product link carries its current prices. No browser involved.
 */

export const cardWidth = 1200;
export const cardHeight = 630;

const fontsDirectory = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
const fontFiles = ["400", "500", "600", "700"].map((weight) => resolve(fontsDirectory, `IBMPlexSans-${weight}.ttf`));

const colours = { background: "#0b1411", text: "#f3f7f4", muted: "#9fb3a8", green: "#3ddc97", greenDeep: "#0f7a54", up: "#ff7b7b", down: "#3ddc97" };
const fontFamily = "IBM Plex Sans";

export type CardRow = { label: string; value: string; note?: string | undefined; noteColour?: string | undefined };
export type CardStat = { value: string; label: string };
export type Card = {
  eyebrow: string;
  title: string;
  subtitle?: string | undefined;
  rows?: CardRow[] | undefined;
  stats?: CardStat[] | undefined;
  body?: string | undefined;
  footer: string;
  image?: { data: Buffer; mime: "image/jpeg" | "image/png" } | undefined;
};

const escape = (text: string): string => text.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

/** Roughly how wide a run of text is in this font, enough to wrap and place things. */
export function textWidth(text: string, size: number, weight = 400): number {
  const factor = weight >= 600 ? 0.66 : 0.62;
  return Array.from(text).reduce((sum, character) => sum + (character === " " ? 0.32 : /[ijl.,:;'|!]/u.test(character) ? 0.32 : /[mwMW]/u.test(character) ? 0.9 : /[A-Z0-9–]/u.test(character) ? 0.7 : 1) * size * factor, 0);
}

/** Breaks text into lines no wider than the space, at most `max` lines, the last one ending in an ellipsis when cut. */
export function wrapText(text: string, size: number, width: number, max: number, weight = 400): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, weight) <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
    if (lines.length === max) break;
  }
  if (lines.length < max && current) lines.push(current);
  if (lines.length === max && (current && !lines.includes(current) || words.join(" ") !== lines.join(" "))) {
    let last = lines[max - 1]!;
    while (last && textWidth(`${last}…`, size, weight) > width && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

const text = (x: number, y: number, content: string, size: number, fill: string, weight = 400, extra = ""): string => `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escape(content)}</text>`;

/** The SVG for a card. Exported for tests and for anyone who wants the vector. */
export function cardSvg(card: Card): string {
  const left = 72;
  const contentWidth = card.image ? 620 : 1056;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}">`);
  parts.push(`<defs><radialGradient id="glow" cx="1050" cy="-80" r="700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${colours.green}" stop-opacity="0.22"/><stop offset="1" stop-color="${colours.green}" stop-opacity="0"/></radialGradient><clipPath id="photo"><rect x="760" y="120" width="368" height="368" rx="32"/></clipPath></defs>`);
  parts.push(`<rect width="${cardWidth}" height="${cardHeight}" fill="${colours.background}"/><rect width="${cardWidth}" height="${cardHeight}" fill="url(#glow)"/><rect x="0" y="0" width="${cardWidth}" height="6" fill="${colours.greenDeep}"/>`);
  // Brand.
  parts.push(`<g transform="translate(${left} 62)"><rect width="44" height="44" rx="11" fill="${colours.greenDeep}"/><path d="M11 28.9l6.9-8.3 5.5 5.5 9.6-12.4" fill="none" stroke="#fff" stroke-width="4.1" stroke-linecap="round" stroke-linejoin="round"/></g>`);
  parts.push(text(left + 60, 94, "PriceLens", 30, colours.text, 600));
  parts.push(text(left + 214, 94, "price.prabhavalabs.com", 22, colours.muted));
  // Eyebrow and title. Cards with stat tiles run a little tighter so the tiles clear the footer.
  const compact = Boolean(card.stats?.length);
  let y = compact ? 176 : 190;
  parts.push(text(left, y, card.eyebrow.toUpperCase(), 20, colours.green, 600, 'letter-spacing="3"'));
  y += 26;
  const titleSize = compact ? 56 : card.title.length > 28 && !card.image ? 60 : 64;
  const titleLines = wrapText(card.title, titleSize, contentWidth, 2, 600);
  for (const line of titleLines) {
    y += titleSize + (compact ? 8 : 10);
    parts.push(text(left, y, line, titleSize, colours.text, 600, 'letter-spacing="-1.5"'));
  }
  if (card.subtitle) {
    const size = compact ? 25 : 27;
    for (const line of wrapText(card.subtitle, size, contentWidth, 2)) {
      y += compact ? 34 : 40;
      parts.push(text(left, y, line, size, colours.muted));
    }
  }
  // Price rows.
  if (card.rows?.length) {
    y += 34;
    for (const row of card.rows.slice(0, 3)) {
      y += 30;
      parts.push(text(left, y, row.label, 21, colours.muted, 500));
      y += 40;
      parts.push(text(left, y, row.value, 34, colours.text, 600));
      if (row.note) parts.push(text(left + contentWidth, y, row.note, 22, row.noteColour ?? colours.muted, 600, 'text-anchor="end"'));
      y += 6;
    }
  }
  // Stat tiles.
  if (card.stats?.length) {
    const tiles = card.stats.slice(0, 3);
    const tileWidth = Math.min(320, Math.floor((contentWidth - 24 * (tiles.length - 1)) / tiles.length));
    const top = y + 30;
    tiles.forEach((stat, index) => {
      const x = left + index * (tileWidth + 24);
      parts.push(`<rect x="${x}" y="${top}" width="${tileWidth}" height="104" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>`);
      parts.push(text(x + 26, top + 50, stat.value, 38, colours.text, 600));
      parts.push(text(x + 26, top + 82, stat.label, 18, colours.muted));
    });
  }
  // Body copy.
  if (card.body) {
    y += 20;
    for (const line of wrapText(card.body, 26, contentWidth, 3)) {
      y += 40;
      parts.push(text(left, y, line, 26, colours.muted));
    }
  }
  // Photo.
  if (card.image) {
    parts.push(`<image x="760" y="120" width="368" height="368" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)" xlink:href="data:${card.image.mime};base64,${card.image.data.toString("base64")}"/>`);
    parts.push(`<rect x="760" y="120" width="368" height="368" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>`);
  }
  // Footer.
  parts.push(`<line x1="${left}" y1="548" x2="${cardWidth - left}" y2="548" stroke="#ffffff" stroke-opacity="0.08"/>`);
  parts.push(text(left, 590, card.footer, 21, colours.muted));
  parts.push(text(cardWidth - left, 590, "Free · No account · Open source", 21, colours.muted, 400, 'text-anchor="end"'));
  parts.push("</svg>");
  return parts.join("");
}

export function renderCard(card: Card): Buffer {
  const renderer = new Resvg(cardSvg(card), { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: fontFamily }, fitTo: { mode: "width", value: cardWidth } });
  return Buffer.from(renderer.render().asPng());
}

// --- The cards themselves -----------------------------------------------------------------

const groupLabels: Record<string, string> = { retail_market: "Open markets", supermarket: "Supermarkets", wholesale: "Wholesale markets" };
const groupOrder = ["retail_market", "supermarket", "wholesale"];
const unitLabels: Record<string, string> = { kg: "per kg", g: "per g", l: "per litre", ml: "per ml", piece: "each", pack: "per pack", bunch: "per bunch", dozen: "per dozen" };

/** "fish_and_seafood" reads as "Fish and seafood". */
export function prettyCategory(value: string | undefined): string {
  const words = (value ?? "").replace(/[_-]+/gu, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

const rupees = (value: number): string => `Rs ${Math.round(value).toLocaleString("en-US")}`;
const range = (low: number, high: number): string => (Math.round(low) === Math.round(high) ? rupees(low) : `${rupees(low)} – ${Math.round(high).toLocaleString("en-US")}`);

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const asOfFooter = (overview: PublicOverview | null): string => {
  const date = formatDate(overview?.as_of);
  return date ? `Prices as observed on ${date}, from official bulletins and store shelves` : "From official bulletins and supermarket shelves, every day";
};

export function siteCard(overview: PublicOverview | null, fallback = { products: 130, supermarkets: 4, sources: 3 }): Card {
  const products = overview?.products.length ?? fallback.products;
  const supermarkets = overview ? new Set(overview.sources.filter((source) => source.kind === "supermarket").map((source) => source.id)).size || fallback.supermarkets : fallback.supermarkets;
  const official = overview ? overview.sources.filter((source) => source.kind !== "supermarket").length || fallback.sources : fallback.sources;
  return {
    eyebrow: "Sri Lanka food prices, every day",
    title: "Open markets, supermarkets and wholesale, side by side",
    subtitle: "Today's prices with history, a basket that finds the cheapest store, and recipes priced at today's rates.",
    stats: [{ value: `${products}+`, label: "products" }, { value: String(supermarkets), label: "supermarkets" }, { value: String(official), label: "official sources" }],
    footer: asOfFooter(overview),
  };
}

export function pageCard(name: string, overview: PublicOverview | null, dishes = 363): Card | null {
  const footer = asOfFooter(overview);
  switch (name) {
    case "guide":
      return { eyebrow: "How to use PriceLens", title: "From the front page to a priced shopping list in five minutes", subtitle: "Find a product, read a price and its history, build a basket, compare stores, cook from what you have.", footer };
    case "recipes":
      return { eyebrow: "Recipes", title: `${dishes} Sri Lankan dishes, priced at today's rates`, subtitle: "What each one needs, what you already have, and what is still to buy at today's cheapest price.", footer };
    case "basket":
      return { eyebrow: "Your basket", title: "Which store prices your whole list lowest?", subtitle: "Set real amounts, half a kilo or two, and see every store's total for the lot. It stays in your browser.", footer };
    case "about":
      return { eyebrow: "About PriceLens", title: "Where the prices come from and how they are matched", subtitle: "Central Bank, Census and Statistics, HARTI, and the online shelves of Keells, Cargills, Glomark and SPAR.", footer };
    default:
      return null;
  }
}

export function productCard(product: PublicProductCard, overview: PublicOverview | null, photo?: Buffer | undefined): Card {
  const rows: CardRow[] = groupOrder
    .map((group) => product.prices.find((price) => price.group === group))
    .filter((price): price is PublicProductCard["prices"][number] => Boolean(price))
    .map((price) => {
      const change = (price as { change_30d_pct?: number | null }).change_30d_pct ?? null;
      const note = change !== null && Math.abs(change) >= 1 ? `${change > 0 ? "+" : "-"}${Math.abs(Math.round(change))}% in 30 days` : undefined;
      return { label: `${groupLabels[price.group] ?? price.group} · ${price.sellers} ${price.sellers === 1 ? "seller" : "sellers"}`, value: `${range(price.low, price.high)} ${unitLabels[price.unit] ?? price.unit}`, note, noteColour: change !== null && change > 0 ? colours.up : colours.down };
    });
  return {
    eyebrow: `${prettyCategory(product.category)} · Sri Lanka price today`,
    title: product.label,
    subtitle: rows.length ? undefined : "No published price in the last 30 days.",
    rows,
    footer: asOfFooter(overview),
    image: photo ? { data: photo, mime: "image/jpeg" } : undefined,
  };
}

export type CardDish = { id: string; names: { en?: string | undefined }; summary?: string | undefined; category?: string | undefined; difficulty?: string | undefined; prep_minutes?: number | undefined; cook_minutes?: number | undefined; key_ingredients?: unknown[] | undefined; other_ingredients?: unknown[] | undefined };

export function recipeCard(dish: CardDish, overview: PublicOverview | null): Card {
  const minutes = (dish.prep_minutes ?? 0) + (dish.cook_minutes ?? 0);
  const ingredients = (dish.key_ingredients?.length ?? 0) + (dish.other_ingredients?.length ?? 0);
  const stats: CardStat[] = [];
  if (ingredients) stats.push({ value: String(ingredients), label: "ingredients" });
  if (minutes) stats.push({ value: `${minutes} min`, label: "prep and cook" });
  if (dish.difficulty) stats.push({ value: dish.difficulty.charAt(0).toUpperCase() + dish.difficulty.slice(1), label: "difficulty" });
  return {
    eyebrow: `${dish.category ? `${prettyCategory(dish.category)} · ` : ""}Sri Lankan recipe`,
    title: dish.names.en ?? dish.id,
    subtitle: dish.summary,
    stats,
    footer: asOfFooter(overview),
  };
}

/** The photo for a product, when the site has one. */
export function productPhoto(imagesRoot: string, productId: string): Buffer | undefined {
  const file = resolve(imagesRoot, "products", `${productId.replace(/^product_/u, "")}.jpg`);
  return existsSync(file) ? readFileSync(file) : undefined;
}

/** Rendered cards, kept for an hour so a popular link costs one render. */
export class CardCache {
  private readonly entries = new Map<string, { png: Buffer; expires: number }>();
  private readonly ttlMs: number;
  private readonly limit: number;
  constructor(ttlMs = 60 * 60 * 1000, limit = 1000) {
    this.ttlMs = ttlMs;
    this.limit = limit;
  }
  async get(key: string, build: () => Promise<Buffer>): Promise<Buffer> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.png;
    const png = await build();
    if (this.entries.size >= this.limit) this.entries.clear();
    this.entries.set(key, { png, expires: now + this.ttlMs });
    return png;
  }
}
