/**
 * Where a store shows a product and its picture: the product's own page on the store's site and
 * the original address of the image the store serves for it. Adapters build both from the fields
 * they already receive and attach them to a record as `raw.url` and `raw.image`. The capture
 * itself downloads nothing: `store-products.ts` keeps the links for the items on offer and
 * `images.ts` fetches each picture once, so a deal always leads to the shelf it came from and
 * shows the store's own picture of it.
 *
 * Every address is checked against the hosts below when the adapter builds it, again when it is
 * read back from a stored row, and again before anything is fetched: https only, a known host,
 * no credentials. That list is also what keeps the downloader from being pointed anywhere else.
 * A store that moves its pictures simply stops having new ones until the list is updated.
 */

export const storePageHosts = ["www.keellssuper.com", "keellssuper.com", "cargillsonline.com", "glomark.lk", "spar2u.lk"] as const;
export const storeImageHosts = ["essstr.blob.core.windows.net", "cargillsonline.com", "objectstorage.ap-mumbai-1.oraclecloud.com", "cdn.shopify.com"] as const;

function safeUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== "string" || !value || value.length > 600) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.hostname)) return null;
  return url.toString();
}

/** A store's product page, or null when it is not an https page on one of the stores' own sites. */
export const storePageUrl = (value: unknown): string | null => safeUrl(value, storePageHosts);

/** A store's product picture, or null when it is not an https image on one of the stores' image hosts. */
export const storeImageUrl = (value: unknown): string | null => safeUrl(value, storeImageHosts);

/** Both, read back from a stored `raw_json`. */
export function readStoreLinks(raw: unknown): { url: string | null; image: string | null } {
  const record = (raw ?? {}) as { url?: unknown; image?: unknown };
  return { url: storePageUrl(record.url), image: storeImageUrl(record.image) };
}

/** A label as a path segment: lower case, anything that is not a letter or a digit becomes one hyphen. */
export function slugOf(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "product";
}
