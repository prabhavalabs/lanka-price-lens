import { formatChange, type Line, type Message } from "../message.ts";
import { plainText } from "./text.ts";

/**
 * Slack Block Kit: a header, the summary, one section block per message section, the image,
 * link buttons, and a context footer. mrkdwn needs &, <, > escaped and writes links as <url|label>.
 */

export type SlackBlock = Record<string, unknown>;

export function escapeMrkdwn(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function mrkdwnLine(line: Line): string {
  const label = line.url ? `<${line.url}|${escapeMrkdwn(line.text)}>` : escapeMrkdwn(line.text);
  const parts = [`• ${label}`];
  if (line.value) parts.push(`: *${escapeMrkdwn(line.value)}*`);
  if (line.change !== undefined) parts.push(` (${formatChange(line.change)})`);
  if (line.note) parts.push(` _${escapeMrkdwn(line.note)}_`);
  return parts.join("");
}

export function slackBlocks(message: Message): SlackBlock[] {
  const blocks: SlackBlock[] = [{ type: "header", text: { type: "plain_text", text: message.title.slice(0, 150), emoji: true } }];
  if (message.summary) blocks.push({ type: "section", text: { type: "mrkdwn", text: escapeMrkdwn(message.summary).slice(0, 3000) } });
  for (const section of message.sections) {
    const text = [section.heading ? `*${escapeMrkdwn(section.heading)}*` : null, ...section.lines.map(mrkdwnLine)].filter(Boolean).join("\n");
    if (text) blocks.push({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 3000) } });
  }
  if (message.image) blocks.push({ type: "image", image_url: message.image.url, alt_text: (message.image.alt ?? message.title).slice(0, 2000) });
  if (message.actions.length) {
    blocks.push({
      type: "actions",
      elements: message.actions.map((action, index) => ({ type: "button", text: { type: "plain_text", text: action.label.slice(0, 75), emoji: true }, url: action.url, action_id: `link_${index}` })),
    });
  }
  if (message.footer) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: escapeMrkdwn(message.footer).slice(0, 2000) }] });
  return blocks.slice(0, 50);
}

/** The payload an incoming webhook accepts: blocks plus the plain text notifications and old clients show. */
export function slackPayload(message: Message): { text: string; blocks: SlackBlock[] } {
  return { text: plainText(message, { links: false }).slice(0, 4000), blocks: slackBlocks(message) };
}
