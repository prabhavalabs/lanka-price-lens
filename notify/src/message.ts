import { z } from "zod";

/**
 * The one shape every notification takes before a channel renders it. A composer (a price
 * digest, a feedback forward, another application's alert) builds a Message; the channel
 * decides how a title, a summary, a few sections of lines, an image, and some links look in
 * a Telegram chat, a Discord embed, a Slack post, an email, or a push notification.
 *
 * Lines carry structured parts (a value, a signed percentage change, a note, a link) so each
 * channel can format them in its own idiom instead of receiving pre-rendered text.
 */

export const severities = ["info", "good", "warn", "alert"] as const;
export type Severity = (typeof severities)[number];

export const lineSchema = z.object({
  /** What the line is about: "Big onion at Keells". */
  text: z.string().trim().min(1).max(200),
  /** The figure, already formatted: "Rs 370 / kg". */
  value: z.string().trim().max(80).optional(),
  /** Signed percentage change; -12.5 reads as down 12.5%. */
  change: z.number().finite().optional(),
  /** Context after the figure: "was Rs 420 yesterday". */
  note: z.string().trim().max(200).optional(),
  url: z.url().max(2000).optional(),
});

export const sectionSchema = z.object({
  heading: z.string().trim().max(120).optional(),
  lines: z.array(lineSchema).max(50),
});

export const actionSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.url().max(2000),
});

export const messageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** One or two plain-text paragraphs under the title. */
  summary: z.string().trim().max(4000).optional(),
  sections: z.array(sectionSchema).max(20).default([]),
  /** Links the reader can follow; the first one is where a push notification opens. */
  actions: z.array(actionSchema).max(5).default([]),
  image: z.object({ url: z.url().max(2000), alt: z.string().trim().max(200).optional() }).optional(),
  /** More pictures for a channel that posts a set of them at once (an Instagram carousel, a Facebook album). A channel that shows only one uses `image`. */
  images: z.array(z.object({ url: z.url().max(2000), alt: z.string().trim().max(200).optional() })).max(10).optional(),
  footer: z.string().trim().max(500).optional(),
  severity: z.enum(severities).default("info"),
  /** Two messages with the same key for the same target are one message; the outbox drops the repeat. */
  dedupe_key: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export type Message = z.infer<typeof messageSchema>;
export type MessageInput = z.input<typeof messageSchema>;
export type Line = z.infer<typeof lineSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Action = z.infer<typeof actionSchema>;

/** Validates and normalises a message; throws a ZodError naming the field when the input is not one. */
export function message(input: MessageInput): Message {
  return messageSchema.parse(input);
}

/** The same check without throwing, for input that arrived over the network. */
export function parseMessage(input: unknown): { ok: true; message: Message } | { ok: false; error: string } {
  const result = messageSchema.safeParse(input);
  if (result.success) return { ok: true, message: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join(".") || "message"}: ${issue.message}` : "Invalid message" };
}

/** "+12.5%", "-3%", "0%": the change of a line as text, with the sign always shown. */
export function formatChange(change: number): string {
  const rounded = Math.round(change * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** Cuts text to `limit` characters on a word boundary and marks the cut with an ellipsis. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(0, limit - 1));
  if (text[limit - 1] === " ") return `${cut}…`;
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > limit * 0.6 ? cut.slice(0, boundary) : cut}…`;
}
