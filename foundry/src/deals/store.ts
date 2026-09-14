import type { OperationalDatabase } from "../db.ts";
import type { DealsDay } from "./compute.ts";

/**
 * Computed days kept in the operational SQLite, one row per Colombo day, so the API and the
 * deals mail read a saved day rather than querying the warehouse on every request. The table
 * is created here on first use; a later migration in db.ts creating the same table is a no-op.
 */

type DealDayRow = { day: string; computed_at: string; deals_json: string };

export function ensureDealsSchema(database: OperationalDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS deal_day (
      day TEXT PRIMARY KEY,
      computed_at TEXT NOT NULL,
      deals_json TEXT NOT NULL
    ) STRICT;
  `);
}

/** Keeps the day, replacing an earlier computation of the same day. */
export function saveDealsDay(database: OperationalDatabase, day: DealsDay): void {
  ensureDealsSchema(database);
  database
    .prepare(
      `INSERT INTO deal_day (day, computed_at, deals_json) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET computed_at = excluded.computed_at, deals_json = excluded.deals_json`,
    )
    .run(day.day, day.computed_at, JSON.stringify(day));
}

export function readDealsDay(database: OperationalDatabase, day: string): DealsDay | null {
  ensureDealsSchema(database);
  const row = database.prepare("SELECT day, computed_at, deals_json FROM deal_day WHERE day = ?").get(day) as DealDayRow | undefined;
  return row ? parseDay(row) : null;
}

/** The newest saved day, whatever day it is; the API answers this as "today". */
export function latestDealsDay(database: OperationalDatabase): DealsDay | null {
  ensureDealsSchema(database);
  const row = database.prepare("SELECT day, computed_at, deals_json FROM deal_day ORDER BY day DESC LIMIT 1").get() as DealDayRow | undefined;
  return row ? parseDay(row) : null;
}

function parseDay(row: DealDayRow): DealsDay {
  return JSON.parse(row.deals_json) as DealsDay;
}
