import type { DealsDay } from "@lanka-pricelens/foundry/deals";
import { message, type Message } from "@lanka-pricelens/notify";

import { formatMinor } from "../newsletters/deals.ts";
import { dayWords, dayWordsSinhala } from "../newsletters/time.ts";
import { colours, escape, fontFamily, markData, renderSvg, siteHost, textWidth } from "../og.ts";

/**
 * The day's deals as a Facebook Page post (docs/distribution.md): a picture drawn here and a short
 * caption. The picture is ours from corner to corner: the site's colours, the store's name as
 * words, the prices the store itself lists. No store logo and no store photograph goes to
 * Facebook, where a rights complaint takes a post down and repeated ones take the Page.
 */

export type PostDeal = {
  label: string;
  store: string;
  /** What kind of row this is. The caption groups on this, not on the words, which are Sinhala and would break the grouping if they changed. */
  kind: "offer" | "drop" | "cheapest";
  /** The Sinhala words under the product in the caption: "හැමෝටම", "ඊයේට වඩා අඩුයි". */
  note: string;
  /** The same thing in English, for the picture: resvg cannot shape Sinhala (see dealsCardSvg). */
  noteEnglish: string;
  now: string;
  was: string | null;
  /** Signed: -30 is 30 % off. */
  pct: number;
};

export const postRules = { cardRows: 6, captionOffers: 5, captionDrops: 3 };

/** The rows a post leads with: the stores' own offers on food the site tracks, then the biggest drops, then the cheapest-store picks; one row per product. */
export function postDeals(day: DealsDay, limit = postRules.cardRows): PostDeal[] {
  const rows: PostDeal[] = [];
  const seen = new Set<string>();
  const push = (productId: string, deal: PostDeal) => {
    if (seen.has(productId) || rows.length >= limit) return;
    seen.add(productId);
    rows.push(deal);
  };
  for (const offer of day.store_offers ?? []) {
    push(offer.product_id, { label: offer.store_label || offer.label, store: offer.market, kind: "offer", note: offer.audience === "members" ? `${offer.offer_label ?? "loyalty"} සාමාජිකයන්ට` : "හැමෝටම", noteEnglish: offer.audience === "members" ? `${offer.offer_label ?? "loyalty"} members` : "for everyone", now: formatMinor(offer.now_minor), was: formatMinor(offer.was_minor), pct: offer.pct });
  }
  for (const deal of day.deals) {
    if (deal.pct >= 0) continue;
    push(deal.product_id, { label: deal.label, store: deal.market, kind: "drop", note: deal.baseline === "yesterday" ? "ඊයේට වඩා අඩුයි" : "සති දෙකේ මිලට වඩා අඩුයි", noteEnglish: deal.baseline === "yesterday" ? "down since yesterday" : "below its two-week price", now: formatMinor(deal.now_minor, deal.unit), was: formatMinor(deal.was_minor), pct: deal.pct });
  }
  for (const deal of day.cheapest) {
    push(deal.product_id, { label: deal.label, store: deal.market, kind: "cheapest", note: "අද අඩුම මිල මෙතන", noteEnglish: "cheapest store today", now: formatMinor(deal.now_minor, deal.unit), was: null, pct: deal.pct });
  }
  return rows;
}

// --- The picture ----------------------------------------------------------------------------

export const postCardWidth = 1080;
export const postCardHeight = 1350;

const text = (x: number, y: number, content: string, size: number, fill: string, weight = 400, extra = ""): string => `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escape(content)}</text>`;

