import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { storeImagesRoot } from "@lanka-pricelens/foundry/retail";
import type { DealsDay } from "@lanka-pricelens/foundry/deals";
import { message, type Message } from "@lanka-pricelens/notify";
import sharp from "sharp";

import { formatMinor } from "../newsletters/deals.ts";
import { dayWordsSinhala } from "../newsletters/time.ts";
import { colours, defaultImagesRoot, markData, productPhoto, renderSvg, siteHost } from "../og.ts";
import { shapedFit, shapedText, shapedWidth } from "../shape.ts";

/**
 * The day's deals as a Facebook Page post (docs/distribution.md): a picture drawn here and a short
 * caption, both in Sinhala, the language the readers the post is for actually read. The words are
 * shaped with HarfBuzz (see ../shape.ts) because the renderer alone draws Sinhala wrongly.
 *
 * The item beside each row is the store's own picture of the pack on offer, the one the reader
 * will recognise on the shelf, with our own photograph behind it and a lettered tile last. Those
 * pictures are the stores' property: they are shown as the store published them, beside the
 * store's name, and a store that objects is taken out of `LPL_STORE_IMAGES_DISABLED` territory
 * the same way the site's own pictures are.
 */

export type PostDeal = {
  /** Which product this is, so the card can look for our own photograph of it. */
  productId: string;
  label: string;
  store: string;
  /** What kind of row this is. The caption groups on this, not on the words, which are Sinhala and would break the grouping if they changed. */
  kind: "offer" | "drop" | "cheapest";
  /** The Sinhala words under the product, in the caption and on the picture: "හැමෝටම", "ඊයේට වඩා අඩුයි". */
  note: string;
  /** The store's own picture of this pack ("<source>/ab/<sha>.jpg" under the store-image root), when the capture took one. */
  imagePath: string | null;
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
    push(offer.product_id, { productId: offer.product_id, label: offer.store_label || offer.label, store: offer.market, kind: "offer", note: offer.audience === "members" ? `${offer.offer_label ?? "loyalty"} සාමාජිකයන්ට` : "හැමෝටම", imagePath: offer.image_path ?? null, now: formatMinor(offer.now_minor), was: formatMinor(offer.was_minor), pct: offer.pct });
  }
  for (const deal of day.deals) {
    if (deal.pct >= 0) continue;
    push(deal.product_id, { productId: deal.product_id, label: deal.label, store: deal.market, kind: "drop", note: deal.baseline === "yesterday" ? "ඊයේට වඩා අඩුයි" : "සති දෙකේ මිලට වඩා අඩුයි", imagePath: null, now: formatMinor(deal.now_minor, deal.unit), was: formatMinor(deal.was_minor), pct: deal.pct });
  }
  for (const deal of day.cheapest) {
    push(deal.product_id, { productId: deal.product_id, label: deal.label, store: deal.market, kind: "cheapest", note: "අද අඩුම මිල මෙතන", imagePath: null, now: formatMinor(deal.now_minor, deal.unit), was: null, pct: deal.pct });
  }
  return rows;
}

// --- The picture ----------------------------------------------------------------------------

export const postCardWidth = 1080;
export const postCardHeight = 1350;

const thumbSize = 96;
/** What a picture on the card is resized to: twice the drawn size, so it stays sharp on a phone. */
const thumbPixels = thumbSize * 2;
/** A stored picture's path, exactly as the capture files one; nothing else is opened from the disk. */
const storedPicture = /^[a-z0-9_]+\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:jpg|png|webp|gif|avif)$/u;

export type DealPicture = { data: Buffer; mime: "image/jpeg" | "image/png" };
/** Pictures already prepared, so a card redrawn within the hour re-encodes nothing. */
const pictures = new Map<string, DealPicture | null>();

/**
 * The store's own picture of the pack on offer, resized and re-encoded as a JPEG the renderer can
 * read (it does not decode WebP, which is what several of the stores publish). Only a path the
 * capture itself filed is opened, and only under the store-image root.
 */
