import { createProductionApp, mailServices, newsletterServices } from "./app.ts";
import { mailCommand, mailUsage } from "./mail/cli.ts";
import { newsletterCommand, newsletterUsage } from "./newsletters/cli.ts";

/**
 * The API's own commands, run against the same configuration the server uses (the env file,
 * the operational database, the warehouse) without starting the server or its timers:
 *
 *   node src/cli.ts newsletter run --kind recipes_daily [--day YYYY-MM-DD] [--dry-run] [--force]
 *   node src/cli.ts mail samples --to owner@example.com [--kind verify_email,deals_daily,notices] [--origin https://price.prabhavalabs.com]
 */
const [command, ...arguments_] = process.argv.slice(2);

if (command === "newsletter") {
  const app = createProductionApp({ scheduler: false });
  const service = newsletterServices.get(app);
  if (!service) throw new Error("The newsletter service is not available");
  await newsletterCommand(arguments_, { service });
} else if (command === "mail") {
  // The samples' links and pictures point at the site the app is configured for; --origin points them elsewhere (the production site from a laptop).
  const originAt = arguments_.indexOf("--origin");
  const origin = originAt >= 0 ? arguments_[originAt + 1] : undefined;
  if (originAt >= 0 && !origin) throw new Error(mailUsage);
  if (origin) process.env.LPL_SITE_ORIGIN = origin;
  const app = createProductionApp({ scheduler: false });
  const services = mailServices.get(app);
  if (!services) throw new Error("The mail services are not available");
  await mailCommand(arguments_, services);
} else {
  throw new Error(`Unknown command "${command ?? ""}". ${newsletterUsage} ${mailUsage}`);
}
