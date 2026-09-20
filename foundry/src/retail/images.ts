import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { OperationalDatabase } from "../db.ts";
import { fetchWithPolicy, HttpError } from "./http.ts";
import { storeImageUrl } from "./links.ts";
import type { FetchLike } from "./types.ts";

/**
 * Fetches each store item's picture once and keeps it under the store-images root, addressed by
 * its content (`<source>/<first two hex>/<sha256>.<ext>`), so an identical picture is stored
 * once and a stored file never changes. The root is its own tree: the site's generated product
 * photos live in data/images and are never written, read, or replaced from here.
 *
 * A picture is tried directly first. Only when the direct request fails for a reason a proxy
 * could cure (a network error, a block, a server error) is it tried once more through the
 * source's proxy, when it has one: proxies are metered, and the stores' image hosts are open.
 * A picture the store does not have (404, 410) is `missing` and looked for again in two weeks;
 * other failures back off and stop after `maxAttempts`. Only real images are kept: the address
 * must be on a store's image host, the body must start with a known image signature, and it
 * must fit under `maxBytes`.
 */

export const imageRules = { maxBytes: 4 * 1024 * 1024, maxAttempts: 5, missingRetryDays: 14, requestGapMs: 150, timeoutMs: 20_000 } as const;

export type ImageFetchOptions = {
  /** Where pictures are kept; see `storeImagesRoot`. */
  root: string;
  limit?: number | undefined;
  sourceId?: string | undefined;
  /** Sources whose pictures are not to be fetched (`LPL_STORE_IMAGES_DISABLED`): a store that asked, or one being held back. */
  skipSources?: string[] | undefined;
  /** The direct client; Node's fetch by default. */
  http?: FetchLike | undefined;
  /** The source's proxy client, or null when it has none; asked only after a direct failure. */
  proxyFor?: ((sourceId: string) => FetchLike | null) | undefined;
  userAgent?: string | undefined;
  now?: Date | undefined;
  gapMs?: number | undefined;
  /** Stop taking new pictures after this long, so a run that follows a capture never holds the morning's prices up; what is left waits for the next run. */
  budgetMs?: number | undefined;
  log?: ((level: "info" | "warning", message: string, data?: Record<string, unknown>) => void) | undefined;
};

export type ImageFetchResult = { attempted: number; stored: number; reused: number; missing: number; failed: number; via_proxy: number; bytes: number; left: number };

type Pending = { source_id: string; row_ref: string; image_source_url: string; image_attempts: number };

/** Where store pictures live: `LPL_STORE_IMAGES_DIR`, or `store-images` beside the operational database. */
export function storeImagesRoot(environment: Record<string, string | undefined> = process.env, databasePath?: string): string {
  const configured = environment.LPL_STORE_IMAGES_DIR?.trim();
  if (configured) return resolve(configured);
  const database = databasePath ?? environment.LPL_DATABASE_PATH?.trim();
  return resolve(database && database !== ":memory:" ? dirname(database) : "data/runtime", "store-images");
}

