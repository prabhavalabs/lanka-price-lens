# Public price site

The consumer site (`web/`) shows today's food prices across Sri Lanka's open markets and
supermarkets with their history. It is a separate package from the owner's admin (`admin/`)
and reads only the public API.

## What it shows

- **Board (`/`):** every product with a published price, one card each, with a line per
  seller group (open markets, supermarkets, wholesale): the range across sellers in the unit
  most sellers use, the seller count, the observation day, and the change of the sellers'
  average over 30 days. Category chips and a search box narrow the board; Sinhala and Tamil
  labels appear where the vocabulary has them.
- **Product (`/p/:id`):** sellers by group sorted by price with the cheapest marked, the
  supermarket-over-wholesale markup, and a history chart (30 days, 90 days, a year) with a
  line per seller. Pooled products pool their varieties; by-variety products open on the base
  variety, as in the admin explorer.
- **About (`/about`):** how prices are collected, the sources with their attribution and
  cadence, and what is coming.

Every price carries the date it was observed and the site says so on every page.

## Public API

Read-only, no sign-in, only sources whose rights allow publication (`canPublishSource`),
cacheable (`Cache-Control: public, max-age=300, s-maxage=900`) and readable from any origin.

| Path | Purpose |
| --- | --- |
| `GET /v1/public/overview` | Sources with attribution and one card per product with a price line per seller group |
| `GET /v1/public/products/:id?days=30\|90\|180\|365&varieties=` | The explorer detail (latest by seller, summary, markup, series), published sources only |
| `GET /v1/public/search?q=` | Products matching a label, variety, or a source's own wording (two characters or more) |

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

Server-rendered pages for search engines (the site is a client-rendered app today), Sinhala
and Tamil names for every product, the basket comparison, dish costing, and price alerts.