/** Cuts a label to the width with an ellipsis, on a word boundary when one is near. */
function fit(label: string, size: number, width: number, weight: number): string {
  if (textWidth(label, size, weight) <= width) return label;
  let cut = label;
  while (cut.length > 1 && textWidth(`${cut}…`, size, weight) > width) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  return `${(space > cut.length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const pctWords = (pct: number): string => `${pct < 0 ? "−" : "+"}${Math.round(Math.abs(pct))}%`;

export function dealsCardSvg(day: string, deals: PostDeal[]): string {
  const left = 64;
  const width = postCardWidth - left * 2;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${postCardWidth}" height="${postCardHeight}" viewBox="0 0 ${postCardWidth} ${postCardHeight}">`);
  parts.push(`<defs><radialGradient id="glow" cx="940" cy="-60" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${colours.green}" stop-opacity="0.24"/><stop offset="1" stop-color="${colours.green}" stop-opacity="0"/></radialGradient></defs>`);
  parts.push(`<rect width="${postCardWidth}" height="${postCardHeight}" fill="${colours.background}"/><rect width="${postCardWidth}" height="${postCardHeight}" fill="url(#glow)"/><rect width="${postCardWidth}" height="8" fill="${colours.greenDeep}"/>`);
  // Brand and the day.
  parts.push(markData ? `<image x="${left}" y="56" width="56" height="56" xlink:href="data:image/png;base64,${markData}"/>` : `<rect x="${left}" y="56" width="56" height="56" rx="14" fill="${colours.greenDeep}"/>`);
  parts.push(text(left + 72, 96, "PriceLens", 34, colours.text, 600));
  parts.push(text(postCardWidth - left, 96, dayWords(day), 26, colours.muted, 500, 'text-anchor="end"'));
  parts.push(text(left, 196, "SUPERMARKET DEALS TODAY", 22, colours.green, 600, 'letter-spacing="3.5"'));
  parts.push(text(left, 272, "What the stores", 66, colours.text, 600, 'letter-spacing="-1.5"'));
  parts.push(text(left, 346, "marked down this morning", 66, colours.text, 600, 'letter-spacing="-1.5"'));
  // One panel per deal. Six rows fill the card; fewer rows grow taller so a quiet day does not leave half of it empty.
  const shown = deals.slice(0, postRules.cardRows);
  const gap = 16;
  const rowHeight = Math.min(176, Math.floor((840 - gap * Math.max(0, shown.length - 1)) / Math.max(1, shown.length)));
  let top = 400;
  for (const deal of shown) {
    parts.push(`<rect x="${left}" y="${top}" width="${width}" height="${rowHeight}" rx="22" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>`);
    const inset = top + Math.floor((rowHeight - 128) / 2);
    const badge = pctWords(deal.pct);
    const badgeWidth = Math.ceil(textWidth(badge, 26, 700)) + 36;
    const priceWidth = Math.max(textWidth(deal.now, 38, 600), deal.was ? textWidth(deal.was, 24) : 0);
    const labelRoom = width - 56 - priceWidth - 40;
    parts.push(text(left + 28, inset + 54, fit(deal.label, 31, labelRoom, 600), 31, colours.text, 600));
    parts.push(`<rect x="${left + 28}" y="${inset + 74}" width="${badgeWidth}" height="36" rx="18" fill="${deal.pct < 0 ? colours.green : colours.up}" fill-opacity="0.16"/>`);
    parts.push(text(left + 28 + badgeWidth / 2, inset + 100, badge, 24, deal.pct < 0 ? colours.green : colours.up, 700, 'text-anchor="middle"'));
    parts.push(text(left + 28 + badgeWidth + 16, inset + 100, fit(`${deal.store} · ${deal.noteEnglish}`, 24, labelRoom - badgeWidth - 16, 400), 24, colours.muted));
    parts.push(text(left + width - 28, inset + 58, deal.now, 38, colours.text, 600, 'text-anchor="end"'));
    if (deal.was) parts.push(text(left + width - 28, inset + 100, deal.was, 24, colours.muted, 400, 'text-anchor="end" text-decoration="line-through"'));
    top += rowHeight + gap;
  }
  // Footer.
  parts.push(`<line x1="${left}" y1="1268" x2="${postCardWidth - left}" y2="1268" stroke="#ffffff" stroke-opacity="0.08"/>`);
  parts.push(text(left, 1312, `${siteHost}/deals`, 26, colours.text, 600));
  parts.push(text(postCardWidth - left, 1312, "Prices as the stores list them", 22, colours.muted, 400, 'text-anchor="end"'));
  parts.push("</svg>");
  return parts.join("");
}

