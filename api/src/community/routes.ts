import { productProposalInputSchema, reactionSchema, submissionInputSchema, translationFeedbackInputSchema, type ProductProposal, type RecipeSubmission, type TranslationFeedback } from "@lanka-pricelens/shared";
import { message, type Message } from "@lanka-pricelens/notify";
import { Hono, type Context } from "hono";

import type { ContentStore } from "../account/content.ts";
import type { Account, AccountErrorCode } from "../account/types.ts";
import { envelope, jsonObject, sameOrigin } from "../http.ts";
import type { OwnerNotifier } from "../notify.ts";
import type { RecipeStore } from "../recipes.ts";
import { CommunityLimitError, type CommunityStore } from "./store.ts";

/**
 * What a signed-in person gives back on the recipe section (docs/community.md), mounted at
 * /v1/account/community behind requireAccount. Reactions need only a session; everything
 * that reaches the owner's review needs a verified address. Each contribution the owner
 * reviews also raises a note through the owner notifier; a failure there never fails the
 * request.
 */

export type CommunityBindings = { Variables: { account: Account; requestId: string } };

export type CommunityDeps = {
  store: CommunityStore;
  /** The account's own recipes, for a recipe submission. */
  content: ContentStore;
  /** The catalogue, to name dishes in notices and to refuse reactions on unknown ones. */
  recipes: RecipeStore | undefined;
  notifier: OwnerNotifier;
  /** Where the notice's link to the admin points. */
  siteOrigin: string | null;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

type FailureStatus = 400 | 403 | 404 | 409 | 413;

function fail(context: Context<CommunityBindings>, status: FailureStatus, message: string, code?: AccountErrorCode | "NOT_FOUND" | "ALREADY_SENT") {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

function issueMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.map(String).join(".") || fallback}: ${issue.message}` : `Invalid ${fallback}`;
}

const dishPattern = /^dish_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

/** The note the owner gets for a contribution: what, who, and where to review it. */
export function communityNotice(kind: "submission" | "request" | "translation" | "proposal", account: Pick<Account, "email" | "display_name">, detail: { title: string; lines: Array<{ text: string; value: string }>; body?: string | undefined }, siteOrigin: string | null): Message {
  const admin = `${(siteOrigin ?? "https://price.prabhavalabs.com").replace(/\/+$/u, "")}/admin/community`;
  const heading = { submission: "Recipe submission", request: "Recipe request", translation: "Translation feedback", proposal: "New ingredient proposed" }[kind];
  return message({
    title: `[PriceLens] ${heading}: ${detail.title.slice(0, 80)}`,
    summary: detail.body ?? `${account.display_name} (${account.email}) sent a ${heading.toLowerCase()}.`,
    severity: "info",
    sections: [{ lines: [{ text: "From", value: `${account.display_name} <${account.email}>` }, ...detail.lines] }],
    actions: [{ label: "Review in the admin", url: admin }],
    tags: ["community", kind],
  });
}

export function communityRoutes(deps: CommunityDeps): Hono<CommunityBindings> {
  const app = new Hono<CommunityBindings>();
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)));
  const dishName = (dishId: string): string | null => deps.recipes?.catalogue.dishes.find((dish) => dish.id === dishId)?.names.en ?? null;
  const notify = (note: Message) => {
    void deps.notifier.notify(note).catch((error: unknown) => log({ level: "warn", message: "Community notice failed", detail: error instanceof Error ? error.message : String(error) }));
  };

  app.use("*", async (context, next) => {
    if (context.req.method !== "GET" && !sameOrigin(context)) return fail(context, 403, "Cross-origin request rejected");
    return next();
  });
  // Everything that reaches the owner's review needs a verified address; a reaction does not.
  app.use("*", async (context, next) => {
    if (context.req.method !== "GET" && !context.req.path.includes("/reactions") && !context.get("account").email_verified_at) return fail(context, 403, "Verify your email address to contribute", "EMAIL_NOT_VERIFIED");
    return next();
  });

  app.get("/reactions", (context) => context.json(envelope(context.get("requestId"), deps.store.reactionsOf(context.get("account").id))));
  app.put("/reactions/:dishId", async (context) => {
    const dishId = (context.req.param("dishId") ?? "").slice(0, 120);
    if (!dishPattern.test(dishId) || (deps.recipes && !deps.recipes.catalogue.dishes.some((dish) => dish.id === dishId))) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = reactionSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "reaction"));
    const score = deps.store.react(context.get("account").id, dishId, parsed.data.value, clock());
    return context.json(envelope(context.get("requestId"), { value: parsed.data.value, ...score }, true, parsed.data.value === "none" ? "Reaction removed" : "Thanks"));
  });

  app.post("/translations", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = translationFeedbackInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "feedback"));
    if (deps.recipes && !deps.recipes.catalogue.dishes.some((dish) => dish.id === parsed.data.dish_id)) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    const account = context.get("account");
    const now = clock();
    if (deps.store.translationFeedbackToday(account.id, parsed.data.dish_id, parsed.data.language, now.toISOString().slice(0, 10))) return fail(context, 409, "You already sent feedback on this translation today", "ALREADY_SENT");
    const feedback: TranslationFeedback = deps.store.addTranslationFeedback(account.id, parsed.data, now);
    const name = dishName(feedback.dish_id) ?? feedback.dish_id;
    notify(communityNotice("translation", account, { title: `${name} (${feedback.language === "si" ? "Sinhala" : "Tamil"}) ${feedback.verdict}`, lines: [{ text: "Recipe", value: name }, { text: "Language", value: feedback.language }, { text: "Verdict", value: feedback.verdict }, ...(feedback.note ? [{ text: "Note", value: feedback.note.slice(0, 200) }] : [])], body: feedback.correction ? `Suggested text:\n${feedback.correction.slice(0, 1500)}` : undefined }, deps.siteOrigin));
    return context.json(envelope(context.get("requestId"), feedback, true, "Thanks, the translation team will look at it"), 201);
  });

  app.get("/submissions", (context) => context.json(envelope(context.get("requestId"), deps.store.listSubmissionsOf(context.get("account").id))));
  app.post("/submissions", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = submissionInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "submission"));
    const account = context.get("account");
    let submission: RecipeSubmission;
    try {
      if (parsed.data.kind === "request") {
        submission = deps.store.addSubmission(account.id, { kind: "request", name: parsed.data.name, notes: parsed.data.notes, source_recipe_id: null, recipe: null }, clock());
      } else {
        const own = deps.content.getRecipe(account.id, parsed.data.source_recipe_id);
        if (!own) return fail(context, 404, "That recipe is not yours or does not exist", "NOT_FOUND");
        const { id: _id, account_id: _account, created_at: _created, updated_at: _updated, ...recipe } = own;
        submission = deps.store.addSubmission(account.id, { kind: "recipe", name: own.name, notes: parsed.data.notes, source_recipe_id: own.id, recipe }, clock());
      }
    } catch (error) {
      if (error instanceof CommunityLimitError) return fail(context, 413, error.message);
      throw error;
    }
    notify(communityNotice(submission.kind === "recipe" ? "submission" : "request", account, { title: submission.name, lines: [{ text: "Kind", value: submission.kind === "recipe" ? "a full recipe from their editor" : "a request" }, ...(submission.notes ? [{ text: "Notes", value: submission.notes.slice(0, 300) }] : [])] }, deps.siteOrigin));
    return context.json(envelope(context.get("requestId"), submission, true, submission.kind === "recipe" ? "Sent for review" : "Request sent"), 201);
  });

  app.get("/products", (context) => context.json(envelope(context.get("requestId"), deps.store.listProposalsOf(context.get("account").id))));
  app.post("/products", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = productProposalInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "ingredient"));
    const account = context.get("account");
    let proposal: ProductProposal;
    try {
      proposal = deps.store.addProposal(account.id, parsed.data, clock());
    } catch (error) {
      if (error instanceof CommunityLimitError) return fail(context, 413, error.message);
      throw error;
    }
    notify(communityNotice("proposal", account, { title: proposal.label, lines: [{ text: "Ingredient", value: proposal.label }, { text: "Kind", value: proposal.category ?? "not said" }, { text: "Unit", value: proposal.unit_hint ?? "not said" }, ...(proposal.note ? [{ text: "Note", value: proposal.note.slice(0, 300) }] : [])] }, deps.siteOrigin));
    return context.json(envelope(context.get("requestId"), proposal, true, "Proposed; it will be listed once reviewed"), 201);
  });

  return app;
}
