import { escapeHtml, formatChange } from "@lanka-pricelens/notify";

/**
 * The one branded layout every mail the site sends is poured into: the PriceLens mark and
 * wordmark, a white card with a headline, a sentence or two, optional content blocks (recipe
 * cards, deal rows), a sentence or two more, one button with its link written out beneath,
 * and a footer saying why the mail came and where to reply. Tables and inline styles so it
 * reads the same in Gmail, Outlook, and Apple Mail; light only; no external CSS. The mark is
 * the only remote image besides the recipe card pictures, and the wordmark beside it carries
 * the name when a client blocks images. Every block also has a plain-text rendering.
 */

/** The sender account mail goes out as when the environment names none. */
export const defaultMailFrom = "PriceLens <hello@prabhavalabs.com>";
/** The address the footer invites replies to when the sender is the default. */
export const defaultReplyTo = "hello@prabhavalabs.com";
/** The mark as served by the public site; mail needs an absolute address a mail client can fetch. */
export const defaultMarkUrl = "https://price.prabhavalabs.com/mark.png";

export type RenderedMail = { subject: string; html: string; text: string };

export type RecipeCard = {
  /** An absolute image URL (the site's OG card), or null for a card without a picture. */
  image: string | null;
  name: string;
  /** One line about the dish. */
  summary: string;
  kcal: number | null;
  minutes: number | null;
  /** Already worded: "Rs 120 per serving". Null when no price is known. */
  cost: string | null;
  url: string;
};

export type DealRow = {
  product: string;
  store: string;
  /** Already worded: "Rs 370 / kg". */
  now: string;
  /** The comparison, as a whole phrase: "was Rs 420 / kg yesterday", "next store Rs 440 / kg". Null when there is none. */
  was: string | null;
  /** Signed percentage; negative is a drop. Null shows no badge. */
  pct: number | null;
  url: string | null;
};

export type ContentBlock =
  | { type: "recipes"; heading: string | null; cards: RecipeCard[] }
  | { type: "deals"; heading: string | null; rows: DealRow[]; note: string | null };

/** What the layout is given: plain text everywhere, escaped here. */
export type MailContent = {
  subject: string;
  /** The hidden preview line clients show beside the subject; the first intro paragraph when empty. */
  preheader: string;
  headline: string;
  /** Paragraphs before the blocks. */
  intro: string[];
  blocks: ContentBlock[];
  /** Paragraphs after the blocks, before the button. */
  outro: string[];
  button: { label: string; url: string } | null;
  /** Why the person received the mail, and what to do if it was not them. */
  reason: string;
  /** A one-click unsubscribe link for the footer; newsletters only. */
  unsubscribeUrl: string | null;
};

export type LayoutOptions = {
  /** The address the footer invites replies to; the default sender's address when unset. */
  replyTo?: string | undefined;
  /** Where the mark at the top of every mail is fetched from; the production site when unset. */
  markUrl?: string | undefined;
};

const green = "#007f52";
const ink = "#1c2420";
const muted = "#5f6b66";
const ground = "#f4f6f5";
const border = "#e2e7e4";
const fonts = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = `font-family:${fonts};`;

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px 0;${font}font-size:16px;line-height:1.55;color:${ink};">${escapeHtml(text)}</p>`;
}

function heading(text: string | null): string {
  return text ? `<h2 style="margin:8px 0 12px 0;${font}font-size:17px;font-weight:700;line-height:1.3;color:${ink};">${escapeHtml(text)}</h2>` : "";
}

/** "320 kcal · 35 min · Rs 120 per serving": the facts under a recipe card's name, whichever are known. */
export function recipeFacts(card: Pick<RecipeCard, "kcal" | "minutes" | "cost">): string {
  const facts: string[] = [];
  if (card.kcal !== null) facts.push(`${Math.round(card.kcal)} kcal`);
  if (card.minutes !== null) facts.push(`${Math.round(card.minutes)} min`);
  if (card.cost) facts.push(card.cost);
  return facts.join(" · ");
}

function recipeCardsHtml(block: Extract<ContentBlock, { type: "recipes" }>): string {
  const cards = block.cards
    .map((card) => {
      const picture = card.image
        ? `<td width="120" valign="top" style="width:120px;padding:0 14px 0 0;"><a href="${escapeHtml(card.url)}" style="text-decoration:none;"><img alt="" src="${escapeHtml(card.image)}" width="120" height="63" style="display:block;width:120px;height:63px;border:0;border-radius:8px;background:${ground};"></a></td>`
        : "";
      const facts = recipeFacts(card);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;border:1px solid ${border};border-radius:10px;">
  <tr>
    <td style="padding:14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${picture}
          <td valign="top" style="${font}font-size:15px;line-height:1.45;color:${ink};">
            <a href="${escapeHtml(card.url)}" style="${font}font-size:17px;font-weight:700;line-height:1.3;color:${ink};text-decoration:none;">${escapeHtml(card.name)}</a>
            <div style="margin:4px 0 0 0;color:${ink};">${escapeHtml(card.summary)}</div>
            ${facts ? `<div style="margin:6px 0 0 0;${font}font-size:13px;color:${muted};">${escapeHtml(facts)}</div>` : ""}
            <div style="margin:8px 0 0 0;"><a href="${escapeHtml(card.url)}" style="${font}font-size:14px;font-weight:700;color:${green};text-decoration:none;">See the recipe</a></div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
    })
    .join("\n");
  return `${heading(block.heading)}\n${cards}`;
}

