import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  cloudflareCredentials,
  downloadArchiveObject,
  listArchiveObjects,
  uploadArchiveObject,
  type ArchiveObject,
} from "@lanka-pricelens/archive/cloudflare-api";

export type ArchiveStorage = {
  bucket: string;
  uri?: ((key: string) => string) | undefined;
  list: () => Promise<Map<string, ArchiveObject>>;
  upload: (key: string, filename: string, bytes: Uint8Array, metadata: Record<string, string>) => Promise<void>;
  download: (key: string) => Promise<Uint8Array>;
};

export async function configuredArchiveStorage(bucket = process.env.LPL_R2_BUCKET ?? "lanka-price-lens-pdfs"): Promise<ArchiveStorage> {
  if ((process.env.LPL_ARCHIVE_DRIVER ?? "cloudflare") === "filesystem") {
    return filesystemArchiveStorage(resolve(process.env.LPL_LOCAL_ARCHIVE_ROOT ?? "../data/raw/archive"));
  }
  const credentials = await cloudflareCredentials();
  return {
    bucket,
    uri: (key) => `r2://${bucket}/${key}`,
    list: () => listArchiveObjects(credentials, bucket),
    upload: (key, filename, bytes, metadata) => uploadArchiveObject(credentials, bucket, key, filename, bytes, metadata),
    download: (key) => downloadArchiveObject(credentials, bucket, key),
  };
}

export function filesystemArchiveStorage(root: string): ArchiveStorage {
  const archiveRoot = resolve(root);
  const bucket = "local-dev";
  return {
    bucket,
    uri: (key) => `file://${safeArchivePath(archiveRoot, key)}`,
    list: async () => {
      const objects = new Map<string, ArchiveObject>();
      for (const file of await archiveFiles(archiveRoot)) {
        if (file.endsWith(".metadata.json")) continue;
        const details = await stat(file);
        const key = relative(archiveRoot, file).split(sep).join("/");
        const metadata = await readMetadata(`${file}.metadata.json`);
        objects.set(key, {
          key,
          etag: metadata.etag ?? createHash("sha256").update(await readFile(file)).digest("hex"),
          size: details.size,
          lastModified: details.mtime.toISOString(),
          customMetadata: metadata.customMetadata ?? {},
        });
      }
      return objects;
    },
    upload: async (key, filename, bytes, metadata) => {
      const path = safeArchivePath(archiveRoot, key);
      await mkdir(dirname(path), { recursive: true });
      const digest = createHash("sha256").update(bytes).digest("hex");
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, path);
      await writeFile(
        `${path}.metadata.json`,
        `${JSON.stringify({ filename, etag: digest, customMetadata: metadata }, null, 2)}\n`,
        { mode: 0o600 },
      );
    },
    download: async (key) => new Uint8Array(await readFile(safeArchivePath(archiveRoot, key))),
  };
}

async function archiveFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await archiveFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function safeArchivePath(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\")) throw new Error("ARCHIVE_KEY_INVALID");
  const path = resolve(root, key);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("ARCHIVE_KEY_INVALID");
  return path;
}

async function readMetadata(path: string): Promise<{ etag?: string; customMetadata?: Record<string, string> }> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as { etag?: string; customMetadata?: Record<string, string> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
