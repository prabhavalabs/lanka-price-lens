-- Reproducible row-level quality checks for the PDF validation cohort.
-- The caller must first populate TEMP.validation_batch_artifact(artifact_id)
-- from batch-results.json.
SELECT
  COUNT(*) AS stored_observations,
  SUM(
    CASE
      WHEN observation.min_value_minor <= 0
        OR observation.max_value_minor <= 0
        OR observation.min_value_minor > observation.max_value_minor
        OR observation.source_date NOT GLOB '????-??-??'
      THEN 1 ELSE 0
    END
  ) AS invalid_observations,
  SUM(
    CASE
      WHEN observation.source_date <> substr(publication.published_at, 1, 10)
      THEN 1 ELSE 0
    END
  ) AS source_date_differs_from_publication,
  COUNT(DISTINCT observation.source_date) AS unique_source_dates,
  COUNT(DISTINCT observation.source_item_label) AS unique_item_labels,
  COUNT(DISTINCT observation.source_market_label) AS unique_markets
FROM staging_observation AS observation
JOIN validation_batch_artifact AS selected
  ON selected.artifact_id = observation.artifact_id
JOIN source_artifact AS artifact
  ON artifact.id = observation.artifact_id
JOIN source_publication AS publication
  ON publication.id = artifact.publication_id;
