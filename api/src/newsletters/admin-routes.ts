import type { DealsDay } from "@lanka-pricelens/foundry/deals";
import { preferencesSchema } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { MailSender } from "../account/mail.ts";
import { isMailKind, type MailKind } from "../mail/defaults.ts";
import type { RenderedMail } from "../mail/layout.ts";
import { readFields, renderMail, type MailData, type TemplateStore } from "../mail/templates.ts";
import { envelope, jsonObject } from "../http.ts";
import type { RecipeIndexEntry } from "../recipe-views.ts";
import { composeDealsMail, dealsBlocks, type DealsAccess } from "./deals.ts";
import { composeRecipesMail } from "./recipes.ts";
import { NewsletterRunningError, type NewsletterService } from "./service.ts";
import { isNewsletterKind } from "./store.ts";
import { colomboDay, dayWords, isDay } from "./time.ts";

/**
 * The owner's routes, behind requireOwner in app.ts. `mailAdminRoutes` (mounted at
 * /v1/admin/mail) edits the wording of every mail kind, previews it with sample data, and
 * sends the preview to the owner. `newsletterAdminRoutes` (mounted at /v1/admin) runs a
 * newsletter on demand, lists runs, and reads or recomputes today's deals.
 */

export type AdminBindings = { Variables: { requestId: string } & Partial<{ adminUser: { email: string } }> };

type Ctx = Context<AdminBindings>;

const requestIdOf = (context: Ctx): string => context.get("requestId") ?? "unknown";

function fail(context: Ctx, status: 400 | 404 | 409 | 502 | 503, message: string, code?: string) {
  return context.json({ ...envelope(requestIdOf(context), null, false, message), ...(code ? { code } : {}) }, status);
}

export type NewsletterAdminDeps = {
  service: NewsletterService;
  deals?: DealsAccess | undefined;
  now?: (() => Date) | undefined;
};

