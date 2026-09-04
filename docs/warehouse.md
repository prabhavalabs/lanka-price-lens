# PostgreSQL warehouse

The foundry keeps collecting into its operational SQLite store (runs, staging,
quarantine, evidence). The **warehouse** is a PostgreSQL database that mirrors the
canonical layer (sources, markets, products, items, unit rules, publications,
price observations) and adds the indexes and aggregates that serving and
reporting need. It is the store to build consumer-facing queries and reports on
as the data grows.

## Schema

| Table / view | Grain | Notes |
| --- | --- | --- |
| `source`, `market`, `product`, `item`, `unit_rule`, `publication` | reference | Same ids as SQLite, so mappings stay valid across both stores |
| `price_observation` | one canonical observation | Same row ids as SQLite; `observed_on` is the trading day; `mid_value_minor` is a stored generated column (midpoint of the normalised range); `status` is active / superseded / withdrawn |
| `daily_item_price` (materialized) | item, market, source, price type, day | Low, high, mid, and count of active observations; refreshed after each sync |
| `latest_item_price` (materialized) | item, market, price type | Newest day per series with its low, high, mid, and the count of observations behind it (one for a bulletin, one per product label for a store); what a consumer screen shows first |
| `sync_state` | one row per synced stream | Cursor (change stamp, id) of the last observation copied |
| `schema_migration` | one row per migration | Migrations apply in order and are recorded |

Indexes on `price_observation`:

- `(item_id, market_id, price_type, observed_on DESC) WHERE status = 'active'`: the series query
- `(observed_on, price_type) WHERE status = 'active'`: day slices and baskets
- `(market_id, observed_on DESC) WHERE status = 'active'`: market pages
- `(source_id, observed_on DESC)`: per-source reporting
- `(effective_key) WHERE status = 'active'`: uniqueness checks (the report counts duplicates)
- `(updated_at)`: change tracking

Prices are stored as integer minor units (cents of LKR) exactly as in SQLite; the
warehouse never re-derives a price, so both stores agree to the cent.

## Sync

`foundry warehouse sync` copies changes from SQLite:

1. applies pending migrations;
2. upserts the reference tables whole (they are small);
3. streams observations in `(change stamp, id)` order from the saved cursor, 500
   per transaction, upserting by id, and advances the cursor after each batch, so
   an interrupted run resumes where it stopped and a rerun sends nothing new;
4. refreshes the materialized views.

The change stamp is `COALESCE(updated_at, created_at)` on the SQLite row;
canonicalisation stamps `updated_at` whenever it supersedes a row, so status
changes flow through as well as inserts. `--full` ignores the cursor and resends
everything (still an upsert, still idempotent); use it after a schema change.
Transient database errors (connection drops, deadlocks, serialization failures)
are retried with growing pauses; anything else fails the run loudly.

## Validation report

`foundry warehouse report` (add `--json` for machine output) prints totals,
per-source and per-market coverage, integrity checks (duplicate active effective
keys, missing keys, dangling supersessions, orphan publications, items priced in
more than one unit, implausible per-kilogram prices, stale sources), and the
latest price of staple items across every market.

## Operating

- Production: `compose.yaml` runs `postgres` (18, alpine) with a named volume; the
  `api`, `foundry`, and `scheduler` services receive `LPL_POSTGRES_URL`. The deploy
  script generates `POSTGRES_PASSWORD` in `app.env` on first use and runs
  `warehouse migrate` after the app is up. Both systemd timers run
  `warehouse sync` after their capture or sync step.
- Local: point `LPL_POSTGRES_URL` at any PostgreSQL 16+ (for example a container on
  port 5433) and run `pnpm --filter @lanka-pricelens/foundry cli warehouse migrate`
  then `… warehouse sync`. Tests use PGlite (PostgreSQL in-process), so they need
  no server.

## Growth plan

Canonical volume today is a few thousand rows per day, which a single table with
the indexes above serves comfortably for years. When `price_observation` passes
tens of millions of rows: partition it by month on `observed_on` (declarative
range partitioning; every serving query filters on the day), add a BRIN index on
`observed_on`, and move the materialized views to incremental rollup tables
maintained by the sync. None of that changes the sync contract or the row ids.

## Serving: the price explorer

The admin portal's **Price explorer** page reads the warehouse only. It works at
the level a shopper thinks at: the **product** ("Potato"), not the items the
sources tell apart ("Potato (Imported)", "Potato (Welimada)", the unlabelled potato
a supermarket sells). Search matches product and item labels, varieties, origins,
and every alias in `item_alias` (the labels bulletins and stores use, synced from
the operational mapping table), so "bandakka" finds ladies fingers and "B'Onion
Imported" finds Big Onion; each product is one result, whatever its varieties.

The product view pools the selected varieties **per seller**: one row per market or
store with the low, high, and average across the varieties it reports, the
varieties named on the row, and the count of prices behind it. Bulletins price by
origin and supermarkets by unlabelled produce, so pooling is what finally puts a
shelf price beside the market price of the same food. Variety chips narrow the
view to one variety; the URL keeps the choice (`varieties=all` or a list of item
ids). Which varieties open by default is the product's `comparison` setting in the
mapping bundle: `pooled` (the default) opens on every variety, right for origins,
grades, and sizes; `by_variety` opens on the base variety alone, right for
products whose items are different things under one name (chicken cuts, banana
and mango types, pepper colours, salted and unsalted butter). Endpoints:
`GET /v1/admin/explorer/search?q=` and
`GET /v1/admin/explorer/products/:id?days=|from=&to=&varieties=`.

Under the hood it combines `latest_item_price` (latest price per seller, grouped
into wholesale markets, retail markets, and supermarkets, with the group average in
the group's most common unit and the shelf-over-wholesale markup) with
`daily_item_price` over the chosen period (one trend line per seller, the seller's
daily average across the pooled varieties, first-to-last change per seller). A
supermarket's price is the range across every brand and pack of the product on its
shelf that day. Every seller carries a mark (`admin/src/components/seller-mark.tsx`):
supermarkets their official logo (files and sources under `admin/public/sellers/`,
with a monogram fallback if a file cannot load), markets a glyph drawn from the place
(Pettah's clock tower, Dambulla's rock, the Kelani bridge at Peliyagoda), with
retail markets tinted so they never pass for the wholesale market of the same town;
a market without a drawn mark gets a stable colour and initials from its id.
When `LPL_POSTGRES_URL` is not
set or the database is unreachable, the endpoints answer 503 and the rest of the
admin keeps working.
