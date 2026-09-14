# Personalised recipes, daily deals, and mail templates

Three things that hang off an account and one that hangs off the warehouse, built together
because they share the mail layout and the daily rhythm:

1. **Food preferences** on the account (diet, things to avoid, goals, favourite kinds of
   dish) and a **Surprise me** pick on the recipes section that uses them.
2. A **daily recipe mail**: three recipes chosen for the person's preferences, never the
   same ones twice in three weeks.
3. A **deals engine** over the supermarket series in the warehouse (drops against yesterday
   and against the fortnight, the cheapest store for a product, a watch on common household
   items) and a **daily deals mail** built from it.
4. **Mail templates** for every mail the site sends, with the wording editable in the admin
   portal and a preview beside the editor. The layout stays in code; the words do not.

This page is the contract between the packages. Types and names here are the ones the code
uses; when the code and this page disagree, fix one of them the same day.

## Preferences

`preferencesSchema` in `shared/src/accounts.ts` grows from three switches to:

```ts
export const dietChoices = ["everything", "vegetarian", "vegan", "pescatarian"] as const;
export const avoidChoices = ["egg", "dairy", "fish", "meat", "gluten"] as const;
export const goalChoices = ["weight_loss", "high_protein", "diabetic_friendly", "heart_healthy", "budget", "quick", "kid_friendly", "comfort"] as const;

export const preferencesSchema = z.object({
  notify_email: z.boolean().default(true),     // everything that is not about the account itself
  notify_digest: z.boolean().default(false),   // the daily deals mail
  notify_alerts: z.boolean().default(false),   // price alerts (later)
  notify_recipes: z.boolean().default(false),  // the daily recipe mail
  diet: z.enum(dietChoices).default("everything"),
  avoid: z.array(z.enum(avoidChoices)).max(5).default([]),
  goals: z.array(z.enum(goalChoices)).max(8).default([]),
  likes: z.array(z.enum(dishCategories)).max(9).default([]),   // favourite kinds of dish
});
```

Stored as before in `account.preferences_json`; rows saved before this change parse with
the defaults. `PATCH /v1/account/me` takes any subset under `preferences` (already merged
with the current values in `service.ts`). A mail of a kind the person has switched off is
never sent, and account mail (verification, resets) ignores `notify_email`.

How the choices meet the dish catalogue (`dish.diet` carries `vegetarian`, `vegan`,
`gluten_free`, `contains_egg`, `contains_dairy`, `contains_fish`, `contains_meat`):

| Choice | A dish qualifies when |
| --- | --- |
| `diet: vegetarian` | `diet` has `vegetarian` or `vegan` |
| `diet: vegan` | `diet` has `vegan` |
| `diet: pescatarian` | `diet` lacks `contains_meat` |
| `avoid: egg / dairy / fish / meat` | `diet` lacks the matching `contains_*` |
| `avoid: gluten` | `diet` has `gluten_free` |

Goals map to the recipe tags (`recipeTags` in `shared/src/recipes.ts`) and score rather
than filter: `weight_loss` → `weight_loss_friendly`, `low_calorie`, `light` (and a penalty for
`deep_fried`, `high_sugar`); `high_protein` → `high_protein`; `diabetic_friendly` → the tag
(penalty `high_sugar`); `heart_healthy` → the tag (penalty `high_sodium`, `deep_fried`);
`budget` → `budget`; `quick` → `quick`, `one_pot`; `kid_friendly` → the tag; `comfort` →
`comfort`, `filling`. `likes` adds a bonus per matching `dish.category`.

## Recommendation (`shared/src/recommend.ts`)

Pure functions, no I/O, tested in `shared/test/recommend.test.ts`:

```ts
export type DishFacts = {
  id: string;
  category: DishCategory;
  diet: string[];                  // dish.diet
  tags: string[];                  // recipe.tags
  kcal_per_serving: number | null;
  minutes: number | null;          // prep + cook + passive
  popularity: 1 | 2 | 3;           // 1 = most popular
};
export function suitable(dish: DishFacts, preferences: AccountPreferences): boolean;      // hard filters (diet, avoid)
export function scoreDish(dish: DishFacts, preferences: AccountPreferences): number;      // goals, likes, popularity; higher is better
export function explainPick(dish: DishFacts, preferences: AccountPreferences): string[];  // "vegetarian", "under 30 minutes", "you like rice and grains"
export function pickSurprise(dishes: DishFacts[], preferences: AccountPreferences, options: { exclude?: Iterable<string>; seed?: string }): DishFacts | null;
export function pickDaily(dishes: DishFacts[], preferences: AccountPreferences, options: { exclude: Iterable<string>; count: number; seed: string }): DishFacts[];
```

