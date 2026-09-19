import { z } from "zod";

import { CookieJar, fetchWithPolicy, parseJsonBody } from "../http.ts";
import { storeOffer, type RecordOffer } from "../offer.ts";
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
  /** Rupees off one unit while the promotion runs; the listing keeps `amount` at the shelf price. */
  promotionDiscountValue?: number | null;
  discountedTotal: number;
  departmentCode?: string;
  subDepartmentCode?: string;
  categoryCode?: string;
};
/** One promotion on one item, as the listing sends it beside the items: who it is for, its size, and its limits. */
export type KeellsPromotion = {
  promotionDetailID: number;
  itemID: number;
  isNexusDeal?: boolean;
  minimumQuantity?: number;
  maximumQuantity?: number;
  discountValue?: number;
  isValuePromotion?: boolean;
  discountPercentage?: number;
  isPercentagePromotion?: boolean;
  checkPaymentMode?: boolean;
  promoCode?: string | null;
};
type ItemDetailsResponse = { statusCode: number; result?: { itemDetailResult?: { pageCount: number; itemDetails: KeellsItem[] }; promotionItemDetailsList?: KeellsPromotion[] | null } };
type GuestLoginResponse = { statusCode: number; result?: { userSessionID?: string } };
type DepartmentSnapshot = { departmentId: number | null; pages: number; truncated: boolean; items: KeellsItem[]; promotions?: KeellsPromotion[] };

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
      const promotions = new Map<number, KeellsPromotion>();
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
        const body = parseJsonBody<ItemDetailsResponse>(result.body, url).result;
        const listing = body?.itemDetailResult;
        for (const promotion of body?.promotionItemDetailsList ?? []) promotions.set(promotion.promotionDetailID, promotion);
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
      departments.push({ departmentId, pages: fetched, truncated, items, promotions: [...promotions.values()] });
    }
    return { fetchedAt: context.now.toISOString(), requests, data: { outletCode: settings.outletCode, departments } };
  },
  normalize(payload, settings, date) {
    const data = payload.data as { departments?: DepartmentSnapshot[] };
    const include = compilePattern(settings.includeDepartments);
    const exclude = compilePattern(settings.excludeDepartments);
    const records: NormalizedRecord[] = [];
    for (const department of data.departments ?? []) {
      const promotions = new Map<number, KeellsPromotion[]>();
      for (const promotion of department.promotions ?? []) promotions.set(promotion.itemID, [...(promotions.get(promotion.itemID) ?? []), promotion]);
      for (const item of department.items) {
        if (!item.isAvailable && !settings.includeUnavailable) continue;
        const departmentPath = `${item.departmentCode ?? ""}/${item.subDepartmentCode ?? ""}`;
        if (!categoryAllowed(departmentPath, include, exclude)) continue;
        const amount = Number(item.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const name = item.name.replace(/\s+/gu, " ").trim();
        if (!name) continue;
        const pack = keellsPack(item.uom, name);
        const offer = keellsOffer(item, promotions.get(item.itemID) ?? []);
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
            promotion_discount: item.promotionDiscountValue ?? null,
            discounted_total: item.discountedTotal,
            department_id: department.departmentId,
            category: departmentPath,
            department_code: item.departmentCode ?? null,
            sub_department_code: item.subDepartmentCode ?? null,
            category_code: item.categoryCode ?? null,
            ...(offer ? { offer } : {}),
          },
        });
      }
    }
    return dedupeRecords(records);
  },
};

/**
 * Keells leaves `amount` at the shelf price and lists the rupees a promotion takes off one unit. Who gets that price is on the
 * promotion: Nexus deals are for loyalty members, the rest for every shopper. Promotions tied to a payment card, a promo code,
 * or buying several at once are not a price for the pack, and an item whose promotion cannot be found is left without an offer.
 */
export function keellsOffer(item: Pick<KeellsItem, "amount" | "isPromotionApplied" | "promotionDiscountValue">, promotions: KeellsPromotion[]): RecordOffer | null {
  const amount = Number(item.amount);
  const discount = Number(item.promotionDiscountValue);
  if (!item.isPromotionApplied || !(discount > 0) || !(amount > discount)) return null;
  const plain = promotions.filter((promotion) => !promotion.checkPaymentMode && !promotion.promoCode && (promotion.minimumQuantity ?? 0) <= 1);
  // The promotion whose own arithmetic gives the listed discount is the one the listing priced.
  const priced = plain.find((promotion) => Math.abs(keellsDiscount(promotion, amount) - discount) < 0.51) ?? plain[0];
  if (!priced) return null;
  const cap = priced.maximumQuantity ?? 0;
  return storeOffer({
    listMinor: priceToMinor(amount),
    offerMinor: priceToMinor(amount - discount),
    kind: "discount",
    audience: priced.isNexusDeal ? "members" : "everyone",
    label: priced.isNexusDeal ? "Nexus" : undefined,
    maxQuantity: cap > 0 && cap < 100 ? cap : undefined,
  });
}

function keellsDiscount(promotion: KeellsPromotion, amount: number): number {
  if (promotion.isPercentagePromotion && promotion.discountPercentage) return (amount * promotion.discountPercentage) / 100;
  if (promotion.isValuePromotion && promotion.discountValue) return promotion.discountValue;
  return Number.NaN;
}

/** Keells sells loose produce per kilogram (uom KG) and packs per unit (uom NO); packs carry their size in the name. */
export function keellsPack(uom: string, name: string): { quantity: string; unit: string } {
  const unit = normalizeUnit(uom);
  if (unit === "kg" || unit === "g" || unit === "l" || unit === "ml") return { quantity: "1", unit };
  return packFromLabel(name) ?? { quantity: "1", unit: "piece" };
}
