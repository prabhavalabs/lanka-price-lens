import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

export type CloudflareCredentials = { accountId: string; token: string };
export type ArchiveObject = {
  key: string;
  etag: string;
  size: number;
  lastModified: string;
  customMetadata: Record<string, string>;
};
type ApiResponse<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
  result_info?: { cursor?: string };
};

export async function cloudflareCredentials(): Promise<CloudflareCredentials> {
  if (process.env.NODE_ENV === "production" && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for R2 workflows");
  }
  const token = process.env.CLOUDFLARE_API_TOKEN ?? (await wranglerJson<{ token: string }>(["auth", "token", "--json"])).token;
  const configuredAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (configuredAccount) return { accountId: configuredAccount, token };
  const identity = await wranglerJson<{ accounts: Array<{ id: string }> }>(["whoami", "--json"]);
  if (identity.accounts.length !== 1) throw new Error("Set CLOUDFLARE_ACCOUNT_ID when Wrangler can access more than one account");
  return { accountId: identity.accounts[0]!.id, token };
}

export async function listArchiveKeys(credentials: CloudflareCredentials, bucket: string): Promise<Set<string>> {
  return new Set((await listArchiveObjects(credentials, bucket)).keys());
}

export async function listArchiveObjects(credentials: CloudflareCredentials, bucket: string): Promise<Map<string, ArchiveObject>> {
  const objects = new Map<string, ArchiveObject>();
  let cursor: string | undefined;
  do {
    const url = objectApiUrl(credentials.accountId, bucket);
    url.searchParams.set("per_page", "1000");
    url.searchParams.set("prefix", "sources/harti/daily-food-prices/");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await cloudflareRequest<Array<{
      key: string;
      etag: string;
      size: number;
      last_modified: string;
      custom_metadata?: Record<string, string>;
    }>>(url, credentials.token);
    for (const object of response.result) {
      objects.set(object.key, {
        key: object.key,
        etag: object.etag,
        size: object.size,
        lastModified: object.last_modified,
        customMetadata: object.custom_metadata ?? {},
      });
    }
    cursor = response.result_info?.cursor;
  } while (cursor);
  return objects;
}

export async function uploadArchiveObject(
  credentials: CloudflareCredentials,
  bucket: string,
  key: string,
  filename: string,
  bytes: Uint8Array,
  metadata: Record<string, string> = {},
): Promise<void> {
  await cloudflareRequest(objectApiUrl(credentials.accountId, bucket, key), credentials.token, {
    method: "PUT",
    body: new Uint8Array(bytes).buffer,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ...Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${name}`, value])),
    },
  });
}

export async function downloadArchiveObject(
  credentials: CloudflareCredentials,
  bucket: string,
  key: string,
  maximumBytes = 20 * 1024 * 1024,
): Promise<Uint8Array> {
  const response = await fetch(objectApiUrl(credentials.accountId, bucket, key), {
    headers: { authorization: `Bearer ${credentials.token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`R2_HTTP_${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("R2_OBJECT_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("R2_OBJECT_TOO_LARGE");
  return bytes;
}

async function cloudflareRequest<T>(url: URL, token: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || `CLOUDFLARE_HTTP_${response.status}`);
  }
  return payload;
}

function objectApiUrl(accountId: string, bucket: string, key?: string): URL {
  const encodedKey = key?.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects${encodedKey ? `/${encodedKey}` : ""}`,
  );
}

async function wranglerJson<T>(arguments_: string[]): Promise<T> {
  const executable = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
  const { stdout } = await execute(executable, arguments_, { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as T;
}