export function renderDealsCard(day: string, deals: PostDeal[]): Buffer {
  return renderSvg(dealsCardSvg(day, deals), postCardWidth);
}

/** Where the day's picture is served; Facebook fetches it from here when the post is published. */
export function dealsCardUrl(siteOrigin: string, day: string): string {
  return `${siteOrigin.replace(/\/+$/u, "")}/og/deals/${day}.png`;
}

// --- The caption ----------------------------------------------------------------------------

/** The same post every morning reads as a machine, to readers and to Facebook alike; the opening line turns with the day. */
const openings = [
  "අද උදේ සුපර්මාර්කට් වල මිල අඩු කළ භාණ්ඩ, ඒ කඩවලම නිල වෙබ් අඩවි වලින්.",
  "කඩේ යන්න කලින් බලන්න: අද සුපර්මාර්කට් වල තියෙන ඕෆර්.",
  "අද උදේ මිල ගණන් ආවා. සුපර්මාර්කට් වල ලොකුම මිල අඩු කිරීම් මෙන්න.",
  "සුපර්මාර්කට් වලම නිල මිල අනුව, අද මිල අඩු වුණු භාණ්ඩ.",
  "අද බඩු ගන්න කලින් මේක බලන්න: කඩවල් ම දාලා තියෙන අද ඕෆර්.",
];

function dayNumber(day: string): number {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? 0 : Math.floor(date.valueOf() / 86_400_000);
}

/** The day's post, or null when the day has nothing worth a post. */
export function facebookDealsPost(day: DealsDay, siteOrigin: string, options: { dedupeKey?: string | undefined } = {}): Message | null {
  const origin = siteOrigin.replace(/\/+$/u, "");
  const rows = postDeals(day, postRules.captionOffers + postRules.captionDrops);
  if (rows.length < 3) return null;
  // The product name is left exactly as the store writes it on its own shelf label, which is how a
  // reader finds it in the aisle; everything the post says around it is ours, and is Sinhala.
  const line = (deal: PostDeal) => ({ text: deal.label, value: deal.now, change: deal.pct, note: deal.was ? `කලින් ${deal.was} · ${deal.store} · ${deal.note}` : `${deal.store} · ${deal.note}` });
  const offers = rows.filter((deal) => deal.kind === "offer").slice(0, postRules.captionOffers);
  const moves = rows.filter((deal) => !offers.includes(deal)).slice(0, postRules.captionDrops);
  const stores = day.stores.map((store) => store.label.replace(/\s+Online$/u, ""));
  const words = dayWordsSinhala(day.day);
  return message({
    title: `අද සුපර්මාර්කට් ඕෆර් · ${words}`,
    summary: openings[dayNumber(day.day) % openings.length],
    sections: [...(offers.length ? [{ heading: "කඩවල ඕෆර්", lines: offers.map(line) }] : []), ...(moves.length ? [{ heading: offers.length ? "තවත් මිල අඩු වුණු" : "අද හොඳම මිල", lines: moves.map(line) }] : [])],
    actions: [{ label: "හැම ඕෆර් එකක්ම බලන්න පිවිසෙන්න", url: `${origin}/deals` }],
    image: { url: dealsCardUrl(origin, day.day), alt: `${words} දින සුපර්මාර්කට් ඕෆර්` },
    footer: `${words} දින එක් එක් කඩේ නිල වෙබ් අඩවියේ තිබූ මිල${stores.length ? ` (${stores.join(", ")})` : ""}. PriceLens ස්වාධීන සේවාවකි. අපි ඉහත කිසිදු ආයතනයක් සමඟ සම්බන්ධතාවක් නොමැත.`,
    dedupe_key: options.dedupeKey ?? `facebook:deals_daily:${day.day}`,
    // These are published as hashtags, so they are the reader's words, not ours for routing; what
    // this post is and where it goes is already in the dedupe key and the outbox's own channel.
    tags: ["බඩුමිල", "SriLanka", "GroceryPrices", "PriceLens"],
  });
}
