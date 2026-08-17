import { readFile } from "node:fs/promises";

import { sourceManifestSchema, type SourceManifest } from "@lanka-pricelens/shared";

export async function readSourceManifest(path: string): Promise<SourceManifest> {
  return sourceManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
