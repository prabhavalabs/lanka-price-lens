import { createChannels, escapeHtml, mask, message, parseMailbox, sendDirect, type ChannelRegistry, type FetchLike } from "@lanka-pricelens/notify";

import type { AccountMailer, MailResult } from "./types.ts";

/**
 * The branded mail the accounts system sends: one layout, seven templates, and a plain-text
 * part for every message. Delivery goes through the notify package's email channel: Resend
 * (`LPL_RESEND_API_KEY`, the domain verified there), or SendGrid when only its key is set, from
 * `LPL_MAIL_FROM`. Without a key nothing is sent: the mailer says so once in the log and every
 * send answers with a failure instead of throwing, so registering and resetting keep working
 * on a machine without mail.
 */

export const defaultAccountMailFrom = "PriceLens <hello@prabhavalabs.com>";

export type AccountMailKind = "verifyEmail" | "welcome" | "resetPassword" | "passwordChanged" | "changeEmail" | "emailChanged" | "accountDeleted";
export type AccountMailInput<K extends AccountMailKind> = Parameters<AccountMailer[K]>[0];
export type RenderedMail = { subject: string; html: string; text: string };
export type RenderOptions = {
  /** The address the footer invites replies to; the sender's address by default. */
  replyTo?: string | undefined;
};

/** What a template decides; the layout turns it into html and text. Everything here is plain text and gets escaped. */
type MailContent = {
  subject: string;
  headline: string;
  /** One or two short sentences. */
  paragraphs: string[];
  button: { label: string; url: string } | null;
  /** Why the person received the mail, and what to do if it was not them. */
  reason: string;
};

const templates: { [K in AccountMailKind]: (input: AccountMailInput<K>) => MailContent } = {
  verifyEmail: ({ name, link }) => ({
    subject: "Confirm your email address",
    headline: "Confirm your email address",
    paragraphs: [`Hi ${name}, thanks for joining PriceLens. Press the button to confirm that this address is yours. The link works for a day.`],
    button: { label: "Confirm my email", url: link },
    reason: "You're getting this email because this address was used to create a PriceLens account. If that wasn't you, ignore this email and nothing happens.",
  }),
  welcome: ({ name, link }) => ({
    subject: "Your PriceLens account is ready",
    headline: `Welcome to PriceLens, ${name}`,
    paragraphs: ["Your email is confirmed and your account is ready. Keep menus, write down your own recipes, and see what dinner costs today."],
    button: { label: "Open PriceLens", url: link },
    reason: "You're getting this email because you confirmed this address on PriceLens.",
  }),
  resetPassword: ({ name, link, expiresMinutes }) => ({
    subject: "Reset your PriceLens password",
    headline: "Reset your password",
    paragraphs: [`Hi ${name}, someone asked to reset the password for this PriceLens account. If that was you, press the button and choose a new one. The link works for ${expiresMinutes} minutes.`],
    button: { label: "Choose a new password", url: link },
    reason: "You're getting this email because a password reset was requested for this address. If that wasn't you, ignore this email; your password stays as it is.",
  }),
  passwordChanged: ({ name, when, link }) => ({
    subject: "Your PriceLens password was changed",
    headline: "Your password was changed",
    paragraphs: [`Hi ${name}, the password for your PriceLens account was changed on ${when}, and every other device was signed out.`, "If that was you, there is nothing more to do. If it wasn't, reset your password straight away and reply to this email."],
    button: { label: "Reset my password", url: link },
    reason: "You're getting this email because the password on your PriceLens account changed.",
  }),
  changeEmail: ({ name, link, newEmail }) => ({
    subject: "Confirm your new email address",
    headline: "Confirm your new email address",
    paragraphs: [`Hi ${name}, you asked to move your PriceLens account to ${newEmail}. Press the button to confirm the change. Until then your account keeps its current address.`],
    button: { label: "Confirm this address", url: link },
    reason: "You're getting this email because someone entered this address on a PriceLens account. If that wasn't you, ignore this email and nothing changes.",
  }),
  emailChanged: ({ name, newEmail, link }) => ({
    subject: "The email address on your PriceLens account was changed",
    headline: "Your email address was changed",
    paragraphs: [`Hi ${name}, the email address on your PriceLens account is now ${newEmail}. Mail about your account goes there from now on.`, "If you didn't make this change, secure your account straight away and reply to this email so we can help."],
    button: { label: "Secure my account", url: link },
    reason: "You're getting this email at your previous address because the address on your PriceLens account changed.",
  }),
  accountDeleted: ({ name }) => ({
    subject: "Your PriceLens account was deleted",
    headline: "Your account was deleted",
    paragraphs: [`Hi ${name}, your PriceLens account and everything kept on it, menus, recipes and settings included, have been deleted.`, "Prices stay free to read without an account, and you're welcome back any time."],
    button: null,
    reason: "You're getting this email because the account with this address was deleted. If you didn't do this, reply to this email straight away.",
  }),
};

const green = "#007f52";
const ink = "#1c2420";
const muted = "#5f6b66";
const ground = "#f4f6f5";
const border = "#e2e7e4";
const fonts = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The one layout: the PriceLens mark, a headline, a sentence or two, one button with its link
 * written out beneath, and a footer saying why the mail came. Tables and inline styles so it
 * reads the same in Gmail, Outlook, and Apple Mail; nothing has to load.
 */