`pickSurprise` is a weighted random draw among suitable dishes (weight = score, floor 1);
with a `seed` the draw is deterministic (a small xorshift or mulberry32 over the seed's
hash, no dependency). `pickDaily` is deterministic for its seed (the day and the account id),
prefers different categories among the `count` picks, and never returns an excluded id.
With no preferences set every dish is suitable and popularity decides the weights.

## Surprise me

`GET /v1/public/recipes/surprise?exclude=dish_a,dish_b&seed=` answers
`{ id, name, reasons }` for one dish that has a full recipe. With a session cookie the
account's preferences apply (the route runs behind `readAccount`); without one the catalogue
defaults do, and `?diet=vegetarian` (a `dietChoices` value) may narrow it. `exclude` (up to
50 ids) keeps "another one" from repeating; the site remembers the ids it has shown in the
tab. 404 `NO_MATCH` when nothing qualifies. Built in `api/src/surprise.ts` as
`surpriseRoutes({ recipes, index })` and mounted at `/v1/public/recipes/surprise` by `app.ts`
before the `/:id` route.

On the site: a **Surprise me** button beside the recipe search bar (`RiDiceLine`) and the
same entry in the ⋯ menu; both call the route and go to `/r/<id>?surprise=1`, where the
recipe page shows a one-line banner ("Picked for you: vegetarian, under 30 minutes") with
**Another one** and, signed out, **Set your preferences** (to `/account/login`, back to
`/account#preferences` afterwards). The profile page gets a **Food preferences** section
(diet, avoid, goals, favourite kinds) saved as switched, and the Notifications section gains
**Daily recipe ideas** (`notify_recipes`) and renames **Daily price digest** to describe
the deals mail.

## Deals engine (`foundry/src/deals/`)

Runs against the warehouse (`WarehouseClient`), over the four online stores only
(`market.type = 'online_store'`, `price_type = 'retail_online_store'`), reading
`daily_item_price` joined to `item` (for `product_id`), `product`, and `market`.

```ts
export type DealKind = "drop" | "offer" | "cheapest";
export type Deal = {
  product_id: string; label: string; unit: string;
  market_id: string; market: string;
  now_minor: number; was_minor: number; was_on: string;   // the comparison price and its day
  pct: number;                                            // signed, -21.3 means down 21.3 %
  kind: DealKind;
  baseline: "yesterday" | "median14" | "other_stores";
  url: string;                                            // /p/<product_id>
};
export type EssentialWatch = {
  product_id: string; label: string; unit: string;
  cheapest: { market_id: string; market: string; price_minor: number };
  change_pct: number | null;        // cheapest today against cheapest yesterday
  trend: "down" | "flat" | "up";    // against the 14-day median of the cheapest price
};
export type DealsDay = {
  day: string;                      // YYYY-MM-DD, Asia/Colombo
  computed_at: string;
  stores: Array<{ market_id: string; label: string; series: number; deals: number }>;   // deals counts both lists
  deals: Deal[];                    // kinds "drop" and "offer" only, best first, one per product, at most 12
  cheapest: Deal[];                 // kind "cheapest", largest gap first, one per product, at most 8
  movers_up: Deal[];                // at most 5, kind "drop" with positive pct
  essentials: EssentialWatch[];     // every essential with a price today
  stats: { series: number; fresh: number; considered: number };
};
export async function computeDeals(client: WarehouseClient, options: { day?: Date; essentials: string[] }): Promise<DealsDay>;
```

Rules (the in-house algorithm, in one place, `foundry/src/deals/compute.ts`, tested with a
fake client):

- A series counts only when its latest day is the day itself or the day before (stale
  observations never make a deal).
- **Drop against yesterday**: the previous observed day is within three days and
  `now ≤ 0.90 × prev`. **Drop against the fortnight**: at least three prior days in the
  last 14 and `now ≤ 0.85 × median`. Either qualifies; the larger fall is the one reported.
  A fall of 20 % or more is reported as an **offer** ("21 % off at Glomark").
