import type { WatchItem } from "@lanka-pricelens/shared";

import type { WatchQuote } from "../account/watchlist.ts";
import type { ContentBlock, DealRow } from "../mail/layout.ts";
import type { MailData } from "../mail/templates.ts";
import { formatMinor } from "./deals.ts";
import { countWords, dayWords } from "./time.ts";

/**
 * Price alerts for the wishlist (docs/newsletters.md): each starred product carries a rule, the
 * daily run prices every watched product once, and an account gets one mail listing the
 * products whose rule fired. "Any drop" fires when the cheapest retail price is at least five
 * percent under the day before, or under what the last alert reported; "below" fires when the
 * cheapest price is at or under the person's own mark, and again after a week while it stays.
 */

export const alertDropPct = 5;
export const belowRepeatDays = 7;

export type WatchHit = {
  item: WatchItem;
  quote: WatchQuote;
  /** The price the rule compared against, in cents; null for a "below" hit with no day-before price. */
  was_minor: number | null;
  /** Signed percentage against `was_minor`; null without one. */
  pct: number | null;
  reason: "drop" | "below";
};

const percent = (now: number, was: number): number => Math.round(((now - was) / was) * 1000) / 10;

const fellEnough = (now: number, was: number | null): was is number => was !== null && was > 0 && now * 100 <= was * (100 - alertDropPct);

/** Whether the item's rule fires on today's quote; pure, so the rules can be checked without a database. */
export function evaluateWatch(item: WatchItem, quote: WatchQuote, now: Date): WatchHit | null {
  if (item.alert.mode === "off" || quote.now_minor === null) return null;
  const current = quote.now_minor;
  if (item.alert.mode === "below") {
    const mark = item.alert.threshold_minor;
    if (!mark || current > mark) return null;
    const lastAt = item.last_alert_at ? Date.parse(item.last_alert_at) : Number.NaN;
    const toldRecently = !Number.isNaN(lastAt) && now.getTime() - lastAt < belowRepeatDays * 86_400_000 && item.last_alert_minor !== null && item.last_alert_minor <= mark;
    if (toldRecently) return null;
    const was = quote.yesterday_minor;
    return { item, quote, was_minor: was, pct: was ? percent(current, was) : null, reason: "below" };
  }
  // Any drop: against the day before first, else against what the last alert said.
  const baseline = fellEnough(current, quote.yesterday_minor) ? quote.yesterday_minor : fellEnough(current, item.last_alert_minor) ? item.last_alert_minor : null;
  if (baseline === null) return null;
  return { item, quote, was_minor: baseline, pct: percent(current, baseline), reason: "drop" };
}

function rowOf(hit: WatchHit, origin: string): DealRow {
  const { quote } = hit;
  const now = quote.now_minor === null ? "—" : formatMinor(quote.now_minor, quote.unit);
  const store = quote.cheapest ? `at ${quote.cheapest.market_label}` : "at the cheapest seller";
  let was: string | null = null;
  if (hit.reason === "below" && hit.item.alert.threshold_minor) {
    was = `under your mark of ${formatMinor(hit.item.alert.threshold_minor, quote.unit)}${hit.was_minor !== null ? `; was ${formatMinor(hit.was_minor, quote.unit)} yesterday` : ""}`;
  } else if (hit.was_minor !== null) {
    was = `was ${formatMinor(hit.was_minor, quote.unit)}${hit.was_minor === quote.yesterday_minor ? " yesterday" : " when we last wrote"}`;
  }
  return { product: quote.label, store, now, was, pct: hit.pct, url: `${origin}/p/${quote.product_id}` };
}

export type AlertsMail = {
  productIds: string[];
  data: MailData;
  summary: { hits: number; drops: number; below: number };
};

/** One mail per account listing every product whose rule fired; null when none did. */
export function composeAlertsMail(account: { display_name: string }, day: string, hits: WatchHit[], deps: { siteOrigin: string }, unsubscribeUrl: string | null = null): AlertsMail | null {
  if (!hits.length) return null;
  const origin = deps.siteOrigin.replace(/\/+$/u, "");
  const ordered = [...hits].sort((left, right) => (left.pct ?? 0) - (right.pct ?? 0));
  const block: ContentBlock = { type: "deals", heading: null, rows: ordered.map((hit) => rowOf(hit, origin)), note: "Prices are the cheapest published retail seller today; open markets and supermarkets count, wholesale does not." };
  return {
    productIds: ordered.map((hit) => hit.item.product_id),
    data: {
      values: { name: account.display_name, date: dayWords(day), count: countWords(hits.length), link: `${origin}/account#wishlist` },
      blocks: [block],
      unsubscribeUrl,
    },
    summary: { hits: hits.length, drops: hits.filter((hit) => hit.reason === "drop").length, below: hits.filter((hit) => hit.reason === "below").length },
  };
}
