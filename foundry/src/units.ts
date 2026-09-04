/** Unit and pack-size helpers shared by document parsers and retail adapters. */

const packPattern = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|grams?|ml|l|ltr|litre|liter)\b/iu;

/**
 * Reads a pack size out of a label such as "Basil Leaves 50g" or
 * "Papaya, each (about 1.2kg)". Returns null when the label carries none.
 */
export function packFromLabel(label: string): { quantity: string; unit: string } | null {
  const match = label.match(packPattern);
  if (!match?.[1] || !match[2]) return null;
  return { quantity: trimNumber(match[1]), unit: normalizeUnit(match[2]) };
}

export function normalizeUnit(unit: string): string {
  const lower = unit.trim().toLowerCase().replace(/[.\s]+$/u, "");
  if (["kg", "kgs", "kilogram", "kilograms", "kilo"].includes(lower)) return "kg";
  if (["g", "gm", "gms", "gram", "grams"].includes(lower)) return "g";
  if (["l", "ltr", "litre", "liter", "litres", "liters"].includes(lower)) return "l";
  if (lower === "ml") return "ml";
  if (["pcs", "pc", "piece", "pieces", "each", "no", "nos", "unit", "units", "nut", "nuts", "fruit", "fruits", "egg", "eggs"].includes(lower)) return "piece";
  if (["bunch", "bunches", "bundle", "bundles"].includes(lower)) return "bunch";
  return lower;
}

/**
 * Parses a printed unit such as "1 kg.", "Rs./kg", "500g", "750 ml", "Bunch",
 * "Each", "100 leaves", or "1Kg.Pkt." into a quantity and normalised unit.
 */
export function parsePrintedUnit(text: string): { quantity: string; unit: string } | null {
  const cleaned = text.replace(/^rs\.?\s*\/?\s*/iu, "").replace(/\bpkt\.?$/iu, "").replace(/[().]/gu, " ").trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)?\s*([A-Za-z]+)/u);
  if (!match?.[2]) return null;
  const quantity = match[1] ? trimNumber(match[1]) : "1";
  return { quantity, unit: normalizeUnit(match[2]) };
}

export function trimNumber(value: string | number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return String(Number(numeric.toFixed(3)));
}

/** Parses "1,234.50" style amounts; returns null for blanks and "n.a." markers. */
export function parsePrintedNumber(text: string): number | null {
  const cleaned = text.replace(/,/gu, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/u.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
