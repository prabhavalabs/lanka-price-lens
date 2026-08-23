# PDF workflow validation analysis notes

## Cohort

- Batch ID: `pdf-workflow-validation-2026-08-22`
- 120 randomly selected HARTI publications dated 2026-04-01 through 2026-08-22.
- Previously successful PDF-processing runs were excluded before sampling.
- The random selection is frozen in `sample-manifest.json` and `sample-manifest.csv`.
- Each document ran through the application's existing retrieve, parse, extract, validate, and insert steps.

## Analytical definitions

- Observation grain: source date × source item label × wholesale market × source unit.
- Repeated grains are retained in SQLite. The report view prefers the publication date closest to the source date, with the newer publication breaking a tie.
- Price measure: midpoint of the published minimum and maximum wholesale range, expressed in LKR per source unit.
- Period movement: median of the first 14 available Peliyagoda observations versus the last 14, restricted to kg items with at least 60 dates.
- Relative volatility: interquartile range divided by the median midpoint price.
- Market coverage: distinct source dates for the market divided by all 132 distinct source dates in the cohort.

## Chart map

1. Monthly extraction depth — median observations per document; verifies stability across the sampled window.
2. Four-item price trend — daily Peliyagoda midpoint ranges for Tomato, Beans, Carrot, and Green Chillies.
3. Directional extremes — seven largest declines and seven largest increases under the first/last-window definition.
4. Market date coverage — shows uneven availability across the ten wholesale markets.
5. Price/volatility relationship — median price versus relative IQR for sufficiently observed Peliyagoda items.

## Important limitations

- All 120 PDFs selected the `labelled_market_date_grid` strategy. This is a strong test of that family, not of scanned-image or unrelated-document rejection.
- All 26,893 observations are stored in `staging_observation` with status `unmapped`. They are validated and durable but are not yet canonical `price_observation` releases.
- Fifty-three grains repeat across publications; 48 contain a different min/max value. This is consistent with revised or reprinted previous-day market columns and requires a versioning rule.
- The price midpoint is a range summary, not a volume-weighted transaction price.
- Observed movements are descriptive and do not imply causality.
