import { createHash, randomBytes, scryptSync } from "node:crypto";

import { preferencesSchema, type AccountLocale, type AccountPreferences, type AccountProfile } from "@lanka-pricelens/shared";

import { verifyPassword } from "../auth.ts";
import { AccountError, toProfile, type Account, type AccountConfig, type AccountMailer, type AccountStore, type MailResult } from "./types.ts";
import { lockoutSeconds } from "./store.ts";

/**
 * The rules of the accounts system, on top of the store and the mailer: who may register, what a
 * sign-in answers, when a token is minted and what consuming it changes, and which mail goes out.
 * Every failure is an AccountError with a code the routes translate; mail never fails a request.
 */

export type SessionMeta = { userAgent: string | null; address: string | null };

/** What a sign-in hands the route: the account, its profile, and the raw session token to put in the cookie. */
export type SignedIn = { account: Account; profile: AccountProfile; sessionToken: string; ttlSeconds: number };

/** What PATCH /me may change: the shape of `profilePatchSchema`'s output. */
export type ProfilePatch = { display_name?: string | undefined; locale?: AccountLocale | undefined; preferences?: { [K in keyof AccountPreferences]?: AccountPreferences[K] | undefined } | undefined };

/** A live session as the profile page sees it: no token, no hash, just where and when. */
export type SessionView = { id: string; created_at: string; expires_at: string; user_agent: string | null; address: string | null; current: boolean };

