import { bodyExcerpt, classifyStatus, failure, type Channel, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { emailContent } from "../render/email.ts";

/**
 * Email through Resend's HTTP API. The address is the recipient; `meta.reply_to` sets the
 * reply address, `meta.subject` overrides the title as subject, and `meta.html` with
 * `meta.text` carry a finished template through unchanged.
 */

export type EmailConfig = {
  apiKey: string;
  from: string;
  /** Which service the key belongs to; the registry builds the matching channel. Resend unless said otherwise. */
  provider?: "resend" | "sendgrid" | undefined;
  fetch?: FetchLike | undefined;
  endpoint?: string | undefined;
};

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isEmailAddress(value: string): boolean {
  return emailPattern.test(value) && value.length <= 254;
}

export function createEmailChannel(config: EmailConfig): Channel {
  const request = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? "https://api.resend.com/emails";
  return {
    kind: "email",
    describe: (target) => {
      const [user = "", domain = ""] = target.address.split("@");
      return `email:${user.slice(0, 2)}…@${domain}`;
    },
    send: async (target: Target, message: Message) => {
      if (!isEmailAddress(target.address)) return failure("EMAIL_ADDRESS_INVALID", { gone: true });
      const content = emailContent(message, target.meta);
      const replyTo = typeof target.meta?.reply_to === "string" && isEmailAddress(target.meta.reply_to) ? target.meta.reply_to : null;
      let response: Response;
      try {
        response = await request(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from: config.from, to: [target.address], subject: content.subject, text: content.text, html: content.html, ...(replyTo ? { reply_to: replyTo } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return failure(`RESEND_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
      }
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, reference: payload?.id ?? null };
      }
      const detail = await bodyExcerpt(response);
      const classified = classifyStatus(response.status, response.headers);
      // A 422 naming the recipient means the address itself is refused; other 4xx are our mistake and not worth retrying.
      const gone = response.status === 422 && /to|recipient|email/iu.test(detail) && /invalid|not valid/iu.test(detail);
      return failure(`RESEND_HTTP_${response.status}: ${detail}`, { ...classified, gone });
    },
  };
}
