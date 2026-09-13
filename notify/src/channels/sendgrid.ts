import { bodyExcerpt, classifyStatus, failure, type Channel, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { emailContent } from "../render/email.ts";
import { isEmailAddress } from "./email.ts";

/**
 * Email through SendGrid's v3 mail API, for mail from the site's own authenticated domain.
 * The address is the recipient; `meta.subject` overrides the title as subject, `meta.reply_to`
 * sets the reply address, and `meta.html` with `meta.text` carry a finished template through
 * unchanged. Click and open tracking are off so links stay on our domain and nothing in the
 * mail phones home.
 */

export type SendGridConfig = { apiKey: string; from: string; fetch?: FetchLike | undefined; endpoint?: string | undefined };

export const sendGridEndpoint = "https://api.sendgrid.com/v3/mail/send";

/** "PriceLens <hello@example.com>" as SendGrid wants it; a bare address has no name. */
export function parseMailbox(value: string): { email: string; name?: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/u.exec(value);
  if (match) {
    const name = match[1]?.trim();
    return name ? { email: match[2]!, name } : { email: match[2]! };
  }
  return { email: value.trim() };
}

/** SendGrid answers 400 with a list of errors naming a field; one about the recipient means the address itself is refused. */
function recipientRefused(detail: string): boolean {
  return /personalizations\.\d+\.to\b|\brecipient\b|\bto\b (?:array|address|email|field)/iu.test(detail) && /invalid|not valid|does not contain|malformed/iu.test(detail);
}

export function createSendGridChannel(config: SendGridConfig): Channel {
  const request = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? sendGridEndpoint;
  const from = parseMailbox(config.from);
  return {
    kind: "email",
    describe: (target) => {
      const [user = "", domain = ""] = target.address.split("@");
      return `email:${user.slice(0, 2)}…@${domain}`;
    },
    send: async (target: Target, message: Message) => {
      if (!isEmailAddress(target.address)) return failure("EMAIL_ADDRESS_INVALID", { gone: true });
      const content = emailContent(message, target.meta);
      const replyTo = typeof target.meta?.reply_to === "string" && isEmailAddress(target.meta.reply_to) ? parseMailbox(target.meta.reply_to) : null;
      const body = {
        personalizations: [{ to: [{ email: target.address }] }],
        from,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: content.subject,
        content: [
          { type: "text/plain", value: content.text },
          { type: "text/html", value: content.html },
        ],
        tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
        mail_settings: { sandbox_mode: { enable: false } },
      };
      let response: Response;
      try {
        response = await request(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return failure(`SENDGRID_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
      }
      // SendGrid accepts with 202 and an empty body; the message id lives in a header.
      if (response.ok) return { ok: true, reference: response.headers.get("x-message-id") };
      const detail = await bodyExcerpt(response);
      const classified = classifyStatus(response.status, response.headers);
      const gone = response.status >= 400 && response.status < 500 && !classified.retryable && recipientRefused(detail);
      return failure(`SENDGRID_HTTP_${response.status}: ${detail}`, { ...classified, gone });
    },
  };
}
