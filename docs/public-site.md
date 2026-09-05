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
- **Quick basket:** the header's basket opens a dropdown to adjust or remove items on the go
  (a scroll area past eight items), clear the whole list in two taps, or go to the full
  comparison. On a card, the "Add" button in the top-right corner turns into a −/count/+ control
  once the product is in the basket (a short zoom-in on the swap and on each count change) and
  the card is marked.
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
  again to unpin. Lines draw themselves in from left to right when they appear and again when the
  scale changes (staggered per seller), the grid fades in, markers pop in on hover while the other
  lines dim, and all of it is skipped for readers whose device asks for reduced motion.
- **Feedback:** "Feedback" in the header and the footer opens a dialog: feedback or a bug
  report, a message, an optional email, with the page URL and browser attached. It posts to
  `POST /v1/public/feedback` (five per hour per address, a honeypot field for bots). The owner
  reads and works through them in the admin's **Feedback** page (new, seen, done) through
  `GET /v1/admin/feedback` and `PATCH /v1/admin/feedback/:id`, and receives each one by mail
  through Resend when `LPL_FEEDBACK_EMAIL_TO` and `LPL_RESEND_API_KEY` are set (`LPL_MAIL_FROM`
  names the sender: a verified domain, or Resend's shared `onboarding@resend.dev` while testing).
  Mail never blocks or fails the request; without the settings the messages simply stay in the
  admin.
- **Who is here:** the footer shows how many people are on the site. Each tab keeps a random id
  in session storage and posts a beat to `POST /v1/public/presence` once a minute while visible;
  the API counts ids seen in the last three minutes, in memory, no cookies.
- **Analytics:** with `LPL_GA_MEASUREMENT_ID` set (a GA4 id, `G-…`), `GET /v1/public/config`
  hands it to the site, which loads gtag with IP anonymisation, sends a page view on every route
  change, `add_to_basket` and `feedback_sent` events, and stays silent for visitors whose browser
  says "do not track". Without the id nothing is loaded.
- **Quantities:** a basket line holds a decimal amount in the unit the product is priced in (0.5
  for half a kilo, 6 for six eggs, 0.75 for 750 ml). "Add" starts at half a kilo or litre, or one
  piece; the −/+ steps are a quarter kilo or litre, or one piece; tapping the amount opens presets
  (100 g to 5 kg, 250 ml to 2 l, 1 to 30 pieces) and a free field in grams or kilos. Below 50 g,
  50 ml, or one piece the line is removed. Totals multiply a seller's average price by the amount
  and only count sellers priced in the same unit as the line.
- **Recipes (`/recipes`, `/r/:id`):** the dish catalogue, searchable by name in any of its languages
  or by ingredient, with a category filter. A dish page lists its key ingredients split into "from
  your basket" and "still to buy" (today's cheapest price per unit, add in the amount you want),
  the pantry items the price vocabulary does not carry, variants, and dishes it goes with, plus a
  rough extra cost (one unit of each missing ingredient at its cheapest seller).
- **Cook with your basket:** the basket page suggests dishes from what is in it. A dish scores by
  how much of its key ingredients the basket covers (40%), how much of the basket it uses (30%),
  how many basket items it brings together (30%, up to three), a nudge for everyday dishes, and a
  small cost per ingredient still to buy; one shared ingredient is enough to appear, dishes that
  use the basket well come first. Each card shows how many key ingredients are in the basket and
  names what is still needed.
- **About (`/about`):** how prices are collected, the sources with their marks, attribution and
  cadence, and what is coming.

Every price carries the date it was observed and the site says so on every page.

## Images

Product photos (`data/images/products/<slug>.jpg`, one per product) and store logos
(`data/images/sellers/`) are shared by the admin and the site; the API serves them at
`/images/…` with a day of browser cache and a week at the edge. The image copies `data/images`.

## The guide

`/guide` is a how-to-use page for visitors: nine sections, each with steps and screenshots of
the live site, and an "on this page" list that follows the reader. The text lives in
`web/src/content/guide.ts`, the page in `web/src/pages/guide.tsx`, and the screenshots in
`web/public/guide/`. The same guide is in the repository as [user-guide.md](user-guide.md).

To refresh the screenshots after a visible change, run `web/scripts/guide-screenshots.js` from
the repository root with playwright-cli (it seeds a basket and shoots the public site at 1280
wide, in dark, and on a phone), then compress them:

```bash
playwright-cli open
playwright-cli run-code --filename=web/scripts/guide-screenshots.js
playwright-cli close
pngquant --quality=65-85 --speed 1 --force --ext .png web/public/guide/*.png
```

`web/test/guide.test.ts` checks that every screenshot the guide refers to exists at the size
declared in the content file, so a re-shoot that changes a size fails the build until the
content is updated.

## Search engines and previews

`web/scripts/prerender.mjs` runs after `vite build` and writes one page per product
(`dist/p/<id>/index.html`) with its title, description, canonical URL, and Open Graph tags
(the product photo as the image), plus `sitemap.xml` and `robots.txt`. The API serves the
prerendered page for `/p/<id>`, `/r/<id>`, `/recipes`, and `/guide`, and the app shell for everything else, so a crawler or a chat
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
| `GET /v1/public/recipes?q=&category=&meal=&page=` | Browse the dish catalogue (24 per page) |
| `GET /v1/public/recipes/recommend?products=a,b,c&limit=` | Dishes ranked by fit to those products, with names and cheapest prices of every ingredient involved |
| `GET /v1/public/recipes/:id` | One dish with its key ingredients priced |
| `GET /v1/public/config` | What the site needs from the deployment: the analytics id, when set |
| `POST /v1/public/presence` `{ id }` / `GET /v1/public/presence` | Beat for the online count / the count; never cached |

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
