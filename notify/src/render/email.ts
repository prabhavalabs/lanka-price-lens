import { formatChange, type Line, type Message, type Severity } from "../message.ts";
import { plainText } from "./text.ts";

/** A small, inline-styled HTML body that reads in every mail client, beside the plain text part. */

export function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

const accents: Record<Severity, string> = { info: "#5b8def", good: "#1f9d6a", warn: "#c97c10", alert: "#d13438" };

function htmlLine(line: Line): string {
  const label = line.url ? `<a href="${escapeHtml(line.url)}" style="color:#1a56db;text-decoration:none">${escapeHtml(line.text)}</a>` : escapeHtml(line.text);
  const change = line.change !== undefined ? ` <span style="color:${line.change < 0 ? "#1f9d6a" : line.change > 0 ? "#d13438" : "#6b7280"}">${escapeHtml(formatChange(line.change))}</span>` : "";
  const value = line.value ? ` <strong>${escapeHtml(line.value)}</strong>` : "";
  const note = line.note ? ` <span style="color:#6b7280">${escapeHtml(line.note)}</span>` : "";
  return `<li style="margin:0 0 6px 0">${label}${value ? `:${value}` : ""}${change}${note}</li>`;
}

export function emailHtml(message: Message): string {
  const parts: string[] = [];
  parts.push(`<h1 style="font-size:20px;margin:0 0 12px 0;border-left:4px solid ${accents[message.severity]};padding-left:10px">${escapeHtml(message.title)}</h1>`);
  if (message.summary) parts.push(`<p style="margin:0 0 16px 0;white-space:pre-line">${escapeHtml(message.summary)}</p>`);
  if (message.image) parts.push(`<p style="margin:0 0 16px 0"><img src="${escapeHtml(message.image.url)}" alt="${escapeHtml(message.image.alt ?? "")}" style="max-width:100%;height:auto;border-radius:8px"></p>`);
  for (const section of message.sections) {
    if (section.heading) parts.push(`<h2 style="font-size:15px;margin:16px 0 6px 0">${escapeHtml(section.heading)}</h2>`);
    parts.push(`<ul style="margin:0 0 12px 0;padding-left:18px">${section.lines.map(htmlLine).join("")}</ul>`);
  }
  if (message.actions.length) {
    parts.push(`<p style="margin:16px 0">${message.actions.map((action) => `<a href="${escapeHtml(action.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;background:#111827;color:#ffffff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a>`).join("")}</p>`);
  }
  if (message.footer) parts.push(`<p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;white-space:pre-line">${escapeHtml(message.footer)}</p>`);
  return `<!doctype html><html><body style="margin:0;padding:20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111827;background:#ffffff"><div style="max-width:600px;margin:0 auto">${parts.join("")}</div></body></html>`;
}

export function emailParts(message: Message): { subject: string; text: string; html: string } {
  return { subject: message.title.slice(0, 200), text: plainText(message), html: emailHtml(message) };
}

/**
 * What one target receives: the rendered message, unless its meta carries a `subject`, or a
 * ready-made `html` and `text` (a branded template that should pass through unchanged, with the
 * message left as the plain fallback). Empty overrides are ignored.
 */
export function emailContent(message: Message, meta: Record<string, unknown> | undefined): { subject: string; text: string; html: string } {
  const parts = emailParts(message);
  const subject = typeof meta?.subject === "string" && meta.subject.trim() ? meta.subject.trim().slice(0, 200) : parts.subject;
  const html = typeof meta?.html === "string" && meta.html.trim() ? meta.html : parts.html;
  const text = typeof meta?.text === "string" && meta.text.trim() ? meta.text : parts.text;
  return { subject, text, html };
}