export function newsletterAdminRoutes(deps: NewsletterAdminDeps): Hono<AdminBindings> {
  const app = new Hono<AdminBindings>();
  const clock = deps.now ?? (() => new Date());

  app.get("/newsletters/runs", (context) => {
    const requested = (context.req.query("kind") ?? "").trim();
    const kind = isNewsletterKind(requested) ? requested : null;
    if (requested && !kind) return fail(context, 400, "kind must be recipes_daily or deals_daily");
    const limit = Number(context.req.query("limit") ?? 20);
    return context.json(envelope(requestIdOf(context), deps.service.listRuns(kind, Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 20)));
  });

  app.post("/newsletters/run", bodyLimit({ maxSize: 4 * 1024 }), async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    if (!isNewsletterKind(body.kind)) return fail(context, 400, "kind must be recipes_daily or deals_daily");
    if (body.day !== undefined && !isDay(body.day)) return fail(context, 400, "day must be YYYY-MM-DD");
    try {
      const outcome = await deps.service.runNewsletter(body.kind, { day: typeof body.day === "string" ? body.day : undefined, trigger: "manual", dryRun: body.dry_run === true, force: body.force === true });
      const { run } = outcome;
      const message = outcome.repeated ? `Already ran for ${run.day} (${run.status}); pass force to run again` : run.status === "dry_run" ? `Dry run: ${run.sent} of ${run.recipients} would be sent` : `${run.status}: ${run.sent} of ${run.recipients} queued`;
      // The admin page lists who a dry run would reach; the report keeps at most five samples with masked addresses.
      const deliveries = run.status === "dry_run" ? (run.report?.samples ?? []) : undefined;
      return context.json(envelope(requestIdOf(context), { ...run, repeated: outcome.repeated, ...(deliveries ? { deliveries } : {}) }, run.status !== "failed", message), run.status === "failed" ? 502 : 200);
    } catch (error) {
      if (error instanceof NewsletterRunningError) return fail(context, 409, error.message, "NEWSLETTER_RUNNING");
      return fail(context, 400, error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/deals/today", (context) => {
    if (!deps.deals) return fail(context, 503, "The deals engine is not configured", "DEALS_UNAVAILABLE");
    const day = deps.deals.latest();
    if (!day) return fail(context, 503, "No deals have been computed yet", "DEALS_UNAVAILABLE");
    return context.json(envelope(requestIdOf(context), day));
  });

  app.post("/deals/compute", bodyLimit({ maxSize: 4 * 1024 }), async (context) => {
    if (!deps.deals) return fail(context, 503, "The deals engine is not configured", "DEALS_UNAVAILABLE");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    if (body.day !== undefined && !isDay(body.day)) return fail(context, 400, "day must be YYYY-MM-DD");
    const day = typeof body.day === "string" ? body.day : colomboDay(clock());
    try {
      const computed = await deps.deals.compute(day);
      if (!computed) return fail(context, 503, "The warehouse is not available", "DEALS_UNAVAILABLE");
      return context.json(envelope(requestIdOf(context), computed, true, `Deals computed for ${computed.day}: ${computed.deals.length} deals, ${computed.essentials.length} essentials`));
    } catch (error) {
      return fail(context, 502, `Deals computation failed: ${error instanceof Error ? error.message : String(error)}`, "DEALS_FAILED");
    }
  });

  return app;
}

export type MailAdminDeps = {
  templates: TemplateStore;
  /** Sends a rendered mail through the account mailer's channel; without it the test route answers 503. */
  send?: MailSender | undefined;
  /** Where test mail goes: the owner's ADMIN_EMAIL, else the mailer's reply address. */
  testAddress: string | null;
  siteOrigin: string | null;
  replyTo?: string | undefined;
  markUrl?: string | undefined;
  recipes?: { index: Map<string, RecipeIndexEntry> } | undefined;
  deals?: DealsAccess | undefined;
  now?: (() => Date) | undefined;
};

/** A deals day for the preview when none has been computed: enough rows to show every block. */
export function sampleDealsDay(day: string): DealsDay {
  const computedAt = `${day}T01:30:00.000Z`;
  return {
    day,
    computed_at: computedAt,
    stores: [
      { market_id: "market_keells_online", label: "Keells", series: 120, deals: 2 },
      { market_id: "market_cargills_online", label: "Cargills", series: 110, deals: 1 },
    ],
    deals: [
      { product_id: "product_big_onion", label: "Big onion", unit: "kg", market_id: "market_keells_online", market: "Keells", now_minor: 37_000, was_minor: 47_000, was_on: day, pct: -21.3, kind: "offer", baseline: "yesterday", url: "/p/product_big_onion" },
      { product_id: "product_potato", label: "Potato", unit: "kg", market_id: "market_cargills_online", market: "Cargills", now_minor: 29_000, was_minor: 33_000, was_on: day, pct: -12.1, kind: "drop", baseline: "median14", url: "/p/product_potato" },
    ],
    cheapest: [{ product_id: "product_chicken", label: "Chicken, whole", unit: "kg", market_id: "market_keells_online", market: "Keells", now_minor: 119_000, was_minor: 142_000, was_on: day, pct: -16.2, kind: "cheapest", baseline: "other_stores", url: "/p/product_chicken" }],
    movers_up: [{ product_id: "product_egg", label: "Eggs", unit: "piece", market_id: "market_cargills_online", market: "Cargills", now_minor: 4_500, was_minor: 3_800, was_on: day, pct: 18.4, kind: "drop", baseline: "yesterday", url: "/p/product_egg" }],
    essentials: [
      { product_id: "product_red_rice", label: "Red rice", unit: "kg", cheapest: { market_id: "market_cargills_online", market: "Cargills", price_minor: 24_500 }, change_pct: -2.4, trend: "flat" },
      { product_id: "product_red_dhal", label: "Red dhal", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells", price_minor: 41_000 }, change_pct: 0, trend: "down" },
      { product_id: "product_coconut", label: "Coconut", unit: "piece", cheapest: { market_id: "market_keells_online", market: "Keells", price_minor: 12_000 }, change_pct: null, trend: "up" },
    ],
    stats: { series: 230, fresh: 214, considered: 190 },
  };
}

/** What the preview of each kind is rendered with: fixed names and links, real recipes when the index has them, today's deals when saved. */
export function sampleMailData(kind: MailKind, deps: Pick<MailAdminDeps, "siteOrigin" | "recipes" | "deals">, now: Date): MailData {
  const origin = (deps.siteOrigin ?? "https://price.prabhavalabs.com").replace(/\/+$/u, "");
  const day = colomboDay(now);
  const unsubscribe = `${origin}/v1/newsletter/unsubscribe?token=sample`;
  const account = { id: "account_sample", display_name: "Amal", preferences: preferencesSchema.parse({}) };
  switch (kind) {
    case "recipes_daily": {
      const composed = deps.recipes ? composeRecipesMail(account, day, [], { index: deps.recipes.index, siteOrigin: origin, cost: (entry) => (entry.dish.popularity === 1 ? 145 : 210) }, unsubscribe) : null;
      if (composed) return composed.data;
      // No catalogue on this machine: fixed cards, so the layout can still be seen.
      const cards = [
        { image: `${origin}/og/r/dish_parippu.png`, name: "Dhal curry", summary: "Red lentils simmered in coconut milk with turmeric and a tempered onion finish.", kcal: 281, minutes: 35, cost: "Rs 95 per serving", url: `${origin}/r/dish_parippu` },
        { image: `${origin}/og/r/dish_pol_sambol.png`, name: "Pol sambol", summary: "Freshly grated coconut pounded with chilli, onion, lime, and Maldive fish.", kcal: 160, minutes: 15, cost: "Rs 60 per serving", url: `${origin}/r/dish_pol_sambol` },
        { image: `${origin}/og/r/dish_chicken_curry.png`, name: "Chicken curry", summary: "Chicken pieces braised in a roasted curry powder gravy finished with thick coconut milk.", kcal: 420, minutes: 60, cost: "Rs 310 per serving", url: `${origin}/r/dish_chicken_curry` },
      ];
      return { values: { name: "Amal", date: dayWords(day), count: "three", link: `${origin}/recipes` }, blocks: [{ type: "recipes", heading: null, cards }], unsubscribeUrl: unsubscribe };
    }
    case "deals_daily": {
      const dealsDay = deps.deals?.latest() ?? sampleDealsDay(day);
      const composed = composeDealsMail(account, dealsDay, { siteOrigin: origin }, unsubscribe);
      if (composed) return composed.data;
      return { values: { name: "Amal", date: dayWords(dealsDay.day), count: 0, stores: "the supermarkets", link: `${origin}/deals` }, blocks: dealsBlocks(dealsDay, origin), unsubscribeUrl: unsubscribe };
    }
    case "reset_password":
      return { values: { name: "Amal", link: `${origin}/account/reset?token=sample`, minutes: 60 } };
    case "password_changed":
      return { values: { name: "Amal", when: `${dayWords(day)} at 09:15`, link: `${origin}/account/forgot` } };
    case "change_email":
      return { values: { name: "Amal", link: `${origin}/account/confirm-email?token=sample`, new_email: "amal.new@example.com" } };
    case "email_changed":
      return { values: { name: "Amal", new_email: "amal.new@example.com", link: `${origin}/about` } };
    case "welcome":
      return { values: { name: "Amal", link: `${origin}/` } };
    case "account_deleted":
      return { values: { name: "Amal" } };
    case "verify_email":
      return { values: { name: "Amal", link: `${origin}/account/verify?token=sample` } };
  }
}

export function mailAdminRoutes(deps: MailAdminDeps): Hono<AdminBindings> {
  const app = new Hono<AdminBindings>();
  const clock = deps.now ?? (() => new Date());
  const kindOf = (context: Ctx): MailKind | null => {
    const kind = context.req.param("kind");
    return isMailKind(kind) ? kind : null;
  };
  const preview = (kind: MailKind, overrides: unknown): RenderedMail => {
    const stored = deps.templates.get(kind).fields;
    const fields = { ...stored, ...readFields(overrides) };
    return renderMail(kind, sampleMailData(kind, deps, clock()), { fields, markUrl: deps.markUrl, replyTo: deps.replyTo, siteOrigin: deps.siteOrigin });
  };

  app.get("/templates", (context) => context.json(envelope(requestIdOf(context), deps.templates.list())));

  app.get("/templates/:kind", (context) => {
    const kind = kindOf(context);
    if (!kind) return fail(context, 404, "Unknown mail kind", "NOT_FOUND");
    return context.json(envelope(requestIdOf(context), deps.templates.get(kind)));
  });

  app.put("/templates/:kind", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const kind = kindOf(context);
    if (!kind) return fail(context, 404, "Unknown mail kind", "NOT_FOUND");
    const body = await jsonObject(context);
    if (!body || typeof body.fields !== "object" || body.fields === null) return fail(context, 400, "Body must be JSON with a fields object");
    const fields = readFields(body.fields);
    for (const value of Object.values(fields)) if (value.length > 4000) return fail(context, 400, "A field may hold up to 4,000 characters");
    const saved = deps.templates.put(kind, fields, context.get("adminUser")?.email ?? null);
    return context.json(envelope(requestIdOf(context), saved, true, saved.edited ? "Template saved" : "Template matches the defaults"));
  });

  app.delete("/templates/:kind", (context) => {
    const kind = kindOf(context);
    if (!kind) return fail(context, 404, "Unknown mail kind", "NOT_FOUND");
    return context.json(envelope(requestIdOf(context), deps.templates.reset(kind), true, "Template reset to defaults"));
  });

  app.post("/templates/:kind/preview", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const kind = kindOf(context);
    if (!kind) return fail(context, 404, "Unknown mail kind", "NOT_FOUND");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    return context.json(envelope(requestIdOf(context), preview(kind, body.fields)));
  });

  app.post("/templates/:kind/test", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const kind = kindOf(context);
    if (!kind) return fail(context, 404, "Unknown mail kind", "NOT_FOUND");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    if (!deps.send || !deps.testAddress) return fail(context, 503, "Mail is not configured: set LPL_RESEND_API_KEY, LPL_MAIL_FROM, and ADMIN_EMAIL", "MAIL_NOT_CONFIGURED");
    const rendered = preview(kind, body.fields);
    const result = await deps.send(deps.testAddress, { ...rendered, subject: `[Test] ${rendered.subject}` });
    if (!result.ok) return fail(context, result.error === "MAIL_NOT_CONFIGURED" ? 503 : 502, `Test mail failed: ${result.error}`, result.error === "MAIL_NOT_CONFIGURED" ? "MAIL_NOT_CONFIGURED" : "MAIL_FAILED");
    return context.json(envelope(requestIdOf(context), { ok: true, reference: result.reference, to: deps.testAddress }, true, `Test mail sent to ${deps.testAddress}`));
  });

  return app;
}
