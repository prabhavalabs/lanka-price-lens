import { createProductionApp, newsletterServices } from "./app.ts";
import { newsletterCommand, newsletterUsage } from "./newsletters/cli.ts";

/**
 * The API's own commands, run against the same configuration the server uses (the env file,
 * the operational database, the warehouse) without starting the server or its timers:
 *
 *   node src/cli.ts newsletter run --kind recipes_daily [--day YYYY-MM-DD] [--dry-run] [--force]
 */
const [command, ...arguments_] = process.argv.slice(2);

if (command === "newsletter") {
  const app = createProductionApp({ scheduler: false });
  const service = newsletterServices.get(app);
  if (!service) throw new Error("The newsletter service is not available");
  await newsletterCommand(arguments_, { service });
} else {
  throw new Error(`Unknown command "${command ?? ""}". ${newsletterUsage}`);
}
