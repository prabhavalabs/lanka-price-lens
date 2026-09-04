import { z } from "zod";

import { CookieJar, fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema, categoryAllowed, compilePattern, patternSetting } from "../settings.ts";
import { dedupeRecords, normalizeUnit, packFromLabel, priceToMinor, trimNumber, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const cargillsSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://cargillsonline.com").describe("Cargills Online origin"),
  pinCode: z.string().min(1).default("Colombo").describe("Delivery area that selects the store whose prices are shown"),
  categoryIds: z
    .array(z.string().min(1))
    .default([])
    .describe("Encoded category ids to capture; leave empty to discover every category from the store menu"),
  includeCategories: patternSetting("Only keep categories whose name matches this pattern (for example ^(Vegetables|Fruits|Dairy)$)"),
  excludeCategories: patternSetting("Drop categories whose name matches this pattern"),
  pageSize: z.number().int().min(50).max(10_000).default(5_000),
  maxPages: z.number().int().min(1).max(100).default(20).describe("Safety cap on pages per category"),
});
export type CargillsSettings = z.infer<typeof cargillsSettingsSchema>;

type CargillsItem = {
  Id: number;
  ItemName: string;
  Price: string | null;
  Mrp?: string | null;
  Inventory?: number | null;
  IsSaleable?: string | null;
  SKUCODE?: string | null;
  UnitSize?: number | string | null;
  UOM?: string | null;
  PackSize?: number | string | null;
  CategoryCode?: string | null;
  SearchTerm?: string | null;
};
type StoreInfo = { PinCode: string; StoreId: string; DeliveryOption: string; Address?: string };
type MenuCategory = { EnId: string; MenuCategoryName: string; Abbreviation?: string; IsAgeRestrict?: string };
type CategorySnapshot = { categoryId: string; name: string | null; pages: number; truncated: boolean; items: CargillsItem[] };

