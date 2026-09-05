# Public price site

The consumer site (`web/`) shows today's food prices across Sri Lanka's open markets and
supermarkets with their history. It is a separate package from the owner's admin (`admin/`)
and reads only the public API.

## What it shows

The site shares the admin's design system (shadcn components, the same tokens and fonts,
product photos and store logos) and opens in light, following the device into dark.

- **Board (`/`):** the day's headline, the biggest 30-day rises and falls, then every product
  with a published price grouped by category (vegetables first), one card each with its photo
  and a line per seller group (open markets, supermarkets, wholesale): the range across sellers
  in the unit most sellers use, the seller count, the observation day, and the 30-day change.
  Category chips narrow the board; a `+` on each card adds it to the basket.
- **Search:** one box in the header. Typing is matched at once against every product's names in
  English, Sinhala, and Tamil with a forgiving matcher (`web/src/lib/fuzzy.ts`: prefix, word,
  substring, then a small edit distance, so "potatos" and "b onion" work), and after a 220 ms
  pause the server adds products whose store or bulletin wording matches. Suggestions show the
  photo, category, and today's open-market price; Enter opens the highlighted product.
- **Product (`/p/:id`):** photo, varieties, a summary card per seller group (cheapest seller,
  average, seller count, supermarket-over-wholesale markup), sellers by group with their marks
  and the cheapest badged, and a history chart (30 days, 90 days, a year) with a line per seller
  in the seller's colour and toggles per group. Share via the device share sheet, WhatsApp, or
  copy link.
- **Basket (`/basket`):** the shopper's list, kept in the browser, priced at every seller
  through `GET /v1/public/basket?products=`: sellers that carry the whole list first, then by
  total, with what each one is missing; quantities per item; share the result.
- **About (`/about`):** how prices are collected, the sources with their marks, attribution and
  cadence, and what is coming.

Every price carries the date it was observed and the site says so on every page.

## Images

Product photos (`data/images/products/<slug>.jpg`, one per product) and store logos
(`data/images/sellers/`) are shared by the admin and the site; the API serves them at
`/images/…` with a day of browser cache and a week at the edge. The image copies `data/images`.

## Search engines and previews

`web/scripts/prerender.mjs` runs after `vite build` and writes one page per product
(`dist/p/<id>/index.html`) with its title, description, canonical URL, and Open Graph tags
(the product photo as the image), plus `sitemap.xml` and `robots.txt`. The API serves the
prerendered page for `/p/<id>` and the app shell for everything else, so a crawler or a chat
preview sees the product before the app loads.

## Public API

Read-only, no sign-in, only sources whose rights allow publication (`canPublishSource`),
cacheable (`Cache-Control: public, max-age=300, s-maxage=900`) and readable from any origin.

| Path | Purpose |
| --- | --- |
| `GET /v1/public/overview` | Sources with attribution and one card per product with a price line per seller group |
| `GET /v1/public/products/:id?days=30\|90\|180\|365&varieties=` | The explorer detail (latest by seller, summary, markup, series), published sources only |
| `GET /v1/public/search?q=` | Products matching a label, variety, or a source's own wording (two characters or more) |
| `GET /v1/public/basket?products=a,b,c` | The latest price of each product at every published seller (up to 60 products) |

All three answer 503 when the warehouse is unavailable.

## Hosting

The API container serves both sites and picks by host name: `LPL_WEB_HOSTS`
(`price.prabhavalabs.com`) gets the public site at `/`, `LPL_ADMIN_HOSTS`
(`admin.price.prabhavalabs.com`, and the original `lanka-price-lens.prabhavalabs.com`) get the
admin at `/admin/` with `/` redirecting there. On the public host `/admin/*` redirects to the
first admin host. With neither variable set (a single-host or local install) the public site
answers at `/` wherever `web/dist` exists and the admin stays at `/admin/`.

`deploy/nginx/lanka-price-lens.conf` has a server block for the two new hosts and keeps the
original host answering `/v1/` (the deploy health check) while redirecting browsers to the
admin. Adding the hosts on the VPS is a one-time operation outside the deploy workflow:

```bash
# DNS first: A records for price and admin.price pointing at the VPS.
sudo install -m 0644 /opt/lanka-price-lens/deploy/nginx/lanka-price-lens.conf /etc/nginx/sites-available/lanka-price-lens.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d price.prabhavalabs.com -d admin.price.prabhavalabs.com
```

## Development

```bash
pnpm dev:api      # API on :3000
pnpm dev:web      # site on :5174, /v1 proxied to the API
```

`pnpm --filter @lanka-pricelens/web build` writes `web/dist`; the production image copies it and
`compose.yaml` points `LPL_WEB_ROOT` at it.

## Not yet

Sinhala and Tamil names for every product (the fields exist and the site shows them when
present), price alerts, dish costing, and the weekly budget planner.
