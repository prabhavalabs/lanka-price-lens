import { request as httpsRequest } from "node:https";

import type { FetchLike } from "./types.ts";

export type RequestPolicy = {
  attempts: number;
  timeoutMs: number;
  /** Delay before the second attempt; doubles each retry with jitter, capped at maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxBytes?: number;
  userAgent: string;
};

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly retryable: boolean;

  constructor(url: string, status: number, retryable: boolean) {
    super(`SOURCE_HTTP_${status}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

export type FetchResult = { response: Response; body: Uint8Array; attempts: number; setCookies: string[] };

/**
 * Fetch with a bounded body, a per-attempt timeout, and exponential backoff on
 * network errors, 429s, and 5xx responses. 4xx responses (other than 429) are
 * not retried because repeating them cannot succeed.
 */
export async function fetchWithPolicy(http: FetchLike, url: string, init: RequestInit, policy: RequestPolicy): Promise<FetchResult> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("user-agent")) headers.set("user-agent", policy.userAgent);
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      const response = await http(url, { ...init, headers, signal: AbortSignal.timeout(policy.timeoutMs) });
      if (response.ok) {
        const body = await limitedBody(response, policy.maxBytes ?? 20 * 1024 * 1024);
        return { response, body, attempts: attempt, setCookies: setCookieHeaders(response) };
      }
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new HttpError(url, response.status, retryable);
      if (!retryable) throw lastError;
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error;
    }
    if (attempt < policy.attempts) await delay(backoff(attempt, policy.baseDelayMs ?? 600, policy.maxDelayMs ?? 8_000));
  }
  throw lastError instanceof Error ? lastError : new Error("SOURCE_FETCH_FAILED");
}

export function backoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  // Full jitter: spreads retries from concurrent workers instead of hammering the origin in lockstep.
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

export function parseJsonBody<T = unknown>(body: Uint8Array, url: string): T {
  const text = new TextDecoder().decode(body);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SOURCE_JSON_INVALID:${url}`);
  }
}

export function decodeText(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

/** A tiny cookie jar for origins whose JSON APIs are session-scoped (store selection, guest login). */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair] = header.split(";", 1);
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get size(): number {
    return this.cookies.size;
  }
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function limitedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("SOURCE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * A fetch-compatible transport built on node:https. Some origins sit behind bot
 * protection that rejects the request signature of Node's built-in fetch (undici)
 * while accepting node:https and curl; adapters that need it declare
 * `transport: "node_https"`. No automatic decompression: it never advertises
 * accept-encoding, so servers send plain bodies.
 */
export const nodeHttpsFetch: FetchLike = (input, init = {}) =>
  new Promise<Response>((resolveResponse, reject) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? Buffer.from(init.body) : init.body instanceof Uint8Array ? Buffer.from(init.body) : null;
    if (method !== "GET" && method !== "HEAD" && !headers["content-length"]) headers["content-length"] = String(body?.byteLength ?? 0);
    const request = httpsRequest(
      { hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const entry of value) responseHeaders.append(key, entry);
            else if (typeof value === "string") responseHeaders.set(key, value);
          }
          const status = response.statusCode ?? 502;
          resolveResponse(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, statusText: response.statusMessage ?? "", headers: responseHeaders }));
        });
      },
    );
    request.on("error", reject);
    const signal = init.signal;
    if (signal) {
      const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("SOURCE_TIMEOUT"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    if (body) request.write(body);
    request.end();
  });

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
