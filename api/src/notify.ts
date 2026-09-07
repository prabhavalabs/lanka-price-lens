import type { FeedbackItem } from "./feedback.ts";

/**
 * Posts to the community Discord through an incoming webhook: every feedback message or bug report
 * goes to the staff inbox channel when `LPL_FEEDBACK_DISCORD_WEBHOOK` is set. Without it nothing is
 * sent. Like mail, posting never blocks or fails the request that triggered it.
 */

export type Notifier = { post: (note: Note) => Promise<void>; configured: boolean };
export type Note = { title: string; body: string; fields?: Array<{ name: string; value: string }> | undefined; colour?: number | undefined };

const webhookPattern = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/u;

export function createNotifier(environment: Record<string, string | undefined> = process.env, request: typeof fetch = fetch): Notifier {
  const url = environment.LPL_FEEDBACK_DISCORD_WEBHOOK?.trim();
  if (!url || !webhookPattern.test(url)) return { configured: false, post: async () => undefined };
  return {
    configured: true,
    post: async (note) => {
      const embed = { title: note.title.slice(0, 256), description: note.body.slice(0, 4000), color: note.colour ?? 0x3ddc97, fields: (note.fields ?? []).map((field) => ({ name: field.name.slice(0, 256), value: (field.value || "—").slice(0, 1024), inline: true })) };
      const response = await request(`${url}?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "PriceLens", embeds: [embed], allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`DISCORD_HTTP_${response.status}: ${detail.slice(0, 200)}`);
      }
    },
  };
}

/** The Discord post for one feedback item: the message, then where it came from. */
export function feedbackNote(item: FeedbackItem): Note {
  const bug = item.kind === "bug";
  return {
    title: bug ? "Bug report from the price site" : "Feedback from the price site",
    body: item.message,
    colour: bug ? 0xe5484d : 0x3ddc97,
    fields: [
      { name: "Page", value: item.page ?? "unknown" },
      { name: "From", value: item.email ?? "anonymous" },
      { name: "Received", value: item.created_at },
      { name: "Id", value: item.id },
    ],
  };
}
