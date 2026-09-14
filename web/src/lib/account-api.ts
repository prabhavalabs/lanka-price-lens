import type { AccountLocale, AccountMenu, AccountMenuInput, AccountPreferences, AccountProfile, ProductProposal, ProductProposalInput, ReactionValue, RecipeScore, RecipeSubmission, SubmissionInput, TranslationFeedback, TranslationFeedbackInput, UserRecipe, UserRecipeInput, WatchAlert, WatchEntry, WatchItem } from "@lanka-pricelens/shared";

import { describeFailure, type Envelope } from "./api.ts";

/**
 * The account routes as the site calls them. Every state-changing call is a same-origin JSON
 * POST/PATCH/PUT/DELETE with the session cookie; the API answers the usual envelope. A 401 means
 * signed out, a 403 with code EMAIL_NOT_VERIFIED means the address still needs verifying.
 */

/** A live session as the profile page lists it; the API never sends the token itself. */
export type AccountSessionSummary = { id: string; created_at: string; expires_at: string; user_agent: string | null; address: string | null; current: boolean };

/** A row of the recipe list: the recipe's own columns plus what the cards show without loading it. */
export type UserRecipeSummary = Pick<UserRecipe, "id" | "account_id" | "name" | "category" | "visibility" | "created_at" | "updated_at" | "base_servings" | "summary"> & { ingredient_count: number; minutes: number };

/** The account's thumb on a dish, as the reactions map holds it; a dish it has not reacted to is simply absent. */
export type OwnReaction = Exclude<ReactionValue, "none">;

/** The answer to setting a reaction: the account's value and the dish's counts as they now stand. */
export type ReactionAnswer = { value: ReactionValue } & RecipeScore;

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}), credentials: "same-origin" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw describeFailure(0, null);
  }
  const envelope = (await response.json().catch(() => null)) as (Envelope<T> & { code?: string }) | null;
  if (!response.ok || !envelope || envelope.success === false) throw new AccountApiError(response.status, envelope?.message ?? describeFailure(response.status, null).message, envelope?.code ?? null);
  return envelope.payload;
}

