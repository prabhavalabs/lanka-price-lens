import { computeDeals, latestDealsDay, readDealsDay, saveDealsDay, type Deal, type DealsDay, type EssentialWatch } from "@lanka-pricelens/foundry/deals";
import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";

import type { ContentBlock, DealRow } from "../mail/layout.ts";
import type { MailData } from "../mail/templates.ts";
import { dayWords, listWords } from "./time.ts";

/**
 * The daily deals mail from a `DealsDay` the deals engine computed, in this order: the drops
 * and offers, the cheapest store for products several stores sell, the household essentials
 * watch, and what went up. A day with no deals, no cheapest-store picks, and no essential
 * moving against its fortnight has nothing to say and is skipped rather than sent empty.
 */

/** How the newsletters reach the deals engine; built in app.ts over the warehouse and the operational database. */
export type DealsAccess = {
  read: (day: string) => DealsDay | null;
  latest: () => DealsDay | null;
  /** Computes the day from the warehouse and saves it; null when the warehouse is away. */
  compute: (day: string) => Promise<DealsDay | null>;
};

/** The engine over the app's warehouse handle and essentials list: reads and saves in the operational database, computes against the warehouse. */
export function dealsAccessFor(deps: { database: OperationalDatabase; warehouse: () => Promise<WarehouseClient | null>; essentials: () => string[] }): DealsAccess {
  return {
    read: (day) => readDealsDay(deps.database, day),
    latest: () => latestDealsDay(deps.database),
    compute: async (day) => {
      const client = await deps.warehouse();
      if (!client) return null;
      // The start of the Colombo day, so the engine lands on that calendar day whatever the process time zone.
      const result = await computeDeals(client, { day: new Date(`${day}T00:00:00+05:30`), essentials: deps.essentials() });
      saveDealsDay(deps.database, result);
      return result;
    },
  };
}

/** "Rs 370 / kg" from a price in cents and its unit. */
export function formatMinor(minor: number, unit?: string | null): string {
  const rupees = minor / 100;
  const whole = Number.isInteger(rupees);
  const amount = whole ? rupees.toLocaleString("en-US") : rupees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return unit ? `Rs ${amount} / ${unit}` : `Rs ${amount}`;
}

/** "21% off at Glomark" for an offer; the store's name for anything else. */
export function storeWords(deal: Deal): string {
  return deal.kind === "offer" && deal.pct < 0 ? `${Math.round(Math.abs(deal.pct))}% off at ${deal.market}` : deal.market;
}

/** The comparison a deal is measured against, as the row words it. */
export function baselineWords(deal: Deal): string {
  const was = formatMinor(deal.was_minor, deal.unit);
  switch (deal.baseline) {
    case "yesterday":
      return `was ${was} yesterday`;
    case "median14":
      return `typical price over the last two weeks was ${was}`;
    case "other_stores":
      return `next store ${was}`;
  }
}

function productUrl(url: string, siteOrigin: string): string {
  return url.startsWith("/") ? `${siteOrigin}${url}` : url;
}

/** Whether the site has a photo of a product (data/images/products); rows without one show a lettered tile. */
export type PhotoLookup = ((productId: string) => boolean) | null | undefined;

/** The product's photo as the site serves it. */
export function productPhotoUrl(siteOrigin: string, productId: string): string {
  return `${siteOrigin}/images/products/${productId.replace(/^product_/u, "")}.jpg`;
}

const photoOf = (siteOrigin: string, productId: string, hasPhoto: PhotoLookup): string | null => (hasPhoto?.(productId) ? productPhotoUrl(siteOrigin, productId) : null);

export function dealRowOf(deal: Deal, siteOrigin: string, hasPhoto?: PhotoLookup): DealRow {
  return { product: deal.label, store: storeWords(deal), image: photoOf(siteOrigin, deal.product_id, hasPhoto), now: formatMinor(deal.now_minor, deal.unit), was: baselineWords(deal), pct: deal.pct, url: productUrl(deal.url, siteOrigin) };
}

const trendWords: Record<EssentialWatch["trend"], string | null> = { down: "below its usual price this fortnight", up: "above its usual price this fortnight", flat: null };

/** An essential row: the cheapest store today, the change against yesterday as the badge, the fortnight trend as the note. */
export function essentialRowOf(essential: EssentialWatch, siteOrigin: string, hasPhoto?: PhotoLookup): DealRow {
  return {
    product: essential.label,
    store: essential.cheapest.market,
    image: photoOf(siteOrigin, essential.product_id, hasPhoto),
    now: formatMinor(essential.cheapest.price_minor, essential.unit),
    was: trendWords[essential.trend],
    pct: essential.change_pct,
    url: `${siteOrigin}/p/${essential.product_id}`,
  };
}

/** An essential moved when its cheapest price sits off its fortnight median. */
export function essentialMoved(essential: EssentialWatch): boolean {
  return essential.trend !== "flat";
}

/** A day worth a mail: a deal, a cheapest-store pick, or an essential that moved. */
export function hasSomethingToSay(day: DealsDay): boolean {
  return day.deals.length > 0 || day.cheapest.length > 0 || day.essentials.some(essentialMoved);
}

export function dealsBlocks(day: DealsDay, siteOrigin: string, hasPhoto?: PhotoLookup): ContentBlock[] {
  const origin = siteOrigin.replace(/\/+$/u, "");
  const blocks: ContentBlock[] = [];
  if (day.deals.length) blocks.push({ type: "deals", heading: "Biggest drops today", rows: day.deals.map((deal) => dealRowOf(deal, origin, hasPhoto)), note: "Against yesterday's price or the usual price of the last two weeks." });
  if (day.cheapest.length) blocks.push({ type: "deals", heading: "Cheapest store today", rows: day.cheapest.map((deal) => dealRowOf(deal, origin, hasPhoto)), note: "Products several stores sell in the same unit, where one store is well under the next." });
  if (day.essentials.length) {
    // Moved items first, so the eye lands on what changed; the rest keep the engine's order.
    const rows = [...day.essentials].sort((left, right) => Number(essentialMoved(right)) - Number(essentialMoved(left)));
    blocks.push({ type: "deals", heading: "Household essentials", rows: rows.map((essential) => essentialRowOf(essential, origin, hasPhoto)), note: "The cheapest store for each item today; the badge is the change against yesterday's cheapest price." });
  }
  if (day.movers_up.length) blocks.push({ type: "deals", heading: "Going up", rows: day.movers_up.map((deal) => dealRowOf(deal, origin, hasPhoto)), note: null });
  return blocks;
}

export type DealsMail = {
  summary: { deals: number; cheapest: number; movers: number; essentials: number; moved: number };
  data: MailData;
};

/** Composes the mail for one account, or null when the day has nothing to say. */
export function composeDealsMail(account: { display_name: string }, day: DealsDay, deps: { siteOrigin: string; hasPhoto?: PhotoLookup }, unsubscribeUrl: string | null = null): DealsMail | null {
  if (!hasSomethingToSay(day)) return null;
  const origin = deps.siteOrigin.replace(/\/+$/u, "");
  const stores = day.stores.map((store) => store.label);
  return {
    summary: { deals: day.deals.length, cheapest: day.cheapest.length, movers: day.movers_up.length, essentials: day.essentials.length, moved: day.essentials.filter(essentialMoved).length },
    data: {
      values: { name: account.display_name, date: dayWords(day.day), count: day.deals.length, stores: stores.length ? listWords(stores) : "the supermarkets", link: `${origin}/` },
      blocks: dealsBlocks(day, origin, deps.hasPhoto),
      unsubscribeUrl,
    },
  };
}
