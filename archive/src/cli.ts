import { discoverHartiArchive, hartiArchiveObjectKey } from "@lanka-pricelens/shared/harti-archive";

import { cloudflareCredentials, listArchiveKeys, uploadArchiveObject } from "./cloudflare-api.ts";
import { fetchPdf } from "./pdf.ts";

const BACKFILL_REQUEST_INTERVAL_MS = 5_000;
let lastSourceRequestAt = 0;
const [command, ...arguments_] = process.argv.slice(2);
if (command === "backfill") {
  await backfill();
} else if (command === "status") {
  const bucket = valueOf("--bucket") ?? "lanka-price-lens-pdfs";
  const existing = await listArchiveKeys(await cloudflareCredentials(), bucket);
  console.log(JSON.stringify({ bucket, stored: existing.size }));
} else {
  console.error("Usage: pnpm archive <backfill|status> [--bucket NAME] [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  process.exitCode = 1;
}

async function backfill(): Promise<void> {
  const bucket = valueOf("--bucket") ?? "lanka-price-lens-pdfs";
  const landingUrl = "https://www.harti.gov.lk/daily-price.php";
  const range = { from: dateValue("--from"), to: dateValue("--to") };
  if (range.from && range.to && range.from > range.to) throw new Error("--from must not be later than --to");

  let credentials = await cloudflareCredentials();
  const existing = await listArchiveKeys(credentials, bucket);
  const landing = await fetchWithRetry(landingUrl);
  const publications = discoverHartiArchive(await landing.text(), landingUrl, range);
  const pending = publications.filter((publication) => !existing.has(hartiArchiveObjectKey(publication)));
  console.log(`Discovered ${publications.length} PDFs; ${existing.size} already stored; ${pending.length} pending.`);

  let uploaded = 0;
  const failures: Array<{ url: string; message: string }> = [];
  for (const publication of pending) {
    try {
      await waitForSourceInterval();
      const bytes = await retry(() => fetchPdf(fetch, publication.downloadUrl));
      await retry(async () => {
        try {
          await uploadArchiveObject(credentials, bucket, hartiArchiveObjectKey(publication), publication.title, bytes);
        } catch (error) {
          if (/authentication error/iu.test(error instanceof Error ? error.message : String(error))) {
            credentials = await cloudflareCredentials();
          }
          throw error;
        }
      });
      uploaded += 1;
      if (uploaded % 25 === 0 || uploaded === pending.length) console.log(`Uploaded ${uploaded}/${pending.length} pending PDFs.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/authentication error|rate limit/iu.test(message)) throw error;
      failures.push({ url: publication.downloadUrl, message });
      console.error(`Failed ${publication.downloadUrl}: ${message}`);
    }
  }

  console.log(JSON.stringify({ bucket, discovered: publications.length, previouslyStored: existing.size, uploaded, failed: failures.length }));
  if (failures.length) process.exitCode = 1;
}

async function waitForSourceInterval(): Promise<void> {
  const remaining = BACKFILL_REQUEST_INTERVAL_MS - (Date.now() - lastSourceRequestAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  lastSourceRequestAt = Date.now();
}

async function fetchWithRetry(url: string): Promise<Response> {
  await waitForSourceInterval();
  return retry(async () => {
    const response = await fetch(url, {
      headers: { "user-agent": "LankaPriceLens/0.1 (+non-commercial public-data archive)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
    return response;
  });
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        const message = error instanceof Error ? error.message : String(error);
        const delay = /rate limit/iu.test(message) ? 60_000 : attempt * 1_000;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function valueOf(name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function dateValue(name: string): string | undefined {
  const value = valueOf(name);
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
}
