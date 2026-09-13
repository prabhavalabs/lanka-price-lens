import { createChannels, message, sendDirect, type ChannelRegistry, type Delivery, type FetchLike, type Message, type Target } from "@lanka-pricelens/notify";

import type { FeedbackItem } from "./feedback.ts";

/**
 * Notifications for the owner: every feedback message or bug report from the site is forwarded
 * to the addresses configured in the environment, through the shared notify channels.
 *
 * - `LPL_FEEDBACK_DISCORD_WEBHOOK`: a Discord webhook (the community's staff inbox channel).
 * - `LPL_FEEDBACK_EMAIL_TO` with `LPL_RESEND_API_KEY` (and `LPL_MAIL_FROM`): mail through Resend.
 *
 * Without any of them nothing is sent and the messages stay readable in the admin. Forwarding
 * never blocks or fails the request that triggered it; failures are returned for logging.
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

export function createOwnerNotifier(environment: Record<string, string | undefined> = process.env, request?: FetchLike): OwnerNotifier {
  const channels = ownerChannels(environment, request);
  const targets: Target[] = [];
  const webhook = environment.LPL_FEEDBACK_DISCORD_WEBHOOK?.trim();
  if (webhook) targets.push({ kind: "discord", address: webhook });
  const mailTo = environment.LPL_FEEDBACK_EMAIL_TO?.trim();
  if (mailTo && channels.has("email")) targets.push({ kind: "email", address: mailTo });
  return {
    configured: targets.length > 0,
    targets: targets.map((target) => channels.get(target.kind)?.describe(target) ?? target.kind),
    notify: async (note, options = {}) => {
      const results: Array<{ target: string; delivery: Delivery }> = [];
      for (const target of targets) {
        const addressed: Target = target.kind === "email" && options.replyTo ? { ...target, meta: { reply_to: options.replyTo } } : target;
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
  });
}
