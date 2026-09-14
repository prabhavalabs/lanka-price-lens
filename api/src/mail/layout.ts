import { escapeHtml, formatChange } from "@lanka-pricelens/notify";

/**
 * The one branded layout every mail the site sends is poured into: a white card with a green
 * top edge, the PriceLens mark and wordmark as a letterhead, a small kicker naming the kind of
 * mail, a headline, a sentence or two, optional content blocks (recipe cards, deal rows, fact
 * rows), a sentence or two more, one button with its link written out beneath, and, for
 * account mail, a boxed note saying why the mail came (amber when it is a security notice).
 * Under the card a footer carries the site's links, the unsubscribe link for the daily mails,
 * the reply address, and "Made in Sri Lanka". Tables and inline styles so it reads the same in
 * Gmail, Outlook, and Apple Mail; light only; no external CSS; the mark and the recipe card
 * pictures are the only remote images, and the wordmark beside the mark carries the name when
 * a client blocks images. Every block also has a plain-text rendering.
 */

/** The sender account mail goes out as when the environment names none. */
export const defaultMailFrom = "PriceLens <hello@prabhavalabs.com>";
/** The address the footer invites replies to when the sender is the default. */
export const defaultReplyTo = "hello@prabhavalabs.com";
/** Where the site lives; the footer's links point there unless the layout is told otherwise. */
export const defaultSiteOrigin = "https://price.prabhavalabs.com";
/** The mark as served by the public site; mail needs an absolute address a mail client can fetch. */
export const defaultMarkUrl = `${defaultSiteOrigin}/mark.png`;

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

/** A labelled value, as the owner's notices list them: "From: Amal <amal@example.com>". */
export type FactRow = {
  label: string;
  value: string;
  url: string | null;
  note: string | null;
};

export type ContentBlock =
  | { type: "recipes"; heading: string | null; cards: RecipeCard[] }
  | { type: "deals"; heading: string | null; rows: DealRow[]; note: string | null }
  | { type: "facts"; heading: string | null; rows: FactRow[] };

/** Where the reason line sits: boxed in the card as a note or a warning, or in the footer. */
export type ReasonStyle = "note" | "warning" | "footer";

/** What the layout is given: plain text everywhere, escaped here. */
export type MailContent = {
  subject: string;
  /** The hidden preview line clients show beside the subject; the first intro paragraph when empty. */
  preheader: string;
  /** Small capitals above the headline naming the kind of mail ("Daily recipes · Monday 15 September"); null hides it. */
  kicker: string | null;
  headline: string;
  /** Paragraphs before the blocks. */
  intro: string[];
  blocks: ContentBlock[];
  /** Paragraphs after the blocks, before the button. */
  outro: string[];
  button: { label: string; url: string } | null;
  /** Why the person received the mail, and what to do if it was not them. */
  reason: string;
  reasonStyle: ReasonStyle;
  /** A one-click unsubscribe link for the footer; newsletters only. */
  unsubscribeUrl: string | null;
};

export type LayoutOptions = {
  /** The address the footer invites replies to; the default sender's address when unset. */
  replyTo?: string | undefined;
  /** Where the mark at the top of every mail is fetched from; the production site when unset. */
  markUrl?: string | undefined;
  /** Where the footer's links point; the production site when unset. */
  siteOrigin?: string | null | undefined;
};

export const mailColours = {
  green: "#0c7c53",
  greenDeep: "#085a3c",
  greenTint: "#e4f3ec",
  amber: "#d9962b",
  amberTint: "#fff7e6",
  amberLine: "#f1dcae",
  red: "#b42318",
  redTint: "#fdecea",
  ink: "#1c2420",
  muted: "#5f6b66",
  faint: "#8a948f",
  ground: "#eef3f0",
  card: "#ffffff",
  border: "#dfe7e2",
  rule: "#e8eeea",
  chip: "#f1f5f3",
} as const;

const { green, greenDeep, greenTint, amber, amberTint, amberLine, red, redTint, ink, muted, faint, ground, card, border, rule, chip } = mailColours;
const fonts = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = `font-family:${fonts};`;
/** The card's inner width: 600, less the card's border and its padding. */
const innerWidth = 534;
/** A recipe picture fills the card less its own border, at the OG card's 1200 × 630 shape. */
const pictureWidth = innerWidth - 2;
const pictureHeight = Math.round((pictureWidth * 630) / 1200);

const link = (href: string, text: string, style: string): string => `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(text)}</a>`;

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;${font}font-size:16px;line-height:1.6;color:${ink};">${escapeHtml(text)}</p>`;
}

