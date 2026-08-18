import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { openOperationalDatabase, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { ingestManualPdf, maximumPdfBytes } from "@lanka-pricelens/foundry/intake";
import { runIngestion } from "@lanka-pricelens/foundry/pipeline";
import { canPublishSource, sourceManifestSchema, type ApiEnvelope, type SourceManifest } from "@lanka-pricelens/shared";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import {
  adminSessionCookie,
  adminSessionSeconds,
  authenticateAdmin,
  createAdminSession,
  findAdminSession,
  revokeAdminSession,
  seedAdminUser,
  type AdminUser,
} from "./auth.ts";

type AppBindings = { Variables: { adminUser: AdminUser } };

export function createApp(
  database: OperationalDatabase,
  sourceManifest?: SourceManifest,
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.use("*", requestId(), secureHeaders());
  app.get("/v1/health", (context) => context.json(envelope(context.get("requestId"), { status: "ok" })));

  app.post("/v1/auth/login", bodyLimit({ maxSize: 16 * 1024 }), async (context) => {
    if (!sameOrigin(context)) return context.json(envelope(context.get("requestId"), null, false, "Cross-origin request rejected"), 403);
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(envelope(context.get("requestId"), null, false, "Invalid login request"), 400);
    }
    const email = typeof body === "object" && body && "email" in body ? (body as { email: unknown }).email : undefined;
    const password = typeof body === "object" && body && "password" in body ? (body as { password: unknown }).password : undefined;
    if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 1_024) {
      return context.json(envelope(context.get("requestId"), null, false, "Invalid email or password"), 401);
    }
    const user = authenticateAdmin(database, email, password);
    if (!user) return context.json(envelope(context.get("requestId"), null, false, "Invalid email or password"), 401);
    const token = createAdminSession(database, user.id);
    setCookie(context, adminSessionCookie, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: adminSessionSeconds,
    });
    return context.json(envelope(context.get("requestId"), user, true, "Signed in"));
  });

  const requireOwner = async (context: Context<AppBindings>, next: Next) => {
    const user = findAdminSession(database, getCookie(context, adminSessionCookie));
    if (!user) return context.json(envelope(context.get("requestId"), null, false, "Authentication required"), 401);
    if (!sameOrigin(context)) return context.json(envelope(context.get("requestId"), null, false, "Cross-origin request rejected"), 403);
    context.set("adminUser", user);
    await next();
  };
  app.get("/v1/auth/session", requireOwner, (context) =>
    context.json(envelope(context.get("requestId"), context.get("adminUser"))),
  );
  app.post("/v1/auth/logout", requireOwner, (context) => {
    revokeAdminSession(database, getCookie(context, adminSessionCookie));
    deleteCookie(context, adminSessionCookie, { path: "/", secure: process.env.NODE_ENV === "production" });
    return context.json(envelope(context.get("requestId"), null, true, "Signed out"));
  });
  app.use("/v1/admin/*", requireOwner);

  app.get("/v1/admin/overview", (context) => {
    const counts = database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM source) AS sources,
          (SELECT COUNT(*) FROM source_artifact) AS pdfs,
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
    const { page, pageSize, offset } = pageRequest(context);
    const total = (database.prepare("SELECT COUNT(*) AS count FROM ingest_run").get() as { count: number }).count;
    return context.json(
      envelope(
        context.get("requestId"),
        {
          items: database
            .prepare(
              `SELECT id, source_id, trigger, status, started_at, finished_at,
               discovered_count, fetched_count, parsed_count, quarantined_count,
               error_code, error_message FROM ingest_run ORDER BY started_at DESC LIMIT ? OFFSET ?`,
            )
            .all(pageSize, offset),
          page,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize)),
        },
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
  app.get("/v1/admin/uploads", (context) => {
    const { page, pageSize, offset } = pageRequest(context);
    const total = (database.prepare("SELECT COUNT(*) AS count FROM source_artifact WHERE original_filename IS NOT NULL").get() as { count: number }).count;
    const items = database
      .prepare(
        `SELECT artifact.id AS artifact_id, artifact.run_id, artifact.original_filename,
         artifact.fetched_at, artifact.byte_size, artifact.sha256, artifact.status,
         json_extract(artifact.inspection_json, '$.pdfType') AS pdf_type,
         json_extract(artifact.inspection_json, '$.pageCount') AS page_count,
         json_extract(artifact.inspection_json, '$.confidence') AS confidence,
         COALESCE(json_array_length(artifact.inspection_json, '$.pagesNeedingOcr'), 0) AS ocr_page_count,
         run.status AS run_status,
         (SELECT COUNT(*) FROM staging_observation observation WHERE observation.artifact_id = artifact.id) AS parsed_count,
         run.quarantined_count
         FROM source_artifact artifact
         LEFT JOIN ingest_run run ON run.id = artifact.run_id
         WHERE artifact.original_filename IS NOT NULL
         ORDER BY artifact.fetched_at DESC LIMIT ? OFFSET ?`,
      )
      .all(pageSize, offset);
    return context.json(envelope(context.get("requestId"), { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) }));
  });
  app.post("/v1/admin/ingestion/:mode", (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Automated intake is not configured"), 503);
    if (!canPublishSource(sourceManifest)) return context.json(envelope(context.get("requestId"), null, false, "Source permission is not current"), 403);
    const mode = context.req.param("mode");
    if (mode !== "backfill" && mode !== "sync") return context.json(envelope(context.get("requestId"), null, false, "Unknown ingestion mode"), 404);
    const active = database
      .prepare("SELECT id, trigger, status FROM ingest_run WHERE source_id = ? AND status = 'running' LIMIT 1")
      .get(sourceManifest.id) as { id: string; trigger: string; status: string } | undefined;
    if (active) return context.json(envelope(context.get("requestId"), active, false, "Another source run is active"), 409);

    const task = runIngestion(database, sourceManifest, { trigger: mode === "backfill" ? "backfill" : "scheduled" });
    const run = database
      .prepare("SELECT id, trigger, status FROM ingest_run WHERE source_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(sourceManifest.id) as { id: string; trigger: string; status: string } | undefined;
    void task.catch(() => undefined);
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Ingestion did not start"), 500);
    return context.json(envelope(context.get("requestId"), run, true, "Ingestion started"), 202);
  });
  app.post(
    "/v1/admin/uploads",
    bodyLimit({
      maxSize: maximumPdfBytes + 1024 * 1024,
      onError: (context) => context.json(envelope(context.get("requestId"), null, false, "PDF exceeds the 20 MiB limit"), 413),
    }),
    async (context) => {
      if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Manual intake is not configured"), 503);
      let body: Awaited<ReturnType<typeof context.req.parseBody>>;
      try {
        body = await context.req.parseBody();
      } catch {
        return context.json(envelope(context.get("requestId"), null, false, "Invalid multipart upload"), 400);
      }
      const file = body.file;
      if (!(file instanceof File)) return context.json(envelope(context.get("requestId"), null, false, "A PDF file is required"), 400);

      const fileName = basename(file.name).slice(0, 255);
      if (!fileName.toLowerCase().endsWith(".pdf")) {
        return context.json(envelope(context.get("requestId"), null, false, "Only .pdf files are accepted"), 400);
      }
      if (file.size < 5 || file.size > maximumPdfBytes) {
        return context.json(envelope(context.get("requestId"), null, false, "PDF must be between 5 bytes and 20 MiB"), 400);
      }
      if (file.type && !["application/pdf", "application/octet-stream"].includes(file.type)) {
        return context.json(envelope(context.get("requestId"), null, false, "Unsupported media type"), 415);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        return context.json(envelope(context.get("requestId"), null, false, "File signature is not a PDF"), 400);
      }
      try {
        const result = await ingestManualPdf(database, sourceManifest, { fileName, bytes, actor: context.get("adminUser").email });
        const response = envelope(context.get("requestId"), result, true, result.status === "duplicate" ? "PDF already exists" : "PDF accepted");
        if (result.status === "duplicate") return context.json(response);
        if (result.status === "quarantined") return context.json(response, 202);
        return context.json(response, 201);
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        if (code === "SOURCE_BUSY") return context.json(envelope(context.get("requestId"), null, false, "Another source run is active"), 409);
        if (code === "SOURCE_RIGHTS_BLOCKED") return context.json(envelope(context.get("requestId"), null, false, "Source processing is blocked"), 403);
        return context.json(envelope(context.get("requestId"), null, false, "PDF intake failed"), 422);
      }
    },
  );
  return app;
}

