import type { NewsletterService } from "./service.ts";
import { isNewsletterKind, type NewsletterRun } from "./store.ts";
import { isDay } from "./time.ts";

/**
 * `newsletter run --kind <recipes_daily|deals_daily> [--day YYYY-MM-DD] [--dry-run] [--force]`
 * from a shell: the same run the scheduler and the admin start, printed as JSON. The caller
 * builds the service the way app.ts does and decides what to do with the run it gets back.
 */

export type NewsletterCommandDeps = {
  service: NewsletterService;
  /** Where the run is printed; console.log by default. */
  write?: ((line: string) => void) | undefined;
};

export const newsletterUsage = "Usage: newsletter run --kind <recipes_daily|deals_daily> [--day YYYY-MM-DD] [--dry-run] [--force]";

function valueOf(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function newsletterCommand(args: string[], deps: NewsletterCommandDeps): Promise<NewsletterRun> {
  const [action, ...rest] = args;
  if (action !== "run") throw new Error(newsletterUsage);
  const kind = valueOf(rest, "--kind");
  if (!isNewsletterKind(kind)) throw new Error(newsletterUsage);
  const day = valueOf(rest, "--day");
  if (day !== undefined && !isDay(day)) throw new Error("--day must be a valid YYYY-MM-DD date");
  const outcome = await deps.service.runNewsletter(kind, { day, trigger: "cli", dryRun: rest.includes("--dry-run"), force: rest.includes("--force") });
  const write = deps.write ?? ((line: string) => console.log(line));
  write(JSON.stringify({ ...outcome.run, repeated: outcome.repeated }, null, 2));
  if (outcome.run.status === "failed") throw new Error(`Newsletter run failed: ${outcome.run.error ?? "unknown error"}`);
  return outcome.run;
}
