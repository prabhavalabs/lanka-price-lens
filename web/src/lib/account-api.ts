import type { AccountLocale, AccountMenu, AccountMenuInput, AccountPreferences, AccountProfile, UserRecipe, UserRecipeInput } from "@lanka-pricelens/shared";

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
  /** Where the browser goes to sign in with Google; the API redirects back to `/account?linked=google` or `/`. */
  googleStartUrl: (returnTo = "/") => `/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`,
};
