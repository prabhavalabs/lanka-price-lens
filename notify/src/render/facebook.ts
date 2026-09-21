import { formatChange, type Line, type Message } from "../message.ts";

/**
 * A Facebook Page post is plain text: no markup survives, and a bare address in the text
 * becomes a link on its own. Lines therefore go without their own links (a post with a dozen
 * addresses reads as spam); the message's actions carry the links at the foot. Facebook folds
 * a long post behind "See more", so the default room is a few screens, far below its limit.
 */

export const facebookPostLimit = 2000;

export function facebookLine(line: Line): string {
  const parts = [`• ${line.text}`];
  if (line.value) parts.push(`: ${line.value}`);
  if (line.change !== undefined) parts.push(` (${formatChange(line.change)})`);
  if (line.note) parts.push(` — ${line.note}`);
  return parts.join("");
}

/**
 * Title, summary, sections, links, footer, in the order every channel keeps. The title, the
 * summary, the links, and the footer stay whole; section lines fill the room between them and
 * a dropped remainder is marked with an ellipsis line.
 */
export function facebookText(message: Message, limit = facebookPostLimit): string {
  const head = [message.title, ...(message.summary ? [message.summary] : [])];
  const hashtags = message.tags.length ? message.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ") : "";
  const tail = [
    ...(message.actions.length ? [message.actions.map((action) => `${action.label}: ${action.url}`).join("\n")] : []),
    ...(message.footer ? [message.footer] : []),
    ...(hashtags ? [hashtags] : []),
  ];
  const size = (blocks: string[]): number => blocks.reduce((sum, block, index) => sum + block.length + (index ? 2 : 0), 0);
  const kept = [...head];
  const tailKept = size([...head, ...tail]) <= limit ? tail : [];
  const room = limit - (tailKept.length ? size(tailKept) + 2 : 0);
  let cut = false;
  for (const section of message.sections) {
    if (cut) break;
    const lines: string[] = [];
    for (const entry of [section.heading?.toUpperCase(), ...section.lines.map(facebookLine)]) {
      if (!entry) continue;
      // Room for this line and, should the next one not fit, the ellipsis line after it.
      if (size([...kept, [...lines, entry].join("\n")]) + 2 > room) {
        cut = true;
        break;
      }
      lines.push(entry);
    }
    // A heading with nothing under it says nothing.
    if (lines.length > (section.heading ? 1 : 0)) kept.push(cut ? [...lines, "…"].join("\n") : lines.join("\n"));
  }
  return [...kept, ...tailKept].join("\n\n").slice(0, limit);
}
