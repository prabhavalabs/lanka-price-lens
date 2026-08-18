import assert from "node:assert/strict";
import test from "node:test";

import { hartiArchiveObjectKey } from "@lanka-pricelens/shared/harti-archive";

import { syncNewest } from "../src/worker.ts";

test("scheduled archive stores a missing PDF once with source metadata", async () => {
  const url = "https://www.harti.gov.lk/assets/pdf/food_price/daily/eng/Vegetables%20Wholesale%20Prices%20(2026.08.17).pdf";
  const html = `<a href="${url}">PDF</a>`;
  const bytes = new TextEncoder().encode("%PDF-1.7\narchive");
  const stored = new Map<string, { value: Uint8Array; options: R2PutOptions }>();
  const bucket = {
    head: async (key: string) => stored.has(key) ? ({ key } as R2Object) : null,
    put: async (key: string, value: Uint8Array, options: R2PutOptions) => {
      stored.set(key, { value, options });
      return { key } as R2Object;
    },
  } as unknown as R2Bucket;
  const request = async (input: string | URL | Request) => String(input).endsWith("daily-price.php")
    ? new Response(html, { headers: { "content-type": "text/html" } })
    : new Response(bytes, { headers: { "content-type": "application/pdf" } });
  const env = {
    PDF_ARCHIVE: bucket,
    SOURCE_LANDING_URL: "https://www.harti.gov.lk/daily-price.php",
    MAX_UPLOADS_PER_RUN: "1",
    SOURCE_REQUEST_INTERVAL_MS: "1000",
  };

  assert.deepEqual(await syncNewest(env, request as typeof fetch), { discovered: 1, uploaded: 1 });
  assert.deepEqual(await syncNewest(env, request as typeof fetch), { discovered: 1, uploaded: 0 });
  const key = hartiArchiveObjectKey({ title: "Vegetables Wholesale Prices (2026.08.17).pdf", date: "2026-08-17", downloadUrl: url });
  assert.equal(stored.get(key)?.options.customMetadata?.sourceDate, "2026-08-17");
});
