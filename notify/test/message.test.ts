import assert from "node:assert/strict";
import test from "node:test";

import { formatChange, message, parseMessage, truncate } from "../src/index.ts";

test("a message normalises defaults and trims text", () => {
  const built = message({ title: "  Big onion fell 12%  ", summary: "Cheapest at Keells today.", sections: [{ lines: [{ text: "Keells", value: "Rs 370 / kg", change: -12.3 }] }] });
  assert.equal(built.title, "Big onion fell 12%");
  assert.equal(built.severity, "info");
  assert.deepEqual(built.actions, []);
  assert.deepEqual(built.tags, []);
  assert.equal(built.sections[0]!.lines[0]!.value, "Rs 370 / kg");
});

test("network input is checked without throwing and the first problem is named", () => {
  assert.deepEqual(parseMessage({ title: "" }).ok, false);
  const bad = parseMessage({ title: "x", actions: [{ label: "Open", url: "not a url" }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /^actions\.0\.url/u);
  const good = parseMessage({ title: "Prices", severity: "good" });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.message.severity, "good");
});

test("a title carries a whole social caption, and stops at the largest a channel takes", () => {
  const caption = "අද සුපිරි වෙළඳසැලක දෙහි කිලෝ එකක් රු. 1,490යි. ".repeat(20);
  assert.ok(caption.length > 200);
  assert.equal(message({ title: caption }).title, caption.trim());
  assert.equal(parseMessage({ title: "x".repeat(2200) }).ok, true);
  assert.equal(parseMessage({ title: "x".repeat(2201) }).ok, false);
});

test("changes always show a sign and at most one decimal", () => {
  assert.equal(formatChange(12.34), "+12.3%");
  assert.equal(formatChange(-3), "-3%");
  assert.equal(formatChange(0), "0%");
  assert.equal(formatChange(-0.04), "0%");
});

test("truncate cuts on a word and marks the cut", () => {
  assert.equal(truncate("short", 10), "short");
  const cut = truncate("the quick brown fox jumps over the lazy dog", 20);
  assert.ok(cut.length <= 20);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut, "the quick brown fox…");
});
