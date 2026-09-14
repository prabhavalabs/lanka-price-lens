import { newId, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { openSubmissionLimit, pendingProposalLimit, scoreOf, userRecipeInputSchema, type ProductProposal, type ProductProposalInput, type ReactionValue, type RecipeScore, type RecipeSubmission, type ReviewStatus, type SubmissionKind, type TranslationFeedback, type TranslationFeedbackInput, type TranslationStatus, type UserRecipeInput } from "@lanka-pricelens/shared";

/**
 * The community tables (docs/community.md): reactions, translation feedback, submissions,
 * and product proposals, over the operational SQLite. Reads are plain rows; the admin joins
 * the account for the contributor. Scores are computed on read, never stored.
 */

export class CommunityLimitError extends Error {}

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; pages: number };
export type PageRequest = { page?: number | undefined; pageSize?: number | undefined };

export type ReactionRow = { account_id: string; dish_id: string; value: 1 | -1; updated_at: string };
export type DishReactions = { dish_id: string; likes: number; dislikes: number; score: number; last_at: string };

export type CommunityStore = {
  /** Sets, switches, or removes (value "none") the account's reaction; answers the dish's new counts. */
  react: (accountId: string, dishId: string, value: ReactionValue, now: Date) => RecipeScore;
  /** The account's reactions, dish id to "up" or "down". */
  reactionsOf: (accountId: string) => Record<string, "up" | "down">;
  scoresFor: (dishIds: string[]) => Map<string, RecipeScore>;
  /** Every dish with a reaction, for the admin: the requested order, paged. */
  listDishReactions: (sort: "score" | "dislikes" | "recent", request: PageRequest) => Page<DishReactions>;
  listReactionsOf: (dishId: string) => ReactionRow[];
  reactionTotals: () => { likes: number; dislikes: number; dishes: number };

  addTranslationFeedback: (accountId: string, input: TranslationFeedbackInput, now: Date) => TranslationFeedback;
  /** True when the account already gave feedback on this dish and language today. */
  translationFeedbackToday: (accountId: string, dishId: string, language: string, day: string) => boolean;
  listTranslationFeedback: (status: TranslationStatus | null, request: PageRequest) => Page<TranslationFeedback>;
  listTranslationFeedbackOf: (accountId: string) => TranslationFeedback[];
  setTranslationStatus: (id: string, status: TranslationStatus, by: string | null, now: Date) => TranslationFeedback | undefined;
  countTranslationFeedback: (status: TranslationStatus) => number;

  /** Throws CommunityLimitError at the account's open-submission limit. */
  addSubmission: (accountId: string, submission: { kind: SubmissionKind; name: string; notes: string | null; source_recipe_id: string | null; recipe: UserRecipeInput | null }, now: Date) => RecipeSubmission;
  listSubmissionsOf: (accountId: string) => RecipeSubmission[];
  listSubmissions: (filter: { status: ReviewStatus | null; kind: SubmissionKind | null }, request: PageRequest) => Page<RecipeSubmission>;
  getSubmission: (id: string) => RecipeSubmission | undefined;
  reviewSubmission: (id: string, status: ReviewStatus, note: string | null, by: string | null, now: Date) => RecipeSubmission | undefined;
  countSubmissions: (status: ReviewStatus) => number;

  /** Throws CommunityLimitError at the account's pending-proposal limit. */
  addProposal: (accountId: string, input: ProductProposalInput, now: Date) => ProductProposal;
  listProposalsOf: (accountId: string) => ProductProposal[];
  listProposals: (status: ReviewStatus | null, request: PageRequest) => Page<ProductProposal>;
  reviewProposal: (id: string, status: ReviewStatus, note: string | null, by: string | null, now: Date) => ProductProposal | undefined;
  countProposals: (status: ReviewStatus) => number;
};

