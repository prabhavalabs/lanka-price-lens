import { z } from "zod";

import { decodeText, fetchWithPolicy } from "../http.ts";
import { baseSettingsSchema, categoryAllowed, compilePattern, patternSetting } from "../settings.ts";
import { dedupeRecords, normalizeUnit, packFromLabel, priceToMinor, trimNumber, type AdapterContext, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const glomarkSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://glomark.lk").describe("Glomark storefront origin"),
  categoryPaths: z
    .array(z.string().min(1).startsWith("/"))
    .default([])
    .describe("Category paths to capture (for example /fresh/vegetable/c/145); leave empty to discover every category from the site navigation"),
  includeCategories: patternSetting("Only keep discovered categories whose path matches this pattern (for example ^/fresh/)"),
  excludeCategories: patternSetting("Drop discovered categories whose path matches this pattern"),
  maxCategories: z.number().int().min(1).max(1000).default(400).describe("Safety cap on category pages fetched per capture"),
  requestGapMs: z.number().int().min(0).max(60_000).default(2_000).describe("Pause between page requests; the site throttles fast crawlers"),
  pageRetries: z.number().int().min(0).max(5).default(3).describe("Extra attempts, with growing pauses, when a category page comes back without its product list"),
  maxUnreadablePagesPct: z.number().min(0).max(100).default(20).describe("Fail the capture when more than this share of category pages stay unreadable, instead of storing a partial snapshot"),
  includeOutOfStock: z.boolean().default(false).describe("Keep products the store marks out of stock"),
});
export type GlomarkSettings = z.infer<typeof glomarkSettingsSchema>;

export type GlomarkProduct = {
  id: number;
  name: string;
  unit: string;
  displayQuantity: number;
  price: number;
  promoPrice?: number | null;
  applicablePrice?: number | null;
  isOutOfStock?: boolean;
  stock?: number;
  erpCode?: string | null;
  department?: { id?: number; name?: string } | null;
  category?: number | null;
  subCategory?: { id?: number; name?: string } | null;
  brand?: number | null;
};
type PageSnapshot = { path: string; products: GlomarkProduct[] };