async function storePicture(imagePath: string): Promise<DealPicture | null> {
  if (!storedPicture.test(imagePath)) return null;
  const known = pictures.get(imagePath);
  if (known !== undefined) return known;
  const file = resolve(storeImagesRoot(), imagePath);
  let picture: DealPicture | null = null;
  if (existsSync(file)) {
    try {
      const data = await sharp(readFileSync(file), { limitInputPixels: 100_000_000 })
        .resize({ width: thumbPixels, height: thumbPixels, fit: "cover", withoutEnlargement: true })
        .flatten({ background: "#101a16" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      picture = { data, mime: "image/jpeg" };
    } catch {
      picture = null;
    }
  }
  if (pictures.size > 500) pictures.clear();
  pictures.set(imagePath, picture);
  return picture;
}

/**
 * The picture for every row, the store's own first and our own photograph behind it. Prepared
 * before the card is drawn because re-encoding is asynchronous and the drawing is not.
 */
export async function dealPictures(deals: readonly PostDeal[]): Promise<Map<string, DealPicture>> {
  const found = new Map<string, DealPicture>();
  for (const deal of deals) {
    const stored = deal.imagePath ? await storePicture(deal.imagePath) : null;
    if (stored) {
      found.set(deal.productId, stored);
      continue;
    }
    const ours = productPhoto(defaultImagesRoot(), deal.productId);
    if (ours) found.set(deal.productId, { data: ours, mime: "image/jpeg" });
  }
  return found;
}

/**
 * The little picture beside a row: the store's own photograph of the pack when the capture took
 * one, else ours from data/images/products, else a lettered tile, which reads as a deliberate
 * mark rather than a hole.
 */
function thumb(deal: PostDeal, x: number, y: number, picture: DealPicture | undefined): string {
  const clip = `thumb-${deal.productId.replace(/[^a-z0-9]/giu, "")}`;
  if (picture) {
    return (
      `<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${thumbSize}" height="${thumbSize}" rx="18"/></clipPath></defs>` +
      `<image x="${x}" y="${y}" width="${thumbSize}" height="${thumbSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" xlink:href="data:${picture.mime};base64,${picture.data.toString("base64")}"/>` +
      `<rect x="${x}" y="${y}" width="${thumbSize}" height="${thumbSize}" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>`
    );
  }
  const letter = (deal.label.trim()[0] ?? "?").toUpperCase();
  return (
    `<rect x="${x}" y="${y}" width="${thumbSize}" height="${thumbSize}" rx="18" fill="${colours.greenDeep}" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.10"/>` +
    shapedText(x + thumbSize / 2, y + thumbSize / 2 + 15, letter, 42, colours.green, { weight: 600, anchor: "middle" })
  );
}

const pctWords = (pct: number): string => `${pct < 0 ? "−" : "+"}${Math.round(Math.abs(pct))}%`;

/**
 * The card's own words, all of them Sinhala. The products keep the store's own spelling of the
 * pack, which is how a reader finds it in the aisle, and the store's name stays as the store
 * writes it; everything the card says around them is ours.
 */
export const cardWords = {
  eyebrow: "අද සුපර්මාර්කට් ඕෆර්",
  headline: ["අද උදේ කඩවල", "මිල අඩු කළ භාණ්ඩ"],
  footer: "මිල කඩවලම නිල වෙබ් අඩවි වලින්",
} as const;

export function dealsCardSvg(day: string, deals: PostDeal[], pictures: Map<string, DealPicture> = new Map()): string {
  const left = 64;
  const width = postCardWidth - left * 2;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${postCardWidth}" height="${postCardHeight}" viewBox="0 0 ${postCardWidth} ${postCardHeight}">`);
  parts.push(`<defs><radialGradient id="glow" cx="940" cy="-60" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${colours.green}" stop-opacity="0.24"/><stop offset="1" stop-color="${colours.green}" stop-opacity="0"/></radialGradient></defs>`);
  parts.push(`<rect width="${postCardWidth}" height="${postCardHeight}" fill="${colours.background}"/><rect width="${postCardWidth}" height="${postCardHeight}" fill="url(#glow)"/><rect width="${postCardWidth}" height="8" fill="${colours.greenDeep}"/>`);
  // Brand and the day.
  parts.push(markData ? `<image x="${left}" y="56" width="56" height="56" xlink:href="data:image/png;base64,${markData}"/>` : `<rect x="${left}" y="56" width="56" height="56" rx="14" fill="${colours.greenDeep}"/>`);
  parts.push(shapedText(left + 72, 96, "PriceLens", 34, colours.text, { weight: 600 }));
  parts.push(shapedText(postCardWidth - left, 96, dayWordsSinhala(day), 26, colours.muted, { weight: 500, anchor: "end" }));
  parts.push(shapedText(left, 200, cardWords.eyebrow, 26, colours.green, { weight: 600 }));
  // Sinhala sits taller than Latin, so the headline is measured and stepped down until it fits.
  const headlineSize = [62, 58, 54, 50].find((size) => cardWords.headline.every((line) => shapedWidth(line, size, { weight: 600 }) <= width)) ?? 46;
  cardWords.headline.forEach((line, index) => parts.push(shapedText(left, 276 + index * (headlineSize + 12), line, headlineSize, colours.text, { weight: 600 })));
  // One panel per deal. Six rows fill the card; fewer rows grow taller so a quiet day does not leave half of it empty.
  const shown = deals.slice(0, postRules.cardRows);
  const gap = 16;
  const rowHeight = Math.min(176, Math.floor((840 - gap * Math.max(0, shown.length - 1)) / Math.max(1, shown.length)));
  let top = 400;
  for (const deal of shown) {
    parts.push(`<rect x="${left}" y="${top}" width="${width}" height="${rowHeight}" rx="22" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>`);
    const inset = top + Math.floor((rowHeight - 128) / 2);
    const badge = pctWords(deal.pct);
    const badgeWidth = Math.ceil(shapedWidth(badge, 26, { weight: 700 })) + 36;
    const priceWidth = Math.max(shapedWidth(deal.now, 38, { weight: 600 }), deal.was ? shapedWidth(deal.was, 24) : 0);
    const textLeft = left + 28 + thumbSize + 24;
    const labelRoom = width - 56 - thumbSize - 24 - priceWidth - 40;
    parts.push(thumb(deal, left + 28, inset + Math.floor((128 - thumbSize) / 2) + 8, pictures.get(deal.productId)));
    parts.push(shapedText(textLeft, inset + 54, shapedFit(deal.label, 31, labelRoom, { weight: 600 }), 31, colours.text, { weight: 600 }));
    parts.push(`<rect x="${textLeft}" y="${inset + 74}" width="${badgeWidth}" height="36" rx="18" fill="${deal.pct < 0 ? colours.green : colours.up}" fill-opacity="0.16"/>`);
    parts.push(shapedText(textLeft + badgeWidth / 2, inset + 100, badge, 24, deal.pct < 0 ? colours.green : colours.up, { weight: 700, anchor: "middle" }));
    parts.push(shapedText(textLeft + badgeWidth + 16, inset + 100, shapedFit(`${deal.store} · ${deal.note}`, 24, labelRoom - badgeWidth - 16), 24, colours.muted));
    parts.push(shapedText(left + width - 28, inset + 58, deal.now, 38, colours.text, { weight: 600, anchor: "end" }));
    if (deal.was) parts.push(shapedText(left + width - 28, inset + 100, deal.was, 24, colours.muted, { anchor: "end", strike: true }));
    top += rowHeight + gap;
  }
  // Footer.
  parts.push(`<line x1="${left}" y1="1268" x2="${postCardWidth - left}" y2="1268" stroke="#ffffff" stroke-opacity="0.08"/>`);
  parts.push(shapedText(left, 1312, `${siteHost}/deals`, 26, colours.text, { weight: 600 }));
  parts.push(shapedText(postCardWidth - left, 1312, cardWords.footer, 22, colours.muted, { anchor: "end" }));
  parts.push("</svg>");
  return parts.join("");
}

/** The day's card as a PNG. Asynchronous because the stores' pictures are re-encoded before it is drawn. */
export async function renderDealsCard(day: string, deals: PostDeal[]): Promise<Buffer> {
  return renderSvg(dealsCardSvg(day, deals, await dealPictures(deals)), postCardWidth);
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
