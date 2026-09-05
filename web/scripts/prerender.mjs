// After `vite build`: one HTML page per product (dist/p/<id>/index.html) with its own title, description,
// and social tags, plus sitemap.xml and robots.txt, so search engines and link previews see the product
// before the app loads. The pages are the app shell with the head filled in; the app takes over on load.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const mappings = resolve(root, "../data/mappings");
const recipesFile = resolve(root, "../data/recipes/catalogue.json");
const origin = process.env.LPL_PUBLIC_ORIGIN ?? "https://price.prabhavalabs.com";

const shell = readFileSync(resolve(dist, "index.html"), "utf8");
const products = new Map();
for (const file of readdirSync(mappings).filter((name) => name.endsWith(".json"))) {
  const bundle = JSON.parse(readFileSync(resolve(mappings, file), "utf8"));
  for (const product of bundle.products ?? []) products.set(product.id, product);
}

const escape = (text) => text.replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const page = (title, description, path, image) => shell
  .replace(/<title>.*?<\/title>/su, `<title>${escape(title)}</title>`)
  .replace(/<meta name="description" content=".*?" \/>/su, `<meta name="description" content="${escape(description)}" />`)
  .replace("</head>", [
    `    <link rel="canonical" href="${origin}${path}" />`,
    `    <meta property="og:title" content="${escape(title)}" />`,
    `    <meta property="og:description" content="${escape(description)}" />`,
    `    <meta property="og:url" content="${origin}${path}" />`,
    `    <meta property="og:type" content="website" />`,
    image ? `    <meta property="og:image" content="${origin}${image}" />` : "",
    `    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    "  </head>",
  ].filter(Boolean).join("\n"));

const urls = ["/", "/basket", "/recipes", "/about"];
writeFileSync(resolve(dist, "index.html"), page("PriceLens · Sri Lanka food prices today", "Today's food prices across Sri Lanka's open markets and supermarkets, from official bulletins and store shelves, with history.", "/", null));
for (const product of products.values()) {
  const path = `/p/${product.id}`;
  const label = product.canonical_label_en;
  const directory = resolve(dist, "p", product.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "index.html"),
    page(`${label} price today in Sri Lanka · PriceLens`, `${label}: today's price at open markets and supermarkets across Sri Lanka, the cheapest seller, and the trend over 30 days, 90 days, and a year.`, path, `/images/products/${product.id.replace(/^product_/u, "")}.jpg`),
  );
  urls.push(path);
}
// One page per dish as well, when the catalogue is present.
let dishCount = 0;
if (existsSync(recipesFile)) {
  const catalogue = JSON.parse(readFileSync(recipesFile, "utf8"));
  for (const dish of catalogue.dishes ?? []) {
    const path = `/r/${dish.id}`;
    const directory = resolve(dist, "r", dish.id);
    mkdirSync(directory, { recursive: true });
    const name = dish.names?.en ?? dish.id;
    writeFileSync(resolve(directory, "index.html"), page(`${name} recipe: ingredients and today's cost · PriceLens`, `${dish.summary ?? name} What ${name} needs and what those ingredients cost today across Sri Lanka's markets and supermarkets.`, path, null));
    urls.push(path);
    dishCount += 1;
  }
  mkdirSync(resolve(dist, "recipes"), { recursive: true });
  writeFileSync(resolve(dist, "recipes", "index.html"), page("Sri Lankan recipes priced today · PriceLens", "Sri Lankan dishes with what each needs and what it costs to buy today, matched to your basket.", "/recipes", null));
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(resolve(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${origin}${url}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}\n</urlset>\n`);
writeFileSync(resolve(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`prerendered ${products.size} product pages and ${dishCount} recipe pages, sitemap with ${urls.length} urls`);
