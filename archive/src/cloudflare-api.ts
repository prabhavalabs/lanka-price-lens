import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

type CloudflareCredentials = { accountId: string; token: string };
type ApiResponse<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
  result_info?: { cursor?: string };
};

export async function cloudflareCredentials(): Promise<CloudflareCredentials> {
  const token = process.env.CLOUDFLARE_API_TOKEN ?? (await wranglerJson<{ token: string }>(["auth", "token", "--json"])).token;
  const configuredAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (configuredAccount) return { accountId: configuredAccount, token };
  const identity = await wranglerJson<{ accounts: Array<{ id: string }> }>(["whoami", "--json"]);
  if (identity.accounts.length !== 1) throw new Error("Set CLOUDFLARE_ACCOUNT_ID when Wrangler can access more than one account");
  return { accountId: identity.accounts[0]!.id, token };
}

export async function listArchiveKeys(credentials: CloudflareCredentials, bucket: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = objectApiUrl(credentials.accountId, bucket);
    url.searchParams.set("per_page", "1000");
    url.searchParams.set("prefix", "sources/harti/daily-food-prices/");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await cloudflareRequest<Array<{ key: string }>>(url, credentials.token);
    for (const object of response.result) keys.add(object.key);
    cursor = response.result_info?.cursor;
  } while (cursor);
  return keys;
}

export async function uploadArchiveObject(
  credentials: CloudflareCredentials,
  bucket: string,
  key: string,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  await cloudflareRequest(objectApiUrl(credentials.accountId, bucket, key), credentials.token, {
    method: "PUT",
    body: new Uint8Array(bytes).buffer,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
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
  const { stdout } = await execute("wrangler", arguments_, { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as T;
}
