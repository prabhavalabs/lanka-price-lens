import { mailKinds, type MailKind } from "./defaults.ts";
import type { MailServices } from "./samples.ts";

/**
 * `mail samples --to <address>` mails every kind the site sends, rendered with sample data, to
 * one address for review: the ten templates, then the owner's notices. `--kind` narrows it to
 * a comma-separated list of kinds, `notices` among them. Resend accepts two requests a second,
 * so the sends are spaced out.
 */

export const mailUsage = "Usage: mail samples --to <address> [--kind verify_email,deals_daily,notices] [--origin https://badumila.com]";

export type MailCommandOptions = {
  out?: ((line: string) => void) | undefined;
  /** The pause between sends, in milliseconds; zero in tests. */
  spacing?: number | undefined;
};

export function parseMailArguments(arguments_: string[]): { to: string; kinds: Array<MailKind | "notices"> } {
  const [subcommand, ...rest] = arguments_;
  if (subcommand !== "samples") throw new Error(mailUsage);
  let to: string | null = null;
  let requested: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--to" && value) {
      to = value;
      index += 1;
    } else if (flag === "--kind" && value) {
      requested = value;
      index += 1;
    } else if (flag === "--origin" && value) {
      index += 1;
    } else {
      throw new Error(mailUsage);
    }
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(to)) throw new Error(`A recipient is required. ${mailUsage}`);
  const kinds: Array<MailKind | "notices"> = [];
  for (const name of (requested ?? [...mailKinds, "notices"].join(",")).split(",").map((part) => part.trim()).filter(Boolean)) {
    if (name === "notices" || (mailKinds as readonly string[]).includes(name)) kinds.push(name as MailKind | "notices");
    else throw new Error(`Unknown kind "${name}". Kinds: ${[...mailKinds, "notices"].join(", ")}`);
  }
  return { to, kinds };
}

const pause = (milliseconds: number): Promise<void> => (milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve());

export async function mailCommand(arguments_: string[], services: MailServices, options: MailCommandOptions = {}): Promise<{ sent: number; failed: number }> {
  const out = options.out ?? ((line: string) => console.log(line));
  const spacing = options.spacing ?? 700;
  const { to, kinds } = parseMailArguments(arguments_);
  if (!services.send) throw new Error("Mail is not configured: set LPL_RESEND_API_KEY and LPL_MAIL_FROM");
  const mails: Array<{ name: string; mail: ReturnType<MailServices["sample"]> }> = [];
  for (const kind of kinds) {
    if (kind === "notices") mails.push(...services.notices());
    else mails.push({ name: kind, mail: services.sample(kind) });
  }
  let sent = 0;
  let failed = 0;
  for (const [index, entry] of mails.entries()) {
    if (index > 0) await pause(spacing);
    const result = await services.send(to, entry.mail);
    if (result.ok) {
      sent += 1;
      out(`${entry.name}: sent "${entry.mail.subject}" (${result.reference ?? "no reference"})`);
    } else {
      failed += 1;
      out(`${entry.name}: failed "${entry.mail.subject}": ${result.error}`);
    }
  }
  out(`${sent} sent, ${failed} failed, to ${to}`);
  return { sent, failed };
}