export function createProductionApp(): Hono<AppBindings> {
  const database = openOperationalDatabase(resolve(process.env.LPL_DATABASE_PATH ?? "../data/runtime/operations.sqlite"));
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !passwordHash) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD_HASH are required");
  seedAdminUser(database, email, passwordHash);
  const manifestPath = resolve(process.env.LPL_SOURCE_MANIFEST_PATH ?? "../data/manifests/harti_daily_food_prices.json");
  const manifest = sourceManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const app = createApp(database, manifest);
  const adminRoot = resolve(process.env.LPL_ADMIN_ROOT ?? "../admin/dist");
  app.use("/admin/*", serveStatic({ root: adminRoot, rewriteRequestPath: (path) => path.replace(/^\/admin/u, "") || "/index.html" }));
  app.get("/admin/*", serveStatic({ root: adminRoot, rewriteRequestPath: () => "/index.html" }));
  app.get("/admin", (context) => context.redirect("/admin/"));
  return app;
}

function sameOrigin(context: Context): boolean {
  const origin = context.req.header("origin");
  return !origin || origin === new URL(context.req.url).origin;
}

function pageRequest(context: Context): { page: number; pageSize: number; offset: number } {
  const requestedPage = Number(context.req.query("page") ?? 1);
  const requestedSize = Number(context.req.query("pageSize") ?? 20);
  const page = Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1;
  const pageSize = Number.isInteger(requestedSize) ? Math.min(Math.max(requestedSize, 1), 100) : 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function envelope<T>(requestId: string, payload: T, success = true, message = "OK"): ApiEnvelope<T> {
  return { success, message, payload, meta: { request_id: requestId, generated_at: new Date().toISOString() } };
}
