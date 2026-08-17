import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type TextItem = {
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function extractPdfText(data: Uint8Array): Promise<TextItem[]> {
  if (data.byteLength < 5 || new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") {
    throw new Error("SOURCE_NOT_PDF");
  }

  const loadingTask = getDocument({ data });
  const document = await loadingTask.promise;
  const items: TextItem[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const [index, item] of content.items.entries()) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform;
      items.push({ page: pageNumber, index, text: item.str.trim(), x, y, width: item.width, height: item.height });
    }
  }
  await loadingTask.destroy();
  return items;
}
