import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  mappingBundleSchema,
  sourceKind,
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

export type CatalogEntry = { manifest: SourceManifest; mappingBundle?: MappingBundle | undefined };

/** Every configured source with its mapping bundle; the scheduler and API work from this. */
export type SourceCatalog = {
  entries: CatalogEntry[];
  /** The PDF bulletin source the single-source routes and commands still address. */
  primary: CatalogEntry | null;
  find: (sourceId: string) => CatalogEntry | undefined;
};

export function createSourceCatalog(entries: CatalogEntry[]): SourceCatalog {
  const byId = new Map(entries.map((entry) => [entry.manifest.id, entry]));
  if (byId.size !== entries.length) throw new Error("SOURCE_CATALOG_DUPLICATE_ID");
  return {
    entries,
    primary: entries.find((entry) => sourceKind(entry.manifest) === "pdf_bulletin") ?? null,
    find: (sourceId) => byId.get(sourceId),
  };
}

export function singleSourceCatalog(manifest: SourceManifest, mappingBundle?: MappingBundle): SourceCatalog {
  return createSourceCatalog([{ manifest, mappingBundle }]);
}

/**
 * Loads every manifest in a directory and pairs each with the mapping bundle whose
 * source_id matches. A bundle without a manifest, or a manifest without a bundle,
 * is fine: the source then runs with promotion disabled ("not configured").
 */
export async function readSourceCatalog(manifestsDirectory: string, mappingsDirectory: string): Promise<SourceCatalog> {
  const manifests = await Promise.all((await jsonFiles(manifestsDirectory)).map((file) => readSourceManifest(file)));
  const bundles = await Promise.all((await jsonFiles(mappingsDirectory)).map((file) => readMappingBundle(file)));
  const bundleBySource = new Map(bundles.map((bundle) => [bundle.source_id, bundle]));
  const entries = manifests
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((manifest) => ({ manifest, mappingBundle: bundleBySource.get(manifest.id) }));
  return createSourceCatalog(entries);
}

async function jsonFiles(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort().map((name) => join(directory, name));
}