type FeedbackRow = { id: string; account_id: string; dish_id: string; language: "si" | "ta"; verdict: "correct" | "incorrect"; correction: string | null; note: string | null; status: TranslationStatus; created_at: string; reviewed_at: string | null; reviewed_by: string | null };
type SubmissionRow = { id: string; account_id: string; kind: SubmissionKind; name: string; notes: string | null; source_recipe_id: string | null; recipe_json: string | null; status: ReviewStatus; review_note: string | null; created_at: string; updated_at: string; reviewed_at: string | null; reviewed_by: string | null };
type ProposalRow = { id: string; account_id: string; label: string; category: string | null; unit_hint: ProductProposal["unit_hint"]; note: string | null; status: ReviewStatus; review_note: string | null; created_at: string; reviewed_at: string | null; reviewed_by: string | null };

const feedbackColumns = "id, account_id, dish_id, language, verdict, correction, note, status, created_at, reviewed_at, reviewed_by";
const submissionColumns = "id, account_id, kind, name, notes, source_recipe_id, status, review_note, created_at, updated_at, reviewed_at, reviewed_by";
const proposalColumns = "id, account_id, label, category, unit_hint, note, status, review_note, created_at, reviewed_at, reviewed_by";

function pageOf(request: PageRequest): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(100, Math.max(1, Math.floor(request.pageSize ?? 25) || 25));
  const page = Math.max(1, Math.floor(request.page ?? 1) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function recipeOf(json: string | null): UserRecipeInput | null {
  if (!json) return null;
  try {
    const parsed = userRecipeInputSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const toSubmission = (row: SubmissionRow, withRecipe: boolean): RecipeSubmission => ({
  id: row.id,
  account_id: row.account_id,
  kind: row.kind,
  name: row.name,
  notes: row.notes,
  source_recipe_id: row.source_recipe_id,
  recipe: withRecipe ? recipeOf(row.recipe_json) : null,
  status: row.status,
  review_note: row.review_note,
  created_at: row.created_at,
  updated_at: row.updated_at,
  reviewed_at: row.reviewed_at,
  reviewed_by: row.reviewed_by,
});

export function createCommunityStore(database: OperationalDatabase): CommunityStore {
  const scoresFor = (dishIds: string[]): Map<string, RecipeScore> => {
    const ids = [...new Set(dishIds)];
    const scores = new Map<string, RecipeScore>();
    if (!ids.length) return scores;
    const placeholders = ids.map(() => "?").join(", ");
    const rows = database.prepare(`SELECT dish_id, SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS likes, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS dislikes FROM recipe_reaction WHERE dish_id IN (${placeholders}) GROUP BY dish_id`).all(...ids) as Array<{ dish_id: string; likes: number; dislikes: number }>;
    for (const row of rows) scores.set(row.dish_id, { likes: row.likes, dislikes: row.dislikes, score: scoreOf(row.likes, row.dislikes) });
    return scores;
  };
  const scoreOfDish = (dishId: string): RecipeScore => scoresFor([dishId]).get(dishId) ?? { likes: 0, dislikes: 0, score: 0 };

  const getFeedback = (id: string): TranslationFeedback | undefined => database.prepare(`SELECT ${feedbackColumns} FROM translation_feedback WHERE id = ?`).get(id) as FeedbackRow | undefined;
  const getSubmissionRow = (id: string): SubmissionRow | undefined => database.prepare(`SELECT ${submissionColumns}, recipe_json FROM recipe_submission WHERE id = ?`).get(id) as SubmissionRow | undefined;
  const getProposal = (id: string): ProductProposal | undefined => database.prepare(`SELECT ${proposalColumns} FROM product_proposal WHERE id = ?`).get(id) as ProposalRow | undefined;

  return {
    react: (accountId, dishId, value, now) => {
      const stamp = now.toISOString();
      if (value === "none") {
        database.prepare("DELETE FROM recipe_reaction WHERE account_id = ? AND dish_id = ?").run(accountId, dishId);
      } else {
        database
          .prepare("INSERT INTO recipe_reaction (account_id, dish_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account_id, dish_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .run(accountId, dishId, value === "up" ? 1 : -1, stamp, stamp);
      }
      return scoreOfDish(dishId);
    },
    reactionsOf: (accountId) => {
      const reactions: Record<string, "up" | "down"> = {};
      for (const row of database.prepare("SELECT dish_id, value FROM recipe_reaction WHERE account_id = ?").all(accountId) as Array<{ dish_id: string; value: number }>) reactions[row.dish_id] = row.value === 1 ? "up" : "down";
      return reactions;
    },
    scoresFor,
    listDishReactions: (sort, request) => {
      const { page, pageSize, offset } = pageOf(request);
      const order = sort === "dislikes" ? "dislikes DESC, likes DESC" : sort === "recent" ? "last_at DESC" : "score DESC, likes DESC";
      const total = (database.prepare("SELECT COUNT(DISTINCT dish_id) AS count FROM recipe_reaction").get() as { count: number }).count;
      const rows = database
        .prepare(`SELECT dish_id, likes, dislikes, MAX(likes - dislikes, 0) AS score, last_at FROM (SELECT dish_id, SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS likes, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS dislikes, MAX(updated_at) AS last_at FROM recipe_reaction GROUP BY dish_id) ORDER BY ${order}, dish_id LIMIT ? OFFSET ?`)
        .all(pageSize, offset) as DishReactions[];
      return { items: rows, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    listReactionsOf: (dishId) => database.prepare("SELECT account_id, dish_id, value, updated_at FROM recipe_reaction WHERE dish_id = ? ORDER BY updated_at DESC").all(dishId) as ReactionRow[],
    reactionTotals: () => database.prepare("SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS likes, COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS dislikes, COUNT(DISTINCT dish_id) AS dishes FROM recipe_reaction").get() as { likes: number; dislikes: number; dishes: number },

    addTranslationFeedback: (accountId, input, now) => {
      const id = newId("tfb");
      database
        .prepare("INSERT INTO translation_feedback (id, account_id, dish_id, language, verdict, correction, note, status, created_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, NULL, NULL)")
        .run(id, accountId, input.dish_id, input.language, input.verdict, input.correction, input.note, now.toISOString());
      return getFeedback(id)!;
    },
    translationFeedbackToday: (accountId, dishId, language, day) => (database.prepare("SELECT COUNT(*) AS count FROM translation_feedback WHERE account_id = ? AND dish_id = ? AND language = ? AND created_at >= ?").get(accountId, dishId, language, `${day}T00:00:00`) as { count: number }).count > 0,
    listTranslationFeedback: (status, request) => {
      const { page, pageSize, offset } = pageOf(request);
      const where = status ? "WHERE status = ?" : "";
      const params = status ? [status] : [];
      const total = (database.prepare(`SELECT COUNT(*) AS count FROM translation_feedback ${where}`).get(...params) as { count: number }).count;
      const items = database.prepare(`SELECT ${feedbackColumns} FROM translation_feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as FeedbackRow[];
      return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    listTranslationFeedbackOf: (accountId) => database.prepare(`SELECT ${feedbackColumns} FROM translation_feedback WHERE account_id = ? ORDER BY created_at DESC`).all(accountId) as FeedbackRow[],
    setTranslationStatus: (id, status, by, now) => {
      const changed = database.prepare("UPDATE translation_feedback SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(status, status === "new" ? null : now.toISOString(), status === "new" ? null : by, id).changes;
      return changed ? getFeedback(id) : undefined;
    },
    countTranslationFeedback: (status) => (database.prepare("SELECT COUNT(*) AS count FROM translation_feedback WHERE status = ?").get(status) as { count: number }).count,

    addSubmission: (accountId, submission, now) => {
      const open = (database.prepare("SELECT COUNT(*) AS count FROM recipe_submission WHERE account_id = ? AND status = 'pending'").get(accountId) as { count: number }).count;
      if (open >= openSubmissionLimit) throw new CommunityLimitError(`You already have ${openSubmissionLimit} submissions waiting for review`);
      const id = newId("sub");
      const stamp = now.toISOString();
      database
        .prepare("INSERT INTO recipe_submission (id, account_id, kind, name, notes, source_recipe_id, recipe_json, status, review_note, created_at, updated_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, NULL)")
        .run(id, accountId, submission.kind, submission.name, submission.notes, submission.source_recipe_id, submission.recipe ? JSON.stringify(submission.recipe) : null, stamp, stamp);
      return toSubmission(getSubmissionRow(id)!, true);
    },
    listSubmissionsOf: (accountId) => (database.prepare(`SELECT ${submissionColumns}, NULL AS recipe_json FROM recipe_submission WHERE account_id = ? ORDER BY created_at DESC`).all(accountId) as SubmissionRow[]).map((row) => toSubmission(row, false)),
    listSubmissions: (filter, request) => {
      const { page, pageSize, offset } = pageOf(request);
      const conditions: string[] = [];
      const params: string[] = [];
      if (filter.status) {
        conditions.push("status = ?");
        params.push(filter.status);
      }
      if (filter.kind) {
        conditions.push("kind = ?");
        params.push(filter.kind);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const total = (database.prepare(`SELECT COUNT(*) AS count FROM recipe_submission ${where}`).get(...params) as { count: number }).count;
      const items = (database.prepare(`SELECT ${submissionColumns}, NULL AS recipe_json FROM recipe_submission ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as SubmissionRow[]).map((row) => toSubmission(row, false));
      return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    getSubmission: (id) => {
      const row = getSubmissionRow(id);
      return row ? toSubmission(row, true) : undefined;
    },
    reviewSubmission: (id, status, note, by, now) => {
      const stamp = now.toISOString();
      const changed = database.prepare("UPDATE recipe_submission SET status = ?, review_note = ?, updated_at = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(status, note, stamp, status === "pending" ? null : stamp, status === "pending" ? null : by, id).changes;
      if (!changed) return undefined;
      const row = getSubmissionRow(id);
      return row ? toSubmission(row, true) : undefined;
    },
    countSubmissions: (status) => (database.prepare("SELECT COUNT(*) AS count FROM recipe_submission WHERE status = ?").get(status) as { count: number }).count,

    addProposal: (accountId, input, now) => {
      const pending = (database.prepare("SELECT COUNT(*) AS count FROM product_proposal WHERE account_id = ? AND status = 'pending'").get(accountId) as { count: number }).count;
      if (pending >= pendingProposalLimit) throw new CommunityLimitError(`You already have ${pendingProposalLimit} ingredients waiting for review`);
      const id = newId("prop");
      database
        .prepare("INSERT INTO product_proposal (id, account_id, label, category, unit_hint, note, status, review_note, created_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL)")
        .run(id, accountId, input.label, input.category, input.unit_hint, input.note, now.toISOString());
      return getProposal(id)!;
    },
    listProposalsOf: (accountId) => database.prepare(`SELECT ${proposalColumns} FROM product_proposal WHERE account_id = ? ORDER BY created_at DESC`).all(accountId) as ProposalRow[],
    listProposals: (status, request) => {
      const { page, pageSize, offset } = pageOf(request);
      const where = status ? "WHERE status = ?" : "";
      const params = status ? [status] : [];
      const total = (database.prepare(`SELECT COUNT(*) AS count FROM product_proposal ${where}`).get(...params) as { count: number }).count;
      const items = database.prepare(`SELECT ${proposalColumns} FROM product_proposal ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as ProposalRow[];
      return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
    },
    reviewProposal: (id, status, note, by, now) => {
      const changed = database.prepare("UPDATE product_proposal SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(status, note, status === "pending" ? null : now.toISOString(), status === "pending" ? null : by, id).changes;
      return changed ? getProposal(id) : undefined;
    },
    countProposals: (status) => (database.prepare("SELECT COUNT(*) AS count FROM product_proposal WHERE status = ?").get(status) as { count: number }).count,
  };
}
