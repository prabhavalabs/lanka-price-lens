# Recipes: the dish catalogue and where it leads

The end product is a daily cooking planner: what to cook today, for how many, on
what budget, with which vegetables or protein, priced from the warehouse. That
needs a recipe corpus that we own. This document describes the first layer of
it, the **dish catalogue**, the rights position, and the layers that follow.

## Rights position

- Every word of prose in the corpus is ours. Dish names, ingredient lists, and
  quantities are facts and may be gathered from anywhere; method text and
  descriptions are never copied from a website, book, or video.
- Published Sri Lankan cookery sources (YouTube channels, blogs, institutional
  publications) are **indexed, consulted, and linked**, never reproduced. The
  index lives in `data/recipes/references.json` with the date each URL was
  verified.
- Drafting is done by model assistance in bulk, then validated (schema, duplicate
  and vocabulary checks), audited by a second pass, and reviewed by the owner
  before it is committed. Nothing reaches `data/recipes/` unreviewed.

## The dish catalogue (`data/recipes/catalogue.json`)

A dish is what a household cooks and names: red rice, parippu, pol sambol,
ambul thiyal. The catalogue records for each dish its names (English, Sinhala
and romanised Sinhala, Tamil and romanised Tamil), category, roles on the plate,
meal slots, region or community, popularity tier (1 everyday, 2 common,
3 occasional), preparation and cooking time, difficulty, diet tags, protein
sources, spice level, a one-sentence original summary, occasions, variants, and
the dishes it is usually served with.

Two ingredient lists carry the link to prices:

- `key_ingredients` are ids from the **price vocabulary** (the products the
  mapping bundles define), so the warehouse can price them today. The admin shows
  how many of a dish's key ingredients have a price and, per ingredient, the
  cheapest current seller.
- `other_ingredients` are plain text for what the vocabulary does not carry yet
  (curry powder, coconut milk, cardamom, kithul treacle). The admin ranks them by
  how many dishes need them: that list is the pantry mapping backlog, worked off
  with pattern rules in the retail bundles.

The schema is `dishCatalogueSchema` in `shared/src/index.ts`; ids are unique and
pairings must point at dishes that exist. The API reads the directory named by
`LPL_RECIPES_DIR` (default `data/recipes`) once at start; the compose services
and the image carry `/app/data/recipes`.

## Endpoints and admin

- `GET /v1/admin/recipes/overview`: counts by category and meal, price coverage,
  the pantry backlog, reference counts.
- `GET /v1/admin/recipes/dishes?search=&category=&meal=&protein=&diet=&region=&occasion=&page=&pageSize=`:
  search matches any name (all scripts), variants, and ingredients.
- `GET /v1/admin/recipes/dishes/:id`: the dish with its ingredients priced and
  its pairings resolved.
- `GET /v1/admin/recipes/references`: the reference index.
- Admin: Intelligence → Recipes.

## The recipe layer (2026-09-13)

Two more files sit beside the catalogue, both under `dishCatalogueSchema`'s
siblings in `shared/src/recipes.ts`:

- **`ingredients.json`, the ingredient registry.** Every ingredient a recipe may
  name: the priced products (`product_…`, the vocabulary) and the pantry entries
  the vocabulary does not carry (`pantry_…`: coconut milk, curry powders,
  cardamom, jaggery, curd). Each entry carries its names in English, Sinhala,
  and Tamil, the group, the state the figures refer to, the edible fraction of
  what a household buys (curry-cut chicken with bone is about 0.68), a density
  for liquids, spoon, cup, piece, and bunch weights, and the nutrition per 100 g
  of the edible part (energy, protein, fat, carbohydrate, fibre, sugar, sodium).
  The value is ours to defend: the entry records the sources it was checked
  against (USDA FoodData Central, the Sri Lanka Food Composition Tables of the
  Medical Research Institute, the Indian Food Composition Tables 2017, ASEAN),
  which one the chosen figure follows, the Sri Lankan adjustment made, and a
  confidence. The schema refuses an entry whose energy strays more than 25% from
  what its macros give.