function badge(pct: number): string {
  const drop = pct < 0;
  const colour = drop ? green : muted;
  const background = drop ? "#e3f4ec" : "#eceff0";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${background};${font}font-size:12px;font-weight:700;line-height:1.4;color:${colour};white-space:nowrap;">${escapeHtml(formatChange(pct))}</span>`;
}

function dealRowsHtml(block: Extract<ContentBlock, { type: "deals" }>): string {
  const rows = block.rows
    .map((row, index) => {
      const product = row.url ? `<a href="${escapeHtml(row.url)}" style="color:${ink};font-weight:700;text-decoration:none;">${escapeHtml(row.product)}</a>` : `<span style="font-weight:700;">${escapeHtml(row.product)}</span>`;
      const was = row.was ? `<div style="${font}font-size:12px;color:${muted};">${escapeHtml(row.was)}</div>` : "";
      const top = index === 0 ? "" : `border-top:1px solid ${border};`;
      return `        <tr>
          <td valign="top" style="padding:10px 8px 10px 0;${top}${font}font-size:15px;line-height:1.4;color:${ink};">${product}<div style="${font}font-size:13px;color:${muted};">${escapeHtml(row.store)}</div></td>
          <td valign="top" align="right" style="padding:10px 8px 10px 0;${top}${font}font-size:15px;line-height:1.4;color:${ink};white-space:nowrap;"><strong>${escapeHtml(row.now)}</strong>${was}</td>
          <td valign="top" align="right" width="64" style="padding:10px 0;${top}width:64px;">${row.pct === null ? "" : badge(row.pct)}</td>
        </tr>`;
    })
    .join("\n");
  const note = block.note ? `<p style="margin:6px 0 0 0;${font}font-size:13px;line-height:1.5;color:${muted};">${escapeHtml(block.note)}</p>` : "";
  return `${heading(block.heading)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;">
${rows}
</table>
${note}`;
}

function blockHtml(block: ContentBlock): string {
  return block.type === "recipes" ? recipeCardsHtml(block) : dealRowsHtml(block);
}

function blockText(block: ContentBlock): string {
  if (block.type === "recipes") {
    const cards = block.cards.map((card) => {
      const facts = recipeFacts(card);
      return [`${card.name}: ${card.summary}`, facts ? `  ${facts}` : null, `  ${card.url}`].filter((line): line is string => line !== null).join("\n");
    });
    return [block.heading, ...cards].filter((line): line is string => Boolean(line)).join("\n\n");
  }
  const rows = block.rows.map((row) => {
    const parts = [`${row.product} at ${row.store}: ${row.now}`];
    if (row.was) parts.push(row.was);
    if (row.pct !== null) parts.push(formatChange(row.pct));
    const line = `${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join(", ")})` : ""}`;
    return row.url ? `${line}\n  ${row.url}` : line;
  });
  return [block.heading, rows.join("\n"), block.note].filter((line): line is string => Boolean(line)).join("\n\n");
}

/** Turns content into html and text. Pure: the wording and the escaping can be checked without sending anything. */
export function renderLayout(content: MailContent, options: LayoutOptions = {}): RenderedMail {
  const replyTo = options.replyTo ?? defaultReplyTo;
  const markUrl = options.markUrl ?? defaultMarkUrl;
  const intro = content.intro.map(paragraph).join("\n");
  const blocks = content.blocks.map(blockHtml).join("\n");
  const outro = content.outro.map(paragraph).join("\n");
  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 16px 0;">
  <tr>
    <td align="center" bgcolor="${green}" style="border-radius:8px;background:${green};">
      <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 28px;${font}font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.button.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0;${font}font-size:13px;line-height:1.5;color:${muted};">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(content.button.url)}" style="color:${green};word-break:break-all;">${escapeHtml(content.button.url)}</a></p>`
    : "";
  const preheader = content.preheader || content.intro[0] || content.headline;
  const unsubscribe = content.unsubscribeUrl ? `<p style="margin:0 0 8px 0;"><a href="${escapeHtml(content.unsubscribeUrl)}" style="color:${muted};">Unsubscribe</a> from this mail with one click.</p>` : "";
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${ground};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ground}" style="background:${ground};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td style="padding:0 0 20px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;"><img alt="" height="36" src="${escapeHtml(markUrl)}" style="display:block;width:36px;height:36px;border:0;" width="36"></td>
                <td style="padding-left:10px;${font}font-size:18px;font-weight:700;color:${ink};">PriceLens</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${border};border-radius:12px;padding:32px 28px;">
            <h1 style="margin:0 0 16px 0;${font}font-size:24px;font-weight:700;line-height:1.25;color:${ink};">${escapeHtml(content.headline)}</h1>
${intro}
${blocks}
${outro}
${button}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0 8px;${font}font-size:12px;line-height:1.5;color:${muted};">
            <p style="margin:0 0 8px 0;">${escapeHtml(content.reason)}</p>
            ${unsubscribe}
            <p style="margin:0;">Questions? Reply to this email or write to <a href="mailto:${escapeHtml(replyTo)}" style="color:${muted};">${escapeHtml(replyTo)}</a>. PriceLens, by Prabhava Labs.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
  const lines = [content.headline, ...content.intro, ...content.blocks.map(blockText), ...content.outro];
  if (content.button) lines.push(`${content.button.label}: ${content.button.url}`);
  lines.push(content.reason);
  if (content.unsubscribeUrl) lines.push(`Unsubscribe from this mail with one click: ${content.unsubscribeUrl}`);
  lines.push(`Questions? Reply to this email or write to ${replyTo}.\nPriceLens, by Prabhava Labs.`);
  return { subject: content.subject, html, text: `${lines.filter((line) => line.length > 0).join("\n\n")}\n` };
}
