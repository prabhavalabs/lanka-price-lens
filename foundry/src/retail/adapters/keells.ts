import { z } from "zod";

import { CookieJar, fetchWithPolicy, parseJsonBody } from "../http.ts";
import { baseSettingsSchema, categoryAllowed, compilePattern, patternSetting } from "../settings.ts";
import { dedupeRecords, normalizeUnit, packFromLabel, priceToMinor, type NormalizedRecord, type RetailAdapter } from "../types.ts";

export const keellsSettingsSchema = baseSettingsSchema.extend({
  apiBaseUrl: z.url().default("https://zebraliveback.keellssuper.com").describe("Keells Online backend origin"),
  storefrontOrigin: z.url().default("https://keellssuper.com").describe("Sent as Origin and Referer, as the web app does"),
  outletCode: z.string().min(1).default("SCDR").describe("Outlet whose prices and stock are reported"),
  departmentIds: z
    .array(z.number().int().positive())
    .default([])
    .describe("Department ids to capture; leave empty to capture every department in one listing"),
  itemsPerPage: z.number().int().min(12).max(500).default(300),
  maxPages: z.number().int().min(1).max(1000).default(200).describe("Safety cap on listing pages per department"),
  includeDepartments: patternSetting("Only keep items whose department/sub-department code (for example V/VWM) matches this pattern"),
  excludeDepartments: patternSetting("Drop items whose department/sub-department code matches this pattern"),
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
type DepartmentSnapshot = { departmentId: number | null; pages: number; truncated: boolean; items: KeellsItem[] };

export const keellsAdapter: RetailAdapter<KeellsSettings> = {
  kind: "keells_api",
  label: "Keells Online (keellssuper.com)",
  description: "Opens a guest session (no account) and reads the item listing, store-wide by default or per department, the same calls the web app makes.",
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

    const scopes: Array<number | null> = settings.departmentIds.length ? settings.departmentIds : [null];
    const departments: DepartmentSnapshot[] = [];
    for (const departmentId of scopes) {
      const items: KeellsItem[] = [];
      const seen = new Set<string>();
      let pages = 1;
      let fetched = 0;
      let truncated = false;
      for (let page = 1; page <= pages; page += 1) {
        if (page > settings.maxPages) {
          truncated = true;
          context.log("warning", "Listing page cap reached; raise maxPages to capture the rest", { department: departmentId ?? "all", pages: settings.maxPages });
          break;
        }
        const query = new URLSearchParams({
          pageNo: String(page),
          itemsPerPage: String(settings.itemsPerPage),
          outletCode: settings.outletCode,
          departmentId: departmentId === null ? "" : String(departmentId),
          subDepartmentId: "",
          categoryId: "",
          itemDescription: "",
          itemPricefrom: "0",
          itemPriceTo: "1000000",
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
        fetched += 1;
        jar.absorb(result.setCookies);
        const listing = parseJsonBody<ItemDetailsResponse>(result.body, url).result?.itemDetailResult;
        if (!listing) throw new Error(`KEELLS_LISTING_MISSING:${departmentId ?? "all"}`);
        pages = Math.max(1, listing.pageCount ?? 1);
        let fresh = 0;
        for (const item of listing.itemDetails ?? []) {
          const key = String(item.itemCode || item.itemID);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(item);
          fresh += 1;
        }
        context.log("info", "Listing page fetched", { department: departmentId ?? "all", page, of: pages, items: fresh });
        // A page with nothing new means the listing is exhausted even if pageCount says otherwise.
        if (fresh === 0 && (listing.itemDetails?.length ?? 0) > 0) break;
      }
      departments.push({ departmentId, pages: fetched, truncated, items });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { outletCode: settings.outletCode, departments } };
  },
  normalize(payload, settings, date) {
    const data = payload.data as { departments?: DepartmentSnapshot[] };
    const include = compilePattern(settings.includeDepartments);
    const exclude = compilePattern(settings.excludeDepartments);
    const records: NormalizedRecord[] = [];
    for (const department of data.departments ?? []) {
      for (const item of department.items) {
        if (!item.isAvailable && !settings.includeUnavailable) continue;
        const departmentPath = `${item.departmentCode ?? ""}/${item.subDepartmentCode ?? ""}`;
        if (!categoryAllowed(departmentPath, include, exclude)) continue;
        const amount = Number(item.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const name = item.name.replace(/\s+/gu, " ").trim();
        if (!name) continue;
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
            category: departmentPath,
            department_code: item.departmentCode ?? null,
            sub_department_code: item.subDepartmentCode ?? null,
            category_code: item.categoryCode ?? null,
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/** Keells sells loose produce per kilogram (uom KG) and packs per unit (uom NO); packs carry their size in the name. */
export function keellsPack(uom: string, name: string): { quantity: string; unit: string } {
  const unit = normalizeUnit(uom);
  if (unit === "kg" || unit === "g" || unit === "l" || unit === "ml") return { quantity: "1", unit };
  return packFromLabel(name) ?? { quantity: "1", unit: "piece" };
}
