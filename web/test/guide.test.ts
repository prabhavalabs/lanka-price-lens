import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { guideSections } from "../src/content/guide.ts";

const guideDirectory = resolve(import.meta.dirname, "../public/guide");

/** Width and height from a PNG header (IHDR follows the 8-byte signature and a 4-byte length + 4-byte type). */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(0, 24);
  assert.equal(header.subarray(1, 4).toString("ascii"), "PNG", `${file} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

test("every guide section is complete and every screenshot it shows exists at the declared size", () => {
  const ids = guideSections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "section ids are unique");
  assert.ok(guideSections.length >= 6, "the guide covers the site");
  for (const section of guideSections) {
    assert.match(section.id, /^[a-z][a-z-]*$/u, `${section.id} works as an anchor`);
    assert.ok(section.title && section.summary, `${section.id} has a title and summary`);
    assert.ok(section.steps.length >= 2, `${section.id} has steps`);
    for (const figure of section.figures) {
      const file = resolve(guideDirectory, `${figure.file}.png`);
      assert.ok(existsSync(file), `${figure.file}.png exists for ${section.id}`);
      assert.deepEqual(pngSize(file), { width: figure.width, height: figure.height }, `${figure.file}.png has the declared size`);
      assert.ok(figure.alt.length > 10 && figure.caption.length > 10, `${figure.file} is described`);
    }
  }
});
