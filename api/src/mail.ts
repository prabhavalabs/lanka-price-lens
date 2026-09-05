import type { FeedbackItem } from "./feedback.ts";

/**
 * Outgoing mail for the owner through Resend (https://resend.com): every feedback message or bug
 * report is forwarded to `LPL_FEEDBACK_EMAIL_TO` from `LPL_MAIL_FROM` with the key in
 * `LPL_RESEND_API_KEY`. Without the key and the address nothing is sent and the messages stay
 * readable in the admin. Sending never blocks or fails the request that triggered it.
 */

export type MailMessage = { subject: string; text: string; replyTo?: string | undefined };
export type Mailer = { send: (message: MailMessage) => Promise<void>; configured: boolean };

const resendEndpoint = "https://api.resend.com/emails";
/** Resend's shared test sender, allowed before a domain is verified; a verified address on the owner's domain is better. */
const defaultFrom = "PriceLens <onboarding@resend.dev>";

export function createMailer(environment: Record<string, string | undefined> = process.env, request: typeof fetch = fetch): Mailer {
  const to = environment.LPL_FEEDBACK_EMAIL_TO?.trim();
  const apiKey = environment.LPL_RESEND_API_KEY?.trim();
  if (!to || !apiKey) return { configured: false, send: async () => undefined };
  const from = environment.LPL_MAIL_FROM?.trim() || defaultFrom;
  return {
    configured: true,
    send: async (message) => {
      const response = await request(resendEndpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, ...(message.replyTo ? { reply_to: message.replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`RESEND_HTTP_${response.status}: ${detail.slice(0, 200)}`);
      }
    },
  };
}

export function feedbackMessage(item: FeedbackItem): MailMessage {
  const kind = item.kind === "bug" ? "Bug report" : "Feedback";
  const lines = [
    `${kind} from the price site`,
    "",
    item.message,
    "",
    `Page: ${item.page ?? "unknown"}`,
    `From: ${item.email ?? "anonymous"}`,
    `Browser: ${item.user_agent ?? "unknown"}`,
    `Received: ${item.created_at}`,
    `Id: ${item.id}`,
  ];
  return { subject: `[PriceLens] ${kind}: ${item.message.slice(0, 60).replace(/\s+/gu, " ")}${item.message.length > 60 ? "…" : ""}`, text: lines.join("\n"), replyTo: item.email ?? undefined };
}
