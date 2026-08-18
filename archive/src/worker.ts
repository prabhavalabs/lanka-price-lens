import { discoverHartiArchive, hartiArchiveObjectKey } from "@lanka-pricelens/shared/harti-archive";

import { fetchPdf, sha256 } from "./pdf.ts";

type Env = {
  PDF_ARCHIVE: R2Bucket;
  SOURCE_LANDING_URL: string;
  MAX_UPLOADS_PER_RUN: string;
  SOURCE_REQUEST_INTERVAL_MS: string;
};

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await syncNewest(env);
    console.log(JSON.stringify(result));
  },
};

export async function syncNewest(env: Env, request: typeof fetch = fetch): Promise<{ discovered: number; uploaded: number }> {
  const landing = await request(env.SOURCE_LANDING_URL, {
    headers: { "user-agent": "LankaPriceLens/0.1 (+non-commercial public-data archive)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!landing.ok) throw new Error(`SOURCE_HTTP_${landing.status}`);
  const publications = discoverHartiArchive(await landing.text(), env.SOURCE_LANDING_URL);
  const maximumUploads = boundedInteger(env.MAX_UPLOADS_PER_RUN, 1, 5, 2);
  const requestInterval = boundedInteger(env.SOURCE_REQUEST_INTERVAL_MS, 1_000, 60_000, 5_000);
  let uploaded = 0;

  for (const publication of publications.slice(0, 14)) {
    const key = hartiArchiveObjectKey(publication);
    if (await env.PDF_ARCHIVE.head(key)) continue;
    if (uploaded >= maximumUploads) break;
    if (uploaded > 0) await new Promise<void>((resolve) => setTimeout(resolve, requestInterval));
    const bytes = await fetchPdf(request, publication.downloadUrl);
    await env.PDF_ARCHIVE.put(key, bytes, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(publication.title)}`,
      },
      customMetadata: {
        source: "HARTI Daily Food Commodities Bulletin",
        sourceDate: publication.date,
        sourceUrl: publication.downloadUrl,
        sha256: await sha256(bytes),
      },
    });
    uploaded += 1;
  }

  return { discovered: publications.length, uploaded };
}

function boundedInteger(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
