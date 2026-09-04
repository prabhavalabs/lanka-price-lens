import { z } from "zod";

import { fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema, categoryAllowed, compilePattern, patternSetting } from "../settings.ts";
import { dedupeRecords, packFromLabel, priceToMinor, trimNumber, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const sparSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://spar2u.lk").describe("Shopify storefront origin"),
  collections: z
    .array(z.string().min(1))
    .default([])
    .describe("Collection handles to capture; leave empty to capture the whole catalogue through the store-wide product feed"),
  pageSize: z.number().int().min(1).max(250).default(250).describe("Products per page (Shopify allows up to 250)"),
  maxPages: z.number().int().min(1).max(500).default(80).describe("Safety cap on pages fetched per feed"),
  includeProductTypes: patternSetting("Only keep products whose Shopify product type matches this pattern (for example ^(Vegetables|Fruits)$)"),
  excludeProductTypes: patternSetting("Drop products whose Shopify product type matches this pattern"),
  outletVariants: z
    .enum(["first", "all"])
    .default("first")
    .describe("SPAR repeats every product once per outlet as a variant (WT, GL, GP, …). \"first\" keeps one outlet's prices; \"all\" keeps every outlet"),
});
export type SparSettings = z.infer<typeof sparSettingsSchema>;

type ShopifyVariant = { id: number; title: string; price: string; available: boolean; grams?: number; sku?: string | null };
type ShopifyProduct = { id: number; title: string; handle: string; updated_at?: string; product_type?: string; vendor?: string; variants: ShopifyVariant[] };
type FeedSnapshot = { handle: string | null; pages: number; truncated: boolean; products: ShopifyProduct[] };

export const sparAdapter: RetailAdapter<SparSettings> = {
  kind: "spar_shopify",
  label: "SPAR Sri Lanka (spar2u.lk)",
  description: "Reads the public Shopify product feed, store-wide by default or per collection. One request per page, no session.",
  marketLabel: "SPAR Online",
  priceType: "retail_online_store",
  settingsSchema: sparSettingsSchema,
  async fetch(settings, context) {
    const feeds = settings.collections.length
      ? settings.collections.map((handle) => ({ handle, url: `${settings.baseUrl}/collections/${encodeURIComponent(handle)}/products.json` }))
      : [{ handle: null, url: `${settings.baseUrl}/products.json` }];
    const snapshots: FeedSnapshot[] = [];
    let requests = 0;
    for (const feed of feeds) {
      const products: ShopifyProduct[] = [];
      const seen = new Set<number>();
      let pages = 0;
      let truncated = false;
      for (let page = 1; ; page += 1) {
        if (page > settings.maxPages) {
          truncated = true;
          context.log("warning", "Feed page cap reached; raise maxPages to capture the rest", { feed: feed.handle ?? "catalogue", pages: settings.maxPages });
          break;
        }
        const url = `${feed.url}?limit=${settings.pageSize}&page=${page}`;
        const result = await fetchWithPolicy(context.http, url, { headers: { accept: "application/json" } }, {
          attempts: settings.maxAttempts,
          timeoutMs: settings.requestTimeoutMs,
          userAgent: context.userAgent,
        });
        requests += result.attempts;
        pages += 1;
        const batch = parseJsonBody<{ products?: ShopifyProduct[] }>(result.body, url).products ?? [];
        // Shopify repeats the last page when asked past the end; stop as soon as nothing new arrives.
        const fresh = batch.filter((product) => !seen.has(product.id));
        for (const product of fresh) seen.add(product.id);
        products.push(...fresh);
        context.log("info", "Feed page fetched", { feed: feed.handle ?? "catalogue", page, products: fresh.length });
        if (batch.length < settings.pageSize || fresh.length === 0) break;
      }
      snapshots.push({ handle: feed.handle, pages, truncated, products });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { feeds: snapshots } };
  },
  normalize(payload, settings, date) {
    const data = payload.data as { feeds?: FeedSnapshot[] };
    const include = compilePattern(settings.includeProductTypes);
    const exclude = compilePattern(settings.excludeProductTypes);
    const records: NormalizedRecord[] = [];
    for (const feed of data.feeds ?? []) {
      for (const product of feed.products) {
        const productType = (product.product_type ?? "").trim();
        if (!categoryAllowed(productType, include, exclude)) continue;
        const variants = product.variants ?? [];
        const firstOutlet = variants[0] ? outletCode(variants[0].title) : null;
        for (const variant of variants) {
          const outlet = outletCode(variant.title);
          if (settings.outletVariants === "first" && outlet !== firstOutlet) continue;
          const price = Number(variant.price);
          if (!Number.isFinite(price) || price <= 0) continue;
          const label = sparLabel(product.title, variant.title);
          const pack = sparPack(variant.title, label, variant.grams);
          records.push({
            rowRef: `${product.id}:${variant.id}`,
            itemLabel: label,
            marketLabel: sparAdapter.marketLabel,
            date,
            sourceQuantity: pack.quantity,
            sourceUnit: pack.unit,
            minValueMinor: priceToMinor(price),
            maxValueMinor: priceToMinor(price),
            raw: {
              product_id: product.id,
              variant_id: variant.id,
              handle: product.handle,
              collection: feed.handle,
              category: productType || null,
              vendor: product.vendor ?? null,
              variant_title: variant.title,
              outlet_code: outlet,
              available: variant.available,
              grams: variant.grams ?? null,
              sku: variant.sku ?? null,
              updated_at: product.updated_at ?? null,
            },
          });
        }
      }
    }
    return dedupeRecords(records);
  },
};

/** Variant titles are "<outlet> / <grams>" or just "<outlet>", where the outlet is a short code such as WT, GL, or GP. */
export function outletCode(variantTitle: string): string | null {
  const match = variantTitle.match(/^\s*([A-Z]{2,4})\s*(?:\/|$)/u);
  return match?.[1] ?? null;
}

const weightVariant = /^\s*[A-Z]{2,4}(\s*\/\s*\d+(?:\.\d+)?)?\s*$/u;

/** Outlet and weight variants are not part of the product name; other variants (sizes, flavours) are. */
export function sparLabel(productTitle: string, variantTitle: string): string {
  const title = cleanTitle(productTitle);
  const variant = cleanTitle(variantTitle);
  if (!variant || variant === "Default Title" || weightVariant.test(variant) || title.toLowerCase().includes(variant.toLowerCase())) return title;
  return `${title} ${variant}`;
}

/** "<outlet> / 1000" is 1000 g; "<outlet>" alone is per kilogram for loose produce; otherwise read the pack from the label, then Shopify's grams, then per piece. */
export function sparPack(variantTitle: string, label: string, grams?: number): { quantity: string; unit: string } {
  const weight = variantTitle.match(/^\s*[A-Z]{2,4}\s*\/\s*(\d+(?:\.\d+)?)/u);
  if (weight?.[1]) return { quantity: trimNumber(weight[1]), unit: "g" };
  if (/\beach\b/iu.test(label)) return { quantity: "1", unit: "piece" };
  const fromLabel = packFromLabel(label);
  if (fromLabel) return fromLabel;
  if (/^\s*[A-Z]{2,4}\s*$/u.test(variantTitle) && !/\d/u.test(label)) return { quantity: "1", unit: "kg" };
  if (grams && grams > 0) return { quantity: trimNumber(grams), unit: "g" };
  return { quantity: "1", unit: "piece" };
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim();
}
