import { formatChange, type Line, type Message } from "../message.ts";

/**
 * The plain-text reading of a message: what an email's text part, a Slack fallback, or a log
 * line shows. Every other renderer follows the same order so a message reads the same on
 * every channel: title, summary, sections, links, footer.
 */

export function lineText(line: Line, options: { links?: boolean } = {}): string {
  const parts = [line.text];
  if (line.value) parts.push(`: ${line.value}`);
  if (line.change !== undefined) parts.push(` (${formatChange(line.change)})`);
  if (line.note) parts.push(` — ${line.note}`);
  if (options.links && line.url) parts.push(` ${line.url}`);
  return parts.join("");
}

export function plainText(message: Message, options: { links?: boolean } = {}): string {
  const links = options.links ?? true;
  const blocks: string[] = [message.title];
  if (message.summary) blocks.push(message.summary);
  for (const section of message.sections) {
    const lines = section.lines.map((line) => `• ${lineText(line, { links })}`);
    blocks.push([section.heading, ...lines].filter((entry): entry is string => Boolean(entry)).join("\n"));
  }
  if (links && message.actions.length) blocks.push(message.actions.map((action) => `${action.label}: ${action.url}`).join("\n"));
  if (message.footer) blocks.push(message.footer);
  return blocks.join("\n\n");
}

/** A one-paragraph digest for places with little room (a push notification body, a preview). */
export function shortText(message: Message, limit = 240): string {
  const first = message.summary || message.sections.flatMap((section) => section.lines).slice(0, 3).map((line) => lineText(line)).join("; ");
  const text = first.replace(/\s+/gu, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
