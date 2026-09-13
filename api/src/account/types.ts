import type { AccountLocale, AccountPreferences, AccountProfile } from "@lanka-pricelens/shared";

/**
 * The contracts of the accounts system. Every module under api/src/account codes against these
 * types: the store (SQLite, foundry/src/db.ts tables), the service (register, sign in, tokens),
 * the mailer (branded mail through SendGrid), the Google sign-in, and the routes. app.ts mounts
 * the routes; nothing here reaches into app.ts.
 */

export type AccountStatus = "active" | "disabled";

export type Account = {
  id: string;
  email: string;
  email_verified_at: string | null;
  /** Null for an account that only ever signed in with Google. `scrypt$<salt>$<hex>` otherwise (see api/src/auth.ts). */
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  locale: AccountLocale;
  status: AccountStatus;
  failed_login_count: number;
  locked_until: string | null;
  preferences: AccountPreferences;
  created_at: string;
  updated_at: string;
};

export type AccountSession = {
  token_hash: string;
  account_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  address: string | null;
};

export type AccountTokenKind = "verify_email" | "reset_password" | "change_email";

export type AccountToken = {
  token_hash: string;
  account_id: string;
  kind: AccountTokenKind;
  /** For change_email, the new address; null otherwise. */
  payload: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type AccountIdentity = { provider: "google"; subject: string; account_id: string; email: string; created_at: string };

export type AccountListRequest = { search: string; status: AccountStatus | ""; page: number; pageSize: number };

/** Everything the accounts system reads and writes. One implementation on the operational SQLite database. */
export type AccountStore = {
  createAccount: (input: { email: string; passwordHash: string | null; displayName: string; locale?: AccountLocale | undefined; avatarUrl?: string | null | undefined; emailVerified: boolean }, now: Date) => Account;
  findAccountById: (id: string) => Account | undefined;
  findAccountByEmail: (email: string) => Account | undefined;
  updateAccount: (id: string, patch: Partial<Pick<Account, "email" | "email_verified_at" | "password_hash" | "display_name" | "avatar_url" | "locale" | "status" | "preferences">>, now: Date) => Account;
  /** Counts a failed sign-in; locks the account for a while after too many. */
  recordLoginFailure: (id: string, now: Date) => { locked: boolean; locked_until: string | null; attempts_remaining: number };
  recordLoginSuccess: (id: string, now: Date) => void;
  deleteAccount: (id: string) => void;
  countAccounts: () => number;
  listAccounts: (request: AccountListRequest) => { items: Account[]; total: number; page: number; pageSize: number; pages: number };

  /** Returns the raw session token (stored hashed); `ttlSeconds` from now. */
  createSession: (accountId: string, meta: { userAgent: string | null; address: string | null }, ttlSeconds: number, now: Date) => string;
  findSession: (token: string, now: Date) => { account: Account; session: AccountSession } | undefined;
  /** Sliding expiry: pushes a live session's expiry out. */
  extendSession: (tokenHash: string, expiresAt: Date) => void;
  revokeSession: (token: string, now: Date) => void;
  /** Revokes every session of the account except the one whose hash is given; returns how many. */
  revokeSessions: (accountId: string, now: Date, exceptTokenHash?: string | undefined) => number;
  listSessions: (accountId: string, now: Date) => AccountSession[];

  /** Returns the raw token (stored hashed); earlier unused tokens of the same kind for the account are invalidated. */
  createToken: (accountId: string, kind: AccountTokenKind, payload: string | null, ttlSeconds: number, now: Date) => string;
  /** Marks the token used and returns it, or undefined when unknown, used, expired, or of another kind. */
  consumeToken: (token: string, kind: AccountTokenKind, now: Date) => AccountToken | undefined;

  linkIdentity: (identity: Omit<AccountIdentity, "created_at">, now: Date) => AccountIdentity;
  findIdentity: (provider: AccountIdentity["provider"], subject: string) => AccountIdentity | undefined;
  listIdentities: (accountId: string) => AccountIdentity[];
  unlinkIdentity: (accountId: string, provider: AccountIdentity["provider"]) => void;
};

/** Settings the accounts system needs, read from the environment by app.ts. */
export type AccountConfig = {
  /** "https://price.prabhavalabs.com": where links in mail and OAuth redirects point. Read from the request when empty. */
  siteOrigin: string | null;
  cookieName: string;
  /** Session length for "remember me" sign-ins and the sliding renewal window. */
  sessionSeconds: number;
  shortSessionSeconds: number;
  verifyTokenSeconds: number;
  resetTokenSeconds: number;
  google: { clientId: string; clientSecret: string } | null;
  /** Secret for signing the OAuth state cookie; a random value per process when unset. */
  stateSecret: string;
  secureCookies: boolean;
};

export const defaultAccountConfig: Omit<AccountConfig, "siteOrigin" | "google" | "stateSecret" | "secureCookies"> = {
  cookieName: "lpl_session",
  sessionSeconds: 30 * 24 * 3600,
  shortSessionSeconds: 24 * 3600,
  verifyTokenSeconds: 24 * 3600,
  resetTokenSeconds: 60 * 60,
};

/** The branded mail the accounts system sends. Each call renders a template and sends it; failures are returned, never thrown. */
export type AccountMailer = {
  configured: boolean;
  /** Where the mail goes, masked, for logs. */
  describe: () => string;
  verifyEmail: (input: { to: string; name: string; link: string }) => Promise<MailResult>;
  welcome: (input: { to: string; name: string; link: string }) => Promise<MailResult>;
  resetPassword: (input: { to: string; name: string; link: string; expiresMinutes: number }) => Promise<MailResult>;
  passwordChanged: (input: { to: string; name: string; when: string; link: string }) => Promise<MailResult>;
  changeEmail: (input: { to: string; name: string; link: string; newEmail: string }) => Promise<MailResult>;
  emailChanged: (input: { to: string; name: string; newEmail: string; link: string }) => Promise<MailResult>;
  accountDeleted: (input: { to: string; name: string }) => Promise<MailResult>;
};

export type MailResult = { ok: true; reference: string | null } | { ok: false; error: string };

/** What Google tells us about a person after a successful sign-in, verified from the ID token. */
export type GoogleProfile = { subject: string; email: string; email_verified: boolean; name: string | null; picture: string | null; locale: string | null };

/** Turns a stored account into what the site may see. */
export function toProfile(account: Account, identities: AccountIdentity[]): AccountProfile {
  return {
    id: account.id,
    email: account.email,
    email_verified: account.email_verified_at !== null,
    display_name: account.display_name,
    avatar_url: account.avatar_url,
    locale: account.locale,
    preferences: account.preferences,
    identities: identities.map((identity) => identity.provider),
    has_password: account.password_hash !== null,
    created_at: account.created_at,
  };
}

/** Error codes the service raises; routes map them to status codes and wording. */
export type AccountErrorCode =
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "TOKEN_INVALID"
  | "PASSWORD_REQUIRED"
  | "PASSWORD_WRONG"
  | "EMAIL_NOT_VERIFIED"
  | "RATE_LIMITED"
  | "NOT_FOUND";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: AccountErrorCode, message?: string, retryAfterSeconds?: number) {
    super(message ?? code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