- **`recipes/<dish id>.json`, one recipe per dish.** Quantities for a base of
  four servings in the dish's usual role (a curry "serves four" as part of rice
  and curry), each line naming a registry id, its amount as bought in grams,
  millilitres, or pieces, a household measure, its preparation, whether it is
  optional, and how it scales: `linear` for almost everything, `sublinear` for
  salt, tempering oil, and whole spices, `fixed` for what does not grow with the
  headcount. Then the method as numbered steps in English, Sinhala, and Tamil,
  times (which never scale), equipment, a tip, a health note, curated tags, and
  two review records: what the drafter was unsure of and which languages a
  person has signed off.

Everything shown is computed from those facts by `shared/src/recipe-math.ts`
and never stored: the ingredient list for any number of people, rounded to
kitchen amounts; nutrition per serving from edible grams; cost per serving from
the cheapest published seller in a unit the registry can convert (a line in
grams against a kilo price, a line in pieces against a piece price or a known
piece weight), marked estimated when something is unpriced or a price is stale;
tags the numbers earn (low calorie, high protein, low carb, high fibre, high
sugar, high salt) by per-serving thresholds that depend on the dish's role.

A **menu** is what a household composes for an occasion: a name, a headcount,
and recipes that scale to it, each overridable (a sambol for the table, a sweet
for half the guests). Menus live in the reader's browser; the API totals them
(`POST /v1/public/menus/compute`): nutrition and cost per person, and one
shopping list summed across recipes.

Endpoints: `GET /v1/public/recipes/:id?servings=N` adds a `recipe` block to the
dish; `GET /v1/public/recipes/query` filters and sorts the indexed recipes by
calories, protein, carbohydrate, time, tags, and cost per serving (the
"recipes for weight loss" question is `tags=weight_loss_friendly&sort=kcal`);
the admin overview counts recipes, languages, and reviews.

**Surprise me**: `GET /v1/public/recipes/surprise?exclude=dish_a,dish_b&seed=&diet=` answers
`{ id, name, reasons }` for one dish that has a full recipe, drawn at random with the better
fits weighted up: a signed-in person's food preferences apply (the route runs behind
`readAccount`), a guest gets the catalogue defaults narrowed by `diet` (a `dietChoices` value);
`exclude` (up to 50 ids) keeps "another one" from repeating and `seed` makes the draw repeat;
404 `NO_MATCH` when nothing qualifies. The engine is `shared/src/recommend.ts` and the route
`api/src/surprise.ts`, both specified in [docs/newsletters.md](newsletters.md).

### Drafting and checking

The registry and the recipes were drafted in batches by model assistance from
the briefs in the session scratchpad (one for nutrition, one for recipes),
against the catalogue and the registry ids, then checked by
`scripts/recipes/validate-drafts.mjs`: schema, ids, energy against macros, energy
ranges per group, main-protein grams per serving per category, yield against
weighed ingredients, calories per serving, missing scripts. Only what passes is
merged by `scripts/recipes/merge-drafts.mjs`. Sinhala and Tamil text is machine
drafted until a person reviews it; the site says so on each recipe.

### First recipe edition (2026-09-13)

363 recipes over 363 dishes, 3,949 ingredient lines, every one naming a registry
id; an average of eight steps, each in English, Sinhala, and Tamil; 249 registry
entries (135 priced products, 114 pantry entries, four of them with no known
nutrition). 82 recipes carry a review flag from the drafter: 72 for Tamil
wording where a dish or a village vegetable has no settled Tamil name, 5 for
Sinhala on northern dishes, 11 for quantities (preserves scaled down to four,
communal pots, roe sacs, a ferment). Calories per serving run from 4 (lunu dehi)
to 1,139 (lamprais), median 304.

