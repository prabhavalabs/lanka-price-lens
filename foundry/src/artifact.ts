import { newId, type OperationalDatabase } from "./db.ts";
import type { ParsedObservation } from "./harti.ts";
import type { TextItem } from "./pdf.ts";

export function persistParsedArtifact(
  database: OperationalDatabase,
  input: { artifactId: string; runId: string; items: TextItem[]; observations: ParsedObservation[] },
): void {
  persistProcessedArtifact(database, input);
  finalizeProcessedArtifacts(database, input.runId, [input.artifactId]);
}

export function persistProcessedArtifact(
  database: OperationalDatabase,
  input: { artifactId: string; runId: string; items: TextItem[]; observations: ParsedObservation[] },
): void {
  database.transaction(() => {
    replaceExtractedText(database, input.artifactId, input.items);

    database.prepare("DELETE FROM staging_observation WHERE artifact_id = ?").run(input.artifactId);
    const insertObservation = database.prepare(
      `INSERT INTO staging_observation (
        id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label,
        source_date, price_type, currency, source_quantity, source_unit,
        min_value_minor, max_value_minor, status, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'wholesale_observed', 'LKR', ?, ?, ?, ?, 'pending_validation', ?)`,
    );
    for (const observation of input.observations) {
      insertObservation.run(
        newId("staging"),
        input.runId,
        input.artifactId,
        observation.rowRef,
        observation.itemLabel,
        observation.marketLabel,
        observation.date,
        observation.sourceQuantity,
        observation.sourceUnit,
        observation.minValueMinor,
        observation.maxValueMinor,
        JSON.stringify(observation.raw),
      );
    }
    database.prepare("UPDATE source_artifact SET status = 'processed' WHERE id = ?").run(input.artifactId);
  })();
}

export function persistExtractedText(database: OperationalDatabase, artifactId: string, items: TextItem[]): void {
  database.transaction(() => replaceExtractedText(database, artifactId, items))();
}

function replaceExtractedText(database: OperationalDatabase, artifactId: string, items: TextItem[]): void {
  database.prepare("DELETE FROM extracted_text_item WHERE artifact_id = ?").run(artifactId);
  const insert = database.prepare(
    `INSERT INTO extracted_text_item (artifact_id, page_number, item_index, text, x, y, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items) insert.run(artifactId, item.page, item.index, item.text, item.x, item.y, item.width, item.height);
}

export function finalizeProcessedArtifacts(database: OperationalDatabase, runId: string, artifactIds?: string[]): void {
  database.transaction(() => {
    if (artifactIds?.length) {
      const placeholders = artifactIds.map(() => "?").join(",");
      database.prepare(`UPDATE staging_observation SET status = 'unmapped' WHERE run_id = ? AND artifact_id IN (${placeholders})`).run(runId, ...artifactIds);
      database.prepare(`UPDATE source_artifact SET status = 'parsed' WHERE id IN (${placeholders})`).run(...artifactIds);
      database.prepare(`UPDATE source_publication SET status = 'parsed' WHERE id IN (SELECT publication_id FROM source_artifact WHERE id IN (${placeholders}))`).run(...artifactIds);
      return;
    }
    database.prepare("UPDATE staging_observation SET status = 'unmapped' WHERE run_id = ? AND status = 'validated'").run(runId);
    database.prepare("UPDATE source_artifact SET status = 'parsed' WHERE run_id = ? AND status = 'validated'").run(runId);
    database.prepare("UPDATE source_publication SET status = 'parsed' WHERE id IN (SELECT publication_id FROM source_artifact WHERE run_id = ? AND status = 'parsed')").run(runId);
  })();
}
