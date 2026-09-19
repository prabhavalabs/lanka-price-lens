/**
 * What a store says about its own price: its regular price beside the price with the offer
 * applied. Adapters attach one to a record as `raw.offer`, so it is stored with the snapshot's
 * staging row and travels without touching the price itself: a record keeps carrying what the
 * store charges every shopper, and an offer never rewrites a series.
 *
 * Each store states it differently. Cargills prints the pack's maximum retail price above its
 * own; Glomark and SPAR give a list (or compare-at) price beside the promotional one they
 * sell at; Keells keeps the shelf price and lists a rupee discount, often for Nexus members only.
 */

export type OfferKind = "mrp" | "promo_price" | "discount" | "compare_at";
export type OfferAudience = "everyone" | "members";

export type RecordOffer = {
  /** The store's regular price for the pack, in minor units. */
  list_minor: number;
  /** The price with the offer applied, in minor units; always under `list_minor`. */
  offer_minor: number;
  /** Signed, one decimal: -20 is 20 % off. */
  pct: number;
  kind: OfferKind;
  /** "members" when the store gives the price to its loyalty members only. */
  audience: OfferAudience;
  /** The store's own name for it, when it has one ("Nexus"). */
  label?: string;
  /** The most packs one shopper may buy at the offer price, when the store caps it. */
  max_quantity?: number;
};

/** A cut under one percent is rounding, and one over ninety is a data error (a price keyed for a different pack). */
export const offerRules = { minimumCutPct: 1, maximumCutPct: 90 } as const;

export function storeOffer(input: {
  listMinor: number;
  offerMinor: number;
  kind: OfferKind;
  audience?: OfferAudience | undefined;
  label?: string | undefined;
  maxQuantity?: number | undefined;
}): RecordOffer | null {
  const { listMinor, offerMinor } = input;
  if (!Number.isSafeInteger(listMinor) || !Number.isSafeInteger(offerMinor) || offerMinor <= 0 || listMinor <= offerMinor) return null;
  const cut = (1 - offerMinor / listMinor) * 100;
  if (cut < offerRules.minimumCutPct || cut > offerRules.maximumCutPct) return null;
  const offer: RecordOffer = { list_minor: listMinor, offer_minor: offerMinor, pct: -Math.round(cut * 10) / 10, kind: input.kind, audience: input.audience ?? "everyone" };
  if (input.label) offer.label = input.label;
  if (input.maxQuantity && Number.isSafeInteger(input.maxQuantity) && input.maxQuantity > 0) offer.max_quantity = input.maxQuantity;
  return offer;
}

/** A price as a store writes it ("1,250.00", 1250) in minor units, or null when it is not a positive number. */
export function minorOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/gu, ""));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) : null;
}

/** Reads an offer back from a stored `raw_json`; anything malformed is no offer. */
export function readOffer(raw: unknown): RecordOffer | null {
  const candidate = (raw as { offer?: Partial<RecordOffer> } | null)?.offer;
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.kind !== "mrp" && candidate.kind !== "promo_price" && candidate.kind !== "discount" && candidate.kind !== "compare_at") return null;
  return storeOffer({
    listMinor: Number(candidate.list_minor),
    offerMinor: Number(candidate.offer_minor),
    kind: candidate.kind,
    audience: candidate.audience === "members" ? "members" : "everyone",
    label: typeof candidate.label === "string" ? candidate.label : undefined,
    maxQuantity: typeof candidate.max_quantity === "number" ? candidate.max_quantity : undefined,
  });
}