Corrections applied over the drafts, kept in `corrections/ingredients.json`:
coconut is weighed as grated flesh (one nut about 250 g); thin second-squeeze
coconut milk is its own entry at 95 kcal against 235 for thick; a curry-leaf
piece is a sprig of 2 g; a kenda leaf weighs 5 g; moringa leaves join the
registry (the wording map had sent them to the drumstick pod and to
kathurumurunga). Two conventions the normaliser enforces on every draft: oil
listed for deep frying is a `frying` line, bought in full but counted at the
absorbed share for calories and cost; a coconut-milk line whose preparation says
thin or second squeeze points at the thin entry.

Known limits of this edition: pantry lines (1,078 of 3,949, coconut milk and
curry powders first) have no price, so cost per serving is a floor and the site
says so; the calorie figure is on a raw edible basis with water loss taken by
`yield_g`, not by cooking retention factors; Sinhala and Tamil text is machine
drafted throughout and awaits native review.

## What follows

1. **Pantry pricing**: the registry's pantry entries priced through retail
   pattern rules (coconut milk, curry powders, jaggery, rice flour first), so
   cost per serving stops being a floor.
2. **Review**: native review of the Sinhala and Tamil text, recorded per recipe.
3. **Planner**: days, meals, budget, must-have vegetables, protein choices,
   dislikes, time; a week's menus and a shopping list per seller.
4. **Questions in words**: a natural-language layer over the query endpoint.

## First edition (2026-09-05)

The first catalogue holds 363 dishes across nine categories (84 vegetable, 56
fish and seafood, 48 meat and poultry, 45 rice and grains, 35 sweets, 26 sambols
and condiments, 23 pulses and eggs, 23 snacks, 23 drinks), drafted in six
sections, merged with duplicate and vocabulary checks, corrected by an audit pass
(4 plate combinations removed, 4 duplicates merged, 42 field corrections, 18
everyday dishes added), and reviewed before commit. Sinhala names are present for
271 dishes and Tamil names for 178; the rest are romanised only until someone
confident of the script fills them in.

Decisions recorded from the audit, to revisit as the corpus grows:

- Rice-flour dishes (kavum, aluwa, athirasa, dodol and their kin) keep "rice
  flour" as an unpriced pantry ingredient rather than pointing at raw rice; a
  rice-flour product in the vocabulary would price them properly.
- Some dishes have no priced key ingredient at all (curd and treacle, papadam,
  kurakkan dishes); they stay in the catalogue and show as unpriceable until curd,
  kurakkan flour, and papadam reach the vocabulary.
- Duck is tagged as chicken and venison and hare as beef for protein purposes
  because the protein enum has no other-poultry or game value; venison and hare
  are genuine village dishes that can never carry a market price.
- Thirteen leafy mallungs list Maldive fish as optional and stay tagged vegan for
  their base form; the variant with Maldive fish is a household choice.
- Hot butter cuttlefish, devilled squid, and fried rice are restaurant dishes that
  have moved into home kitchens and are kept; papadam stays with the condiments;
  popularity means island-wide frequency, so a northern staple can sit at 2.

## On the public site

The catalogue is public through `GET /v1/public/recipes` (browse), `GET /v1/public/recipes/:id`
(one dish with today's cheapest price per key ingredient), and
`GET /v1/public/recipes/recommend?products=…` (dishes ranked by fit to a shopper's basket). The
recommendation (`recommendDishes` in `api/src/recipes.ts`) scores a dish by the share of its key
ingredients the basket covers (weight 0.4), the share of the basket it uses (0.3), how many
basket items it brings together (up to three, weight 0.3, so a curry using four items beats a
drink whose one ingredient is in the basket), a small nudge for everyday dishes (0.08, 0.04), and
a cost of 0.03 per ingredient still to buy (capped at 0.15);
a dish appears with one shared ingredient, full matches first, ties broken by fewer missing
ingredients, then popularity, then name. The site's basket page shows the top nine; a dish page
splits ingredients into "from your basket" and "still to buy" with an add-to-basket control in
real amounts, and lists `other_ingredients` as pantry items.
