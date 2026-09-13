import { formatChange, type Message, type Severity } from "../message.ts";
import { lineText } from "./text.ts";

/**
 * One Discord embed per message. A section with a heading becomes one field holding its
 * lines; a section without a heading becomes one small inline field per line (label and
 * value), which suits key-value summaries such as "Page / From / Received".
 */

export type DiscordEmbed = {
  title: string;
  description?: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  image?: { url: string };
  footer?: { text: string };
};

export const discordColours: Record<Severity, number> = { info: 0x5b8def, good: 0x3ddc97, warn: 0xf5a524, alert: 0xe5484d };

const limits = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, fields: 25, footer: 2048 } as const;

function markdownLine(line: Parameters<typeof lineText>[0]): string {
  const label = line.url ? `[${line.text}](${line.url})` : line.text;
  const parts = [`• ${label}`];
  if (line.value) parts.push(`: **${line.value}**`);
  if (line.change !== undefined) parts.push(` (${formatChange(line.change)})`);
  if (line.note) parts.push(` _${line.note}_`);
  return parts.join("");
}

export function discordEmbed(message: Message): DiscordEmbed {
  const fields: DiscordEmbed["fields"] = [];
  for (const section of message.sections) {
    if (section.heading) {
      fields.push({ name: section.heading.slice(0, limits.fieldName), value: (section.lines.map(markdownLine).join("\n") || "—").slice(0, limits.fieldValue), inline: false });
    } else {
      for (const line of section.lines) fields.push({ name: line.text.slice(0, limits.fieldName), value: ([line.value, line.change !== undefined ? formatChange(line.change) : null, line.note].filter(Boolean).join(" ") || "—").slice(0, limits.fieldValue), inline: true });
    }
  }
  const description = [message.summary, message.actions.length ? message.actions.map((action) => `[${action.label}](${action.url})`).join(" · ") : null].filter(Boolean).join("\n\n");
  const embed: DiscordEmbed = { title: message.title.slice(0, limits.title), color: discordColours[message.severity], fields: fields.slice(0, limits.fields) };
  if (description) embed.description = description.slice(0, limits.description);
  if (message.image) embed.image = { url: message.image.url };
  if (message.footer) embed.footer = { text: message.footer.slice(0, limits.footer) };
  return embed;
}