function layout(content: MailContent, options: RenderOptions): RenderedMail {
  const replyTo = options.replyTo ?? parseMailbox(defaultAccountMailFrom).email;
  const font = `font-family:${fonts};`;
  const paragraphs = content.paragraphs.map((paragraph) => `<p style="margin:0 0 14px 0;${font}font-size:16px;line-height:1.55;color:${ink};">${escapeHtml(paragraph)}</p>`).join("\n");
  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 16px 0;">
  <tr>
    <td align="center" bgcolor="${green}" style="border-radius:8px;background:${green};">
      <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 28px;${font}font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.button.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0;${font}font-size:13px;line-height:1.5;color:${muted};">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(content.button.url)}" style="color:${green};word-break:break-all;">${escapeHtml(content.button.url)}</a></p>`
    : "";
  const preheader = content.paragraphs[0] ?? content.headline;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${ground};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ground}" style="background:${ground};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td style="padding:0 0 20px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="36" height="36" align="center" valign="middle" bgcolor="${green}" style="width:36px;height:36px;border-radius:10px;background:${green};${font}font-size:18px;font-weight:700;line-height:36px;color:#ffffff;">₨</td>
                <td style="padding-left:10px;${font}font-size:18px;font-weight:700;color:${ink};">PriceLens</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${border};border-radius:12px;padding:32px 28px;">
            <h1 style="margin:0 0 16px 0;${font}font-size:24px;font-weight:700;line-height:1.25;color:${ink};">${escapeHtml(content.headline)}</h1>
${paragraphs}
${button}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0 8px;${font}font-size:12px;line-height:1.5;color:${muted};">
            <p style="margin:0 0 8px 0;">${escapeHtml(content.reason)}</p>
            <p style="margin:0;">Questions? Reply to this email or write to <a href="mailto:${escapeHtml(replyTo)}" style="color:${muted};">${escapeHtml(replyTo)}</a>. PriceLens, by Prabhava Labs.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
  const blocks = [content.headline, ...content.paragraphs];
  if (content.button) blocks.push(`${content.button.label}: ${content.button.url}`);
  blocks.push(content.reason, `Questions? Reply to this email or write to ${replyTo}.\nPriceLens, by Prabhava Labs.`);
  return { subject: content.subject, html, text: `${blocks.join("\n\n")}\n` };
}

/** Renders one template: pure, so the wording and the escaping can be checked without sending anything. */
export function renderAccountMail<K extends AccountMailKind>(kind: K, input: AccountMailInput<K>, options: RenderOptions = {}): RenderedMail {
  const template = templates[kind] as (input: AccountMailInput<K>) => MailContent;
  return layout(template(input), options);
}

function maskAddress(address: string): string {
  const [user = "", domain = ""] = address.split("@");
  return `${user.slice(0, 2)}…@${domain}`;
}

export function createAccountMailer(environment: Record<string, string | undefined> = process.env, request?: FetchLike, options: { log?: ((line: string) => void) | undefined } = {}): AccountMailer {
  const log = options.log ?? ((line: string) => console.warn(line));
  const sendgridKey = environment.LPL_SENDGRID_API_KEY?.trim();
  const resendKey = environment.LPL_RESEND_API_KEY?.trim();
  const from = environment.LPL_MAIL_FROM?.trim() || defaultAccountMailFrom;
  // Resend is the mail provider (prabhavalabs.com is verified there); SendGrid stays as an alternative when only its key is set.
  const provider = resendKey ? "resend" : sendgridKey ? "sendgrid" : null;
  const apiKey = resendKey || sendgridKey || "";
  const channels: ChannelRegistry | null = provider ? createChannels({ email: { provider, apiKey, from }, fetch: request }) : null;
  const replyTo = parseMailbox(from).email;
  let warned = false;

  const send = async <K extends AccountMailKind>(kind: K, input: AccountMailInput<K>): Promise<MailResult> => {
    let rendered: RenderedMail;
    try {
      rendered = renderAccountMail(kind, input, { replyTo });
    } catch (error) {
      return { ok: false, error: `MAIL_RENDER: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!channels) {
      if (!warned) {
        warned = true;
        log(`Account mail is not configured: set LPL_RESEND_API_KEY and LPL_MAIL_FROM (a sender on a domain verified in Resend). Not sending "${rendered.subject}" to ${maskAddress(input.to)}.`);
      }
      return { ok: false, error: "MAIL_NOT_CONFIGURED" };
    }
    try {
      const fallback = message({ title: rendered.subject, summary: rendered.text.slice(0, 4000) });
      const delivery = await sendDirect(channels, { kind: "email", address: input.to, meta: { subject: rendered.subject, html: rendered.html, text: rendered.text } }, fallback);
      return delivery.ok ? { ok: true, reference: delivery.reference } : { ok: false, error: delivery.error };
    } catch (error) {
      return { ok: false, error: `MAIL_SEND: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  return {
    configured: channels !== null,
    describe: () => (provider ? `${provider} as ${from} (key ${mask(apiKey)})` : "not configured"),
    verifyEmail: (input) => send("verifyEmail", input),
    welcome: (input) => send("welcome", input),
    resetPassword: (input) => send("resetPassword", input),
    passwordChanged: (input) => send("passwordChanged", input),
    changeEmail: (input) => send("changeEmail", input),
    emailChanged: (input) => send("emailChanged", input),
    accountDeleted: (input) => send("accountDeleted", input),
  };
}
