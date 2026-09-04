import { z } from "zod";

import { CookieJar, fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema } from "../settings.ts";
import { dedupeRecords, normalizeUnit, packFromLabel, priceToMinor, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const keellsSettingsSchema = baseSettingsSchema.extend({
  apiBaseUrl: z.url().default("https://zebraliveback.keellssuper.com").describe("Keells Online backend origin"),
  storefrontOrigin: z.url().default("https://keellssuper.com").describe("Sent as Origin and Referer, as the web app does"),
  outletCode: z.string().min(1).default("SCDR").describe("Outlet whose prices and stock are reported"),
  departmentIds: z.array(z.number().int().positive()).min(1).default([16]).describe("Department ids to capture (16 = Fresh Vegetables)"),
  itemsPerPage: z.number().int().min(12).max(500).default(300),
  includeUnavailable: z.boolean().default(false).describe("Keep items the outlet marks unavailable"),
});
export type KeellsSettings = z.infer<typeof keellsSettingsSchema>;

type KeellsItem = {
  itemID: number;
  itemCode: string;
  name: string;
  amount: number;
  uom: string;
  stockInHand: number;
  isAvailable: boolean;
  isPromotionApplied: boolean;
  discountedTotal: number;
  departmentCode?: string;
  subDepartmentCode?: string;
  categoryCode?: string;
};
type ItemDetailsResponse = { statusCode: number; result?: { itemDetailResult?: { pageCount: number; itemDetails: KeellsItem[] } } };
type GuestLoginResponse = { statusCode: number; result?: { userSessionID?: string } };
type DepartmentSnapshot = { departmentId: number; pages: number; items: KeellsItem[] };

export const keellsAdapter: RetailAdapter<KeellsSettings> = {
  kind: "keells_api",
  label: "Keells Online (keellssuper.com)",
  description: "Opens a guest session (no account) and reads the item listing per department, the same calls the web app makes.",
  marketLabel: "Keells Online",
  priceType: "retail_online_store",
  // Cloudflare in front of the Keells backend answers Node's built-in fetch with 403 but accepts node:https.
  transport: "node_https",
  settingsSchema: keellsSettingsSchema,
  async fetch(settings, context) {
    const policy = { attempts: settings.maxAttempts, timeoutMs: settings.requestTimeoutMs, userAgent: context.userAgent };
    const jar = new CookieJar();
    const baseHeaders = { origin: settings.storefrontOrigin, referer: `${settings.storefrontOrigin}/`, accept: "application/json" };
    let requests = 0;

    const login = await fetchWithPolicy(context.http, `${settings.apiBaseUrl}/1.0/Login/GuestLogin`, {
      method: "POST",
      headers: { ...baseHeaders, usersessionid: "" },
    }, policy);
    requests += login.attempts;
    jar.absorb(login.setCookies);
    const session = parseJsonBody<GuestLoginResponse>(login.body, "GuestLogin").result?.userSessionID;
    if (!session) throw new Error("KEELLS_GUEST_SESSION_MISSING");
    context.log("info", "Guest session opened", { cookies: jar.size });

    const departments: DepartmentSnapshot[] = [];
    for (const departmentId of settings.departmentIds) {
      const items: KeellsItem[] = [];
      let pages = 1;
      for (let page = 1; page <= pages && page <= 50; page += 1) {
        const query = new URLSearchParams({
          pageNo: String(page),
          itemsPerPage: String(settings.itemsPerPage),
          outletCode: settings.outletCode,
          departmentId: String(departmentId),
          subDepartmentId: "",
          categoryId: "",
          itemDescription: "",
          itemPricefrom: "0",
          itemPriceTo: "5000",
          isFeatured: "0",
          isPromotionOnly: "false",
          promotionCategory: "",
          sortBy: "default",
          BrandId: "",
          storeName: "",
          subDeaprtmentCode: "",
          isShowOutofStockItems: "true",
          brandName: "",
        });
        const url = `${settings.apiBaseUrl}/2.0/WebV2/GetItemDetails?${query}`;
        const result = await fetchWithPolicy(context.http, url, { headers: { ...baseHeaders, usersessionid: session, cookie: jar.header() } }, policy);
        requests += result.attempts;
        jar.absorb(result.setCookies);
        const body = parseJsonBody<ItemDetailsResponse>(result.body, url);
        const listing = body.result?.itemDetailResult;
        if (!listing) throw new Error(`KEELLS_LISTING_MISSING:${departmentId}`);
        pages = Math.max(1, listing.pageCount ?? 1);
        items.push(...(listing.itemDetails ?? []));
        context.log("info", "Department page fetched", { department: departmentId, page, of: pages, items: listing.itemDetails?.length ?? 0 });
      }
      departments.push({ departmentId, pages, items });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { outletCode: settings.outletCode, departments } };
  },
  normalize(payload, settings, date) {
    const data = payload.data as { departments?: DepartmentSnapshot[] };
    const records: NormalizedRecord[] = [];
    for (const department of data.departments ?? []) {
      for (const item of department.items) {
        if (!item.isAvailable && !settings.includeUnavailable) continue;
        const amount = Number(item.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const name = item.name.replace(/\s+/gu, " ").trim();
        const pack = keellsPack(item.uom, name);
        records.push({
          rowRef: String(item.itemCode || item.itemID),
          itemLabel: name,
          marketLabel: keellsAdapter.marketLabel,
          date,
          sourceQuantity: pack.quantity,
          sourceUnit: pack.unit,
          minValueMinor: priceToMinor(amount),
          maxValueMinor: priceToMinor(amount),
          raw: {
            item_id: item.itemID,
            item_code: item.itemCode,
            uom: item.uom,
            stock_in_hand: item.stockInHand,
            is_available: item.isAvailable,
            promotion: item.isPromotionApplied,
            discounted_total: item.discountedTotal,
            department_id: department.departmentId,
            department_code: item.departmentCode ?? null,
            sub_department_code: item.subDepartmentCode ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/** Keells sells loose produce per kilogram (uom KG) and packs per unit (uom NO); packs carry their weight in the name. */
export function keellsPack(uom: string, name: string): { quantity: string; unit: string } {
  const unit = normalizeUnit(uom);
  if (unit === "kg" || unit === "g") return { quantity: "1", unit };
  return packFromLabel(name) ?? { quantity: "1", unit: "piece" };
}