export type AccountServiceDeps = {
  store: AccountStore;
  mailer: AccountMailer;
  config: AccountConfig;
  /** The clock, replaceable in tests. */
  now?: (() => Date) | undefined;
  /** Where mail failures are written, one JSON line each; console.error by default. */
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

/** Hashes a password the way the admin login does: `scrypt$<salt>$<hex>` with a random 16-byte salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

/** A hash to verify against when there is no account or no password, so the answer takes as long either way. */
const dummySalt = "00000000000000000000000000000000";
const dummyPasswordHash = `scrypt$${dummySalt}$${scryptSync("invalid-password", dummySalt, 64).toString("hex")}`;

/** Pages on the site that mail links to; the pages post the token to the matching route. */
export const mailLinks = {
  verify: (origin: string, token: string) => `${origin}/account/verify?token=${encodeURIComponent(token)}`,
  reset: (origin: string, token: string) => `${origin}/account/reset?token=${encodeURIComponent(token)}`,
  confirmEmail: (origin: string, token: string) => `${origin}/account/confirm-email?token=${encodeURIComponent(token)}`,
  welcome: (origin: string) => `${origin}/`,
  /** After a password change: the way back in when it was not the person. */
  passwordChanged: (origin: string) => `${origin}/account/forgot`,
  /** After an address change, to the old address: where to reach us when it was not the person. */
  emailChanged: (origin: string) => `${origin}/about`,
};

export function createAccountService(deps: AccountServiceDeps) {
  const { store, mailer, config } = deps;
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.error(JSON.stringify(line)));

  /** Sends one mail and records a failure without letting it reach the request. */
  const deliver = async (kind: string, to: string, send: () => Promise<MailResult>): Promise<void> => {
    try {
      const result = await send();
      if (!result.ok) log({ level: "error", message: "Account mail failed", kind, to: maskAddress(to), detail: result.error });
    } catch (error) {
      log({ level: "error", message: "Account mail failed", kind, to: maskAddress(to), detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const profileOf = (account: Account): AccountProfile => toProfile(account, store.listIdentities(account.id));

  const requireAccount = (id: string): Account => {
    const account = store.findAccountById(id);
    if (!account) throw new AccountError("NOT_FOUND", "Account not found");
    return account;
  };

  const startSession = (account: Account, meta: SessionMeta, remember: boolean, now: Date): SignedIn => {
    const ttlSeconds = remember ? config.sessionSeconds : config.shortSessionSeconds;
    const sessionToken = store.createSession(account.id, meta, ttlSeconds, now);
    return { account, profile: profileOf(account), sessionToken, ttlSeconds };
  };

  const sendVerification = async (account: Account, origin: string, now: Date): Promise<void> => {
    const token = store.createToken(account.id, "verify_email", null, config.verifyTokenSeconds, now);
    await deliver("verify_email", account.email, () => mailer.verifyEmail({ to: account.email, name: account.display_name, link: mailLinks.verify(origin, token) }));
  };

  const sendPasswordChanged = async (account: Account, origin: string, now: Date): Promise<void> => {
    await deliver("password_changed", account.email, () => mailer.passwordChanged({ to: account.email, name: account.display_name, when: now.toISOString(), link: mailLinks.passwordChanged(origin) }));
  };

  /** The password check for a signed-in person changing something sensitive: wrong, or absent on a Google-only account. */
  const checkPassword = (account: Account, password: string): void => {
    if (account.password_hash === null || !verifyPassword(password, account.password_hash)) throw new AccountError("PASSWORD_WRONG", "That password does not match");
  };

  return {
    profile: profileOf,

    /** A new account with a password; the session starts at once and the verification mail goes out. */
    async register(input: { email: string; password: string; displayName: string; locale?: AccountLocale | undefined }, meta: SessionMeta, origin: string): Promise<SignedIn> {
      const now = clock();
      if (store.findAccountByEmail(input.email)) throw new AccountError("EMAIL_TAKEN", "An account with that email address already exists");
      const account = store.createAccount({ email: input.email, passwordHash: hashPassword(input.password), displayName: input.displayName, locale: input.locale, emailVerified: false }, now);
      await sendVerification(account, origin, now);
      return startSession(account, meta, true, now);
    },

    /** Sign in with a password. An unknown address and a wrong password get the same answer; five wrong passwords lock the account for a while. */
    async login(input: { email: string; password: string; remember: boolean }, meta: SessionMeta): Promise<SignedIn> {
      const now = clock();
      const account = store.findAccountByEmail(input.email);
      const locked = account?.locked_until ? new Date(account.locked_until) > now : false;
      // Verify against a stand-in when there is nothing to check, so timing does not reveal whether the address exists.
      const valid = verifyPassword(input.password, !account || locked || account.password_hash === null ? dummyPasswordHash : account.password_hash);
      if (!account || account.password_hash === null) throw new AccountError("INVALID_CREDENTIALS", "Invalid email or password");
      if (locked) {
        const retryAfterSeconds = Math.max(1, Math.ceil((new Date(account.locked_until!).getTime() - now.getTime()) / 1_000));
        throw new AccountError("ACCOUNT_LOCKED", "Sign-in is temporarily locked", retryAfterSeconds);
      }
      if (!valid) {
        const failure = store.recordLoginFailure(account.id, now);
        if (failure.locked) throw new AccountError("ACCOUNT_LOCKED", "Sign-in is temporarily locked", lockoutSeconds);
        throw new AccountError("INVALID_CREDENTIALS", "Invalid email or password");
      }
      if (account.status === "disabled") throw new AccountError("ACCOUNT_DISABLED", "This account is disabled");
      store.recordLoginSuccess(account.id, now);
      return startSession(account, meta, input.remember, now);
    },

    /** A session for an account that proved itself another way (a mail link, Google). */
    signIn(account: Account, meta: SessionMeta, remember = true): SignedIn {
      return startSession(account, meta, remember, clock());
    },

    logout(sessionToken: string): void {
      store.revokeSession(sessionToken, clock());
    },

    /** Consumes a verification token; the first time round the welcome mail goes out. */
    async verifyEmail(token: string, origin: string): Promise<{ account: Account; profile: AccountProfile }> {
      const now = clock();
      const consumed = store.consumeToken(token, "verify_email", now);
      const found = consumed ? store.findAccountById(consumed.account_id) : undefined;
      if (!consumed || !found) throw new AccountError("TOKEN_INVALID", "That link is no longer valid");
      let account = found;
      if (account.email_verified_at === null) {
        account = store.updateAccount(account.id, { email_verified_at: now.toISOString() }, now);
        await deliver("welcome", account.email, () => mailer.welcome({ to: account.email, name: account.display_name, link: mailLinks.welcome(origin) }));
      }
      return { account, profile: profileOf(account) };
    },

    /** A fresh verification link for a signed-in person; nothing to do once the address is verified. */
    async resendVerification(accountId: string, origin: string): Promise<void> {
      const account = requireAccount(accountId);
      if (account.email_verified_at !== null) return;
      await sendVerification(account, origin, clock());
    },

    /** Always succeeds; the reset mail goes out only when there is an active account behind the address. */
    async forgotPassword(email: string, origin: string): Promise<void> {
      const now = clock();
      const account = store.findAccountByEmail(email);
      if (!account || account.status !== "active") return;
      const token = store.createToken(account.id, "reset_password", null, config.resetTokenSeconds, now);
      await deliver("reset_password", account.email, () =>
        mailer.resetPassword({ to: account.email, name: account.display_name, link: mailLinks.reset(origin, token), expiresMinutes: Math.max(1, Math.round(config.resetTokenSeconds / 60)) }),
      );
    },

    /** Consumes a reset token, sets the password, signs every session out, and confirms by mail. Following the link proves the address, so it counts as verified. */
    async resetPassword(token: string, password: string, origin: string): Promise<{ account: Account; profile: AccountProfile }> {
      const now = clock();
      const consumed = store.consumeToken(token, "reset_password", now);
      const found = consumed ? store.findAccountById(consumed.account_id) : undefined;
      if (!consumed || !found) throw new AccountError("TOKEN_INVALID", "That link is no longer valid");
      if (found.status === "disabled") throw new AccountError("ACCOUNT_DISABLED", "This account is disabled");
      const account = store.updateAccount(found.id, { password_hash: hashPassword(password), email_verified_at: found.email_verified_at ?? now.toISOString() }, now);
      store.recordLoginSuccess(account.id, now);
      store.revokeSessions(account.id, now);
      await sendPasswordChanged(account, origin, now);
      return { account, profile: profileOf(account) };
    },

    /** Changes the password of a signed-in person; the other sessions sign out, this one stays. */
    async changePassword(accountId: string, currentPassword: string, newPassword: string, currentTokenHash: string, origin: string): Promise<void> {
      const now = clock();
      const account = requireAccount(accountId);
      checkPassword(account, currentPassword);
      const updated = store.updateAccount(account.id, { password_hash: hashPassword(newPassword) }, now);
      store.revokeSessions(account.id, now, currentTokenHash);
      await sendPasswordChanged(updated, origin, now);
    },

    /** Starts an address change: the new address gets a confirmation link; nothing changes until it is followed. */
    async changeEmail(accountId: string, newEmail: string, password: string, origin: string): Promise<void> {
      const now = clock();
      const account = requireAccount(accountId);
      checkPassword(account, password);
      if (newEmail.toLowerCase() === account.email.toLowerCase()) throw new AccountError("EMAIL_TAKEN", "That is already the address on this account");
      if (store.findAccountByEmail(newEmail)) throw new AccountError("EMAIL_TAKEN", "An account with that email address already exists");
      const token = store.createToken(account.id, "change_email", newEmail, config.verifyTokenSeconds, now);
      await deliver("change_email", newEmail, () => mailer.changeEmail({ to: newEmail, name: account.display_name, link: mailLinks.confirmEmail(origin, token), newEmail }));
    },

    /** Consumes a change-email token: the account takes the new address, verified, and the old address hears about it. */
    async confirmEmail(token: string, origin: string): Promise<{ account: Account; profile: AccountProfile }> {
      const now = clock();
      const consumed = store.consumeToken(token, "change_email", now);
      const found = consumed ? store.findAccountById(consumed.account_id) : undefined;
      if (!consumed || !found || !consumed.payload) throw new AccountError("TOKEN_INVALID", "That link is no longer valid");
      const newEmail = consumed.payload;
      const holder = store.findAccountByEmail(newEmail);
      if (holder && holder.id !== found.id) throw new AccountError("EMAIL_TAKEN", "An account with that email address already exists");
      const oldEmail = found.email;
      const account = store.updateAccount(found.id, { email: newEmail, email_verified_at: now.toISOString() }, now);
      if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        await deliver("email_changed", oldEmail, () => mailer.emailChanged({ to: oldEmail, name: account.display_name, newEmail, link: mailLinks.emailChanged(origin) }));
      }
      return { account, profile: profileOf(account) };
    },

    /** Deletes the account and everything on it; an account with a password asks for it first. */
    async deleteAccount(accountId: string, password: string | undefined): Promise<void> {
      const account = requireAccount(accountId);
      if (account.password_hash !== null) {
        if (!password) throw new AccountError("PASSWORD_REQUIRED", "Enter your password to delete the account");
        if (!verifyPassword(password, account.password_hash)) throw new AccountError("PASSWORD_WRONG", "That password does not match");
      }
      store.deleteAccount(account.id);
      await deliver("account_deleted", account.email, () => mailer.accountDeleted({ to: account.email, name: account.display_name }));
    },

    updateProfile(accountId: string, patch: ProfilePatch): AccountProfile {
      const now = clock();
      const account = requireAccount(accountId);
      const changes: Parameters<AccountStore["updateAccount"]>[1] = {};
      if (patch.display_name !== undefined) changes.display_name = patch.display_name;
      if (patch.locale !== undefined) changes.locale = patch.locale;
      if (patch.preferences !== undefined) {
        // Keys left out (or sent as undefined) keep their current value; only what the person set changes.
        const given = Object.fromEntries(Object.entries(patch.preferences).filter(([, value]) => value !== undefined));
        changes.preferences = preferencesSchema.parse({ ...account.preferences, ...given });
      }
      return profileOf(store.updateAccount(account.id, changes, now));
    },

    listSessions(accountId: string, currentTokenHash: string): SessionView[] {
      return store.listSessions(accountId, clock()).map((session) => ({
        // A stable handle for the list that gives nothing away: a hash of the stored hash.
        id: createHash("sha256").update(session.token_hash).digest("hex").slice(0, 16),
        created_at: session.created_at,
        expires_at: session.expires_at,
        user_agent: session.user_agent,
        address: session.address,
        current: session.token_hash === currentTokenHash,
      }));
    },

    revokeOtherSessions(accountId: string, currentTokenHash: string): number {
      return store.revokeSessions(accountId, clock(), currentTokenHash);
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

/** "n***@example.com": enough to tell addresses apart in a log, not enough to write to one. */
export function maskAddress(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
