import { newId, type OperationalDatabase } from "./db.ts";
import type { ParsedObservation } from "./harti.ts";
import type { TextItem } from "./pdf.ts";

export function persistParsedArtifact(
  database: OperationalDatabase,
  input: { artifactId: string; runId: string; items: TextItem[]; observations: ParsedObservation[] },
): void {
  database.transaction(() => {
    database.prepare("DELETE FROM extracted_text_item WHERE artifact_id = ?").run(input.artifactId);
    const insertText = database.prepare(
      `INSERT INTO extracted_text_item (artifact_id, page_number, item_index, text, x, y, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of input.items) {
      insertText.run(input.artifactId, item.page, item.index, item.text, item.x, item.y, item.width, item.height);
    }

    database.prepare("DELETE FROM staging_observation WHERE artifact_id = ?").run(input.artifactId);
    const insertObservation = database.prepare(
      `INSERT INTO staging_observation (
        id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label,
        source_date, price_type, currency, source_quantity, source_unit,
        min_value_minor, max_value_minor, status, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'wholesale_observed', 'LKR', '1', 'kg', ?, ?, 'unmapped', ?)`,
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
        observation.minValueMinor,
        observation.maxValueMinor,
        JSON.stringify(observation.raw),
      );
    }
    database.prepare("UPDATE source_artifact SET status = 'parsed' WHERE id = ?").run(input.artifactId);
  })();
}
