import { z } from "zod";

import { decodeText, fetchWithPolicy } from "../http.ts";
import { baseSettingsSchema } from "../settings.ts";
import { dedupeRecords, normalizeUnit, priceToMinor, trimNumber, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const glomarkSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://glomark.lk").describe("Glomark storefront origin"),
  categoryPaths: z
    .array(z.string().min(1).startsWith("/"))
    .min(1)
    .default([
      "/fresh/vegetable/up-country-vegetable/sc/801",
      "/fresh/vegetable/low-country-vegetable/sc/799",
      "/fresh/vegetable/leaves%2Cpackets-and-mushrooms/sc/798",
      "/fresh/vegetable/exotic-vegetable/sc/797",
    ])
    .describe("Category or sub-category paths to capture"),
  maxPagesPerCategory: z.number().int().min(1).max(50).default(10),
  requestGapMs: z.number().int().min(0).max(60_000).default(1_500).describe("Pause between page requests"),
});
export type GlomarkSettings = z.infer<typeof glomarkSettingsSchema>;

export type GlomarkProduct = { id: string; name: string; quantity: string; unit: string; price: number; path: string; page: number };
type PageSnapshot = { path: string; page: number; products: GlomarkProduct[] };

export const glomarkAdapter: RetailAdapter<GlomarkSettings> = {
  kind: "glomark_html",
  label: "Glomark (glomark.lk)",
  description: "Reads the server-rendered category pages; the site's robots file allows crawling and needs no session.",
  marketLabel: "Glomark Online",
  priceType: "retail_online_store",
  settingsSchema: glomarkSettingsSchema,
  async fetch(settings, context) {
    const policy = { attempts: settings.maxAttempts, timeoutMs: settings.requestTimeoutMs, userAgent: context.userAgent, maxBytes: 8 * 1024 * 1024 };
    const pages: PageSnapshot[] = [];
    let requests = 0;
    let first = true;
    for (const path of settings.categoryPaths) {
      for (let page = 1; page <= settings.maxPagesPerCategory; page += 1) {
        if (!first && settings.requestGapMs) await pause(settings.requestGapMs);
        first = false;
        const url = `${settings.baseUrl}${path}${page > 1 ? `${path.includes("?") ? "&" : "?"}page=${page}` : ""}`;
        const result = await fetchWithPolicy(context.http, url, { headers: { accept: "text/html" } }, policy);
        requests += result.attempts;
        const products = parseGlomarkProducts(decodeText(result.body), path, page);
        context.log("info", "Category page fetched", { path, page, products: products.length });
        pages.push({ path, page, products });
        if (!products.length || !hasNextPage(decodeText(result.body), page)) break;
      }
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { pages } };
  },
  normalize(payload, _settings, date) {
    const data = payload.data as { pages?: PageSnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const page of data.pages ?? []) {
      for (const product of page.products) {
        records.push({
          rowRef: product.id,
          itemLabel: product.name,
          marketLabel: glomarkAdapter.marketLabel,
          date,
          sourceQuantity: product.quantity,
          sourceUnit: product.unit,
          minValueMinor: priceToMinor(product.price),
          maxValueMinor: priceToMinor(product.price),
          raw: { product_id: product.id, path: product.path, page: product.page },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/**
 * Each card looks like: `<div class="product-box">…<a href="/chinese-cabbage/p/12720">…
 * <h3 class="product-title"><span class="light-font"> Chinese Cabbage</span></h3>…
 * <div class="product-Quanitity">Per &nbsp;100&nbsp;g(s)</div><div class="price"><strong>Rs 90.00</strong>`.
 */
export function parseGlomarkProducts(html: string, path: string, page: number): GlomarkProduct[] {
  const products: GlomarkProduct[] = [];
  const cards = html.split(/class="product-box/u).slice(1);
  for (const card of cards) {
    const id = card.match(/\/p\/(\d+)/u)?.[1];
    const name = card.match(/class="product-title">\s*(?:<span[^>]*>)?\s*([^<]+?)\s*<\/span>/u)?.[1]
      ?? card.match(/class="product-title">\s*([^<]+?)\s*</u)?.[1];
    const quantityMatch = card.match(/product-Quanitity">\s*Per\s*(?:&nbsp;|\s)*([\d.]+)\s*(?:&nbsp;|\s)*([A-Za-z]+)/u);
    const priceMatch = card.match(/class="price"[\s\S]{0,400}?Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/u);
    if (!id || !name || !priceMatch?.[1]) continue;
    const price = Number(priceMatch[1].replaceAll(",", ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    products.push({
      id,
      name: decodeEntities(name).replace(/\s+/gu, " ").trim(),
      quantity: quantityMatch?.[1] ? trimNumber(quantityMatch[1]) : "1",
      unit: quantityMatch?.[2] ? normalizeUnit(quantityMatch[2].replace(/\(s\)$/u, "")) : "piece",
      price,
      path,
      page,
    });
  }
  return products;
}

function hasNextPage(html: string, page: number): boolean {
  return new RegExp(`[?&]page=${page + 1}\\b`, "u").test(html) || /rel="next"/u.test(html);
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/gu, "&").replace(/&#39;/gu, "'").replace(/&quot;/gu, '"').replace(/&nbsp;/gu, " ");
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