function heading(text: string | null): string {
  return text ? `<h2 style="margin:24px 0 12px 0;${font}font-size:18px;font-weight:700;line-height:1.3;color:${ink};">${escapeHtml(text)}</h2>` : "";
}

function note(text: string | null): string {
  return text ? `<p style="margin:0 0 8px 0;${font}font-size:13px;line-height:1.5;color:${muted};">${escapeHtml(text)}</p>` : "";
}

/** A rounded frame around a block's rows. */
function frame(inner: string, margin = "0 0 16px 0"): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};border:1px solid ${border};border-radius:12px;">
  <tr>
    <td style="padding:2px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${inner}
      </table>
    </td>
  </tr>
</table>`;
}

/** "320 kcal · 35 min · Rs 120 per serving": the facts under a recipe card's name, whichever are known. */
export function recipeFacts(card: Pick<RecipeCard, "kcal" | "minutes" | "cost">): string {
  return recipeFactList(card).join(" · ");
}

function recipeFactList(card: Pick<RecipeCard, "kcal" | "minutes" | "cost">): string[] {
  const facts: string[] = [];
  if (card.kcal !== null) facts.push(`${Math.round(card.kcal)} kcal`);
  if (card.minutes !== null) facts.push(`${Math.round(card.minutes)} min`);
  if (card.cost) facts.push(card.cost);
  return facts;
}

function chipHtml(text: string): string {
  return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;background:${chip};${font}font-size:13px;font-weight:600;line-height:1.4;color:${muted};white-space:nowrap;">${escapeHtml(text)}</span>`;
}

