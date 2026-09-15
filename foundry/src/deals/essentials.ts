import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The household essentials the deals mail watches every day: a plain JSON array of product ids
 * in data/deals/essentials.json, chosen from the product vocabulary of the mapping bundles.
 */

const productIdPattern = /^[a-z0-9][a-z0-9._:-]*$/u;

/** data/deals/essentials.json at the repository root, or wherever LPL_DEALS_ESSENTIALS_PATH points. */
export function defaultEssentialsPath(): string {
  return process.env.LPL_DEALS_ESSENTIALS_PATH ?? fileURLToPath(new URL("../../../data/deals/essentials.json", import.meta.url));
}

/** The product ids in the file, in its order, without repeats; a missing or malformed file is an error that names the path. */
export function loadEssentials(path = defaultEssentialsPath()): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read the essentials list at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === "string" && productIdPattern.test(entry))) {
    throw new Error(`The essentials list at ${path} must be a JSON array of product ids`);
  }
  const ids = [...new Set(parsed)];
  if (!ids.length) throw new Error(`The essentials list at ${path} names no products`);
  return ids;
}
