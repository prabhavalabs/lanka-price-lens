import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { openOperationalDatabase, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import type { ApiEnvelope } from "@lanka-pricelens/shared";
import { Hono, type Context, type Next } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { parseBasicAuthorization, verifyPassword } from "./auth.ts";

export function createApp(database: OperationalDatabase, credentials = credentialsFromEnvironment()): Hono {
  const app = new Hono();
  app.use("*", requestId(), secureHeaders());
  app.get("/v1/health", (context) => context.json(envelope(context.get("requestId"), { status: "ok" })));

  // ponytail: single-owner Basic auth; replace with SSO when multiple administrators exist.
  const requireOwner = async (context: Context, next: Next) => {
    const authorization = parseBasicAuthorization(context.req.header("authorization"));
    if (!authorization || !safeUsernameEqual(authorization.username, credentials.username) || !verifyPassword(authorization.password, credentials.passwordHash)) {
      context.header("WWW-Authenticate", 'Basic realm="Lanka PriceLens operations", charset="UTF-8"');
      return context.json(envelope(context.get("requestId"), null, false, "Authentication required"), 401);
    }
    await next();
  };
  app.use("/v1/admin/*", requireOwner);
  app.use("/admin/*", requireOwner);

  app.get("/v1/admin/overview", (context) => {
    const counts = database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM source) AS sources,
          (SELECT COUNT(*) FROM ingest_run WHERE status = 'running') AS running,
          (SELECT COUNT(*) FROM ingest_run WHERE status = 'failed') AS failed,
          (SELECT COUNT(*) FROM quarantine WHERE status = 'open') AS quarantined`,
      )
      .get();
    return context.json(envelope(context.get("requestId"), counts));
  });
  app.get("/v1/admin/sources", (context) =>
    context.json(
      envelope(
        context.get("requestId"),
        database
          .prepare(
            `SELECT id, name, owner, rights_status, review_due_at, enabled, state,
             last_discovery_at, last_fetch_at, last_parse_at FROM source ORDER BY name`,
          )
          .all(),
      ),
    ),
  );
  app.get("/v1/admin/runs", (context) => {
    const requested = Number(context.req.query("limit") ?? 30);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 30;
    return context.json(
      envelope(
        context.get("requestId"),
        database
          .prepare(
            `SELECT id, source_id, trigger, status, started_at, finished_at,
             discovered_count, fetched_count, parsed_count, quarantined_count,
             error_code, error_message FROM ingest_run ORDER BY started_at DESC LIMIT ?`,
          )
          .all(limit),
      ),
    );
  });
  app.get("/v1/admin/runs/:id", (context) => {
    const run = database.prepare("SELECT * FROM ingest_run WHERE id = ?").get(context.req.param("id"));
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Run not found"), 404);
    const stages = database.prepare("SELECT * FROM run_stage WHERE run_id = ? ORDER BY id").all(context.req.param("id"));
    return context.json(envelope(context.get("requestId"), { run, stages }));
  });
  app.get("/v1/admin/quarantine", (context) =>
    context.json(
      envelope(
        context.get("requestId"),
        database
          .prepare(
            `SELECT id, run_id, reason_code, source_row_ref, details_json, status, created_at
             FROM quarantine ORDER BY created_at DESC LIMIT 100`,
          )
          .all(),
      ),
    ),
  );
  app.get("/v1/admin/releases", (context) =>
    context.json(
      envelope(
        context.get("requestId"),
        database
          .prepare(
            `SELECT data_version, schema_version, status, built_at, released_at,
             manifest_sha256, release_path, notes, build_commit
             FROM data_release ORDER BY data_version DESC LIMIT 30`,
          )
          .all(),
      ),
    ),
  );
  return app;
}

export function createProductionApp(): Hono {
  const database = openOperationalDatabase(resolve(process.env.LPL_DATABASE_PATH ?? "../data/runtime/operations.sqlite"));
  const app = createApp(database);
  const adminRoot = resolve(process.env.LPL_ADMIN_ROOT ?? "../admin/dist");
  app.use("/admin/*", serveStatic({ root: adminRoot, rewriteRequestPath: (path) => path.replace(/^\/admin/u, "") || "/index.html" }));
  app.get("/admin", (context) => context.redirect("/admin/"));
  return app;
}

function credentialsFromEnvironment(): { username: string; passwordHash: string } {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!username || !passwordHash) throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD_HASH are required");
  return { username, passwordHash };
}

function safeUsernameEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function envelope<T>(requestId: string, payload: T, success = true, message = "OK"): ApiEnvelope<T> {
  return { success, message, payload, meta: { request_id: requestId, generated_at: new Date().toISOString() } };
}
