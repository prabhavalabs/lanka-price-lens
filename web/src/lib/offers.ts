/** Wording for the Deals page, kept apart from the page so it can be tested without a browser. */

/** The pack as a shopper says it: "for 1 kg" from "1000 g", "for 18 pieces", and nothing for a bare "1 piece", which adds nothing beside the name. */
export function packWords(pack: string): string {
  const [amount = "", unit = ""] = pack.split(" ");
  const quantity = Number(amount);
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit) return `for ${pack}`;
  if (unit === "piece") return quantity === 1 ? "" : `for ${trim(quantity)} pieces`;
  if (unit === "g" && quantity >= 1000) return `for ${trim(quantity / 1000)} kg`;
  if (unit === "ml" && quantity >= 1000) return `for ${trim(quantity / 1000)} l`;
  return `for ${trim(quantity)} ${unit}`;
}

const trim = (value: number): string => String(Math.round(value * 100) / 100);

/** A store that shouts its labels ("RED ONION") is read in title case; any other wording is the store's own. */
export function labelWords(label: string): string {
  if (/[a-z]/u.test(label)) return label;
  return label.toLowerCase().replace(/(^|[\s(/-])([a-z])/gu, (_match, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}
