import { createTransport, type Transporter } from "nodemailer";

import type { FeedbackItem } from "./feedback.ts";

/**
 * Outgoing mail for the owner: every feedback message or bug report is forwarded to the address
 * in `LPL_FEEDBACK_EMAIL_TO` through the SMTP server in `LPL_SMTP_URL`
 * (`smtps://user:password@smtp.example.com:465`). Without both, nothing is sent and the messages
 * stay readable in the admin. Sending never blocks or fails the request that triggered it.
 */

export type Mailer = { send: (message: { subject: string; text: string; replyTo?: string | undefined }) => Promise<void>; configured: boolean };

export function createMailer(environment: Record<string, string | undefined> = process.env, transport?: Transporter): Mailer {
  const to = environment.LPL_FEEDBACK_EMAIL_TO?.trim();
  const url = environment.LPL_SMTP_URL?.trim();
  if (!to || (!url && !transport)) return { configured: false, send: async () => undefined };
  const from = environment.LPL_MAIL_FROM?.trim() || `PriceLens <${new URL(url ?? "smtp://pricelens@localhost").username ? decodeURIComponent(new URL(url ?? "smtp://pricelens@localhost").username) : "pricelens@localhost"}>`;
  const transporter = transport ?? createTransport(url!);
  return {
    configured: true,
    send: async (message) => {
      await transporter.sendMail({ from, to, subject: message.subject, text: message.text, replyTo: message.replyTo });
    },
  };
}

export function feedbackMessage(item: FeedbackItem): { subject: string; text: string; replyTo?: string | undefined } {
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
