import { readFile } from "node:fs/promises";

import {
  mappingBundleSchema,
  sourceManifestSchema,
  type MappingBundle,
  type SourceManifest,
} from "@lanka-pricelens/shared";

export async function readSourceManifest(path: string): Promise<SourceManifest> {
  return sourceManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function readMappingBundle(path: string): Promise<MappingBundle> {
  return mappingBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
