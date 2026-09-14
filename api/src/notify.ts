import { createChannels, formatChange, message, parseMailbox, sendDirect, type ChannelRegistry, type Delivery, type FetchLike, type Message, type Target } from "@lanka-pricelens/notify";

import type { FeedbackItem } from "./feedback.ts";
import { renderLayout, type ContentBlock, type RenderedMail } from "./mail/layout.ts";
import { markUrlFor } from "./mail/templates.ts";

/**
 * Notifications for the owner: every feedback message or bug report from the site is forwarded
 * to the addresses configured in the environment, through the shared notify channels.
 *
 * - `LPL_FEEDBACK_DISCORD_WEBHOOK`: a Discord webhook (the community's staff inbox channel).
 * - `LPL_FEEDBACK_EMAIL_TO` with `LPL_RESEND_API_KEY` (and `LPL_MAIL_FROM`): mail through Resend.
 *
 * Without any of them nothing is sent and the messages stay readable in the admin. Forwarding
 * never blocks or fails the request that triggered it; failures are returned for logging. Mail
 * goes out in the site's branded layout (`renderOwnerNotice`); Discord keeps the message as
 * the notify package renders it.
 */

export type OwnerNotifier = {
  configured: boolean;
  /** Where the owner's notifications go, masked, for the admin and logs. */
  targets: string[];
  notify: (note: Message, options?: { replyTo?: string | undefined }) => Promise<Array<{ target: string; delivery: Delivery }>>;
};

/** Resend's shared test sender, allowed before a domain is verified; a verified address on the owner's domain is better. */
export const defaultMailFrom = "PriceLens <onboarding@resend.dev>";

export function ownerChannels(environment: Record<string, string | undefined> = process.env, request?: FetchLike): ChannelRegistry {
  const apiKey = environment.LPL_RESEND_API_KEY?.trim();
  return createChannels({ email: apiKey ? { apiKey, from: environment.LPL_MAIL_FROM?.trim() || defaultMailFrom } : null, fetch: request });
}

export type OwnerNoticeOptions = {
  markUrl?: string | undefined;
  siteOrigin?: string | null | undefined;
  /** The address the footer names for replies: the reader who wrote in, else the sender. */
  replyTo?: string | undefined;
};

const titlePrefix = /^\[PriceLens\]\s*/u;
const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A notice for the owner in the site's mail layout: the message's tags as the kicker, its
 * title as the headline, its summary as the paragraphs, each section's lines as fact rows,
 * and its first action as the button. Pure, so the wording can be checked without sending.
 */
export function renderOwnerNotice(note: Message, options: OwnerNoticeOptions = {}): RenderedMail {
  const blocks: ContentBlock[] = note.sections
    .filter((section) => section.lines.length > 0)
    .map((section) => ({
      type: "facts",
      heading: section.heading ?? null,
      rows: section.lines.map((line) => ({
        label: line.text,
        value: line.value ?? line.url ?? "",
        url: line.url ?? null,
        note: [line.change === undefined ? null : formatChange(line.change), line.note ?? null].filter((part): part is string => part !== null).join(" · ") || null,
      })),
    }));
  const action = note.actions[0];
  const summary = (note.summary ?? "").split(/\n+/u).map((line) => line.trim()).filter((line) => line.length > 0);
  // "Bug report: The chart shows…" repeats the summary it excerpts; the headline keeps the kind and leaves the words to the paragraph.
  const bare = note.title.replace(titlePrefix, "").trim() || note.title;
  const colon = bare.indexOf(": ");
  const excerpt = colon > 0 ? bare.slice(colon + 2).replace(/…$/u, "") : "";
  const headline = excerpt && note.summary?.startsWith(excerpt) ? bare.slice(0, colon) : bare;
  return renderLayout(
    {
      subject: note.title.slice(0, 200),
      preheader: summary[0] ?? "",
      kicker: note.tags.length ? note.tags.map(capitalise).join(" · ") : "For the owner",
      headline,
      intro: summary,
      blocks,
      outro: note.footer ? [note.footer] : [],
      button: action ? { label: action.label, url: action.url } : null,
      reason: "You're getting this email because you look after PriceLens: feedback from the site and community contributions come to this address.",
      reasonStyle: "footer",
      unsubscribeUrl: null,
    },
    { markUrl: options.markUrl ?? markUrlFor(options.siteOrigin), siteOrigin: options.siteOrigin, ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}) },
  );
}

export function createOwnerNotifier(environment: Record<string, string | undefined> = process.env, request?: FetchLike): OwnerNotifier {
  const channels = ownerChannels(environment, request);
  const targets: Target[] = [];
  const webhook = environment.LPL_FEEDBACK_DISCORD_WEBHOOK?.trim();
  if (webhook) targets.push({ kind: "discord", address: webhook });
  const mailTo = environment.LPL_FEEDBACK_EMAIL_TO?.trim();
  if (mailTo && channels.has("email")) targets.push({ kind: "email", address: mailTo });
  const siteOrigin = environment.LPL_SITE_ORIGIN?.trim() || null;
  const senderAddress = parseMailbox(environment.LPL_MAIL_FROM?.trim() || defaultMailFrom).email;
  return {
    configured: targets.length > 0,
    targets: targets.map((target) => channels.get(target.kind)?.describe(target) ?? target.kind),
    notify: async (note, options = {}) => {
      const results: Array<{ target: string; delivery: Delivery }> = [];
      for (const target of targets) {
        let addressed: Target = target;
        if (target.kind === "email") {
          const rendered = renderOwnerNotice(note, { siteOrigin, replyTo: options.replyTo ?? senderAddress });
          addressed = { ...target, meta: { ...(options.replyTo ? { reply_to: options.replyTo } : {}), subject: rendered.subject, html: rendered.html, text: rendered.text } };
        }
        results.push({ target: channels.get(target.kind)?.describe(target) ?? target.kind, delivery: await sendDirect(channels, addressed, note) });
      }
      return results;
    },
  };
}

/** The notification for one feedback item: the message, then where it came from. */
export function feedbackMessage(item: FeedbackItem): Message {
  const bug = item.kind === "bug";
  const kind = bug ? "Bug report" : "Feedback";
  const excerpt = item.message.slice(0, 60).replace(/\s+/gu, " ");
  return message({
    title: `[PriceLens] ${kind}: ${excerpt}${item.message.length > 60 ? "…" : ""}`,
    summary: item.message,
    severity: bug ? "alert" : "good",
    sections: [
      {
        lines: [
          { text: "Page", value: item.page ?? "unknown" },
          { text: "From", value: item.email ?? "anonymous" },
          { text: "Browser", value: item.user_agent ?? "unknown" },
          { text: "Received", value: item.created_at },
          { text: "Id", value: item.id },
        ],
      },
    ],
    dedupe_key: `feedback:${item.id}`,
    tags: ["feedback", item.kind],
  });
}
