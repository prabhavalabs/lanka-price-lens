import type { OperationalDatabase } from "../db.ts";
import { colomboDay } from "../retail/capture.ts";
import type { WarehouseClient } from "../warehouse/client.ts";
import { computeDeals } from "./compute.ts";
import { loadEssentials } from "./essentials.ts";
import { saveDealsDay } from "./store.ts";

export type DealsCommandDeps = {
  database: OperationalDatabase;
  /** Opens the warehouse; the command closes the client it receives. */
  warehouse: () => Promise<WarehouseClient>;
};

const usage = "Usage: deals compute [--day YYYY-MM-DD] [--save]";

/** `deals compute [--day YYYY-MM-DD] [--save]`: computes the day (today in Colombo by default), prints it as JSON, and with --save keeps it in deal_day. */
export async function dealsCommand(args: string[], deps: DealsCommandDeps): Promise<void> {
  const [action, ...rest] = args;
  if (action !== "compute") throw new Error(usage);
  const day = colomboMidnight(valueOf(rest, "--day"));
  const essentials = loadEssentials();
  const client = await deps.warehouse();
  try {
    const result = await computeDeals(client, { day, essentials });
    if (rest.includes("--save")) saveDealsDay(deps.database, result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

/** The start of the given Colombo day, so `computeDeals` lands on that calendar day whatever the process time zone. */
function colomboMidnight(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00+05:30`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(date.valueOf()) || colomboDay(date) !== value) {
    throw new Error("--day must be a valid YYYY-MM-DD date");
  }
  return date;
}

function valueOf(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
