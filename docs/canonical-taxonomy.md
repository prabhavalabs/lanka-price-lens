# HARTI canonical product taxonomy

This reviewed mapping covers the current HARTI daily wholesale bulletin family.
It contains 44 exact source price-series labels grouped under 34 product
families: 25 vegetable families and 9 fruit families.

## Modelling decisions

- Product family, price series, variety, origin, and size remain separate.
- Potato and cabbage origins are retained instead of being merged.
- Banana and mango varieties are retained.
- Pineapple sizes are retained.
- `Brinjals` and `Eggplant` remain separate because the source reports both on
  the same market dates; treating them as aliases would discard information.
- The malformed continuation fragments `- Medium`, `- Small`, and
  `- Karathakolomban` are intentionally not mapped. They must enter quarantine
  and make the document quality assessment require review.

## Completeness baseline

The expected item/market matrix is the reviewed union observed across the
April–August 2026 validation cohort. It contains 44 source items, 10 markets,
and 265 structurally expected item-market cells. A document is assessed using
item coverage, market coverage, expected-cell coverage, and exact mapping
coverage. This score is independent from parser layout confidence.

## Revision policy

All source versions are retained. For the same canonical
source-date × item × market × price type × currency × normalized-unit grain,
the later source publication is effective. Older or out-of-order publications
remain as superseded history. Reprocessing with the same parser and mapping
version is idempotent, while a reviewed mapping or parser correction creates a
new auditable version.
