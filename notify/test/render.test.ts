import assert from "node:assert/strict";
import test from "node:test";

import { discordEmbed, emailParts, message, plainText, pushPayload, shortText, slackPayload, telegramHtml, telegramMessageLimit } from "../src/index.ts";

const digest = message({
  title: "Prices today: 3 drops, 2 rises",
  summary: "Onions & chillies are cheaper; eggs cost more.",
  severity: "good",
  sections: [
    { heading: "Biggest drops", lines: [{ text: "Big onion", value: "Rs 370 / kg", change: -12.3, note: "was Rs 422", url: "https://price.example/p/product_big_onion" }, { text: "Green chilli", value: "Rs 640 / kg", change: -8 }] },
    { lines: [{ text: "Page", value: "https://price.example/about" }, { text: "From", value: "reader@example.com" }] },
  ],
  actions: [{ label: "Open the board", url: "https://price.example/" }, { label: "Manage alerts", url: "https://price.example/alerts?token=abc" }],
  image: { url: "https://price.example/og/site.png", alt: "Today's prices" },
  footer: "Prices from HARTI, Keells, Cargills. <unsubscribe>",
  dedupe_key: "digest:2026-09-12",
});

test("plain text keeps the order title, summary, sections, links, footer", () => {
  const text = plainText(digest);
  const order = ["Prices today", "Onions & chillies", "Biggest drops", "• Big onion: Rs 370 / kg (-12.3%) — was Rs 422 https://price.example/p/product_big_onion", "• Page: https://price.example/about", "Open the board: https://price.example/", "Prices from HARTI"];
  let cursor = -1;
  for (const piece of order) {
    const at = text.indexOf(piece);
    assert.ok(at > cursor, `${piece} follows the previous piece`);
    cursor = at;
  }
  assert.equal(shortText(digest), "Onions & chillies are cheaper; eggs cost more.");
});

test("telegram html escapes text, bolds values, links lines, and fits the limit by dropping blocks", () => {
  const html = telegramHtml(digest);
  assert.ok(html.startsWith("<b>Prices today: 3 drops, 2 rises</b>"));
  assert.ok(html.includes("Onions &amp; chillies"));
  assert.ok(html.includes('• <a href="https://price.example/p/product_big_onion">Big onion</a> — <b>Rs 370 / kg</b> ▼ -12.3% <i>was Rs 422</i>'));
  assert.ok(html.includes('<a href="https://price.example/">Open the board</a> · <a href="https://price.example/alerts?token=abc">Manage alerts</a>'));
  assert.ok(html.includes("<i>Prices from HARTI, Keells, Cargills. &lt;unsubscribe&gt;</i>"));
  assert.ok(html.length <= telegramMessageLimit);

  const long = message({ title: "Long", sections: Array.from({ length: 20 }, (_, index) => ({ heading: `Section ${index}`, lines: Array.from({ length: 20 }, (__, line) => ({ text: `Product ${index}-${line}`, value: "Rs 1,000 / kg", change: -1 })) })) });
  const fitted = telegramHtml(long, 1000);
  assert.ok(fitted.length <= 1000);
  assert.ok(fitted.startsWith("<b>Long</b>"));
  assert.ok(!/<[^>]*$/u.test(fitted), "never ends inside a tag");
});

test("discord: a headed section is one field, a bare section is one inline field per line", () => {
  const embed = discordEmbed(digest);
  assert.equal(embed.title, digest.title);
  assert.equal(embed.color, 0x3ddc97);
  assert.ok(embed.description?.startsWith("Onions & chillies"));
  assert.ok(embed.description?.includes("[Open the board](https://price.example/)"));
  assert.deepEqual(embed.fields.map((field) => [field.name, field.inline]), [["Biggest drops", false], ["Page", true], ["From", true]]);
  assert.ok(embed.fields[0]!.value.includes("• [Big onion](https://price.example/p/product_big_onion): **Rs 370 / kg** (-12.3%) _was Rs 422_"));
  assert.equal(embed.fields[1]!.value, "https://price.example/about");
  assert.deepEqual(embed.image, { url: "https://price.example/og/site.png" });
  assert.equal(embed.footer?.text, digest.footer);
});

test("slack: header, sections as mrkdwn, image, link buttons, context footer, plus a text fallback", () => {
  const payload = slackPayload(digest);
  assert.ok(payload.text.startsWith("Prices today"));
  const types = payload.blocks.map((block) => block.type);
  assert.deepEqual(types, ["header", "section", "section", "section", "image", "actions", "context"]);
  const drops = payload.blocks[2] as { text: { text: string } };
  assert.ok(drops.text.text.startsWith("*Biggest drops*\n• <https://price.example/p/product_big_onion|Big onion>: *Rs 370 / kg* (-12.3%) _was Rs 422_"));
  const summary = payload.blocks[1] as { text: { text: string } };
  assert.equal(summary.text.text, "Onions &amp; chillies are cheaper; eggs cost more.");
  const actions = payload.blocks[5] as { elements: Array<{ url: string; text: { text: string } }> };
  assert.equal(actions.elements[1]!.url, "https://price.example/alerts?token=abc");
});

test("email: subject from the title, a text part, and escaped html with buttons", () => {
  const parts = emailParts(digest);
  assert.equal(parts.subject, digest.title);
  assert.ok(parts.text.includes("• Green chilli: Rs 640 / kg (-8%)"));
  assert.ok(parts.html.includes("<h1"));
  assert.ok(parts.html.includes("&lt;unsubscribe&gt;"));
  assert.ok(parts.html.includes('href="https://price.example/alerts?token=abc"'));
  assert.ok(parts.html.includes('<img src="https://price.example/og/site.png"'));
});

test("push payload is small and opens the first action", () => {
  const payload = pushPayload(digest);
  assert.equal(payload.title, digest.title);
  assert.equal(payload.body, "Onions & chillies are cheaper; eggs cost more.");
  assert.equal(payload.url, "https://price.example/");
  assert.equal(payload.tag, "digest:2026-09-12");
  assert.equal(payload.image, "https://price.example/og/site.png");
  assert.ok(JSON.stringify(payload).length < 1000);
});