const signatures: Array<{ type: string; extension: string; test: (bytes: Uint8Array) => boolean }> = [
  { type: "image/jpeg", extension: "jpg", test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: "image/png", extension: "png", test: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  { type: "image/webp", extension: "webp", test: (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" },
  { type: "image/gif", extension: "gif", test: (bytes) => ascii(bytes, 0, 4) === "GIF8" },
  { type: "image/avif", extension: "avif", test: (bytes) => ascii(bytes, 4, 8) === "ftyp" && /avif|avis/u.test(ascii(bytes, 8, 16)) },
];

const ascii = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

/** What kind of image the bytes are, by their first bytes; never by the address or the header alone. */
export function imageKind(bytes: Uint8Array): { type: string; extension: string } | null {
  if (bytes.byteLength < 16) return null;
  const match = signatures.find((signature) => signature.test(bytes));
  return match ? { type: match.type, extension: match.extension } : null;
}

export async function fetchStoreImages(database: OperationalDatabase, options: ImageFetchOptions): Promise<ImageFetchResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => undefined);
  const http = options.http ?? fetch;
  const userAgent = options.userAgent ?? "LankaPriceLens/1.0 (+https://badumila.com; price transparency research)";
  const root = resolve(options.root);
  const skipped = (options.skipSources ?? []).filter((id) => /^[a-z0-9_]+$/u.test(id));
  const queue = database
    .prepare(
      `SELECT source_id, row_ref, image_source_url, image_attempts FROM store_product
       WHERE image_source_url IS NOT NULL ${options.sourceId ? "AND source_id = ?" : ""}
         ${skipped.length ? `AND source_id NOT IN (${skipped.map(() => "?").join(", ")})` : ""}
         AND (image_status = 'pending' OR (image_status IN ('failed', 'missing') AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?))
       ORDER BY last_seen_at DESC, row_ref LIMIT ?`,
    )
    .all(...[...(options.sourceId ? [options.sourceId] : []), ...skipped, now.toISOString(), options.limit ?? 500]) as Pending[];

  const stored = database.prepare(
    `UPDATE store_product SET image_status = 'stored', image_path = ?, image_sha256 = ?, image_bytes = ?, image_content_type = ?, image_via = ?,
       image_attempts = image_attempts + 1, image_error = NULL, image_fetched_at = ?, next_attempt_at = NULL WHERE source_id = ? AND row_ref = ?`,
  );
  const failed = database.prepare(
    "UPDATE store_product SET image_status = ?, image_attempts = image_attempts + 1, image_error = ?, next_attempt_at = ? WHERE source_id = ? AND row_ref = ?",
  );
  const result: ImageFetchResult = { attempted: 0, stored: 0, reused: 0, missing: 0, failed: 0, via_proxy: 0, bytes: 0, left: 0 };
  const started = Date.now();
  const policy = { attempts: 2, timeoutMs: imageRules.timeoutMs, maxBytes: imageRules.maxBytes, userAgent };

  for (const [index, item] of queue.entries()) {
    if (options.budgetMs !== undefined && Date.now() - started >= options.budgetMs) {
      result.left = queue.length - index;
      break;
    }
    if (index > 0 && (options.gapMs ?? imageRules.requestGapMs) > 0) await new Promise((done) => setTimeout(done, options.gapMs ?? imageRules.requestGapMs));
    result.attempted += 1;
    const url = storeImageUrl(item.image_source_url);
    if (!url) {
      failed.run("failed", "IMAGE_HOST_NOT_ALLOWED", null, item.source_id, item.row_ref);
      result.failed += 1;
      continue;
    }
    let via: "direct" | "proxy" = "direct";
    let body: Uint8Array | null = null;
    let error: unknown = null;
    try {
      body = (await fetchWithPolicy(http, url, { headers: { accept: "image/avif,image/webp,image/*;q=0.8" } }, policy)).body;
    } catch (direct) {
      error = direct;
      // A picture the store does not have is not cured by another route; a block, a timeout, or a server error may be.
      const gone = direct instanceof HttpError && (direct.status === 404 || direct.status === 410);
      const proxy = gone ? null : options.proxyFor?.(item.source_id) ?? null;
      if (proxy) {
        try {
          body = (await fetchWithPolicy(proxy, url, { headers: { accept: "image/*" } }, { ...policy, attempts: 1 })).body;
          via = "proxy";
          error = null;
        } catch (proxied) {
          error = proxied;
        }
      }
    }

    const kind = body ? imageKind(body) : null;
    if (!body || !kind) {
      const status = error instanceof HttpError && (error.status === 404 || error.status === 410) ? "missing" : "failed";
      const attempts = item.image_attempts + 1;
      const retryAt = status === "missing" ? addDays(now, imageRules.missingRetryDays) : attempts >= imageRules.maxAttempts ? null : addDays(now, Math.min(7, 2 ** (attempts - 1)) / 4);
      const reason = body && !kind ? "NOT_AN_IMAGE" : error instanceof Error ? error.message.slice(0, 200) : "IMAGE_FETCH_FAILED";
      failed.run(status, reason, retryAt, item.source_id, item.row_ref);
      if (status === "missing") result.missing += 1;
      else result.failed += 1;
      log("warning", "Store picture not stored", { source: item.source_id, row_ref: item.row_ref, status, reason });
      continue;
    }

    const sha = createHash("sha256").update(body).digest("hex");
    const relative = `${item.source_id}/${sha.slice(0, 2)}/${sha}.${kind.extension}`;
    const target = join(root, relative);
    if (!target.startsWith(root + sep)) throw new Error("STORE_IMAGE_PATH_ESCAPED");
    // Content-addressed: a file that is already there is this picture, and is left exactly as it is.
    if (existsSync(target)) {
      result.reused += 1;
    } else {
      mkdirSync(dirname(target), { recursive: true });
      // Written beside its place and renamed into it, so a reader never sees half a file.
      const temporary = `${target}.${process.pid}.part`;
      try {
        writeFileSync(temporary, body);
        renameSync(temporary, target);
      } catch (writeError) {
        rmSync(temporary, { force: true });
        throw writeError;
      }
      result.stored += 1;
    }
    stored.run(relative, sha, body.byteLength, kind.type, via, now.toISOString(), item.source_id, item.row_ref);
    result.bytes += body.byteLength;
    if (via === "proxy") result.via_proxy += 1;
  }
  log("info", "Store pictures fetched", result);
  return result;
}

/** The sources named in `LPL_STORE_IMAGES_DISABLED` (comma separated). */
export function disabledImageSources(environment: Record<string, string | undefined> = process.env): string[] {
  return (environment.LPL_STORE_IMAGES_DISABLED ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * Takes one store's pictures off this server: the files, and the record that they were stored,
 * leaving the page links in place. For the day a store asks for it.
 */
export function purgeStoreImages(database: OperationalDatabase, root: string, sourceId: string): { rows: number } {
  if (!/^[a-z0-9_]+$/u.test(sourceId)) throw new Error("SOURCE_ID_INVALID");
  rmSync(join(resolve(root), sourceId), { recursive: true, force: true });
  const changed = database
    .prepare("UPDATE store_product SET image_status = 'none', image_path = NULL, image_sha256 = NULL, image_bytes = NULL, image_content_type = NULL, image_via = NULL, next_attempt_at = NULL WHERE source_id = ?")
    .run(sourceId);
  return { rows: Number(changed.changes) };
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}
