# Reviewed mappings

Mapping bundles are version-controlled JSON files validated by the shared
`mappingBundleSchema`. A bundle must name its reviewer, review date, evidence,
source, canonical entities, exact source labels, and exact unit rules.

Do not add fuzzy or guessed production mappings. Unknown labels must remain in
quarantine until a data steward reviews them. Test-only mappings belong under
`foundry/test/fixtures/`.
