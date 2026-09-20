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
- **Store offers on a product:** under the seller tables, "Store offers today" lists what the stores mark down on
  that product (up to six, cheapest first): the store's label and pack, the offer beside the regular
  price, the offer per kilo (or litre, or piece), and the cut. The sellers' prices above it stay what
  every shopper pays.
- **Deals (`/deals`):** what each supermarket itself marks down today, from `GET /v1/public/offers`,
  each with the store's own picture of the item (served from `/store-images/*`, immutable; the generated
  product photo stands in until a copy is kept, the store's mark when there is neither) and "View at
  <store>", which opens the item on the store's site in a new tab:
  the store's own product name and pack, the offer price with the store's regular price struck
  through, the cut, and who it is for (a Keells Nexus price is badged and shows the shelf price
  beside it; a store's cap per shopper is stated). Chips filter by store (with counts), "Food we
  track" (labels that map to a product, which then link to its page with the offer on the
  product's unit), "For everyone", and "Members' prices"; the search waits for a pause; filters
  and the page live in the address. "Deals" sits in the header beside Recipes.
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
  With `LPL_FEEDBACK_DISCORD_WEBHOOK` set (an incoming webhook of the community Discord's staff
  inbox channel) each message is also posted there as an embed, mentions disabled.
  Mail and the Discord post never block or fail the request; without the settings the messages simply stay in the
  admin.
- **Who is here:** the footer shows how many people are on the site. Each tab keeps a random id
  in session storage and posts a beat to `POST /v1/public/presence` once a minute while visible;
  the API counts ids seen in the last three minutes, in memory, no cookies.
- **Analytics:** with `LPL_GA_MEASUREMENT_ID` set (a GA4 id, `G-…`), `GET /v1/public/config`
  hands it to the site, which loads gtag with IP anonymisation, sends a page view on every route
  change, `add_to_basket` and `feedback_sent` events, and stays silent for visitors whose browser
  says "do not track". Without the id nothing is loaded.
- **Link previews:** every page carries the full Open Graph and Twitter card set (site name,
  locale, type, title, description, canonical url, a 1200×630 image with type, size and alt,
  `summary_large_image`, `@PrabhavaLabs`). The shell holds the site's own block between
  `<!-- social -->` markers; the prerender swaps it per page. The images are drawn by the API
  (`api/src/og.ts`, resvg with the bundled IBM Plex TTFs in `api/assets/fonts`) from today's
  data: `/og/site.png`, `/og/page/{guide,recipes,basket,about}.png`, `/og/p/<id>.png` (label,
  the three group prices, 30-day change, the product photo), `/og/r/<id>.png` (dish, summary,
  ingredients, time, difficulty). Unknown ids get the site card. Cached an hour in memory and
  a day at the edge. Preview any card by opening its url; the Facebook Sharing Debugger and
  X's card validator re-fetch it.
- **Community:** with `LPL_DISCORD_INVITE_URL` set (a `https://discord.gg/…` invite), the config
  names it, the footer, the About page, and the top of the guide link to it, and `CommunityInvite`
  shows one small closable card five seconds after arriving. "Not now" keeps it away for 30 days;
  clicking through, for good. The rule is `web/src/lib/community.ts`.
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

Product photos (`data/images/products/<slug>.jpg`, one per product), pantry photos
(`data/images/pantry/`), dish photographs (`data/images/recipes/<slug>.jpg`, one per dish,
slug = dish id without `dish_`), and store logos (`data/images/sellers/`) are shared by the
admin and the site; the API serves them at `/images/…` with a day of browser cache and a week
at the edge. The image copies `data/images`.

Dish photographs are made by `node scripts/recipes/photos.mjs` with the Codex CLI's built-in
image tool (the owner's ChatGPT subscription, no API key): one ultra-realistic 3:2 picture per
dish from its name, summary, ingredient lines, and serving description, in parallel batches,
then a 900 px JPEG each. Re-running fills in only the dishes still without a picture. The site
shows them on recipe cards and at the top of the recipe page (`DishPhoto`), the recipe OG
card carries the photo beside the title, and the daily recipe mail uses the photo instead of
the OG card when the dish has one.

## The guide

`/guide` is a how-to-use page for visitors: nine sections, each with steps and screenshots of
the live site, and an "on this page" list that follows the reader. The text lives in
`web/src/content/guide.ts`, the page in `web/src/pages/guide.tsx`, and the screenshots in
`web/public/guide/`. The same guide is in the repository as [user-guide.md](user-guide.md).

To refresh the screenshots after a visible change, run `web/scripts/guide-screenshots.js` from
the repository root with playwright-cli (it seeds a basket, signs in with the account named at
the top of the script since menus live on the account, creates the guide's menu there once, and
shoots the site at 1280 wide, in dark, and on a phone), then compress them. Fill in `account`
with a throwaway before running and never commit it; to shoot a local build, point `origin` at
it in a copy of the script:

```bash
playwright-cli open
playwright-cli run-code --filename=web/scripts/guide-screenshots.js
playwright-cli close
pngquant --quality=65-85 --speed 1 --force --ext .png web/public/guide/*.png
```

`web/test/guide.test.ts` checks that every screenshot the guide refers to exists at the size
declared in the content file, so a re-shoot that changes a size fails the build until the
content is updated.

## Brand

The mark (a green magnifying lens holding leaves and rice grains, amber accents) is a raster
PNG for now: `web/public/mark.png` (256 px, transparent) for the header and the sign-in card,
`favicon.png` (64 px) and `favicon.svg` (the same PNG wrapped) for the tab, `apple-touch-icon.png`
(180 px on the light ground) for home screens, and `api/assets/brand/mark.png` embedded in the
social cards. Account mail links to `https://badumila.com/mark.png` (or the same path
on `LPL_SITE_ORIGIN` when that is an https origin), since mail clients fetch images over the
network. Source renders and larger sizes live outside the repository in `marketing/brand/`.

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
| `GET /v1/public/products/:id?days=30\|90\|180\|365&varieties=` | The explorer detail (latest by seller, summary, markup, series), published sources only, with `offers`: what the stores themselves mark down on the product today |
| `GET /v1/public/search?q=` | Products matching a label, variety, or a source's own wording (two characters or more) |
| `GET /v1/public/basket?products=a,b,c` | The latest price of each product at every published seller (up to 60 products) |
| `GET /v1/public/offers?market=&audience=everyone\|members&catalogue=1&q=&page=&pageSize=` | What each supermarket itself marks down: the store's label, pack, list and offer price, percent, who it is for, and the product it maps to. Each store on its newest day (left out past three days), deepest cut first, 48 a page (200 at most). Every offer carries `url` (the item on the store's site) and `image` with `image_origin`: the store's picture under `/store-images/…` once a copy is kept, else the generated photo of the mapped product, else null |
| `POST /v1/public/feedback` | `{ kind: "feedback" \| "bug", message, email?, page?, website? }`; 201, 400 on a bad message, 429 past five an hour |
| `GET /v1/public/recipes?q=&category=&meal=&page=` | Browse the dish catalogue (24 per page) |
| `GET /v1/public/recipes/recommend?products=a,b,c&limit=` | Dishes ranked by fit to those products, with names and cheapest prices of every ingredient involved |
| `GET /v1/public/recipes/:id` | One dish with its key ingredients priced |
| `GET /v1/public/config` | What the site needs from the deployment: the analytics id, when set |
| `POST /v1/public/presence` `{ id }` / `GET /v1/public/presence` | Beat for the online count / the count; never cached |

All three answer 503 when the warehouse is unavailable.

## Hosting

The API container serves both sites and picks by host name: `LPL_WEB_HOSTS`
(`badumila.com`, `www.badumila.com`) gets the public site at `/`, `LPL_ADMIN_HOSTS`
(`admin.badumila.com`, and the original `lanka-price-lens.prabhavalabs.com`) get the
admin at `/admin/` with `/` redirecting there. On the public host `/admin/*` redirects to the
first admin host, so the new admin host leads the list. With neither variable set (a
single-host or local install) the public site answers at `/` wherever `web/dist` exists and the
admin stays at `/admin/`. `LPL_SITE_ORIGIN` (`https://badumila.com`) is the address every link
in mail, Telegram, the social cards, and the OAuth redirects is built from.

The site lived at `price.prabhavalabs.com` and `admin.price.prabhavalabs.com` until
2026-09-20. Both stay in the host lists and in nginx: pages answer 301 to the same path and
query on `badumila.com` (bookmarks, search results, and links in mail already sent keep
working), while `/v1/` on the old public host is still served in place, because a one-click
unsubscribe from an old mail is a POST and a redirected POST arrives as a GET. Accounts sign
in again once after the move (a session cookie belongs to its host), and a basket kept in the
browser stays with the old address.

`deploy/nginx/lanka-price-lens.conf` is the reference configuration: one server block for the
two new hosts, `www` redirected to the bare domain, the two earlier hosts redirected as above,
and the original host kept for `/v1/` (the deploy health check) with browsers redirected to the
admin. On the production VPS the hosts live in certbot-managed site files:
`/etc/nginx/sites-available/lanka-price-lens` (original host),
`/etc/nginx/sites-available/lanka-price-lens-public` (the two earlier hosts, one certificate),
and `/etc/nginx/sites-available/lanka-price-lens-badumila` (`badumila.com`, `www`, and `admin`,
one certificate). All proxy to the API container on 127.0.0.1:8651. Adding a host is a one-time
operation outside the deploy workflow: point its DNS record at the server, write the server
block, enable it, `nginx -t`, reload, then `certbot --nginx --redirect -d <host>`. DNS is at
Cloudflare with the records set to DNS only, so the certificate challenge and the visitor's
address reach nginx directly.

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
