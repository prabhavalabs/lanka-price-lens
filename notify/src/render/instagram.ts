import { formatChange, truncate, type Line, type Message } from "../message.ts";

/** Instagram's caption limit. Anything longer is refused outright, so the caption is cut to fit. */
export const instagramCaptionLimit = 2200;

/**
 * An Instagram caption. Plain text, because Instagram renders none: no bold, no links (an address
 * in a caption is shown but cannot be tapped). Lines therefore carry their figures inline and any
 * address is named in words at the foot, the way "link in bio" is meant.
 */
export function instagramLine(line: Line): string {
  const parts = [line.text];
  if (line.value) parts.push(line.value);
  if (line.change !== undefined) parts.push(formatChange(line.change));
  if (line.note) parts.push(line.note);
  return parts.join(" · ");
}

export function instagramText(message: Message, limit = instagramCaptionLimit): string {
  const blocks: string[] = [message.title];
  if (message.summary) blocks.push(message.summary);
  for (const section of message.sections) {
    const lines = section.lines.map(instagramLine);
    if (!lines.length) continue;
    blocks.push([section.heading, ...lines].filter(Boolean).join("\n"));
  }
  // The address is named, not linked: Instagram captions are not tappable.
  const links = message.actions.map((action) => `${action.label}: ${action.url.replace(/^https?:\/\//u, "").replace(/\/+$/u, "")}`);
  if (links.length) blocks.push(links.join("\n"));
  if (message.footer) blocks.push(message.footer);
  if (message.tags.length) blocks.push(message.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" "));
  return truncate(blocks.join("\n\n"), limit);
}
