import { z } from "zod";

import { CookieJar, fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema } from "../settings.ts";
import { dedupeRecords, normalizeUnit, priceToMinor, trimNumber, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const cargillsSettingsSchema = baseSettingsSchema.extend({
  baseUrl: z.url().default("https://cargillsonline.com").describe("Cargills Online origin"),
  pinCode: z.string().min(1).default("Colombo").describe("Delivery area that selects the store whose prices are shown"),
  categoryIds: z.array(z.string().min(1)).min(1).default(["MjM=", "OQ=="]).describe("Encoded category ids to capture (MjM= Vegetables, OQ== Fruits)"),
  pageSize: z.number().int().min(50).max(10_000).default(10_000),
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
type CategorySnapshot = { categoryId: string; items: CargillsItem[] };

export const cargillsAdapter: RetailAdapter<CargillsSettings> = {
  kind: "cargills_api",
  label: "Cargills Online (cargillsonline.com)",
  description: "Selects the delivery store for the configured area, then reads each category listing, the same calls the web app makes. No account.",
  marketLabel: "Cargills Online",
  priceType: "retail_online_store",
  settingsSchema: cargillsSettingsSchema,
  async fetch(settings, context) {
    const policy = { attempts: settings.maxAttempts, timeoutMs: settings.requestTimeoutMs, userAgent: context.userAgent };
    const jar = new CookieJar();
    const common = { origin: settings.baseUrl, referer: `${settings.baseUrl}/`, "x-requested-with": "XMLHttpRequest" };
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
    const stores = parseJsonBody<StoreInfo[]>(store.body, "CheckDeliveryOptionV1");
    const selected = stores[0];
    if (!selected?.StoreId) throw new Error(`CARGILLS_STORE_UNAVAILABLE:${settings.pinCode}`);
    context.log("info", "Store selected", { pin_code: settings.pinCode, store_id: selected.StoreId });

    const categories: CategorySnapshot[] = [];
    for (const categoryId of settings.categoryIds) {
      const url = `${settings.baseUrl}/Web/GetMenuCategoryItemsPagingV3/`;
      const result = await fetchWithPolicy(context.http, url, {
        method: "POST",
        headers: { ...common, cookie: jar.header(), "content-type": "application/json;charset=UTF-8", accept: "application/json" },
        body: JSON.stringify({
          CategoryId: categoryId,
          Search: "",
          Filter: "",
          PageIndex: 1,
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
      jar.absorb(result.setCookies);
      const items = parseJsonBody<CargillsItem[]>(result.body, url);
      const real = Array.isArray(items) ? items.filter((item) => item.Price !== null && item.ItemName !== "No Products Found") : [];
      context.log("info", "Category fetched", { category: categoryId, items: real.length });
      categories.push({ categoryId, items: real });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { store: { id: selected.StoreId, pin_code: selected.PinCode, address: selected.Address ?? null }, categories } };
  },
  normalize(payload, _settings, date) {
    const data = payload.data as { categories?: CategorySnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const category of data.categories ?? []) {
      for (const item of category.items) {
        const price = Number(item.Price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const pack = cargillsPack(item.UnitSize, item.UOM);
        records.push({
          rowRef: String(item.SKUCODE || item.Id),
          itemLabel: item.ItemName.replace(/\s+/gu, " ").trim(),
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
            category_code: item.CategoryCode ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

export function cargillsPack(unitSize: number | string | null | undefined, uom: string | null | undefined): { quantity: string; unit: string } {
  const quantity = Number(unitSize);
  const unit = normalizeUnit(uom ?? "piece");
  return { quantity: Number.isFinite(quantity) && quantity > 0 ? trimNumber(quantity) : "1", unit: unit || "piece" };
}
