# Public price site

The consumer site (`web/`) shows today's food prices across Sri Lanka's open markets and
supermarkets with their history. It is a separate package from the owner's admin (`admin/`)
and reads only the public API.

## What it shows

The site shares the admin's design system (shadcn components, the same tokens and fonts,
product photos and store logos). The theme follows the device by default; the header's
toggle sets light, dark, or back to the device, remembered in the browser and applied before
the first paint by a small script in `index.html`.

State that several parts of the page share lives in one store per concern
(`web/src/store/basket.ts`, `web/src/store/theme.ts`, both on `useSyncExternalStore`): the
board card, the header's quick basket, the product page, and the basket page read and change
the same basket, which is persisted in the browser and kept in step across tabs. A quantity
taken to zero removes the line.

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
- **Quick basket:** the header's basket opens a dropdown to adjust or remove items on the go,
  with a button to the full comparison. On a card, "Add" turns into a quantity control once the
  product is in the basket and the card is marked.
- **Basket (`/basket`):** the shopper's list, kept in the browser, priced at every seller
  through `GET /v1/public/basket?products=`: sellers that carry the whole list first, then by
  total, with what each one is missing; quantities per item; share the result. Sellers whose
  newest price is older than 30 days are left out of the totals.
- **Stale prices:** a price older than its source's cadence allows (a week for a daily source,
  three weeks for a weekly one; `age_days` and `stale` on every seller row from the API) is
  shown struck through with an "outdated · 9 months ago" badge and never counts as the cheapest.
- **History card:** the range (30 days, 90 days, a year) and the seller groups drawn are in the
  URL (`?days=90&groups=supermarket,wholesale`), so a view can be shared; changing them refreshes
  only the card, without scrolling. Hover or tap a day for every seller's exact price on it; tap
  again to unpin.
- **Feedback:** "Feedback" in the header and the footer opens a dialog: feedback or a bug
  report, a message, an optional email, with the page URL and browser attached. It posts to
  `POST /v1/public/feedback` (five per hour per address, a honeypot field for bots). The owner
  reads and works through them in the admin's **Feedback** page (new, seen, done) through
  `GET /v1/admin/feedback` and `PATCH /v1/admin/feedback/:id`.
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
| `POST /v1/public/feedback` | `{ kind: "feedback" \| "bug", message, email?, page?, website? }`; 201, 400 on a bad message, 429 past five an hour |

All three answer 503 when the warehouse is unavailable.

## Hosting

The API container serves both sites and picks by host name: `LPL_WEB_HOSTS`
(`price.prabhavalabs.com`) gets the public site at `/`, `LPL_ADMIN_HOSTS`
(`admin.price.prabhavalabs.com`, and the original `lanka-price-lens.prabhavalabs.com`) get the
admin at `/admin/` with `/` redirecting there. On the public host `/admin/*` redirects to the
first admin host. With neither variable set (a single-host or local install) the public site
answers at `/` wherever `web/dist` exists and the admin stays at `/admin/`.

`deploy/nginx/lanka-price-lens.conf` is the reference configuration: one server block for the
two new hosts, and the original host kept for `/v1/` (the deploy health check) with browsers
redirected to the admin. On the production VPS (2026-09-05) the hosts live in two certbot-managed
site files, because the original host's file already carried its TLS blocks:
`/etc/nginx/sites-available/lanka-price-lens` (original host) and
`/etc/nginx/sites-available/lanka-price-lens-public` (`price` and `admin.price`, one certificate
covering both, HTTP redirected to HTTPS). Both proxy to the API container on 127.0.0.1:8651.
Adding a host is a one-time operation outside the deploy workflow: write the server block, enable
it, `nginx -t`, reload, then `certbot --nginx --redirect -d <host>`.

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
