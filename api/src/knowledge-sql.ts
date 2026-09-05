/**
 * Shared SQL fragments that resolve a source publication to its latest
 * artifact, archive copy, processing run, and dispatch. The knowledge-base
 * list, document detail, and insights endpoints all derive the same
 * `index_status` from these joins so the UI never shows two answers.
 */
export const latestKnowledgeArtifact = `LEFT JOIN source_artifact artifact ON artifact.id = (
    SELECT candidate.id FROM source_artifact candidate
    WHERE candidate.publication_id = publication.id
    ORDER BY candidate.fetched_at DESC, candidate.id DESC LIMIT 1
  )`;
export const archivedKnowledgePdf = "LEFT JOIN archived_pdf archive ON archive.publication_id = publication.id";
export const latestKnowledgeProcessing = `LEFT JOIN ingest_run processing ON processing.id = (
    SELECT candidate.id FROM ingest_run candidate
    WHERE candidate.archive_id = archive.id AND candidate.workflow = 'pdf_processing'
    ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
  ) LEFT JOIN ingest_run artifact_run ON artifact_run.id = artifact.run_id`;
export const latestKnowledgeDispatch = `LEFT JOIN workflow_dispatch dispatch ON dispatch.id = (
    SELECT candidate.id FROM workflow_dispatch candidate
    WHERE candidate.archive_id = archive.id AND candidate.workflow_key = 'document_processing_pipeline'
    ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
  )`;
export const knowledgeIndexStatus = `CASE
    WHEN dispatch.status IN ('queued', 'running')
      OR COALESCE(processing.status, artifact_run.status) IN ('queued', 'pending', 'running') THEN 'indexing'
    WHEN artifact.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM price_observation indexed_observation
      WHERE indexed_observation.source_artifact_id = artifact.id
    ) THEN 'indexed'
    WHEN artifact.status = 'reviewed' THEN 'reviewed'
    WHEN dispatch.status = 'failed' OR artifact.status = 'quarantined'
      OR COALESCE(processing.status, artifact_run.status) IN ('failed', 'blocked') THEN 'failed'
    ELSE 'not_indexed'
  END`;
export const knowledgeJoins = `${latestKnowledgeArtifact} ${archivedKnowledgePdf} ${latestKnowledgeProcessing} ${latestKnowledgeDispatch}`;
