import { Hono, type Context } from "hono";

import { envelope, jsonObject } from "../http.ts";
import type { ContentStore } from "./content.ts";
import type { Account, AccountErrorCode, AccountIdentity, AccountStatus, AccountStore } from "./types.ts";

/**
 * The owner's view of accounts, mounted by app.ts at /v1/admin/accounts behind requireOwner:
 * a searchable, paged list without secrets, with how much each account keeps, and a switch to
 * disable or enable an account. Disabling also signs the person out everywhere.
 */

export type AdminAccountBindings = { Variables: { requestId: string } };

/** An account as the admin sees it: everything but the password hash, plus what it keeps. */
export type AdminAccountRow = Omit<Account, "password_hash"> & { has_password: boolean; identities: AccountIdentity["provider"][]; menus: number; recipes: number };

export type AdminAccountDeps = { store: AccountStore; content: ContentStore };

function fail(context: Context<AdminAccountBindings>, status: 400 | 404, message: string, code?: AccountErrorCode) {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

function adminRow(account: Account, identities: AccountIdentity[], counts: { menus: number; recipes: number } | undefined): AdminAccountRow {
  const { password_hash, ...rest } = account;
  return { ...rest, has_password: password_hash !== null, identities: identities.map((identity) => identity.provider), menus: counts?.menus ?? 0, recipes: counts?.recipes ?? 0 };
}

function isStatus(value: unknown): value is AccountStatus {
  return value === "active" || value === "disabled";
}

export function adminAccountRoutes(deps: AdminAccountDeps): Hono<AdminAccountBindings> {
  const app = new Hono<AdminAccountBindings>();

  app.get("/", (context) => {
    // The same paging conventions as the other admin lists: page from 1, ten a page, a hundred at most.
    const requestedStatus = (context.req.query("status") ?? "").trim().slice(0, 50);
    const status: AccountStatus | "" | null = requestedStatus === "" ? "" : isStatus(requestedStatus) ? requestedStatus : null;
    if (status === null) return fail(context, 400, "status must be active or disabled");
    const requestedPage = Number(context.req.query("page") ?? 1);
    const requestedSize = Number(context.req.query("pageSize") ?? 10);
    const result = deps.store.listAccounts({
      search: (context.req.query("search") ?? "").trim().slice(0, 100),
      status,
      page: Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1,
      pageSize: Number.isInteger(requestedSize) ? Math.min(Math.max(requestedSize, 1), 100) : 10,
    });
    const counts = deps.content.countContent(result.items.map((account) => account.id));
    return context.json(envelope(context.get("requestId"), { items: result.items.map((account) => adminRow(account, deps.store.listIdentities(account.id), counts.get(account.id))), page: result.page, pageSize: result.pageSize, total: result.total, pages: result.pages }));
  });

  app.patch("/:id", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const status = body.status;
    if (!isStatus(status)) return fail(context, 400, "status must be active or disabled");
    const id = context.req.param("id").slice(0, 120);
    if (!deps.store.findAccountById(id)) return fail(context, 404, "Account not found", "NOT_FOUND");
    const now = new Date();
    const account = deps.store.updateAccount(id, { status }, now);
    const revoked = status === "disabled" ? deps.store.revokeSessions(id, now) : 0;
    const counts = deps.content.countContent([id]);
    return context.json(envelope(context.get("requestId"), { ...adminRow(account, deps.store.listIdentities(account.id), counts.get(id)), sessions_revoked: revoked }, true, status === "disabled" ? "Account disabled" : "Account enabled"));
  });

  return app;
}
