import { createChannels, mask, message, parseMailbox, sendDirect, type ChannelRegistry, type FetchLike } from "@lanka-pricelens/notify";

import type { MailFields, MailKind } from "../mail/defaults.ts";
import { defaultMailFrom, defaultMarkUrl, type RenderedMail } from "../mail/layout.ts";
import { markUrlFor, renderMail, type MailData, type TemplateStore } from "../mail/templates.ts";
import type { AccountMailer, MailResult } from "./types.ts";

/**
 * The branded mail the accounts system sends: seven kinds rendered through the shared mail
 * templates (api/src/mail), so the owner can edit the wording in the admin while the layout
 * and the links stay in code. Delivery goes through the notify package's email channel:
 * Resend (`LPL_RESEND_API_KEY`, the domain verified there), or SendGrid when only its key is
 * set, from `LPL_MAIL_FROM`. Without a key nothing is sent: the mailer says so once in the
 * log and every send answers with a failure instead of throwing, so registering and
 * resetting keep working on a machine without mail.
 */

export const defaultAccountMailFrom = defaultMailFrom;
export { defaultMarkUrl };
export type { RenderedMail };

export type AccountMailKind = "verifyEmail" | "welcome" | "resetPassword" | "passwordChanged" | "changeEmail" | "emailChanged" | "accountDeleted";
export type AccountMailInput<K extends AccountMailKind> = Parameters<AccountMailer[K]>[0];
export type RenderOptions = {
  /** The address the footer invites replies to; the sender's address by default. */
  replyTo?: string | undefined;
  /** Where the mark at the top of every mail is fetched from; the production site by default. */
  markUrl?: string | undefined;
  /** Edited wording for the kind; the defaults apply where it is blank or absent. */
  fields?: Partial<MailFields> | undefined;
};

/** Which template each account mail is, and what its input fills in. */
export const accountMailKinds: Record<AccountMailKind, MailKind> = {
  verifyEmail: "verify_email",
  welcome: "welcome",
  resetPassword: "reset_password",
  passwordChanged: "password_changed",
  changeEmail: "change_email",
  emailChanged: "email_changed",
  accountDeleted: "account_deleted",
};

function valuesOf<K extends AccountMailKind>(input: AccountMailInput<K>): MailData["values"] {
  const record = input as Record<string, unknown>;
  const values: MailData["values"] = { name: String(record.name ?? "") };
  if (typeof record.link === "string") values.link = record.link;
  if (typeof record.expiresMinutes === "number") values.minutes = record.expiresMinutes;
  if (typeof record.when === "string") values.when = record.when;
  if (typeof record.newEmail === "string") values.new_email = record.newEmail;
  return values;
}

/** Renders one account mail: pure, so the wording and the escaping can be checked without sending anything. */
export function renderAccountMail<K extends AccountMailKind>(kind: K, input: AccountMailInput<K>, options: RenderOptions = {}): RenderedMail {
  return renderMail(accountMailKinds[kind], { values: valuesOf(input) }, { fields: options.fields, markUrl: options.markUrl ?? defaultMarkUrl, replyTo: options.replyTo ?? parseMailbox(defaultAccountMailFrom).email });
}

function maskAddress(address: string): string {
  const [user = "", domain = ""] = address.split("@");
  return `${user.slice(0, 2)}…@${domain}`;
}

/** Sends an already rendered mail to one address through the mailer's channel; failures are returned, never thrown. */
export type MailSender = (to: string, mail: RenderedMail, options?: { headers?: Record<string, string> | undefined }) => Promise<MailResult>;

export type AccountMailerOptions = {
  log?: ((line: string) => void) | undefined;
  /** Edited wording from the admin; without it the defaults apply. */
  templates?: TemplateStore | undefined;
};

export function createAccountMailer(environment: Record<string, string | undefined> = process.env, request?: FetchLike, options: AccountMailerOptions = {}): AccountMailer & { send: MailSender; replyTo: string; markUrl: string; channels: ChannelRegistry | null } {
  const log = options.log ?? ((line: string) => console.warn(line));
  const sendgridKey = environment.LPL_SENDGRID_API_KEY?.trim();
  const resendKey = environment.LPL_RESEND_API_KEY?.trim();
  const from = environment.LPL_MAIL_FROM?.trim() || defaultAccountMailFrom;
  // Resend is the mail provider (prabhavalabs.com is verified there); SendGrid stays as an alternative when only its key is set.
  const provider = resendKey ? "resend" : sendgridKey ? "sendgrid" : null;
  const apiKey = resendKey || sendgridKey || "";
  const channels: ChannelRegistry | null = provider ? createChannels({ email: { provider, apiKey, from }, fetch: request }) : null;
  const replyTo = parseMailbox(from).email;
  // Mail clients fetch the mark over the network, so a local origin is no use there; production serves it.
  const markUrl = markUrlFor(environment.LPL_SITE_ORIGIN);
  let warned = false;

  const send: MailSender = async (to, rendered, sendOptions = {}) => {
    if (!channels) {
      if (!warned) {
        warned = true;
        log(`Account mail is not configured: set LPL_RESEND_API_KEY and LPL_MAIL_FROM (a sender on a domain verified in Resend). Not sending "${rendered.subject}" to ${maskAddress(to)}.`);
      }
      return { ok: false, error: "MAIL_NOT_CONFIGURED" };
    }
    try {
      const fallback = message({ title: rendered.subject, summary: rendered.text.slice(0, 4000) });
      const meta: Record<string, unknown> = { subject: rendered.subject, html: rendered.html, text: rendered.text };
      if (sendOptions.headers) meta.headers = sendOptions.headers;
      const delivery = await sendDirect(channels, { kind: "email", address: to, meta }, fallback);
      return delivery.ok ? { ok: true, reference: delivery.reference } : { ok: false, error: delivery.error };
    } catch (error) {
      return { ok: false, error: `MAIL_SEND: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  const sendKind = async <K extends AccountMailKind>(kind: K, input: AccountMailInput<K>): Promise<MailResult> => {
    let rendered: RenderedMail;
    try {
      const fields = options.templates?.get(accountMailKinds[kind]).fields;
      rendered = renderAccountMail(kind, input, { replyTo, markUrl, fields });
    } catch (error) {
      return { ok: false, error: `MAIL_RENDER: ${error instanceof Error ? error.message : String(error)}` };
    }
    return send(input.to, rendered);
  };

  return {
    configured: channels !== null,
    describe: () => (provider ? `${provider} as ${from} (key ${mask(apiKey)})` : "not configured"),
    replyTo,
    markUrl,
    send,
    channels,
    verifyEmail: (input) => sendKind("verifyEmail", input),
    welcome: (input) => sendKind("welcome", input),
    resetPassword: (input) => sendKind("resetPassword", input),
    passwordChanged: (input) => sendKind("passwordChanged", input),
    changeEmail: (input) => sendKind("changeEmail", input),
    emailChanged: (input) => sendKind("emailChanged", input),
    accountDeleted: (input) => sendKind("accountDeleted", input),
  };
}
