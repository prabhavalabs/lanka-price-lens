import assert from "node:assert/strict";
import { test } from "node:test";

import { message } from "@lanka-pricelens/notify";

import { mailKinds } from "../src/mail/defaults.ts";
import { renderLayout } from "../src/mail/layout.ts";
import { renderMail } from "../src/mail/templates.ts";
import { feedbackMessage, renderOwnerNotice } from "../src/notify.ts";

test("every kind carries the letterhead, a kicker, the footer links, and Made in Sri Lanka; the reason sits in the card for account mail and in the footer for the daily mails", () => {
  for (const kind of mailKinds) {
    const rendered = renderMail(kind, { values: { name: "Amal", link: "https://price.example/x", date: "Monday 15 September", count: 2, minutes: 30, when: "today", new_email: "new@example.com", stores: "Keells" }, unsubscribeUrl: kind.endsWith("_daily") || kind === "price_alerts" ? "https://price.example/u" : null }, { siteOrigin: "https://price.example", replyTo: "team@example.com" });
    assert.ok(rendered.html.includes('alt="PriceLens"'), `${kind} has the mark`);
    assert.ok(rendered.html.includes("Sri Lanka's food prices, every day"), `${kind} has the tagline`);
    assert.ok(rendered.html.includes("text-transform:uppercase"), `${kind} has a kicker`);
    assert.ok(rendered.html.includes('href="https://price.example/recipes"'), `${kind} footer links the site`);
    assert.ok(rendered.html.includes("Made in Sri Lanka"), `${kind} says where it is from`);
    assert.ok(rendered.html.includes('href="https://price.example/privacy"') && rendered.html.includes('href="https://price.example/terms"'), `${kind} links the legal pages`);
    assert.ok(rendered.text.includes("Made in Sri Lanka") && rendered.text.includes("Privacy: https://price.example/privacy"), `${kind} text has the footer`);
    const daily = kind === "recipes_daily" || kind === "deals_daily" || kind === "price_alerts";
    if (daily) {
      assert.ok(rendered.html.includes("Monday 15 September"), `${kind} kicker names the day`);
      assert.ok(rendered.html.includes('href="https://price.example/u"') && rendered.html.includes("Notification settings"), `${kind} footer unsubscribes`);
      assert.ok(!rendered.html.includes("border-left:4px solid"), `${kind} has no reason box`);
    } else {
      assert.ok(rendered.html.includes("border-left:4px solid"), `${kind} boxes the reason`);
      assert.ok(!rendered.html.includes("Unsubscribe"), `${kind} has no unsubscribe link`);
    }
  }
  // Security notices are amber; the rest of the account mail is green.
  assert.ok(renderMail("reset_password", { values: { name: "A", link: "https://x.example/", minutes: 5 } }).html.includes("border-left:4px solid #d9962b"));
  assert.ok(renderMail("welcome", { values: { name: "A", link: "https://x.example/" } }).html.includes("border-left:4px solid #0c7c53"));
});

test("deal rows stack the comparison under the store and the badge under the price; recipe cards carry the picture, chips, and the link; fact rows label their values", () => {
  const rendered = renderLayout(
    {
      subject: "s",
      preheader: "",
      kicker: null,
      headline: "h",
      intro: [],
      blocks: [
        { type: "deals", heading: "Drops", rows: [{ product: "Big onion", store: "21% off at Keells", image: "https://x.example/images/products/big_onion.jpg", now: "Rs 370 / kg", was: "was Rs 470 / kg yesterday", pct: -21.3, url: "https://x.example/p/onion" }, { product: "Eggs", store: "Cargills", now: "Rs 45", was: null, pct: 18.4, url: null }], note: "Against yesterday." },
        { type: "recipes", heading: null, cards: [{ image: "https://x.example/og.png", name: "Dhal curry", summary: "Lentils.", kcal: 281, minutes: 35, cost: "Rs 95 per serving", url: "https://x.example/r/dhal" }] },
        { type: "facts", heading: "Details", rows: [{ label: "Page", value: "https://x.example/p/onion", url: "https://x.example/p/onion", note: null }, { label: "From", value: "Amal", url: null, note: "+2.5%" }] },
      ],
      outro: [],
      button: null,
      reason: "why",
      reasonStyle: "footer",
      unsubscribeUrl: null,
    },
    { siteOrigin: "https://x.example" },
  );
  assert.ok(rendered.html.includes(">-21.3%</span>") && rendered.html.includes("#e4f3ec"), "a drop is a green badge");
  assert.ok(rendered.html.includes(">+18.4%</span>") && rendered.html.includes("#fdecea"), "a rise is a red badge");
  assert.ok(rendered.html.includes("was Rs 470 / kg yesterday"));
  assert.ok(rendered.html.includes('src="https://x.example/images/products/big_onion.jpg" width="52"'), "a row with a photo shows the thumbnail");
  assert.ok(rendered.html.includes(">E</div>"), "a row without a photo shows a lettered tile");
  assert.ok(rendered.html.includes('src="https://x.example/og.png"') && rendered.html.includes(">281 kcal</span>") && rendered.html.includes(">See the recipe →</a>"));
  assert.ok(rendered.html.includes(">Page</td>") && rendered.html.includes('href="https://x.example/p/onion"') && rendered.html.includes("+2.5%"));
  assert.ok(rendered.text.includes("Big onion at 21% off at Keells: Rs 370 / kg (was Rs 470 / kg yesterday, -21.3%)"));
  assert.ok(rendered.text.includes("Page: https://x.example/p/onion") && rendered.text.includes("From: Amal (+2.5%)"));
  assert.ok(rendered.text.includes("Dhal curry: Lentils.\n  281 kcal · 35 min · Rs 95 per serving"));
});

test("owner notices wear the same layout: tags as the kicker, the kind as the headline when the title excerpts the summary, lines as fact rows, the action as the button", () => {
  const item = { id: "fb_1", kind: "bug" as const, message: "The chart shows nothing for coconut since Monday morning, whichever range I pick.", email: "someone@example.com", page: "https://price.prabhavalabs.com/p/product_coconut", user_agent: "Firefox", status: "new" as const, created_at: "2026-09-14T10:00:00.000Z", updated_at: "2026-09-14T10:00:00.000Z" };
  const rendered = renderOwnerNotice(feedbackMessage(item), { siteOrigin: "https://price.example", replyTo: "someone@example.com" });
  assert.ok(rendered.subject.startsWith("[PriceLens] Bug report: The chart shows nothing"));
  assert.ok(rendered.html.includes(">Feedback · Bug</p>"), "the tags are the kicker");
  assert.ok(rendered.html.includes(">Bug report</h1>"), "the excerpt is left to the paragraph");
  assert.ok(rendered.html.includes("whichever range I pick."));
  assert.ok(rendered.html.includes(">Page</td>") && rendered.html.includes("product_coconut"));
  assert.ok(rendered.html.includes("mailto:someone@example.com"), "replies go to the reader");
  assert.ok(rendered.html.includes('src="https://price.example/mark.png"'));
  assert.match(rendered.text, /Page: https:\/\/price\.prabhavalabs\.com\/p\/product_coconut/u);

  const plain = renderOwnerNotice(message({ title: "Nightly sync finished", summary: "All good.", actions: [{ label: "Open the admin", url: "https://price.example/admin" }] }));
  assert.ok(plain.html.includes(">For the owner</p>") && plain.html.includes(">Nightly sync finished</h1>") && plain.html.includes(">Open the admin</a>"));
});
