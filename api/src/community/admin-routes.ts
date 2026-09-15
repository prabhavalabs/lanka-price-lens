import { reviewStatuses, submissionKinds, translationStatuses, type Contributor, type ReviewStatus, type SubmissionKind, type TranslationStatus } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";

import type { AccountStore } from "../account/types.ts";
import { envelope, jsonObject } from "../http.ts";
import type { RecipeStore } from "../recipes.ts";
import type { CommunityStore } from "./store.ts";

/**
 * The owner's review of community contributions (docs/community.md), mounted at
 * /v1/admin/community behind requireOwner: counts, paged lists with the contributor beside
 * each row, and the status changes that approve, reject, or mark feedback handled.
 */

export type CommunityAdminBindings = { Variables: { requestId: string } & Partial<{ adminUser: { email: string } }> };

export type CommunityAdminDeps = {
  store: CommunityStore;
  accounts: AccountStore;
  recipes: RecipeStore | undefined;
  now?: (() => Date) | undefined;
};

type Ctx = Context<CommunityAdminBindings>;

function fail(context: Ctx, status: 400 | 404, message: string, code?: string) {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

const isReviewStatus = (value: unknown): value is ReviewStatus => typeof value === "string" && (reviewStatuses as readonly string[]).includes(value);
const isTranslationStatus = (value: unknown): value is TranslationStatus => typeof value === "string" && (translationStatuses as readonly string[]).includes(value);
const isKind = (value: unknown): value is SubmissionKind => typeof value === "string" && (submissionKinds as readonly string[]).includes(value);

function pageRequest(context: Ctx): { page: number; pageSize: number } {
  return { page: Number(context.req.query("page") ?? 1) || 1, pageSize: Number(context.req.query("pageSize") ?? 25) || 25 };
}

export function communityAdminRoutes(deps: CommunityAdminDeps): Hono<CommunityAdminBindings> {
  const app = new Hono<CommunityAdminBindings>();
  const clock = deps.now ?? (() => new Date());
  const reviewer = (context: Ctx): string | null => context.get("adminUser")?.email ?? null;
  const contributor = (accountId: string): Contributor => {
    const account = deps.accounts.findAccountById(accountId);
    return account ? { email: account.email, display_name: account.display_name } : { email: "(deleted account)", display_name: "Unknown" };
  };
  const dishName = (dishId: string): string | null => deps.recipes?.catalogue.dishes.find((dish) => dish.id === dishId)?.names.en ?? null;
  const withContributor = <T extends { account_id: string }>(row: T) => ({ ...row, ...contributor(row.account_id) });

  app.get("/overview", (context) => {
    const totals = deps.store.reactionTotals();
    return context.json(envelope(context.get("requestId"), {
      pending_submissions: deps.store.countSubmissions("pending"),
      new_translations: deps.store.countTranslationFeedback("new"),
      pending_products: deps.store.countProposals("pending"),
      reactions: totals,
    }));
  });

  app.get("/submissions", (context) => {
    const status = context.req.query("status");
    const kind = context.req.query("kind");
    if (status && !isReviewStatus(status)) return fail(context, 400, "status must be pending, approved, or rejected");
    if (kind && !isKind(kind)) return fail(context, 400, "kind must be request or recipe");
    const page = deps.store.listSubmissions({ status: status && isReviewStatus(status) ? status : null, kind: kind && isKind(kind) ? kind : null }, pageRequest(context));
    return context.json(envelope(context.get("requestId"), { ...page, items: page.items.map(withContributor) }));
  });
  app.get("/submissions/:id", (context) => {
    const submission = deps.store.getSubmission((context.req.param("id") ?? "").slice(0, 80));
    if (!submission) return fail(context, 404, "Submission not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), withContributor(submission)));
  });
  app.patch("/submissions/:id", async (context) => {
    const body = await jsonObject(context);
    if (!body || !isReviewStatus(body.status)) return fail(context, 400, "status must be pending, approved, or rejected");
    const note = typeof body.review_note === "string" ? body.review_note.trim().slice(0, 2000) || null : null;
    const submission = deps.store.reviewSubmission((context.req.param("id") ?? "").slice(0, 80), body.status, note, reviewer(context), clock());
    if (!submission) return fail(context, 404, "Submission not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), withContributor(submission), true, `Marked ${submission.status}`));
  });

  app.get("/translations", (context) => {
    const status = context.req.query("status");
    if (status && !isTranslationStatus(status)) return fail(context, 400, "status must be new, reviewed, or applied");
    const page = deps.store.listTranslationFeedback(status && isTranslationStatus(status) ? status : null, pageRequest(context));
    return context.json(envelope(context.get("requestId"), { ...page, items: page.items.map((row) => ({ ...withContributor(row), dish_name: dishName(row.dish_id) })) }));
  });
  app.patch("/translations/:id", async (context) => {
    const body = await jsonObject(context);
    if (!body || !isTranslationStatus(body.status)) return fail(context, 400, "status must be new, reviewed, or applied");
    const feedback = deps.store.setTranslationStatus((context.req.param("id") ?? "").slice(0, 80), body.status, reviewer(context), clock());
    if (!feedback) return fail(context, 404, "Feedback not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), { ...withContributor(feedback), dish_name: dishName(feedback.dish_id) }, true, `Marked ${feedback.status}`));
  });

  app.get("/products", (context) => {
    const status = context.req.query("status");
    if (status && !isReviewStatus(status)) return fail(context, 400, "status must be pending, approved, or rejected");
    const page = deps.store.listProposals(status && isReviewStatus(status) ? status : null, pageRequest(context));
    return context.json(envelope(context.get("requestId"), { ...page, items: page.items.map(withContributor) }));
  });
  app.patch("/products/:id", async (context) => {
    const body = await jsonObject(context);
    if (!body || !isReviewStatus(body.status)) return fail(context, 400, "status must be pending, approved, or rejected");
    const note = typeof body.review_note === "string" ? body.review_note.trim().slice(0, 2000) || null : null;
    const proposal = deps.store.reviewProposal((context.req.param("id") ?? "").slice(0, 80), body.status, note, reviewer(context), clock());
    if (!proposal) return fail(context, 404, "Proposal not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), withContributor(proposal), true, `Marked ${proposal.status}`));
  });

  app.get("/reactions", (context) => {
    const sort = context.req.query("sort");
    const order = sort === "dislikes" || sort === "recent" ? sort : "score";
    const page = deps.store.listDishReactions(order, pageRequest(context));
    return context.json(envelope(context.get("requestId"), { ...page, items: page.items.map((row) => ({ ...row, name: dishName(row.dish_id) })) }));
  });
  app.get("/reactions/:dishId", (context) => {
    const dishId = (context.req.param("dishId") ?? "").slice(0, 120);
    const rows = deps.store.listReactionsOf(dishId).map((row) => ({ ...contributor(row.account_id), value: row.value === 1 ? "up" : "down", updated_at: row.updated_at }));
    return context.json(envelope(context.get("requestId"), { dish_id: dishId, name: dishName(dishId), reactions: rows }));
  });

  return app;
}
