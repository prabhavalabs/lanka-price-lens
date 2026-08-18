const MAXIMUM_PDF_BYTES = 20 * 1024 * 1024;

export async function fetchPdf(request: typeof fetch, url: string): Promise<Uint8Array> {
  const response = await request(url, {
    headers: { "user-agent": "LankaPriceLens/0.1 (+non-commercial public-data archive)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType !== "application/pdf" && mediaType !== "application/octet-stream") {
    throw new Error(`SOURCE_MEDIA_TYPE_INVALID:${mediaType ?? "missing"}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAXIMUM_PDF_BYTES) throw new Error("SOURCE_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_PDF_BYTES) throw new Error("SOURCE_TOO_LARGE");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("SOURCE_PDF_SIGNATURE_INVALID");
  return bytes;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
