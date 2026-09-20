import { message, type Message } from "@lanka-pricelens/notify";
import type { DealsDay } from "@lanka-pricelens/foundry/deals";

import { fillPlaceholders, paragraphsOf, resolveFields, type MailData } from "../mail/templates.ts";
import type { MailFields, MailKind } from "../mail/defaults.ts";
import type { ContentBlock } from "../mail/layout.ts";
import { formatMinor, offerStoreWords, storeWords } from "./deals.ts";
import { dayWords } from "./time.ts";
import type { NewsletterKind } from "./store.ts";

/**
 * The daily mails as Telegram messages: the same subject, the intro paragraph, the recipe
 * cards or deal rows as lines, the button as the link at the foot, and the first recipe
 * photo as the picture. The notify package renders and sends them; the outbox carries them
 * beside the mail.
 */

const linesLimit = 12;

function blockSections(blocks: ContentBlock[]): Message["sections"] {
  const sections: Message["sections"] = [];
  for (const block of blocks) {
    if (block.type === "recipes") {
      sections.push({ lines: block.cards.slice(0, linesLimit).map((card) => ({ text: card.name, value: card.cost ?? undefined, note: [card.kcal === null ? null : `${Math.round(card.kcal)} kcal`, card.minutes === null ? null : `${Math.round(card.minutes)} min`].filter((part): part is string => part !== null).join(" · ") || undefined, url: card.url })) });
    } else if (block.type === "deals") {
      sections.push({ heading: block.heading ?? undefined, lines: block.rows.slice(0, linesLimit).map((row) => ({ text: row.product, value: row.now, change: row.pct ?? undefined, note: row.store.slice(0, 200), url: row.url ?? undefined })) });
    }
  }
  return sections;
}

/** One person's daily mail, as the message their Telegram chat gets. */
export function telegramMessageOf(kind: NewsletterKind, data: MailData, fields: Partial<MailFields> | undefined, dedupeKey: string): Message {
  const resolved = resolveFields(kind as MailKind, fields);
  const fill = (field: keyof MailFields) => fillPlaceholders(resolved[field], data.values).replace(/\s+/gu, " ").trim();
  const intro = paragraphsOf(fillPlaceholders(resolved.intro, data.values));
  const firstPhoto = (data.blocks ?? []).flatMap((block) => (block.type === "recipes" ? block.cards : [])).find((card) => card.image && card.image.includes("/images/recipes/"))?.image ?? null;
  const link = typeof data.values.link === "string" ? data.values.link : null;
  const label = fill("button_label");
  return message({
    title: fill("subject").slice(0, 200),
    summary: intro[0]?.slice(0, 1000),
    sections: blockSections(data.blocks ?? []),
    actions: link && label ? [{ label: label.slice(0, 60), url: link }] : [],
    ...(firstPhoto ? { image: { url: firstPhoto } } : {}),
    footer: "Change what arrives here under Notifications on your account, or send /stop.",
    dedupe_key: dedupeKey,
    tags: ["newsletter", kind, "telegram"],
  });
}

/** The day's deals for the public channel: the biggest drops, the stores' own offers, and the cheapest-store picks, with the board as the link. */
export function channelDealsMessage(day: DealsDay, siteOrigin: string): Message | null {
  const origin = siteOrigin.replace(/\/+$/u, "");
  const drops = day.deals.slice(0, 8).map((deal) => ({ text: deal.label, value: formatMinor(deal.now_minor, deal.unit), change: deal.pct, note: storeWords(deal), url: deal.url.startsWith("/") ? `${origin}${deal.url}` : deal.url }));
  const cheapest = day.cheapest.slice(0, 5).map((deal) => ({ text: deal.label, value: formatMinor(deal.now_minor, deal.unit), change: deal.pct, note: `cheapest at ${deal.market}`, url: deal.url.startsWith("/") ? `${origin}${deal.url}` : deal.url }));
  const offers = (day.store_offers ?? []).slice(0, 6).map((offer) => ({ text: offer.label, value: formatMinor(offer.now_minor, offer.unit), change: offer.pct, note: offerStoreWords(offer), url: offer.url.startsWith("/") ? `${origin}${offer.url}` : offer.url }));
  if (!drops.length && !cheapest.length && !offers.length) return null;
  const stores = day.stores.map((store) => store.label);
  return message({
    title: `Today's supermarket deals · ${dayWords(day.day)}`,
    summary: `What moved on the shelves of ${stores.length ? stores.join(", ") : "the supermarkets"} this morning.`,
    sections: [...(drops.length ? [{ heading: "Biggest drops", lines: drops }] : []), ...(offers.length ? [{ heading: "Store offers", lines: offers }] : []), ...(cheapest.length ? [{ heading: "Cheapest store today", lines: cheapest }] : [])],
    actions: [{ label: "See today's prices", url: `${origin}/` }],
    footer: `Free, no account needed. ${origin.replace(/^https?:\/\//u, "")}`,
    dedupe_key: `channel:deals_daily:${day.day}`,
    tags: ["newsletter", "deals_daily", "channel"],
  });
}