- **Cheapest store**: for a product two or more stores sell in the same unit, the cheapest
  is a deal when it is at least 15 % under the next cheapest (`baseline: other_stores`,
  `was_minor` = the next store's price).
- `deals` carries the drops and offers alone, one per product (the best percentage), best
  first, at most 12; the cheapest-store picks are their own list, `cheapest`, largest gap
  first, one per product, at most 8, so they never crowd out a real fall (a day with nine
  cheapest-store picks among twelve deals is what prompted the split). `movers_up` holds the
  largest rises (≥ 15 %) for context.
- **Essentials** are the product ids in `data/deals/essentials.json` (about 25 common
  household items chosen from `data/mappings/*.json`: rice, dhal, sugar, wheat flour,
  coconut, coconut oil, big onion, potato, eggs, chicken, milk powder, tea, garlic, green
  chillies, tomato, carrot, beans, sprats, salt, and the like); each reports the cheapest
  store today and how that compares.

Where the rules leave a choice, the code takes it this way. A series is one item at one
store in one unit (the `daily_item_price` grain without the source); a by-variety product is
read on its base variety alone when it has one, as the product page opens and the basket
totals. Drops and rises are judged per series, because a price fall happens to one shelf
item; the cheapest-store rule and the essentials watch use the store's pooled price, the
average of its items that day, as the explorer shows per seller. `was_on` for the fortnight
median is the oldest day the median covers. Rises qualify at 15 % against either baseline,
one per product. An essential is watched in the unit most stores sell it in; `change_pct` is
null without a price on the day before its latest fresh day, and `trend` is `down` or `up`
when the cheapest price is 5 % or more under or over the median of the cheapest price across
at least three prior days in the fortnight, otherwise `flat`. `stores[].series` and
`stats.series` count series with a price in the window, `stats.fresh` those whose latest day
counts, `stats.considered` fresh series with a usable baseline. The essentials list is read
from the repository's `data/deals/essentials.json` unless `LPL_DEALS_ESSENTIALS_PATH` points
elsewhere, so a container image must carry `data/deals` beside `data/mappings`.

Results are kept in the operational SQLite as `deal_day(day TEXT PRIMARY KEY, computed_at,
deals_json)` through `foundry/src/deals/store.ts` (`saveDealsDay`, `readDealsDay(day)`,
`latestDealsDay()`), and exposed by `GET /v1/public/deals/today` (the latest day; 503
`DEALS_UNAVAILABLE` when there is none) from `api/src/deals.ts` (`dealsRoutes`). The CLI
`pnpm foundry deals compute [--day YYYY-MM-DD] [--save]` prints the day as JSON.

## Mail templates (`api/src/mail/`)

The branded layout that account mail uses today (`api/src/account/mail.ts`) moves to
`api/src/mail/layout.ts` and learns two blocks: **recipe cards** (image, name, one line,
kcal, minutes, cost, link) and **deal rows** (product, store, now, was, a percentage badge).
Every mail the site sends is a *kind* with editable *fields*:

```ts
export const mailKinds = ["verify_email", "welcome", "reset_password", "password_changed", "change_email", "email_changed", "account_deleted", "recipes_daily", "deals_daily"] as const;
export type MailFields = { subject: string; preheader: string; heading: string; intro: string; outro: string; button_label: string; reason: string };
export type MailTemplate = { kind: MailKind; fields: MailFields; defaults: MailFields; placeholders: Array<{ name: string; description: string }>; edited: boolean; updated_at: string | null; updated_by: string | null };
```

Fields are plain text with `{{placeholders}}` (`{{name}}`, `{{link}}`, `{{minutes}}`,
`{{date}}`, `{{count}}`, `{{store}}`…; each kind lists its own). Defaults live in code
(`api/src/mail/defaults.ts`); an edited row in `mail_template(kind TEXT PRIMARY KEY,
fields_json, updated_at, updated_by)` overrides it. `renderMail(kind, data, options)` fills
the placeholders, escapes everything, and returns `{ subject, html, text }`; account mail
calls it through the same `AccountMailer` interface as today, so nothing in the account
service changes. Unknown placeholders render empty; a field left blank falls back to its
default.

Admin routes (owner only, mounted at `/v1/admin/mail`):

| Route | Body | Answer |
| --- | --- | --- |
| `GET /templates` | | every kind with fields, defaults, placeholders, edited |
| `GET /templates/:kind` | | one |
| `PUT /templates/:kind` | `{ fields }` (partial) | the saved template |
| `DELETE /templates/:kind` | | reset to defaults |
| `POST /templates/:kind/preview` | `{ fields? }` | `{ subject, html, text }` rendered with sample data (today's deals or three real recipes when available) |
| `POST /templates/:kind/test` | `{ fields? }` | sends the preview to the owner's address; `{ ok, reference }` |

## Newsletters (`api/src/newsletters/`)

Two kinds, `recipes_daily` and `deals_daily`, each one run per Colombo day:

- **Recipients**: active accounts with a verified address, `notify_email` on, and the
  kind's switch on (`notify_recipes` / `notify_digest`).
- **Recipes**: `pickDaily` with `count: 3`, `seed: <day>:<account id>`, excluding the ids in
  that account's deliveries of the last 21 days. Each card links `<site>/r/<id>` and shows
  `<site>/og/r/<id>.png`; cost per serving is included when the warehouse answers.
- **Deals**: today's `DealsDay` (computed and saved first if missing); the mail carries the
  deals, the essentials watch, and the movers; a day with no deals and no essential moves is
  skipped, never sent empty.
- **Sending** goes through the notify outbox (`notify_outbox`, `createSqliteOutbox` on the
  operational database, `outboxSchema` run in `foundry/src/db.ts`) with the branded
  `html`/`text` in the target meta, `dedupe_key: <kind>:<day>:<account id>`, and the headers
  `List-Unsubscribe` (a `mailto:` and the https link) and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The notify email channel forwards
  `meta.headers` to Resend.
- **Unsubscribe**: `GET|POST /v1/newsletter/unsubscribe?token=` where the token is
  `base64url(account_id:kind:hmac-sha256(secret, account_id:kind))` with
  `LPL_ACCOUNT_STATE_SECRET`; it switches the kind off and answers a small HTML page (GET)
  or 200 (POST, the one-click form). No session needed.
- **Runs** are recorded in `newsletter_run(id, kind, day, trigger, status, started_at,
  finished_at, recipients, sent, skipped, failed, error, report_json)` and each mail in
  `newsletter_delivery(id, run_id, kind, day, account_id, payload_json, outbox_id,
  created_at)`; a kind with a `sent` run for the day does not run again unless forced.
- **Trigger**: `startNewsletterScheduler(deps)` inside the API process (no timers, no
  Actions changes): every minute it dispatches the outbox; at or after
  `LPL_NEWSLETTER_HOUR` (default `07:30`, Colombo) it runs each kind once for the day.
  `LPL_NEWSLETTERS_ENABLED=false` (the default outside production) keeps it off. Admin
  `POST /v1/admin/newsletters/run` `{ kind, day?, dry_run?, force? }` runs on demand and
  answers the run report; `GET /v1/admin/newsletters/runs?kind=&limit=` lists runs;
  `GET /v1/admin/deals/today` and `POST /v1/admin/deals/compute` cover the engine. The CLI
  `pnpm newsletter run --kind <kind> [--day] [--dry-run]` (the API package's own command, so
  it shares the server's configuration) does the same from a shell.

## Wishlist and price alerts

A star beside a product (board card, product page, recipe ingredient line) puts it on the
account's wishlist: one row per account and product in `account_watch`, with its own rule
(`watchAlertSchema` in `shared/src/accounts.ts`: `mode` `any_drop` | `below` | `off`,
`threshold_minor` for `below`), at most 100 per account. `GET /v1/account/watchlist` answers
the entries with today's cheapest published retail seller (open markets and supermarkets,
never wholesale) and the cheapest price the day before; `PUT /:productId` adds or re-rules,
`PATCH /:productId` changes the rule, `DELETE /:productId` removes. The routes sit behind the
session only, so an unverified account can star; the mail itself needs a verified address.

`price_alerts` is the third newsletter kind (`notify_alerts`). The run prices every watched
product once, then evaluates each account's rules (`api/src/newsletters/alerts.ts`):
**any drop** fires when the cheapest price is at least 5 % under the day before, or under
what the last alert reported; **below** fires when the cheapest price is at or under the
mark, and again after seven days while it stays there. One mail per account lists the
products that fired (deal rows: product, seller, now, was, change), and `account_watch`
records the price each alert reported so the next waits for a further move. A day with no
hits sends nothing.

## Admin portal

A **Mail** page (`/mail`, nav under Public site) with two tabs. **Templates**: the kinds in
a list, an editor for the fields with the kind's placeholders beside it, a preview pane
(iframe, refreshed on a short debounce through the preview route), **Save**, **Reset to
default**, and **Send test to me**. **Newsletters**: each kind with its last run, a **Run
now** with a dry-run switch that shows the report, and today's deals table with
**Recompute**.

## Settings

`LPL_NEWSLETTERS_ENABLED`, `LPL_NEWSLETTER_HOUR`; the rest reuses `LPL_SITE_ORIGIN`,
`LPL_RESEND_API_KEY`, `LPL_MAIL_FROM`, `LPL_ACCOUNT_STATE_SECRET`, `LPL_POSTGRES_URL`.
