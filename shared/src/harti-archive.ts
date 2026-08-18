export type HartiArchivePublication = {
  title: string;
  date: string;
  downloadUrl: string;
};

export function discoverHartiArchive(
  html: string,
  landingUrl: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): HartiArchivePublication[] {
  const landing = new URL(landingUrl);
  const publications = new Map<string, HartiArchivePublication>();

  for (const match of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/giu)) {
    const href = match[1];
    if (!href) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, landing);
    } catch {
      continue;
    }
    if (
      resolved.protocol !== "https:" ||
      resolved.origin !== landing.origin ||
      !/\/assets\/pdf\/food_price\/daily\/eng\//iu.test(resolved.pathname)
    ) continue;

    const date = dateFromPath(resolved.pathname);
    if (!date || (range.from && date < range.from) || (range.to && date > range.to)) continue;
    publications.set(resolved.href, {
      title: filenameFromUrl(resolved),
      date,
      downloadUrl: resolved.href,
    });
  }

  return [...publications.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function hartiArchiveObjectKey(publication: HartiArchivePublication): string {
  const filename = publication.title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._()-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "bulletin.pdf";
  const year = publication.date.slice(0, 4);
  const month = publication.date.slice(5, 7);
  return `sources/harti/daily-food-prices/${year}/${month}/${publication.date}/${filename}`;
}

function filenameFromUrl(url: URL): string {
  const encoded = url.pathname.split("/").at(-1) ?? "bulletin.pdf";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function dateFromPath(path: string): string | undefined {
  const yearFirst = path.match(/(20\d{2})[._-](\d{2})[._-](\d{2})/u);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2]}-${yearFirst[3]}`;
  const dayFirst = path.match(/(?<!\d)(\d{2})[._-](\d{2})[._-](20\d{2})(?!\d)/u);
  return dayFirst ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` : undefined;
}