export const cargillsAdapter: RetailAdapter<CargillsSettings> = {
  kind: "cargills_api",
  label: "Cargills Online (cargillsonline.com)",
  description: "Selects the delivery store for the configured area, discovers the category menu, then reads every category listing, the same calls the web app makes. No account.",
  marketLabel: "Cargills Online",
  priceType: "retail_online_store",
  settingsSchema: cargillsSettingsSchema,
  async fetch(settings, context) {
    const policy = { attempts: settings.maxAttempts, timeoutMs: settings.requestTimeoutMs, userAgent: context.userAgent };
    const jar = new CookieJar();
    const common = { origin: settings.baseUrl, referer: `${settings.baseUrl}/`, "x-requested-with": "XMLHttpRequest" };
    const jsonHeaders = () => ({ ...common, cookie: jar.header(), "content-type": "application/json;charset=UTF-8", accept: "application/json" });
    let requests = 0;

    const home = await fetchWithPolicy(context.http, `${settings.baseUrl}/`, { headers: { accept: "text/html" } }, policy);
    requests += home.attempts;
    jar.absorb(home.setCookies);

    const store = await fetchWithPolicy(context.http, `${settings.baseUrl}/Web/CheckDeliveryOptionV1`, {
      method: "POST",
      headers: { ...common, cookie: jar.header(), "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "application/json" },
      body: new URLSearchParams({ PinCode: settings.pinCode }).toString(),
    }, policy);
    requests += store.attempts;
    jar.absorb(store.setCookies);
    const selected = parseJsonBody<StoreInfo[]>(store.body, "CheckDeliveryOptionV1")[0];
    if (!selected?.StoreId) throw new Error(`CARGILLS_STORE_UNAVAILABLE:${settings.pinCode}`);
    context.log("info", "Store selected", { pin_code: settings.pinCode, store_id: selected.StoreId });

    // Category discovery: the store's own menu, filtered by the operator's patterns.
    let categories: Array<{ id: string; name: string | null }>;
    let menu: MenuCategory[] = [];
    if (settings.categoryIds.length) {
      categories = settings.categoryIds.map((id) => ({ id, name: null }));
    } else {
      const menuResponse = await fetchWithPolicy(context.http, `${settings.baseUrl}/Web/GetCategoriesV1`, { method: "POST", headers: jsonHeaders(), body: "{}" }, policy);
      requests += menuResponse.attempts;
      jar.absorb(menuResponse.setCookies);
      menu = parseJsonBody<MenuCategory[]>(menuResponse.body, "GetCategoriesV1");
      if (!Array.isArray(menu) || !menu.length) throw new Error("CARGILLS_MENU_EMPTY");
      const include = compilePattern(settings.includeCategories);
      const exclude = compilePattern(settings.excludeCategories);
      categories = menu
        .filter((category) => category.EnId && categoryAllowed(category.MenuCategoryName ?? "", include, exclude))
        .map((category) => ({ id: category.EnId, name: category.MenuCategoryName ?? null }));
      context.log("info", "Categories discovered", { total: menu.length, selected: categories.length, names: categories.map((category) => category.name) });
      if (!categories.length) throw new Error("CARGILLS_NO_CATEGORIES_SELECTED");
    }

    const snapshots: CategorySnapshot[] = [];
    for (const category of categories) {
      const items: CargillsItem[] = [];
      const seen = new Set<string>();
      let pages = 0;
      let truncated = false;
      for (let page = 1; ; page += 1) {
        if (page > settings.maxPages) {
          truncated = true;
          context.log("warning", "Category page cap reached; raise maxPages to capture the rest", { category: category.name ?? category.id, pages: settings.maxPages });
          break;
        }
        const url = `${settings.baseUrl}/Web/GetMenuCategoryItemsPagingV3/`;
        const result = await fetchWithPolicy(context.http, url, {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            CategoryId: category.id,
            Search: "",
            Filter: "",
            PageIndex: page,
            PageSize: settings.pageSize,
            BannerId: "",
            SectionId: "",
            CollectionId: "",
            SectionType: "",
            DataType: "",
            SubCatId: "-1",
            PromoId: "",
          }),
        }, policy);
        requests += result.attempts;
        pages += 1;
        jar.absorb(result.setCookies);
        const batch = parseJsonBody<CargillsItem[]>(result.body, url);
        const real = Array.isArray(batch) ? batch.filter((item) => item.Price !== null && item.ItemName !== "No Products Found") : [];
        let fresh = 0;
        for (const item of real) {
          const key = String(item.SKUCODE || item.Id);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(item);
          fresh += 1;
        }
        context.log("info", "Category page fetched", { category: category.name ?? category.id, page, items: fresh });
        if (real.length < settings.pageSize || fresh === 0) break;
      }
      snapshots.push({ categoryId: category.id, name: category.name, pages, truncated, items });
    }
    return {
      fetchedAt: context.now.toISOString(),
      requests,
      data: {
        store: { id: selected.StoreId, pin_code: selected.PinCode, address: selected.Address ?? null },
        menu: menu.map((category) => ({ id: category.EnId, name: category.MenuCategoryName })),
        categories: snapshots,
      },
    };
  },
  normalize(payload, _settings, date) {
    const data = payload.data as { categories?: CategorySnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const category of data.categories ?? []) {
      for (const item of category.items) {
        const price = Number(String(item.Price ?? "").replace(/,/gu, ""));
        if (!Number.isFinite(price) || price <= 0) continue;
        const name = (item.ItemName ?? "").replace(/\s+/gu, " ").trim();
        if (!name) continue;
        const pack = cargillsPack(item.UnitSize, item.UOM, name);
        records.push({
          rowRef: String(item.SKUCODE || item.Id),
          itemLabel: name,
          marketLabel: cargillsAdapter.marketLabel,
          date,
          sourceQuantity: pack.quantity,
          sourceUnit: pack.unit,
          minValueMinor: priceToMinor(price),
          maxValueMinor: priceToMinor(price),
          raw: {
            id: item.Id,
            sku: item.SKUCODE ?? null,
            mrp: item.Mrp ?? null,
            inventory: item.Inventory ?? null,
            saleable: item.IsSaleable ?? null,
            unit_size: item.UnitSize ?? null,
            uom: item.UOM ?? null,
            pack_size: item.PackSize ?? null,
            category_id: category.categoryId,
            category: category.name,
            category_code: item.CategoryCode ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/** Cargills gives a numeric unit size and unit of measure; fall back to the label, then per piece. */
export function cargillsPack(unitSize: number | string | null | undefined, uom: string | null | undefined, name = ""): { quantity: string; unit: string } {
  const quantity = Number(unitSize);
  const unit = uom ? normalizeUnit(uom) : "";
  if (Number.isFinite(quantity) && quantity > 0 && unit) return { quantity: trimNumber(quantity), unit };
  return packFromLabel(name) ?? { quantity: Number.isFinite(quantity) && quantity > 0 ? trimNumber(quantity) : "1", unit: unit || "piece" };
}