export const glomarkAdapter: RetailAdapter<GlomarkSettings> = {
  kind: "glomark_html",
  label: "Glomark (glomark.lk)",
  description: "Discovers categories from the site navigation and reads the full product list each category page embeds. No session; the site's robots file allows crawling.",
  marketLabel: "Glomark Online",
  priceType: "retail_online_store",
  settingsSchema: glomarkSettingsSchema,
  async fetch(settings, context) {
    const policy = { attempts: settings.maxAttempts, timeoutMs: settings.requestTimeoutMs, userAgent: context.userAgent, maxBytes: 12 * 1024 * 1024 };
    let requests = 0;
    let paths = settings.categoryPaths;
    let discovered = 0;
    if (!paths.length) {
      const home = await fetchWithPolicy(context.http, `${settings.baseUrl}/`, { headers: { accept: "text/html" } }, policy);
      requests += home.attempts;
      const all = discoverGlomarkCategories(decodeText(home.body));
      discovered = all.length;
      const include = compilePattern(settings.includeCategories);
      const exclude = compilePattern(settings.excludeCategories);
      paths = all.filter((path) => categoryAllowed(path, include, exclude));
      if (!all.length) throw new Error("GLOMARK_NAVIGATION_EMPTY");
      if (!paths.length) throw new Error("GLOMARK_NO_CATEGORIES_SELECTED");
      context.log("info", "Categories discovered", { total: all.length, selected: paths.length });
    }
    if (paths.length > settings.maxCategories) {
      context.log("warning", "Category cap reached; raise maxCategories to capture the rest", { categories: paths.length, cap: settings.maxCategories });
      paths = paths.slice(0, settings.maxCategories);
    }
    const pages: PageSnapshot[] = [];
    const unreadable: string[] = [];
    let first = true;
    for (const path of paths) {
      if (!first && settings.requestGapMs) await pause(settings.requestGapMs);
      first = false;
      const url = `${settings.baseUrl}${path}`;
      let products: GlomarkProduct[] | null = null;
      for (let attempt = 0; attempt <= settings.pageRetries; attempt += 1) {
        if (attempt > 0) {
          // A page without its product list is almost always the site's throttling page; back off before asking again.
          const backoff = Math.min(60_000, Math.max(settings.requestGapMs, 5_000) * 2 ** (attempt - 1));
          context.log("warning", "Category page came back without its product list; pausing before retrying", { path, attempt, pause_ms: backoff });
          await pause(backoff);
        }
        const result = await fetchWithPolicy(context.http, url, { headers: { accept: "text/html" } }, policy);
        requests += result.attempts;
        products = extractGlomarkProducts(decodeText(result.body));
        if (products !== null) break;
      }
      if (products === null) {
        unreadable.push(path);
        continue;
      }
      context.log("info", "Category page fetched", { path, products: products.length });
      pages.push({ path, products });
    }
    const unreadablePct = paths.length ? (unreadable.length / paths.length) * 100 : 0;
    if (unreadable.length) context.log("warning", "Some category pages stayed unreadable", { count: unreadable.length, of: paths.length, paths: unreadable.slice(0, 20) });
    if (!pages.length || unreadablePct > settings.maxUnreadablePagesPct) {
      throw new Error(`SOURCE_TEMPLATE_CHANGED:${unreadable.length} of ${paths.length} category pages carried no product list`);
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { discovered, unreadable, pages } };
  },
  normalize(payload, settings, date) {
    const data = payload.data as { pages?: PageSnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const page of data.pages ?? []) {
      for (const product of page.products) {
        if (product.isOutOfStock && !settings.includeOutOfStock) continue;
        const price = Number(product.applicablePrice ?? product.promoPrice ?? product.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const name = (product.name ?? "").replace(/\s+/gu, " ").trim();
        if (!name) continue;
        const pack = glomarkPack(product.unit, product.displayQuantity, name);
        records.push({
          rowRef: String(product.id),
          itemLabel: name,
          marketLabel: glomarkAdapter.marketLabel,
          date,
          sourceQuantity: pack.quantity,
          sourceUnit: pack.unit,
          minValueMinor: priceToMinor(price),
          maxValueMinor: priceToMinor(price),
          raw: {
            product_id: product.id,
            erp_code: product.erpCode ?? null,
            path: page.path,
            category: [product.department?.name, product.subCategory?.name].filter(Boolean).join(" > ") || null,
            category_id: product.category ?? null,
            list_price: product.price,
            promo_price: product.promoPrice ?? null,
            unit: product.unit,
            display_quantity: product.displayQuantity,
            out_of_stock: Boolean(product.isOutOfStock),
            stock: product.stock ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/**
 * Category links look like /fresh/vegetable/c/145; the navigation repeats each
 * category in several spellings (capitalised, double-encoded), so paths are
 * deduplicated by category id, preferring the plain lower-case form.
 */
export function discoverGlomarkCategories(html: string): string[] {
  const byId = new Map<string, string>();
  for (const match of html.matchAll(/href="(\/[a-z0-9%._-]+(?:\/[a-z0-9%._-]+)*\/c\/(\d+))"/giu)) {
    const path = match[1];
    const id = match[2];
    if (!path || !id) continue;
    const current = byId.get(id);
    if (!current || pathScore(path) < pathScore(current)) byId.set(id, path);
  }
  return [...byId.values()].sort();
}

function pathScore(path: string): number {
  return (path === path.toLowerCase() ? 0 : 2) + (path.includes("%25") ? 1 : 0);
}

/** Each category page assigns its full product list to a JavaScript variable; read that array with bracket matching (the objects nest arrays). */
export function extractGlomarkProducts(html: string): GlomarkProduct[] | null {
  const marker = html.match(/productList\s*=\s*\[\s*\{/u);
  if (!marker || marker.index === undefined) return /productList\s*=\s*\[\s*\]\s*;[\s\S]*productCount\s*=\s*productList\.length/u.test(html) ? [] : null;
  const start = html.indexOf("[", marker.index);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, index + 1)) as unknown;
          return Array.isArray(parsed) ? (parsed as GlomarkProduct[]) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Weight-priced products carry unit "g"/"kg" with the priced quantity; "unit" products are per pack, with the size in the name when printed. */
export function glomarkPack(unit: string, displayQuantity: number, name: string): { quantity: string; unit: string } {
  const normalized = normalizeUnit(unit || "unit");
  if (["g", "kg", "ml", "l"].includes(normalized)) return { quantity: trimNumber(displayQuantity > 0 ? displayQuantity : 1), unit: normalized };
  return packFromLabel(name) ?? { quantity: trimNumber(displayQuantity > 0 ? displayQuantity : 1), unit: "piece" };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export type { AdapterContext };
