import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { openOperationalDatabase, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { configuredArchiveStorage, type ArchiveStorage } from "@lanka-pricelens/foundry/archive-storage";
import { archiveManualArtifact, ingestManualPdf, maximumPdfBytes } from "@lanka-pricelens/foundry/intake";
import { createSourceCatalog, singleSourceCatalog, type CatalogEntry, type SourceCatalog } from "@lanka-pricelens/foundry/manifest";
import {
  processingStages,
  retryProcessingStage,
  runPdfProcessing,
  runSourceSync,
  workflowRetryState,
  workflowSnapshot,
  type ProcessingStage,
} from "@lanka-pricelens/foundry/pipeline";
import {
  clearAdapterSettings,
  readAdapterOverrides,
  resolveAdapterSettings,
  resumeSourceCapture,
  retailAdapterFor,
  runRetailCapture,
  saveAdapterSettings,
  SettingsError,
  settingsJsonSchema,
  type AnyRetailAdapter,
} from "@lanka-pricelens/foundry/retail";
import { connectWarehouse, type WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import {
  enqueueWorkflow,
  ensureWorkflowSchedules,
  workflowDefinitions,
  type WorkflowKey,
} from "@lanka-pricelens/foundry/workflows";
import {
  canCaptureSource,
  canPublishSource,
  mappingBundleSchema,
  sourceManifestSchema,
  type ApiEnvelope,
  type MappingBundle,
  type SourceManifest,
} from "@lanka-pricelens/shared";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";

import { productDetail, searchProducts } from "./explorer.ts";
import { dishDetail, ingredientPrices, listDishes, pricedProducts, productLabels, readRecipeStore, recipeOverview, type RecipeStore } from "./recipes.ts";
import { basketIndex, insightsSummary, parseRangeRequest, priceSeries } from "./insights.ts";
import {
  archivedKnowledgePdf,
  knowledgeIndexStatus,
  latestKnowledgeArtifact,
  latestKnowledgeDispatch,
  latestKnowledgeProcessing,
} from "./knowledge-sql.ts";
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
  mappingBundle?: MappingBundle,
  options: { archiveStorage?: ArchiveStorage; catalog?: SourceCatalog; warehouse?: () => Promise<WarehouseClient>; recipes?: RecipeStore } = {},
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  /** The PostgreSQL warehouse behind the price explorer; null when not configured or unreachable (the routes answer 503). */
  const warehouse = async (): Promise<WarehouseClient | null> => {
    if (!options.warehouse) return null;
    try {
      return await options.warehouse();
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "Warehouse unavailable", detail: error instanceof Error ? error.message : String(error) }));
      return null;
    }
  };
  const catalog = options.catalog ?? (sourceManifest ? singleSourceCatalog(sourceManifest, mappingBundle) : createSourceCatalog([]));
  for (const entry of catalog.entries) ensureWorkflowSchedules(database, entry.manifest);

  /** Starts a retail capture for one source and answers like the ingestion route: 202 with the run, or 409 when it cannot start. */
  const startCapture = async (context: Context<AppBindings>, entry: CatalogEntry, adapter: AnyRetailAdapter) => {
    if (!canCaptureSource(entry.manifest)) return context.json(envelope(context.get("requestId"), null, false, "Source permission is not current"), 403);
    const health = database
      .prepare("SELECT consecutive_failures, paused_until FROM source WHERE id = ?")
      .get(entry.manifest.id) as { consecutive_failures: number; paused_until: string | null } | undefined;
    if (health?.paused_until && health.paused_until > new Date().toISOString()) {
      return context.json(envelope(context.get("requestId"), health, false, `Capture is paused until ${health.paused_until}; resume it first`), 409);
    }
    const active = database
      .prepare("SELECT id, trigger, status FROM ingest_run WHERE source_id = ? AND workflow != 'pdf_processing' AND status = 'running' LIMIT 1")
      .get(entry.manifest.id) as { id: string; trigger: string; status: string } | undefined;
    if (active) return context.json(envelope(context.get("requestId"), active, false, "Another run for this source is active"), 409);
    const archive = options.archiveStorage ?? (await configuredArchiveStorage().catch(() => undefined));
    const task = runRetailCapture(database, entry.manifest, adapter, { trigger: "manual", mappingBundle: entry.mappingBundle, archive });
    void task.catch(() => undefined);
    const run = database
      .prepare("SELECT id, workflow, trigger, status FROM ingest_run WHERE source_id = ? AND workflow = 'retail_capture' ORDER BY started_at DESC LIMIT 1")
      .get(entry.manifest.id) as { id: string; trigger: string; status: string } | undefined;
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Capture did not start"), 500);
    return context.json(envelope(context.get("requestId"), run, true, "Capture started"), 202);
  };
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
    const authentication = authenticateAdmin(database, email, password);
    if (authentication.status === "invalid_credentials") {
      return context.json(
        envelope(
          context.get("requestId"),
          authentication.attemptsRemaining === null
            ? null
            : { reason: "invalid_credentials" as const, attempts_remaining: authentication.attemptsRemaining },
          false,
          "Invalid email or password",
        ),
        401,
      );
    }
    if (authentication.status === "locked") {
      context.header("Retry-After", String(authentication.retryAfterSeconds));
      return context.json(
        envelope(
          context.get("requestId"),
          {
            reason: "account_locked" as const,
            attempts_remaining: authentication.attemptsRemaining,
            locked_until: authentication.lockedUntil,
            retry_after_seconds: authentication.retryAfterSeconds,
          },
          false,
          "Sign-in is temporarily locked",
        ),
        423,
      );
    }
    const user = authentication.user;
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

  app.get("/v1/admin/events/workflows", (context) => {
    const suppliedCursor = context.req.header("Last-Event-ID") ?? context.req.query("after");
    const parsedCursor = suppliedCursor === undefined ? null : Number.parseInt(suppliedCursor, 10);
    let cursor = parsedCursor !== null && Number.isSafeInteger(parsedCursor) && parsedCursor >= 0
      ? parsedCursor
      : (database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM workflow_event").get() as { id: number }).id;
    context.header("Cache-Control", "no-cache, no-transform");
    context.header("Connection", "keep-alive");
    context.header("X-Accel-Buffering", "no");

    return streamSSE(context, async (stream) => {
      let aborted = false;
      let lastHeartbeat = Date.now();
      stream.onAbort(() => { aborted = true; });
      await stream.writeSSE({
        data: JSON.stringify({ cursor }),
        event: "ready",
        id: String(cursor),
        retry: 2_000,
      });

      while (!aborted) {
        const events = database
          .prepare(
            `SELECT id, event_type, dispatch_id, run_id, archive_id, publication_id,
             stage, status, created_at FROM workflow_event WHERE id > ? ORDER BY id LIMIT 100`,
          )
          .all(cursor) as Array<Record<string, unknown> & { id: number }>;
        for (const event of events) {
          cursor = event.id;
          await stream.writeSSE({ data: JSON.stringify(event), event: "workflow", id: String(event.id) });
        }
        if (Date.now() - lastHeartbeat >= 15_000) {
          await stream.writeSSE({ data: JSON.stringify({ cursor }), event: "heartbeat", id: String(cursor) });
          lastHeartbeat = Date.now();
        }
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, events.length === 100 ? 0 : 500));
      }
    });
  });

  app.get("/v1/admin/overview", (context) => {
    const counts = database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM source) AS sources,
          (SELECT COUNT(*) FROM source_publication) AS pdfs,
          (SELECT COUNT(*) FROM ingest_run WHERE status = 'running') AS running,
          (SELECT COUNT(*) FROM ingest_run WHERE status = 'failed') AS failed,
          (SELECT COUNT(*) FROM quarantine WHERE status = 'open') AS quarantined`,
      )
      .get();
    return context.json(envelope(context.get("requestId"), counts));
  });
  app.get("/v1/admin/sources", (context) => {
    const request = listRequest(context);
    const where = listWhere(request, ["name", "owner", "rights_status"], "state");
    const total = (database.prepare(`SELECT COUNT(*) AS count FROM source${where.sql}`).get(...where.values) as { count: number }).count;
    const page = pageRequest(request, total);
    const failureWindowStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const items = database
      .prepare(
        `SELECT id, name, owner, landing_url, rights_status, rights_evidence_ref, reviewed_at, review_due_at, enabled, state,
         last_discovery_at, last_fetch_at, last_parse_at, last_release_at,
         consecutive_failures, paused_until, last_capture_error, last_capture_at,
         json_extract(manifest_json, '$.adapter.kind') AS adapter_kind,
         json_extract(manifest_json, '$.expected_cadence') AS expected_cadence,
         json_extract(manifest_json, '$.retrieval_method') AS retrieval_method,
         json_extract(manifest_json, '$.attribution_text') AS attribution_text,
         json_extract(manifest_json, '$.geographic_scope') AS geographic_scope,
         json_extract(manifest_json, '$.retention_policy') AS retention_policy,
         (SELECT COUNT(*) FROM source_publication publication WHERE publication.source_id = source.id) AS publication_count,
         (SELECT COUNT(*) FROM source_publication publication
          WHERE publication.source_id = source.id AND publication.status = 'canonicalized') AS canonicalized_count,
         (SELECT COUNT(*) FROM ingest_run run
          WHERE run.source_id = source.id AND run.status = 'failed' AND run.started_at >= ?) AS failed_runs_30d,
         (SELECT COUNT(*) FROM price_observation observation
          JOIN source_publication publication ON publication.id = observation.source_publication_id
          WHERE publication.source_id = source.id AND observation.status = 'active') AS observation_count,
         (SELECT run.started_at FROM ingest_run run
          WHERE run.source_id = source.id AND run.status = 'failed' ORDER BY run.started_at DESC LIMIT 1) AS last_failure_at,
         (SELECT run.error_message FROM ingest_run run
          WHERE run.source_id = source.id AND run.status = 'failed' ORDER BY run.started_at DESC LIMIT 1) AS last_error_message
         FROM source${where.sql}
         ORDER BY name LIMIT ? OFFSET ?`,
      )
      .all(failureWindowStart, ...where.values, page.pageSize, page.offset);
    return context.json(envelope(context.get("requestId"), { items, ...page }));
  });
  app.get("/v1/admin/sources/:id/adapter", (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    const adapter = retailAdapterFor(entry.manifest);
    if (!adapter) return context.json(envelope(context.get("requestId"), { adapter: null }));
    const overrides = readAdapterOverrides(database, entry.manifest.id);
    let effective: unknown = null;
    let error: string | null = null;
    try {
      effective = resolveAdapterSettings(database, entry.manifest, adapter);
    } catch (settingsError) {
      error = settingsError instanceof Error ? settingsError.message : String(settingsError);
    }
    const health = database
      .prepare("SELECT state, consecutive_failures, paused_until, last_capture_error, last_capture_at FROM source WHERE id = ?")
      .get(entry.manifest.id);
    const lastRun = database
      .prepare(
        `SELECT id, status, trigger, started_at, finished_at, parsed_count, quarantined_count, error_code, error_message
         FROM ingest_run WHERE source_id = ? AND workflow = 'retail_capture' ORDER BY started_at DESC LIMIT 1`,
      )
      .get(entry.manifest.id);
    const overridesUpdated = database.prepare("SELECT updated_by, updated_at FROM source_adapter_setting WHERE source_id = ?").get(entry.manifest.id);
    return context.json(
      envelope(context.get("requestId"), {
        adapter: { kind: adapter.kind, label: adapter.label, description: adapter.description, market_label: adapter.marketLabel, price_type: adapter.priceType },
        schema: settingsJsonSchema(adapter),
        defaults: entry.manifest.adapter?.settings ?? {},
        overrides,
        overrides_updated: overridesUpdated ?? null,
        effective,
        error,
        health: health ?? null,
        last_run: lastRun ?? null,
        mapping_configured: Boolean(entry.mappingBundle),
      }),
    );
  });
  app.put("/v1/admin/sources/:id/adapter", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    const adapter = retailAdapterFor(entry.manifest);
    if (!adapter) return context.json(envelope(context.get("requestId"), null, false, "This source has no adapter to configure"), 409);
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(envelope(context.get("requestId"), null, false, "Settings must be a JSON object"), 400);
    }
    const overrides = typeof body === "object" && body && !Array.isArray(body) && "overrides" in body ? (body as { overrides: unknown }).overrides : body;
    if (typeof overrides !== "object" || !overrides || Array.isArray(overrides)) return context.json(envelope(context.get("requestId"), null, false, "Settings must be a JSON object"), 400);
    try {
      const effective = saveAdapterSettings(database, entry.manifest, adapter, overrides as Record<string, unknown>, context.get("adminUser").email);
      return context.json(envelope(context.get("requestId"), { overrides, effective }, true, "Settings saved"));
    } catch (error) {
      if (error instanceof SettingsError) return context.json(envelope(context.get("requestId"), { issues: error.issues }, false, "Settings rejected"), 400);
      throw error;
    }
  });
  app.delete("/v1/admin/sources/:id/adapter", (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    clearAdapterSettings(database, entry.manifest.id, context.get("adminUser").email);
    return context.json(envelope(context.get("requestId"), { overrides: {} }, true, "Settings reset to the manifest defaults"));
  });
  app.post("/v1/admin/sources/:id/capture", async (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    const adapter = retailAdapterFor(entry.manifest);
    if (!adapter) return context.json(envelope(context.get("requestId"), null, false, "This source is collected through the document workflows"), 409);
    return startCapture(context, entry, adapter);
  });
  app.post("/v1/admin/sources/:id/resume", (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    resumeSourceCapture(database, entry.manifest.id, context.get("adminUser").email);
    const health = database.prepare("SELECT state, consecutive_failures, paused_until, last_capture_error, last_capture_at FROM source WHERE id = ?").get(entry.manifest.id);
    return context.json(envelope(context.get("requestId"), health ?? null, true, "Capture resumed"));
  });
  app.get("/v1/admin/explorer/search", async (context) => {
    const client = await warehouse();
    if (!client) return context.json(envelope(context.get("requestId"), null, false, "The price explorer needs the PostgreSQL warehouse (LPL_POSTGRES_URL)"), 503);
    const query = (context.req.query("q") ?? "").slice(0, 80);
    const limit = Number(context.req.query("limit") ?? 20) || 20;
    return context.json(envelope(context.get("requestId"), await searchProducts(client, query, limit)));
  });
  app.get("/v1/admin/explorer/products/:id", async (context) => {
    const client = await warehouse();
    if (!client) return context.json(envelope(context.get("requestId"), null, false, "The price explorer needs the PostgreSQL warehouse (LPL_POSTGRES_URL)"), 503);
    const range = parseRangeRequest({ days: context.req.query("days"), from: context.req.query("from"), to: context.req.query("to") });
    if ("error" in range) return context.json(envelope(context.get("requestId"), null, false, range.error), 400);
    // varieties: omitted for the product's default view, "all" for every variety, or a comma-separated list of item ids.
    const requested = (context.req.query("varieties") ?? "").slice(0, 2000);
    const varieties = requested === "all" ? "all" : requested.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 50);
    const detail = await productDetail(client, context.req.param("id").slice(0, 120), range, { varieties });
    if (!detail) return context.json(envelope(context.get("requestId"), null, false, "Product not found"), 404);
    return context.json(envelope(context.get("requestId"), detail));
  });
  // The recipe corpus: the reviewed dish catalogue with what the warehouse can price for each dish today.
  const noRecipes = (context: Context) => context.json(envelope(context.get("requestId"), null, false, "No recipe catalogue is configured (LPL_RECIPES_DIR)"), 503);
  const pricedNow = async (): Promise<Set<string> | null> => {
    const client = await warehouse();
    return client ? pricedProducts(client).catch(() => null) : null;
  };
  app.get("/v1/admin/recipes/overview", async (context) => {
    if (!options.recipes) return noRecipes(context);
    return context.json(envelope(context.get("requestId"), recipeOverview(options.recipes, await pricedNow())));
  });
  app.get("/v1/admin/recipes/references", (context) => {
    if (!options.recipes) return noRecipes(context);
    return context.json(envelope(context.get("requestId"), options.recipes.references));
  });
  app.get("/v1/admin/recipes/dishes", async (context) => {
    if (!options.recipes) return noRecipes(context);
    const request = listRequest(context);
    const pick = (name: string) => (context.req.query(name) ?? "").slice(0, 40);
    const filters = { search: request.search, category: pick("category"), meal: pick("meal"), protein: pick("protein"), diet: pick("diet"), region: pick("region"), occasion: pick("occasion"), page: request.requestedPage, pageSize: request.pageSize };
    return context.json(envelope(context.get("requestId"), listDishes(options.recipes, filters, await pricedNow())));
  });
  app.get("/v1/admin/recipes/dishes/:id", async (context) => {
    if (!options.recipes) return noRecipes(context);
    const dishId = context.req.param("id").slice(0, 120);
    const dish = options.recipes.catalogue.dishes.find((candidate) => candidate.id === dishId);
    if (!dish) return context.json(envelope(context.get("requestId"), null, false, "Dish not found"), 404);
    const client = await warehouse();
    const labels = client ? await productLabels(client, dish.key_ingredients).catch(() => new Map<string, string>()) : new Map<string, string>();
    const prices = client ? await ingredientPrices(client, dish.key_ingredients).catch(() => null) : null;
    return context.json(envelope(context.get("requestId"), dishDetail(options.recipes, dishId, labels, prices)));
  });
  app.get("/v1/admin/sources/:id/unmapped-labels", (context) => {
    const entry = catalog.find(context.req.param("id"));
    if (!entry) return context.json(envelope(context.get("requestId"), null, false, "Source not found"), 404);
    const limit = Math.min(500, Math.max(1, Number(context.req.query("limit") ?? 50) || 50));
    const total = (database.prepare("SELECT COUNT(*) AS count FROM source_unmapped_label WHERE source_id = ?").get(entry.manifest.id) as { count: number }).count;
    const items = database
      .prepare(
        `SELECT label_type, label, occurrences, first_seen_at, last_seen_at, last_market_label, last_quantity, last_unit, last_price_minor
         FROM source_unmapped_label WHERE source_id = ? ORDER BY occurrences DESC, last_seen_at DESC, label LIMIT ?`,
      )
      .all(entry.manifest.id, limit);
    return context.json(envelope(context.get("requestId"), { items, total }));
  });
  app.get("/v1/admin/runs", (context) => {
    const request = listRequest(context);
    const where = listWhere(request, ["workflow", "trigger", "status", "error_code", "error_message"], "status");
    const total = (database.prepare(`SELECT COUNT(*) AS count FROM ingest_run${where.sql}`).get(...where.values) as { count: number }).count;
    const page = pageRequest(request, total);
    return context.json(
      envelope(
        context.get("requestId"),
        {
          items: database
            .prepare(
              `SELECT id, source_id, workflow, parent_run_id, archive_id, artifact_id,
               definition_key, definition_version, dispatch_id, scheduled_for, environment,
               trigger, status, started_at, finished_at,
               discovered_count, fetched_count, parsed_count, quarantined_count,
               error_code, error_message FROM ingest_run${where.sql}
               ORDER BY started_at DESC LIMIT ? OFFSET ?`,
            )
            .all(...where.values, page.pageSize, page.offset),
          ...page,
        },
      ),
    );
  });
  app.get("/v1/admin/workflows", (context) => {
    const schedules = database
      .prepare(
        `SELECT schedule.*,
         (SELECT status FROM workflow_dispatch dispatch WHERE dispatch.workflow_key = schedule.workflow_key
          ORDER BY dispatch.created_at DESC LIMIT 1) AS last_status,
         (SELECT finished_at FROM workflow_dispatch dispatch WHERE dispatch.workflow_key = schedule.workflow_key
          ORDER BY dispatch.created_at DESC LIMIT 1) AS last_finished_at,
         (SELECT COUNT(*) FROM workflow_dispatch dispatch WHERE dispatch.workflow_key = schedule.workflow_key
          AND dispatch.status = 'running') AS running_count,
         (SELECT COUNT(*) FROM workflow_dispatch dispatch WHERE dispatch.workflow_key = schedule.workflow_key
          AND dispatch.status = 'failed') AS failed_count
         FROM workflow_schedule schedule ORDER BY schedule.created_at`,
      )
      .all() as Array<Record<string, unknown> & { workflow_key: string }>;
    const scheduleByKey = new Map(schedules.map((schedule) => [schedule.workflow_key, schedule]));
    return context.json(
      envelope(
        context.get("requestId"),
        workflowDefinitions.map((definition) => ({
          ...definition,
          cronExpression: definition.schedule,
          version: 1,
          schedule: scheduleByKey.get(definition.key) ?? null,
          schedules: schedules.filter((schedule) => schedule.workflow_key === definition.key),
        })),
      ),
    );
  });
  app.get("/v1/admin/workflow-schedules", (context) => {
    const instances = database.prepare("SELECT * FROM scheduler_instance ORDER BY heartbeat_at DESC").all() as Array<Record<string, unknown> & { heartbeat_at: string }>;
    const now = Date.now();
    const monitoredInstances = instances.map((instance) => ({
      ...instance,
      healthy: instance.status === "online" && now - Date.parse(instance.heartbeat_at) <= 45_000,
    }));
    const activeInstances = monitoredInstances.filter((instance) => instance.healthy);
    return context.json(
      envelope(context.get("requestId"), {
        items: database.prepare("SELECT * FROM workflow_schedule ORDER BY next_run_at").all(),
        instances: activeInstances.length ? activeInstances : monitoredInstances.slice(0, 1),
        stale_after_seconds: 45,
      }),
    );
  });
  app.patch("/v1/admin/workflow-schedules/:id", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(envelope(context.get("requestId"), null, false, "Invalid schedule request"), 400);
    }
    const enabled = typeof body === "object" && body && "enabled" in body ? (body as { enabled: unknown }).enabled : undefined;
    if (typeof enabled !== "boolean") return context.json(envelope(context.get("requestId"), null, false, "enabled must be a boolean"), 400);
    const result = database
      .prepare("UPDATE workflow_schedule SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), context.req.param("id"));
    if (!result.changes) return context.json(envelope(context.get("requestId"), null, false, "Schedule not found"), 404);
    return context.json(envelope(context.get("requestId"), { id: context.req.param("id"), enabled }, true, enabled ? "Schedule enabled" : "Schedule paused"));
  });
  app.get("/v1/admin/workflow-dispatches", (context) => {
    const request = listRequest(context);
    const where = listWhere(request, ["workflow_key", "trigger", "status", "requested_by", "error_code", "error_message"], "status");
    const total = (database.prepare(`SELECT COUNT(*) AS count FROM workflow_dispatch${where.sql}`).get(...where.values) as { count: number }).count;
    const page = pageRequest(request, total);
    const items = database
      .prepare(`SELECT * FROM workflow_dispatch${where.sql} ORDER BY scheduled_for DESC, created_at DESC LIMIT ? OFFSET ?`)
      .all(...where.values, page.pageSize, page.offset);
    return context.json(envelope(context.get("requestId"), { items, ...page }));
  });
  app.post("/v1/admin/workflows/:key/run", async (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Workflow execution is not configured"), 503);
    const definition = workflowDefinitions.find((candidate) => candidate.key === context.req.param("key"));
    if (!definition) return context.json(envelope(context.get("requestId"), null, false, "Workflow not found"), 404);
    let archiveId: string | undefined;
    if (definition.executor === "pdf_processing") {
      let body: unknown;
      try {
        body = await context.req.json();
      } catch {
        body = null;
      }
      archiveId = typeof body === "object" && body && "archive_id" in body && typeof (body as { archive_id: unknown }).archive_id === "string"
        ? (body as { archive_id: string }).archive_id
        : undefined;
      if (!archiveId) return context.json(envelope(context.get("requestId"), null, false, "Choose a document to run this workflow"), 400);
      const ownedArchive = database
        .prepare(
          `SELECT archive.id FROM archived_pdf archive
           JOIN source_publication publication ON publication.id = archive.publication_id
           WHERE archive.id = ? AND publication.source_id = ?`,
        )
        .get(archiveId, sourceManifest.id);
      if (!ownedArchive) return context.json(envelope(context.get("requestId"), null, false, "Archived document not found"), 404);
    }
    if (definition.executor === "retail_capture") {
      const dispatches = catalog.entries
        .filter((entry) => entry.manifest.enabled && retailAdapterFor(entry.manifest))
        .map((entry) => enqueueWorkflow(database, { workflowKey: definition.key as WorkflowKey, sourceId: entry.manifest.id, requestedBy: context.get("adminUser").email }));
      if (!dispatches.length) return context.json(envelope(context.get("requestId"), null, false, "No retail sources are configured"), 409);
      return context.json(envelope(context.get("requestId"), dispatches, true, `${dispatches.length} capture${dispatches.length === 1 ? "" : "s"} queued`), 202);
    }
    const dispatch = enqueueWorkflow(database, {
      workflowKey: definition.key as WorkflowKey,
      sourceId: sourceManifest.id,
      ...(archiveId ? { archiveId } : {}),
      requestedBy: context.get("adminUser").email,
    });
    return context.json(envelope(context.get("requestId"), dispatch, true, "Workflow queued"), 202);
  });
  app.get("/v1/admin/runs/:id", (context) => {
    const run = database.prepare("SELECT * FROM ingest_run WHERE id = ?").get(context.req.param("id"));
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Run not found"), 404);
    const stages = workflowSnapshot(database, context.req.param("id"));
    const children = database
      .prepare(
        `SELECT id, source_id, workflow, parent_run_id, archive_id, artifact_id, trigger, status,
         started_at, finished_at, discovered_count, fetched_count, extracted_count, parsed_count,
         quarantined_count, error_code, error_message
         FROM ingest_run WHERE parent_run_id = ? ORDER BY started_at`,
      )
      .all(context.req.param("id"));
    return context.json(envelope(context.get("requestId"), { run, stages, children }));
  });
  app.post("/v1/admin/runs/:id/stages/:stage/retry", (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Automated intake is not configured"), 503);
    const stage = context.req.param("stage") as ProcessingStage;
    if (!processingStages.includes(stage)) return context.json(envelope(context.get("requestId"), null, false, "Unknown PDF-processing step"), 404);
    const run = database.prepare("SELECT id, source_id, workflow FROM ingest_run WHERE id = ?").get(context.req.param("id")) as
      | { id: string; source_id: string; workflow: string }
      | undefined;
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Run not found"), 404);
    if (run.source_id !== sourceManifest.id) return context.json(envelope(context.get("requestId"), null, false, "Run source is not configured"), 409);
    if (run.workflow !== "pdf_processing") return context.json(envelope(context.get("requestId"), null, false, "Only PDF-processing steps can be retried"), 409);
    const retry = workflowRetryState(database, run.id, stage);
    if (!retry.canRetry) return context.json(envelope(context.get("requestId"), retry, false, retry.reason ?? "Step cannot be retried"), 409);

    const task = retryProcessingStage(database, sourceManifest, run.id, stage, { mappingBundle });
    void task.catch(() => undefined);
    return context.json(envelope(context.get("requestId"), { run_id: run.id, stage }, true, "Step retry started"), 202);
  });
  app.post("/v1/admin/runs/:id/rerun", async (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Automated intake is not configured"), 503);
    const previous = database
      .prepare("SELECT id, source_id, workflow, archive_id FROM ingest_run WHERE id = ?")
      .get(context.req.param("id")) as { id: string; source_id: string; workflow: string; archive_id: string | null } | undefined;
    if (!previous) return context.json(envelope(context.get("requestId"), null, false, "Run not found"), 404);
    if (previous.workflow === "retail_capture") {
      const entry = catalog.find(previous.source_id);
      const adapter = entry ? retailAdapterFor(entry.manifest) : null;
      if (!entry || !adapter) return context.json(envelope(context.get("requestId"), null, false, "Run source is not configured"), 409);
      return startCapture(context, entry, adapter);
    }
    if (previous.source_id !== sourceManifest.id) return context.json(envelope(context.get("requestId"), null, false, "Run source is not configured"), 409);
    const task = previous.workflow === "pdf_processing" && previous.archive_id
      ? runPdfProcessing(database, sourceManifest, previous.archive_id, { trigger: "manual", mappingBundle })
      : runSourceSync(database, sourceManifest, { trigger: "manual", mappingBundle });
    const run = database
      .prepare(
        previous.workflow === "pdf_processing"
          ? "SELECT id, workflow, status FROM ingest_run WHERE workflow = 'pdf_processing' AND archive_id = ? ORDER BY started_at DESC LIMIT 1"
          : "SELECT id, workflow, status FROM ingest_run WHERE workflow = 'source_sync' ORDER BY started_at DESC LIMIT 1",
      )
      .get(...(previous.workflow === "pdf_processing" ? [previous.archive_id] : []));
    void task.catch(() => undefined);
    if (!run) return context.json(envelope(context.get("requestId"), null, false, "Workflow rerun did not start"), 500);
    return context.json(envelope(context.get("requestId"), run, true, "Workflow rerun started"), 202);
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
  const knowledgeSelect = `SELECT publication.id AS publication_id,
    COALESCE(artifact.id, archive.id, publication.id) AS document_id,
    publication.title, publication.published_at, publication.observed_from, publication.observed_to,
    publication.download_url, archive.id AS archive_id, archive.r2_uri, archive.r2_key,
    artifact.id AS artifact_id, artifact.run_id,
    COALESCE(artifact.original_filename, publication.title) AS original_filename,
    COALESCE(artifact.fetched_at, archive.uploaded_at) AS fetched_at,
    COALESCE(artifact.byte_size, archive.byte_size) AS byte_size,
    COALESCE(artifact.sha256, archive.sha256) AS sha256,
    COALESCE(artifact.status, archive.status, publication.status) AS status,
    ${knowledgeIndexStatus} AS index_status,
    json_extract(artifact.inspection_json, '$.pdfType') AS pdf_type,
    json_extract(artifact.inspection_json, '$.pageCount') AS page_count,
    json_extract(artifact.inspection_json, '$.confidence') AS confidence,
    COALESCE(json_array_length(artifact.inspection_json, '$.pagesNeedingOcr'), 0) AS ocr_page_count,
    artifact.parser_strategy, artifact.parser_confidence,
    quality.status AS quality_status, quality.score AS completeness_score,
    quality.item_coverage, quality.market_coverage, quality.cell_coverage, quality.mapping_coverage,
    COALESCE((SELECT COUNT(*) FROM staging_observation observation WHERE observation.artifact_id = artifact.id), 0) AS parsed_count,
    COALESCE((SELECT COUNT(*) FROM price_observation observation WHERE observation.source_artifact_id = artifact.id), 0) AS canonical_count,
    COALESCE((SELECT COUNT(*) FROM quarantine issue WHERE issue.artifact_id = artifact.id AND issue.status = 'open'), 0) AS quarantined_count,
    dispatch.id AS processing_dispatch_id,
    CASE WHEN dispatch.status IN ('queued', 'running')
         THEN CASE WHEN processing.dispatch_id = dispatch.id THEN processing.id ELSE dispatch.run_id END
         ELSE COALESCE(processing.id, artifact_run.id, dispatch.run_id) END AS processing_run_id,
    CASE WHEN dispatch.status IN ('queued', 'running') THEN
           CASE WHEN processing.dispatch_id = dispatch.id THEN processing.status ELSE dispatch.status END
         WHEN processing.id IS NULL AND artifact.status = 'quarantined' THEN 'blocked'
         ELSE COALESCE(processing.status, artifact_run.status, dispatch.status) END AS processing_status,
    COALESCE(CASE WHEN processing.dispatch_id = dispatch.id THEN processing.started_at END,
      dispatch.started_at, processing.started_at, artifact_run.started_at) AS processing_started_at,
    COALESCE(CASE WHEN processing.dispatch_id = dispatch.id THEN processing.finished_at END,
      dispatch.finished_at, processing.finished_at, artifact_run.finished_at) AS processing_finished_at,
    COALESCE(CASE WHEN processing.dispatch_id = dispatch.id THEN processing.error_code END,
      dispatch.error_code, processing.error_code, artifact_run.error_code) AS processing_error_code,
    COALESCE(CASE WHEN processing.dispatch_id = dispatch.id THEN processing.error_message END,
      dispatch.error_message, processing.error_message, artifact_run.error_message) AS processing_error_message
    FROM source_publication publication ${latestKnowledgeArtifact} ${archivedKnowledgePdf} ${latestKnowledgeProcessing} ${latestKnowledgeDispatch}
    LEFT JOIN artifact_quality_assessment quality ON quality.artifact_id = artifact.id`;
  const knowledgeListSelect = `SELECT publication.id AS publication_id,
    COALESCE(artifact.id, archive.id, publication.id) AS document_id,
    publication.title, publication.published_at, publication.download_url,
    archive.id AS archive_id,
    COALESCE(artifact.byte_size, archive.byte_size) AS byte_size,
    COALESCE(artifact.status, archive.status, publication.status) AS status,
    ${knowledgeIndexStatus} AS index_status,
    json_extract(artifact.inspection_json, '$.pdfType') AS pdf_type,
    json_extract(artifact.inspection_json, '$.pageCount') AS page_count,
    COALESCE((SELECT COUNT(*) FROM price_observation observation WHERE observation.source_artifact_id = artifact.id), 0) AS canonical_count,
    dispatch.id AS processing_dispatch_id,
    CASE WHEN dispatch.status IN ('queued', 'running')
         THEN CASE WHEN processing.dispatch_id = dispatch.id THEN processing.id ELSE dispatch.run_id END
         ELSE COALESCE(processing.id, artifact_run.id, dispatch.run_id) END AS processing_run_id,
    CASE WHEN dispatch.status IN ('queued', 'running') THEN
           CASE WHEN processing.dispatch_id = dispatch.id THEN processing.status ELSE dispatch.status END
         WHEN processing.id IS NULL AND artifact.status = 'quarantined' THEN 'blocked'
         ELSE COALESCE(processing.status, artifact_run.status, dispatch.status) END AS processing_status
    FROM source_publication publication ${latestKnowledgeArtifact} ${archivedKnowledgePdf} ${latestKnowledgeProcessing} ${latestKnowledgeDispatch}`;
  const readKnowledgeItem = (publicationId: string): Record<string, unknown> | undefined => database
    .prepare(`${knowledgeSelect} WHERE publication.id = ?`)
    .get(publicationId) as Record<string, unknown> | undefined;

  const listKnowledgeBase = (context: Context<AppBindings>) => {
    const request = listRequest(context);
    const where = listWhere(
      request,
      ["publication.id", "publication.title", "publication.download_url", "archive.id", "archive.r2_uri", "artifact.id", "artifact.original_filename", "artifact.sha256", "archive.sha256"],
      knowledgeIndexStatus,
    );
    const countStatusJoins = request.status ? ` ${latestKnowledgeProcessing} ${latestKnowledgeDispatch}` : "";
    const total = (database
      .prepare(`SELECT COUNT(*) AS count FROM source_publication publication ${latestKnowledgeArtifact} ${archivedKnowledgePdf}${countStatusJoins}${where.sql}`)
      .get(...where.values) as { count: number }).count;
    const page = pageRequest(request, total);
    const items = database
      .prepare(
        `${knowledgeListSelect}${where.sql}
         ORDER BY publication.published_at DESC, publication.first_seen_at DESC, publication.title
         LIMIT ? OFFSET ?`,
      )
      .all(...where.values, page.pageSize, page.offset);
    return context.json(envelope(context.get("requestId"), { items, ...page }));
  };
  app.get("/v1/admin/knowledge-base", listKnowledgeBase);
  app.get("/v1/admin/uploads", listKnowledgeBase);
  app.get("/v1/admin/insights", (context) => context.json(envelope(context.get("requestId"), insightsSummary(database))));
  const rangeRequest = (context: Context<AppBindings>) =>
    parseRangeRequest({ days: context.req.query("days"), from: context.req.query("from"), to: context.req.query("to") });
  app.get("/v1/admin/insights/prices", (context) => {
    const range = rangeRequest(context);
    if ("error" in range) return context.json(envelope(context.get("requestId"), null, false, range.error), 400);
    const series = priceSeries(database, (context.req.query("product") ?? "").trim().slice(0, 100), (context.req.query("item") ?? "").trim().slice(0, 100), range);
    if (!series) return context.json(envelope(context.get("requestId"), null, false, "No canonical prices exist for that product or variety"), 404);
    return context.json(envelope(context.get("requestId"), series));
  });
  app.get("/v1/admin/insights/basket", (context) => {
    const range = rangeRequest(context);
    if ("error" in range) return context.json(envelope(context.get("requestId"), null, false, range.error), 400);
    return context.json(envelope(context.get("requestId"), basketIndex(database, range)));
  });
  app.get("/v1/admin/knowledge-base/:publicationId/file", async (context) => {
    const document = database
      .prepare(
        `SELECT publication.title, archive.r2_bucket, archive.r2_key
         FROM source_publication publication
         LEFT JOIN archived_pdf archive ON archive.publication_id = publication.id
         WHERE publication.id = ?`,
      )
      .get(context.req.param("publicationId")) as { title: string; r2_bucket: string | null; r2_key: string | null } | undefined;
    if (!document) return context.json(envelope(context.get("requestId"), null, false, "Document not found"), 404);
    if (!document.r2_key) return context.json(envelope(context.get("requestId"), null, false, "Document is not archived yet"), 409);
    try {
      const storage = options.archiveStorage ?? await configuredArchiveStorage(document.r2_bucket ?? undefined);
      const pdf = Uint8Array.from(await storage.download(document.r2_key));
      const filename = basename(document.title).replace(/[\r\n"]/gu, "_") || "document.pdf";
      return new Response(pdf, {
        headers: {
          "Cache-Control": "private, max-age=300",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Content-Type": "application/pdf",
        },
      });
    } catch {
      return context.json(envelope(context.get("requestId"), null, false, "Stored PDF could not be read"), 502);
    }
  });
  app.get("/v1/admin/knowledge-base/:publicationId", (context) => {
    const document = readKnowledgeItem(context.req.param("publicationId"));
    return document
      ? context.json(envelope(context.get("requestId"), document))
      : context.json(envelope(context.get("requestId"), null, false, "Document not found"), 404);
  });
  app.post("/v1/admin/knowledge-base/:publicationId/process", (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Document processing is not configured"), 503);
    const document = database
      .prepare(
        `SELECT archive.id AS archive_id, publication.source_id
         FROM source_publication publication
         LEFT JOIN archived_pdf archive ON archive.publication_id = publication.id
         WHERE publication.id = ?`,
      )
      .get(context.req.param("publicationId")) as { archive_id: string | null; source_id: string } | undefined;
    if (!document) return context.json(envelope(context.get("requestId"), null, false, "Document not found"), 404);
    if (!document.archive_id) return context.json(envelope(context.get("requestId"), null, false, "Document is not archived yet"), 409);
    const active = database
      .prepare(
        `SELECT id, status FROM workflow_dispatch WHERE archive_id = ?
         AND workflow_key = 'document_processing_pipeline' AND status IN ('queued', 'running') LIMIT 1`,
      )
      .get(document.archive_id);
    if (active) return context.json(envelope(context.get("requestId"), active, false, "Document processing is already queued or running"), 409);
    const dispatch = enqueueWorkflow(database, {
      workflowKey: "document_processing_pipeline",
      sourceId: document.source_id,
      archiveId: document.archive_id,
      requestedBy: context.get("adminUser").email,
    });
    return context.json(envelope(context.get("requestId"), dispatch, true, "Document processing queued"), 202);
  });
  app.post("/v1/admin/ingestion/:mode", (context) => {
    if (!sourceManifest) return context.json(envelope(context.get("requestId"), null, false, "Automated intake is not configured"), 503);
    if (!canPublishSource(sourceManifest)) return context.json(envelope(context.get("requestId"), null, false, "Source permission is not current"), 403);
    const mode = context.req.param("mode");
    if (mode !== "backfill" && mode !== "sync") return context.json(envelope(context.get("requestId"), null, false, "Unknown ingestion mode"), 404);
    const active = database
      .prepare("SELECT id, trigger, status FROM ingest_run WHERE source_id = ? AND workflow != 'pdf_processing' AND status = 'running' LIMIT 1")
      .get(sourceManifest.id) as { id: string; trigger: string; status: string } | undefined;
    if (active) return context.json(envelope(context.get("requestId"), active, false, "Another source run is active"), 409);

    const task = runSourceSync(database, sourceManifest, { trigger: mode === "backfill" ? "backfill" : "manual", mappingBundle, archive: options.archiveStorage });
    const run = database
      .prepare("SELECT id, workflow, trigger, status FROM ingest_run WHERE source_id = ? AND workflow = 'source_sync' ORDER BY started_at DESC LIMIT 1")
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
        const actor = context.get("adminUser").email;
        const result = await ingestManualPdf(database, sourceManifest, { fileName, bytes, actor });
        let dispatch = null;
        let archiveId: string | null = null;
        if (result.status !== "duplicate") {
          archiveId = await archiveManualArtifact(database, sourceManifest, {
            artifactId: result.artifactId,
            fileName,
            bytes,
            actor,
            archive: await configuredArchiveStorage(),
          });
          dispatch = enqueueWorkflow(database, {
            workflowKey: "document_processing_pipeline",
            sourceId: sourceManifest.id,
            archiveId,
            requestedBy: actor,
          });
        }
        const payload = { ...result, archiveId, dispatchId: dispatch?.id ?? null };
        const response = envelope(context.get("requestId"), payload, true, result.status === "duplicate" ? "PDF already exists" : "PDF archived and processing queued");
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
  const mappingPath = resolve(process.env.LPL_MAPPING_BUNDLE_PATH ?? "../data/mappings/harti_daily_food_prices.json");
  const mappingBundle = mappingBundleSchema.parse(JSON.parse(readFileSync(mappingPath, "utf8")));
  const catalog = readCatalogSync(
    resolve(process.env.LPL_MANIFESTS_DIR ?? "../data/manifests"),
    resolve(process.env.LPL_MAPPINGS_DIR ?? "../data/mappings"),
    { manifest, mappingBundle },
  );
  const warehouseUrl = process.env.LPL_POSTGRES_URL;
  // The recipe catalogue is optional at runtime: an image built before it existed still serves everything else.
  const recipesDirectory = resolve(process.env.LPL_RECIPES_DIR ?? "../data/recipes");
  const recipes = existsSync(resolve(recipesDirectory, "catalogue.json")) ? readRecipeStore(recipesDirectory) : undefined;
  const app = createApp(database, manifest, mappingBundle, { catalog, ...(warehouseUrl ? { warehouse: lazyWarehouse(warehouseUrl) } : {}), ...(recipes ? { recipes } : {}) });
  const adminRoot = resolve(process.env.LPL_ADMIN_ROOT ?? "../admin/dist");
  app.use("/admin/*", serveStatic({ root: adminRoot, rewriteRequestPath: (path) => path.replace(/^\/admin/u, "") || "/index.html" }));
  app.get("/admin/*", serveStatic({ root: adminRoot, rewriteRequestPath: () => "/index.html" }));
  app.get("/admin", (context) => context.redirect("/admin/"));
  return app;
}

/** Connects on first use and retries on the next request after a failure, so a database outage never takes the API down with it. */
function lazyWarehouse(url: string): () => Promise<WarehouseClient> {
  let pending: Promise<WarehouseClient> | null = null;
  return () => {
    pending ??= connectWarehouse(url).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/** Every manifest in the directory, paired with its bundle by source_id; the explicitly configured primary source always wins. */
function readCatalogSync(manifestsDirectory: string, mappingsDirectory: string, primary: CatalogEntry): SourceCatalog {
  const files = (directory: string): string[] => {
    try {
      return readdirSync(directory).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort().map((name) => resolve(directory, name));
    } catch {
      return [];
    }
  };
  const bundles = files(mappingsDirectory).map((file) => mappingBundleSchema.parse(JSON.parse(readFileSync(file, "utf8"))));
  const bundleBySource = new Map(bundles.map((bundle) => [bundle.source_id, bundle]));
  const entries = new Map<string, CatalogEntry>();
  for (const file of files(manifestsDirectory)) {
    const manifest = sourceManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    entries.set(manifest.id, { manifest, mappingBundle: bundleBySource.get(manifest.id) });
  }
  entries.set(primary.manifest.id, primary);
  return createSourceCatalog([...entries.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)));
}

function sameOrigin(context: Context): boolean {
  const origin = context.req.header("origin");
  return !origin || origin === new URL(context.req.url).origin;
}

type ListRequest = { requestedPage: number; pageSize: number; search: string; status: string };

function listRequest(context: Context): ListRequest {
  const requestedPage = Number(context.req.query("page") ?? 1);
  const requestedSize = Number(context.req.query("pageSize") ?? 10);
  const pageSize = Number.isInteger(requestedSize) ? Math.min(Math.max(requestedSize, 1), 100) : 10;
  return {
    requestedPage: Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1,
    pageSize,
    search: (context.req.query("search") ?? "").trim().slice(0, 100),
    status: (context.req.query("status") ?? "").trim().slice(0, 50),
  };
}

function listWhere(request: ListRequest, searchColumns: string[], statusColumn: string): { sql: string; values: string[] } {
  const clauses: string[] = [];
  const values: string[] = [];
  if (request.search) {
    clauses.push(`(${searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`).join(" OR ")})`);
    values.push(...searchColumns.map(() => `%${request.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`));
  }
  if (request.status) {
    clauses.push(`${statusColumn} = ?`);
    values.push(request.status);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

function pageRequest(request: ListRequest, total: number): { page: number; pageSize: number; offset: number; total: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / request.pageSize));
  const page = Math.min(request.requestedPage, pages);
  return { page, pageSize: request.pageSize, offset: (page - 1) * request.pageSize, total, pages };
}

function envelope<T>(requestId: string, payload: T, success = true, message = "OK"): ApiEnvelope<T> {
  return { success, message, payload, meta: { request_id: requestId, generated_at: new Date().toISOString() } };
}
