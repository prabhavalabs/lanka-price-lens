import { extractTextWithPositions, processPdfAsync } from "@firecrawl/pdf-inspector";

export type TextItem = {
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfInspection = {
  engine: "pdf-inspector@1.14.2";
  pdfType: string;
  pageCount: number;
  confidence: number;
  processingTimeMs: number;
  pagesNeedingOcr: number[];
  pagesWithTables: number[];
  pagesWithColumns: number[];
  hasEncodingIssues: boolean;
};

export async function inspectPdf(data: Uint8Array): Promise<{ inspection: PdfInspection; items: TextItem[] }> {
  if (data.byteLength < 5 || new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") {
    throw new Error("SOURCE_NOT_PDF");
  }

  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const result = await processPdfAsync(buffer);
  const pagesNeedingOcr = result.pagesNeedingOcr.length
    ? result.pagesNeedingOcr
    : result.hasEncodingIssues
      ? Array.from({ length: result.pageCount }, (_, index) => index + 1)
      : [];
  const inspection: PdfInspection = {
    engine: "pdf-inspector@1.14.2",
    pdfType: result.pdfType,
    pageCount: result.pageCount,
    confidence: result.confidence,
    processingTimeMs: result.processingTimeMs,
    pagesNeedingOcr,
    pagesWithTables: result.pagesWithTables,
    pagesWithColumns: result.pagesWithColumns,
    hasEncodingIssues: result.hasEncodingIssues,
  };
  if (pagesNeedingOcr.length) return { inspection, items: [] };

  // ponytail: uploads are single-owner and size-bounded; use worker_threads if concurrent intake becomes real.
  const items = extractTextWithPositions(buffer)
    .filter((item) => item.itemType === "Text" && item.text.trim())
    .map((item, index) => ({
      page: item.page,
      index,
      text: item.text.trim(),
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }));
  return { inspection, items };
}
