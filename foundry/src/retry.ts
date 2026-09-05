import type { RetryPolicy } from "@lanka-pricelens/shared";

import type { OperationalDatabase } from "./db.ts";

/**
 * Retries a workflow run that failed, after a cooldown, up to the policy's attempts.
 *
 * Every attempt is its own run row (its own stages, logs, and evidence); attempts after the first
 * carry `attempt` and `retry_of` so the history reads "attempt 2 of 3, retrying run X". Only
 * failures that a retry can help with are retried: an outage, a timeout, a 5xx. A rights block,
 * a bad setting, a snapshot held for review, or a paused source ends the attempts at once. When the
 * last attempt fails the failure stands, exactly as it would have without the policy.
 */

export type RetryAttempt = { attempt: number; final: boolean; retryOf: string | null };

export type RetryOutcome<T> = { result: T; attempts: number; runIds: string[]; waitedMs: number };

export type RetryTarget = { sourceId: string; workflow: string };

/** Failure codes a retry cannot help with. */
export const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "SETTINGS_INVALID",
  "SOURCE_RIGHTS_BLOCKED",
  "CAPTURE_PAUSED",
  "ADAPTER_NOT_CONFIGURED",
  "MAPPING_VERSION_REUSED",
  "SOURCE_HTTP_401",
  "SOURCE_HTTP_404",
]);

type Outcome = { status: string; code?: string | null | undefined; runId?: string | null | undefined };

export function retryableFailure(outcome: Outcome): boolean {
  if (outcome.status !== "failed") return false;
  return !(outcome.code && NON_RETRYABLE_CODES.has(outcome.code));
}

/** The failure code a thrown error carries: an upper-case head such as `SOURCE_HTTP_503`, else null. */
export function failureCodeOf(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const head = message.split(":", 1)[0]?.trim() ?? "";
  return /^[A-Z][A-Z0-9_]+$/u.test(head) ? head : null;
}

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWithRetry<T extends Outcome>(
  database: OperationalDatabase,
  policy: RetryPolicy,
  target: RetryTarget,
  attempt: (context: RetryAttempt) => Promise<T>,
  options: { wait?: ((ms: number) => Promise<void>) | undefined; log?: ((message: string, data: Record<string, unknown>) => void) | undefined } = {},
): Promise<RetryOutcome<T>> {
  const attempts = Math.max(1, policy.attempts);
  const cooldownMs = Math.max(0, policy.cooldown_minutes) * 60_000;
  const wait = options.wait ?? defaultWait;
  const runIds: string[] = [];
  let retryOf: string | null = null;
  let waitedMs = 0;
  for (let number = 1; number <= attempts; number += 1) {
    const final = number === attempts;
    const startedAt = new Date().toISOString();
    let result: T | undefined;
    let thrown: unknown;
    try {
      result = await attempt({ attempt: number, final, retryOf });
    } catch (error) {
      thrown = error;
    }
    // The run this attempt opened: the result names it, or (when the workflow threw) it is the source's newest run since the attempt began.
    const runId = result?.runId ?? latestRun(database, target, startedAt);
    if (runId) {
      runIds.push(runId);
      if (number > 1) database.prepare("UPDATE ingest_run SET attempt = ?, retry_of = ? WHERE id = ?").run(number, retryOf, runId);
    }
    const outcome: Outcome = thrown !== undefined ? { status: "failed", code: failureCodeOf(thrown) } : result!;
    if (final || !retryableFailure(outcome)) {
      if (thrown !== undefined) throw thrown;
      return { result: result!, attempts: number, runIds, waitedMs };
    }
    retryOf = runId ?? retryOf;
    options.log?.(`Attempt ${number} of ${attempts} failed (${outcome.code ?? outcome.status}); retrying in ${policy.cooldown_minutes} min`, {
      source: target.sourceId,
      workflow: target.workflow,
      attempt: number,
      attempts,
      run_id: runId,
      code: outcome.code ?? null,
      cooldown_minutes: policy.cooldown_minutes,
    });
    if (cooldownMs > 0) {
      await wait(cooldownMs);
      waitedMs += cooldownMs;
    }
  }
  throw new Error("RETRY_EXHAUSTED");
}

/** The run this attempt opened: the source's newest run of the workflow started no earlier than the attempt. */
function latestRun(database: OperationalDatabase, target: RetryTarget, startedAt: string): string | null {
  const row = database
    .prepare("SELECT id FROM ingest_run WHERE source_id = ? AND workflow = ? AND started_at >= ? ORDER BY started_at DESC, rowid DESC LIMIT 1")
    .get(target.sourceId, target.workflow, startedAt) as { id: string } | undefined;
  return row?.id ?? null;
}

/** The manifest's policy, with optional command-line overrides (`--retry-attempts`, `--retry-cooldown-minutes`). */
export function retryPolicyFor(manifest: { retry: RetryPolicy }, overrides: { attempts?: number | undefined; cooldownMinutes?: number | undefined } = {}): RetryPolicy {
  return {
    attempts: overrides.attempts ?? manifest.retry.attempts,
    cooldown_minutes: overrides.cooldownMinutes ?? manifest.retry.cooldown_minutes,
  };
}