export const accountApi = {
  me: (signal?: AbortSignal) => call<AccountProfile>("GET", "/v1/account/me", undefined, signal),
  register: (input: { email: string; password: string; display_name: string }) => call<AccountProfile>("POST", "/v1/account/register", input),
  login: (input: { email: string; password: string; remember: boolean }) => call<AccountProfile>("POST", "/v1/account/login", input),
  logout: () => call<null>("POST", "/v1/account/logout", {}),
  /** Any subset of the profile; a partial `preferences` (a switch, the diet, the goals) is merged with the rest on the server. */
  updateProfile: (input: { display_name?: string; locale?: AccountLocale; preferences?: Partial<AccountPreferences> }) => call<AccountProfile>("PATCH", "/v1/account/me", input),
  verifyEmail: (token: string) => call<AccountProfile>("POST", "/v1/account/verify-email", { token }),
  resendVerification: () => call<null>("POST", "/v1/account/resend-verification", {}),
  forgotPassword: (email: string) => call<null>("POST", "/v1/account/forgot-password", { email }),
  resetPassword: (input: { token: string; password: string }) => call<AccountProfile>("POST", "/v1/account/reset-password", input),
  changePassword: (input: { current_password: string; new_password: string }) => call<null>("POST", "/v1/account/change-password", input),
  changeEmail: (input: { new_email: string; password: string }) => call<null>("POST", "/v1/account/change-email", input),
  confirmEmail: (token: string) => call<AccountProfile>("POST", "/v1/account/confirm-email", { token }),
  deleteAccount: (input: { password?: string; confirm: "DELETE" }) => call<null>("DELETE", "/v1/account/me", input),
  sessions: {
    list: (signal?: AbortSignal) => call<AccountSessionSummary[]>("GET", "/v1/account/sessions", undefined, signal),
    /** Signs every other device out; answers how many sessions went. */
    revokeOthers: () => call<{ revoked: number }>("POST", "/v1/account/sessions/revoke-others", {}),
  },
  watchlist: {
    list: (signal?: AbortSignal) => call<{ items: WatchEntry[]; total: number; limit: number; priced: boolean }>("GET", "/v1/account/watchlist", undefined, signal),
    add: (productId: string, alert?: WatchAlert) => call<WatchItem>("PUT", `/v1/account/watchlist/${encodeURIComponent(productId)}`, alert ? { alert } : {}),
    update: (productId: string, alert: WatchAlert) => call<WatchItem>("PATCH", `/v1/account/watchlist/${encodeURIComponent(productId)}`, { alert }),
    remove: (productId: string) => call<null>("DELETE", `/v1/account/watchlist/${encodeURIComponent(productId)}`),
  },
  menus: {
    list: (signal?: AbortSignal) => call<{ items: AccountMenu[]; total: number; limit: number }>("GET", "/v1/account/menus", undefined, signal),
    get: (id: string, signal?: AbortSignal) => call<AccountMenu>("GET", `/v1/account/menus/${encodeURIComponent(id)}`, undefined, signal),
    create: (input: AccountMenuInput) => call<AccountMenu>("POST", "/v1/account/menus", input),
    update: (id: string, input: AccountMenuInput) => call<AccountMenu>("PUT", `/v1/account/menus/${encodeURIComponent(id)}`, input),
    remove: (id: string) => call<null>("DELETE", `/v1/account/menus/${encodeURIComponent(id)}`),
  },
  recipes: {
    list: (signal?: AbortSignal) => call<{ items: UserRecipeSummary[]; total: number; limit: number }>("GET", "/v1/account/recipes", undefined, signal),
    get: (id: string, servings?: number, signal?: AbortSignal) => call<UserRecipe & { view: unknown }>("GET", `/v1/account/recipes/${encodeURIComponent(id)}${servings ? `?servings=${servings}` : ""}`, undefined, signal),
    create: (input: UserRecipeInput) => call<UserRecipe>("POST", "/v1/account/recipes", input),
    update: (id: string, input: UserRecipeInput) => call<UserRecipe>("PUT", `/v1/account/recipes/${encodeURIComponent(id)}`, input),
    remove: (id: string) => call<null>("DELETE", `/v1/account/recipes/${encodeURIComponent(id)}`),
  },
  /**
   * What a signed-in person gives back on the recipes (docs/community.md). A reaction needs only a
   * session; everything the owner reviews needs a verified address (403 EMAIL_NOT_VERIFIED).
   */
  community: {
    reactions: {
      list: (signal?: AbortSignal) => call<Record<string, OwnReaction>>("GET", "/v1/account/community/reactions", undefined, signal),
      /** Sets or switches the account's thumb; "none" removes it. Answers the dish's new counts. */
      set: (dishId: string, value: ReactionValue) => call<ReactionAnswer>("PUT", `/v1/account/community/reactions/${encodeURIComponent(dishId)}`, { value }),
    },
    translations: {
      list: (signal?: AbortSignal) => call<TranslationFeedback[]>("GET", "/v1/account/community/translations", undefined, signal),
      /** One verdict per dish and language a day; a second the same day answers 409 ALREADY_SENT. */
      send: (input: TranslationFeedbackInput) => call<TranslationFeedback>("POST", "/v1/account/community/translations", input),
    },
    submissions: {
      /** The account's requests and submitted recipes, newest first, without the recipe JSON. */
      list: (signal?: AbortSignal) => call<RecipeSubmission[]>("GET", "/v1/account/community/submissions", undefined, signal),
      /** A request by name, or one of the account's own recipes by id; 413 at the open limit. */
      send: (input: SubmissionInput) => call<RecipeSubmission>("POST", "/v1/account/community/submissions", input),
    },
    products: {
      list: (signal?: AbortSignal) => call<ProductProposal[]>("GET", "/v1/account/community/products", undefined, signal),
      send: (input: ProductProposalInput) => call<ProductProposal>("POST", "/v1/account/community/products", input),
    },
  },
  /** Where the browser goes to sign in with Google; the API redirects back to `/account?linked=google` or `/`. */
  googleStartUrl: (returnTo = "/") => `/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`,
};
