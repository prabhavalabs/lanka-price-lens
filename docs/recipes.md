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

## What follows

1. **Recipes** with quantities per four servings, mapped to the vocabulary, with
   yields and portion sizes, and original method text.
2. **Costing**: cost per serving per dish per day per seller, with "estimated"
   flags where a price is older than the ingredient's cadence.
3. **Planner**: people, meals, days, budget, must-have vegetables, protein
   choices, dislikes, time; a menu and a shopping list per seller.
4. **Public surface**: a mobile-first daily "cook today" page in three languages.

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
