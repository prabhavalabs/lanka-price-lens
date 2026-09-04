import { z } from "zod";

import { fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema } from "../settings.ts";
import { dedupeRecords, packFromLabel, priceToMinor, trimNumber, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const sparSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://spar2u.lk").describe("Shopify storefront origin"),
  collections: z.array(z.string().min(1)).min(1).default(["vegetables", "fruits"]).describe("Collection handles to capture"),
  pageSize: z.number().int().min(1).max(250).default(250).describe("Products per page (Shopify allows up to 250)"),
});
export type SparSettings = z.infer<typeof sparSettingsSchema>;

type ShopifyVariant = { id: number; title: string; price: string; available: boolean; grams?: number; sku?: string };
type ShopifyProduct = { id: number; title: string; handle: string; updated_at?: string; product_type?: string; variants: ShopifyVariant[] };
type CollectionSnapshot = { handle: string; products: ShopifyProduct[] };

export const sparAdapter: RetailAdapter<SparSettings> = {
  kind: "spar_shopify",
  label: "SPAR Sri Lanka (spar2u.lk)",
  description: "Reads the public Shopify product feed for each collection. One request per page, no session.",
  marketLabel: "SPAR Online",
  priceType: "retail_online_store",
  settingsSchema: sparSettingsSchema,
  async fetch(settings, context) {
    const collections: CollectionSnapshot[] = [];
    let requests = 0;
    for (const handle of settings.collections) {
      const products: ShopifyProduct[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const url = `${settings.baseUrl}/collections/${encodeURIComponent(handle)}/products.json?limit=${settings.pageSize}&page=${page}`;
        const result = await fetchWithPolicy(context.http, url, { headers: { accept: "application/json" } }, {
          attempts: settings.maxAttempts,
          timeoutMs: settings.requestTimeoutMs,
          userAgent: context.userAgent,
        });
        requests += result.attempts;
        const body = parseJsonBody<{ products?: ShopifyProduct[] }>(result.body, url);
        const batch = body.products ?? [];
        products.push(...batch);
        context.log("info", "Collection page fetched", { collection: handle, page, products: batch.length });
        if (batch.length < settings.pageSize) break;
      }
      collections.push({ handle, products });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { collections } };
  },
  normalize(payload, _settings, date) {
    const data = payload.data as { collections?: CollectionSnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const collection of data.collections ?? []) {
      for (const product of collection.products) {
        const variant = product.variants?.[0];
        if (!variant) continue;
        const price = Number(variant.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const pack = sparPack(variant.title, product.title);
        records.push({
          rowRef: `${collection.handle}:${product.id}:${variant.id}`,
          itemLabel: cleanTitle(product.title),
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
            collection: collection.handle,
            variant_title: variant.title,
            available: variant.available,
            sku: variant.sku ?? null,
            updated_at: product.updated_at ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/** Spar encodes weight-priced items as "WT / 1000" (grams); "WT" alone is per kilogram; everything else is per piece. */
export function sparPack(variantTitle: string, productTitle: string): { quantity: string; unit: string } {
  const weight = variantTitle.match(/WT\s*\/\s*(\d+(?:\.\d+)?)/iu);
  if (weight?.[1]) return { quantity: trimNumber(weight[1]), unit: "g" };
  if (/^\s*WT\s*$/iu.test(variantTitle)) return { quantity: "1", unit: "kg" };
  if (/\beach\b/iu.test(productTitle)) return { quantity: "1", unit: "piece" };
  return packFromLabel(productTitle) ?? { quantity: "1", unit: "piece" };
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim();
}
