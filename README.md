# Lanka PriceLens

Sri Lanka's food prices, every day, in one place: open markets and supermarkets side by side,
with history, a basket that prices your shopping list at every store, and recipes matched to what
you have.

**Public site:** [price.prabhavalabs.com](https://price.prabhavalabs.com)

| | |
| --- | --- |
| ![The price board](web/public/guide/board.png) | ![A product page](web/public/guide/product.png) |
| The board: every product, open markets and supermarkets side by side, the month's movers | A product: sellers by group, the cheapest marked, a year of history |
| ![The basket](web/public/guide/basket.png) | ![A recipe](web/public/guide/recipe.png) |
| The basket: your list priced at every store, in the amounts you set, and dishes to cook from it | A recipe: what you have, what is still to buy at today's cheapest price |

## What it does

- **Collects** official price bulletins (HARTI daily wholesale prices, the Central Bank's daily
  price report, the Department of Census and Statistics' weekly retail prices) as published,
  archives the originals, and parses them with the page and row every price came from.
- **Captures** supermarket shelf prices from the online stores of Keells, Cargills, Glomark, and
  SPAR every morning.
- **Matches** every label to a reviewed product vocabulary, so a bulletin's "B'Onion Imported"
  and a shelf's "Big Onions" compare as the same thing; unknown labels wait for review instead of
  being guessed.
- **Serves** a public site for households and an admin for the operator, from one API on one
  server, with a PostgreSQL warehouse behind the price views.

## Using the site

The site has its own guide with screenshots at
[price.prabhavalabs.com/guide](https://price.prabhavalabs.com/guide): finding a product, reading
a price and its history, building a basket in real amounts, comparing stores, cooking from the
basket, phone and theme, feedback and privacy. The same guide is in the repository as
[docs/user-guide.md](docs/user-guide.md); the screenshots live in `web/public/guide/` and are
refreshed from the live site with `web/scripts/guide-screenshots.js`.

## Documentation

| Topic | Where |
| --- | --- |
| Using the site | [docs/user-guide.md](docs/user-guide.md), live at [/guide](https://price.prabhavalabs.com/guide) |
| How the site works and its public API | [docs/public-site.md](docs/public-site.md) |
| Architecture and the separation of operational data from public views | [docs/architecture.md](docs/architecture.md) |
| Official PDF sources and their parsers | [docs/official-sources.md](docs/official-sources.md), [docs/pdf-archive.md](docs/pdf-archive.md), [docs/pdf-intake.md](docs/pdf-intake.md) |
| Supermarket capture, mapping rules, proxies, snapshots | [docs/retail-capture.md](docs/retail-capture.md) |
| Workflows, retries, automation health | [docs/workflows.md](docs/workflows.md) |
| The warehouse and the explorer | [docs/warehouse.md](docs/warehouse.md) |
| The recipe catalogue and recommendations | [docs/recipes.md](docs/recipes.md) |
| Canonical taxonomy and release process | [docs/canonical-taxonomy.md](docs/canonical-taxonomy.md), [docs/release-process.md](docs/release-process.md) |
| Source rights and policy | [docs/source-permission.md](docs/source-permission.md), [docs/source-policy.md](docs/source-policy.md) |
| Running it yourself | [docs/self-hosting.md](docs/self-hosting.md) |

## Repository layout

| Package | Purpose |
| --- | --- |
| `shared/` | Schemas and vocabulary shared by everything (manifests, mapping bundles, dishes) |
| `foundry/` | The data pipeline: discovery, archive, parsing, mapping, retail capture, warehouse sync, the CLI |
| `api/` | The Hono API: public read routes, the owner's admin routes, both sites' static files |
| `admin/` | The operator's console (React) |
| `web/` | The public site (React) |
| `archive/` | The Cloudflare Worker that fronts the PDF archive |
| `data/` | Source manifests, mapping bundles, the recipe catalogue, product photos and store marks |
| `deploy/` | The VPS deploy script, systemd units, nginx configuration |

## Development

```bash
corepack pnpm install
pnpm dev:api      # API on :3000 (serves the built admin and site)
pnpm dev:admin    # admin on :5173
pnpm dev:web      # site on :5174
pnpm check        # typecheck, tests, build for every package
```

Node 24 and pnpm 11. The API needs a PostgreSQL warehouse for the price views (`LPL_POSTGRES_URL`);
see `.env.example` for every setting and [docs/self-hosting.md](docs/self-hosting.md) for a full
install.

## Data and rights

Every source is used with the publisher's recorded permission and carries the publisher's
attribution on the site. Prices are shown as observed on the date stated and may differ in store
or at the stall.

## Licence

MIT.
