import { formatChange, type Line, type Message } from "../message.ts";

/**
 * Telegram's HTML parse mode: only b, i, u, s, code, pre, a, and blockquote survive, and
 * every literal &, <, > must be escaped. Messages hold 4096 characters, photo captions 1024.
 */

export const telegramMessageLimit = 4096;
export const telegramCaptionLimit = 1024;

export function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

const arrows = { up: "▲", down: "▼", flat: "▬" } as const;

function changeMark(change: number): string {
  const arrow = change > 0 ? arrows.up : change < 0 ? arrows.down : arrows.flat;
  return `${arrow} ${formatChange(change)}`;
}

export function telegramLine(line: Line): string {
  const label = line.url ? `<a href="${escapeHtml(line.url)}">${escapeHtml(line.text)}</a>` : escapeHtml(line.text);
  const parts = [`• ${label}`];
  if (line.value) parts.push(` — <b>${escapeHtml(line.value)}</b>`);
  if (line.change !== undefined) parts.push(` ${changeMark(line.change)}`);
  if (line.note) parts.push(` <i>${escapeHtml(line.note)}</i>`);
  return parts.join("");
}

export function telegramHtml(message: Message, limit = telegramMessageLimit): string {
  const head: string[] = [`<b>${escapeHtml(message.title)}</b>`];
  if (message.summary) head.push(escapeHtml(message.summary));
  const tail: string[] = [];
  if (message.actions.length) tail.push(message.actions.map((action) => `<a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a>`).join(" · "));
  if (message.footer) tail.push(`<i>${escapeHtml(message.footer)}</i>`);
  const body = message.sections.map((section) => [section.heading ? `<b>${escapeHtml(section.heading)}</b>` : null, ...section.lines.map(telegramLine)].filter((entry): entry is string => Boolean(entry)));
  return fitHtml(head, body, tail, limit);
}

/**
 * Keeps the title, summary, links, and footer whole and fills the room between them with
 * section lines in order, never cutting inside a line or a tag; a dropped remainder is
 * marked with an ellipsis line. Blocks are separated by a blank line.
 */
function fitHtml(head: string[], body: string[][], tail: string[], limit: number): string {
  const length = (blocks: string[]): number => blocks.reduce((sum, block, index) => sum + block.length + (index ? 2 : 0), 0);
  let kept = [...head];
  // The tail is dropped only when even the head alone leaves no room for it.
  const tailKept = length([...head, ...tail]) <= limit ? tail : [];
  const trailer = tailKept.length ? 2 + length(tailKept) : 0;
  let used = length(kept);
  let truncated = false;
  for (const section of body) {
    if (truncated) break;
    let block = "";
    for (const line of section) {
      const separator = block ? 1 : 2;
      // Leave room for the ellipsis line should the next line not fit.
      if (used + separator + line.length + trailer + 3 > limit) {
        truncated = true;
        break;
      }
      block = block ? `${block}\n${line}` : line;
      used += separator + line.length;
    }
    if (block) kept.push(block);
  }
  if (truncated) {
    if (kept.length > head.length) kept = [...kept.slice(0, -1), `${kept.at(-1)}\n…`];
    else kept.push("…");
  }
  const text = [...kept, ...tailKept].join("\n\n");
  if (text.length <= limit) return text;
  // Only a head longer than the limit lands here: cut its text, tags stripped, on a character.
  const plain = text.replace(/<[^>]*>/gu, "");
  return `${plain.slice(0, Math.max(0, limit - 1))}…`;
}
