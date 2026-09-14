import { preferencesSchema } from "@lanka-pricelens/shared";
import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

import type { Account } from "../../src/account/types.ts";

/**
 * The account tables as docs/accounts.md defines them, for tests that run before (or without)
 * foundry's migration; IF NOT EXISTS keeps this a no-op once the migration creates them.
 */
export function ensureAccountTables(database: OperationalDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email_verified_at TEXT,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'si', 'ta')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_menu (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      occasion TEXT,
      people INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_menu_account_idx ON account_menu(account_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS account_recipe (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_recipe_account_idx ON account_recipe(account_id, updated_at DESC);
  `);
}

/** An account as the store would hand it out, with the fields a test cares about overridden. */
export function accountFixture(overrides: Partial<Account> & Pick<Account, "id" | "email">): Account {
  return {
    email_verified_at: "2026-09-01T00:00:00.000Z",
    password_hash: "scrypt$salt$hash",
    display_name: overrides.email.split("@")[0] ?? "someone",
    avatar_url: null,
    locale: "en",
    status: "active",
    failed_login_count: 0,
    locked_until: null,
    preferences: preferencesSchema.parse({}),
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Puts the account row in the table directly, so the content tables' foreign keys hold without the account store. */
export function insertAccount(database: OperationalDatabase, account: Account): void {
  database
    .prepare("INSERT INTO account (id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(account.id, account.email, account.email_verified_at, account.password_hash, account.display_name, account.avatar_url, account.locale, account.status, account.failed_login_count, account.locked_until, JSON.stringify(account.preferences), account.created_at, account.updated_at);
}
