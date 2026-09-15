import assert from "node:assert/strict";
import { test } from "node:test";

import { legalDocuments } from "../src/content/legal.ts";

test("every legal document has a date, an intro, and sections with words", () => {
  for (const document of legalDocuments) {
    assert.match(document.updated, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(!Number.isNaN(new Date(`${document.updated}T00:00:00Z`).getTime()));
    assert.ok(document.intro.length > 40, `${document.title} intro`);
    assert.ok(document.sections.length >= 5, `${document.title} sections`);
    for (const section of document.sections) {
      assert.ok(section.heading.length > 2);
      assert.ok(section.body.length >= 1, `${document.title}: ${section.heading}`);
      for (const line of section.body) assert.ok(line.trim().length > 20, `${section.heading}: ${line}`);
    }
  }
});

test("the two documents sit on different paths with distinct titles", () => {
  const paths = new Set(legalDocuments.map((document) => document.path));
  const titles = new Set(legalDocuments.map((document) => document.title));
  assert.equal(paths.size, legalDocuments.length);
  assert.equal(titles.size, legalDocuments.length);
});