function recipeCardsHtml(block: Extract<ContentBlock, { type: "recipes" }>): string {
  const cards = block.cards
    .map((entry) => {
      const picture = entry.image
        ? `  <tr>
    <td style="padding:0;"><a href="${escapeHtml(entry.url)}" style="display:block;text-decoration:none;"><img alt="" src="${escapeHtml(entry.image)}" width="${pictureWidth}" height="${pictureHeight}" style="display:block;width:100%;max-width:${pictureWidth}px;height:auto;border:0;border-radius:13px 13px 0 0;background:${ground};"></a></td>
  </tr>
`
        : "";
      const chips = recipeFactList(entry).map(chipHtml).join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border:1px solid ${border};border-radius:14px;">
${picture}  <tr>
    <td style="padding:18px 20px 16px 20px;">
      ${link(entry.url, entry.name, `${font}font-size:19px;font-weight:700;line-height:1.3;color:${ink};text-decoration:none;`)}
      <div style="margin:6px 0 0 0;${font}font-size:15px;line-height:1.55;color:${ink};">${escapeHtml(entry.summary)}</div>
      ${chips ? `<div style="margin:12px 0 0 0;">${chips}</div>` : ""}
      <div style="margin:${chips ? "8px" : "14px"} 0 0 0;">${link(entry.url, "See the recipe →", `${font}font-size:14px;font-weight:700;color:${green};text-decoration:none;`)}</div>
    </td>
  </tr>
</table>`;
    })
    .join("\n");
  return `${heading(block.heading)}\n${cards}`;
}

function badge(pct: number): string {
  const drop = pct < 0;
  const up = pct > 0;
  const colour = drop ? greenDeep : up ? red : muted;
  const background = drop ? greenTint : up ? redTint : chip;
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${background};${font}font-size:12px;font-weight:700;line-height:1.4;color:${colour};white-space:nowrap;">${escapeHtml(formatChange(pct))}</span>`;
}

function dealRowsHtml(block: Extract<ContentBlock, { type: "deals" }>): string {
  // Product, store, and the comparison stack on the left; the price and its badge sit on the right, so a long comparison never squeezes the price.
  const rows = block.rows
    .map((row, index) => {
      const product = row.url ? link(row.url, row.product, `color:${ink};font-weight:700;text-decoration:none;`) : `<span style="font-weight:700;">${escapeHtml(row.product)}</span>`;
      const was = row.was ? `<div style="margin:2px 0 0 0;${font}font-size:12px;line-height:1.4;color:${faint};">${escapeHtml(row.was)}</div>` : "";
      const top = index === 0 ? "" : `border-top:1px solid ${rule};`;
      return `        <tr>
          <td valign="middle" style="padding:12px 12px 12px 0;${top}${font}font-size:15px;line-height:1.4;color:${ink};">${product}<div style="${font}font-size:13px;color:${muted};">${escapeHtml(row.store)}</div>${was}</td>
          <td valign="middle" align="right" style="padding:12px 0;${top}${font}font-size:16px;line-height:1.4;color:${ink};white-space:nowrap;"><strong>${escapeHtml(row.now)}</strong>${row.pct === null ? "" : `<div style="margin:4px 0 0 0;">${badge(row.pct)}</div>`}</td>
        </tr>`;
    })
    .join("\n");
  return `${heading(block.heading)}
${frame(rows, block.note ? "0 0 8px 0" : "0 0 16px 0")}
${note(block.note)}`;
}

function factRowsHtml(block: Extract<ContentBlock, { type: "facts" }>): string {
  const rows = block.rows
    .map((row, index) => {
      const top = index === 0 ? "" : `border-top:1px solid ${rule};`;
      const value = row.url ? link(row.url, row.value, `color:${green};font-weight:600;text-decoration:none;word-break:break-word;`) : `<span style="word-break:break-word;">${escapeHtml(row.value)}</span>`;
      const aside = row.note ? ` <span style="color:${muted};">${escapeHtml(row.note)}</span>` : "";
      return `        <tr>
          <td valign="top" width="120" style="padding:11px 12px 11px 0;${top}width:120px;${font}font-size:13px;font-weight:600;line-height:1.5;color:${muted};">${escapeHtml(row.label)}</td>
          <td valign="top" style="padding:11px 0;${top}${font}font-size:15px;line-height:1.5;color:${ink};">${value}${aside}</td>
        </tr>`;
    })
    .join("\n");
  return `${heading(block.heading)}
${frame(rows)}`;
}

function blockHtml(block: ContentBlock): string {
  switch (block.type) {
    case "recipes":
      return recipeCardsHtml(block);
    case "deals":
      return dealRowsHtml(block);
    case "facts":
      return factRowsHtml(block);
  }
}

function blockText(block: ContentBlock): string {
  if (block.type === "recipes") {
    const cards = block.cards.map((entry) => {
      const facts = recipeFacts(entry);
      return [`${entry.name}: ${entry.summary}`, facts ? `  ${facts}` : null, `  ${entry.url}`].filter((line): line is string => line !== null).join("\n");
    });
    return [block.heading, ...cards].filter((line): line is string => Boolean(line)).join("\n\n");
  }
  if (block.type === "facts") {
    const rows = block.rows.map((row) => `${row.label}: ${row.value}${row.note ? ` (${row.note})` : ""}${row.url ? `\n  ${row.url}` : ""}`);
    return [block.heading, rows.join("\n")].filter((line): line is string => Boolean(line)).join("\n\n");
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

/** The site's pages the footer links, in order. */
export function footerLinks(origin: string): Array<{ label: string; url: string }> {
  return [
    { label: "Prices", url: `${origin}/` },
    { label: "Recipes", url: `${origin}/recipes` },
    { label: "Wishlist", url: `${origin}/account#wishlist` },
    { label: "Guide", url: `${origin}/guide` },
  ];
}

const footerLink = (href: string, text: string): string => link(href, text, `${font}font-size:13px;font-weight:600;color:${green};text-decoration:none;`);
const footerLine = (inner: string, margin = "0 0 10px 0"): string => `<p style="margin:${margin};${font}font-size:13px;line-height:1.6;color:${muted};">${inner}</p>`;

/** Gmail pads the inbox preview with body text; enough invisible characters after the preheader keep it to the preheader. */
const preheaderPadding = "&#847;&zwnj;&nbsp;".repeat(60);

/** Turns content into html and text. Pure: the wording and the escaping can be checked without sending anything. */
export function renderLayout(content: MailContent, options: LayoutOptions = {}): RenderedMail {
  const replyTo = options.replyTo ?? defaultReplyTo;
  const markUrl = options.markUrl ?? defaultMarkUrl;
  const origin = (options.siteOrigin?.trim() || defaultSiteOrigin).replace(/\/+$/u, "");
  const kicker = content.kicker ? `<p style="margin:0 0 10px 0;${font}font-size:12px;font-weight:700;line-height:1.4;letter-spacing:1px;text-transform:uppercase;color:${green};">${escapeHtml(content.kicker)}</p>` : "";
  const intro = content.intro.map(paragraph).join("\n");
  const blocks = content.blocks.map(blockHtml).join("\n");
  const outro = content.outro.map(paragraph).join("\n");
  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px 0;">
  <tr>
    <td align="center" bgcolor="${green}" style="border-radius:10px;background:${green};">
      <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 28px;${font}font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(content.button.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0;${font}font-size:13px;line-height:1.5;color:${muted};">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(content.button.url)}" style="color:${green};word-break:break-all;">${escapeHtml(content.button.url)}</a></p>`
    : "";
  const boxed = content.reasonStyle !== "footer";
  const warning = content.reasonStyle === "warning";
  const reasonBox = boxed
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
  <tr>
    <td bgcolor="${warning ? amberTint : chip}" style="background:${warning ? amberTint : chip};border:1px solid ${warning ? amberLine : border};border-left:4px solid ${warning ? amber : green};border-radius:10px;padding:14px 16px;${font}font-size:14px;line-height:1.55;color:${ink};">${escapeHtml(content.reason)}</td>
  </tr>
</table>`
    : "";
  const preheader = content.preheader || content.intro[0] || content.headline;
  const links = footerLinks(origin);
  const settingsUrl = `${origin}/account#notifications`;
  const footerReason = boxed ? "" : footerLine(escapeHtml(content.reason));
  const unsubscribe = content.unsubscribeUrl ? footerLine(`${footerLink(content.unsubscribeUrl, "Unsubscribe")} with one click &nbsp;·&nbsp; ${footerLink(settingsUrl, "Notification settings")}`) : "";
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${ground};-webkit-text-size-adjust:100%;word-spacing:normal;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${ground};font-size:1px;line-height:1px;">${escapeHtml(preheader)}${preheaderPadding}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ground}" style="background:${ground};">
  <tr>
    <td align="center" style="padding:28px 12px 36px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td bgcolor="${card}" style="background:${card};border:1px solid ${border};border-top:4px solid ${green};border-radius:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:22px 32px 18px 32px;border-bottom:1px solid ${rule};">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="44" valign="middle" style="width:44px;"><a href="${escapeHtml(origin)}/" style="display:block;text-decoration:none;"><img alt="PriceLens" height="44" src="${escapeHtml(markUrl)}" style="display:block;width:44px;height:44px;border:0;" width="44"></a></td>
                      <td valign="middle" style="padding-left:12px;">
                        ${link(`${origin}/`, "PriceLens", `${font}font-size:21px;font-weight:800;line-height:1.2;letter-spacing:-0.2px;color:${ink};text-decoration:none;`)}
                        <div style="margin:2px 0 0 0;${font}font-size:12px;line-height:1.4;color:${faint};">Sri Lanka's food prices, every day</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 32px 32px 32px;">
${kicker}
                  <h1 style="margin:0 0 16px 0;${font}font-size:26px;font-weight:800;line-height:1.25;letter-spacing:-0.3px;color:${ink};">${escapeHtml(content.headline)}</h1>
${intro}
${blocks}
${outro}
${button}
${reasonBox}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 16px 0 16px;">
${footerReason}
${unsubscribe}
${footerLine(links.map((entry) => footerLink(entry.url, entry.label)).join(" &nbsp;·&nbsp; "), "0 0 14px 0")}
${footerLine(`<strong style="color:${ink};">PriceLens</strong> by Prabhava Labs &nbsp;·&nbsp; Free &nbsp;·&nbsp; Made in Sri Lanka 🇱🇰`, "0 0 6px 0")}
${footerLine(`Questions? Reply to this email or write to <a href="mailto:${escapeHtml(replyTo)}" style="color:${muted};">${escapeHtml(replyTo)}</a>.`, "0 0 6px 0")}
${footerLine(`${link(`${origin}/privacy`, "Privacy", `color:${faint};text-decoration:underline;`)} &nbsp;·&nbsp; ${link(`${origin}/terms`, "Terms", `color:${faint};text-decoration:underline;`)}`, "0")}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
  const lines = [content.kicker ? content.kicker.toUpperCase() : null, content.headline, ...content.intro, ...content.blocks.map(blockText), ...content.outro];
  if (content.button) lines.push(`${content.button.label}: ${content.button.url}`);
  lines.push(content.reason);
  if (content.unsubscribeUrl) lines.push(`Unsubscribe from this mail with one click: ${content.unsubscribeUrl}\nNotification settings: ${settingsUrl}`);
  lines.push(links.map((entry) => `${entry.label}: ${entry.url}`).join("\n"));
  lines.push(`PriceLens by Prabhava Labs · Free · Made in Sri Lanka\nQuestions? Reply to this email or write to ${replyTo}.\nPrivacy: ${origin}/privacy · Terms: ${origin}/terms`);
  return { subject: content.subject, html, text: `${lines.filter((line): line is string => Boolean(line)).join("\n\n")}\n` };
}
