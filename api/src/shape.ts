import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Blob, Buffer as HarfBuzzBuffer, Face, Font, shape } from "harfbuzzjs";

import { escape } from "./og.ts";

/**
 * Text drawn as outlines, so the cards can speak Sinhala.
 *
 * resvg lays a string out glyph by glyph and does not run the font's Sinhala rules, so a word
 * like "සුපර්මාර්කට්" comes out with its vowel signs stacked on top of each other — which is why
 * the day's post card used to be written in English while its caption was Sinhala. HarfBuzz does
 * shape the script properly, so everything on a card goes through here: the text is shaped once,
 * each glyph becomes an SVG path, and resvg only has to fill paths it cannot misread.
 *
 * Latin runs keep IBM Plex Sans, the brand's face; Sinhala runs fall to Noto Sans Sinhala. A
 * string mixing the two, "Rs 1,790 · හැමෝටම", is split at the boundary and each part is shaped
 * with the font that owns it.
 */

export type FontWeight = 400 | 500 | 600 | 700;
type Family = "latin" | "sinhala";

const fontsDirectory = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
const fontFile = (family: Family, weight: FontWeight): string =>
  resolve(fontsDirectory, `${family === "latin" ? "IBMPlexSans" : "NotoSansSinhala"}-${weight}.ttf`);

type LoadedFont = { font: Font; upem: number; paths: Map<number, string> };
const loaded = new Map<string, LoadedFont | null>();

/** The font for a family and weight, or null when the file is not beside the API (tests, a trimmed image). */
function fontFor(family: Family, weight: FontWeight): LoadedFont | null {
  const key = `${family}-${weight}`;
  const hit = loaded.get(key);
  if (hit !== undefined) return hit;
  const file = fontFile(family, weight);
  if (!existsSync(file)) {
    loaded.set(key, null);
    return null;
  }
  const face = new Face(new Blob(new Uint8Array(readFileSync(file))), 0);
  const entry: LoadedFont = { font: new Font(face), upem: face.upem, paths: new Map() };
  loaded.set(key, entry);
  return entry;
}

const glyphPath = (entry: LoadedFont, glyph: number): string => {
  const known = entry.paths.get(glyph);
  if (known !== undefined) return known;
  const path = entry.font.glyphToPath(glyph) ?? "";
  entry.paths.set(glyph, path);
  return path;
};

/** Sinhala's own block, with the joiners that hold its conjuncts together. */
const sinhala = /[඀-෿‌‍]/u;
const isSinhala = (character: string): boolean => sinhala.test(character);

type Run = { family: Family; text: string };

/**
 * Splits a string into runs of one script. A joiner or a space between two Sinhala words stays
 * inside the Sinhala run, so the shaper sees whole words rather than fragments.
 */
export function scriptRuns(content: string): Run[] {
  const runs: Run[] = [];
  for (const character of content) {
    const family: Family = isSinhala(character) ? "sinhala" : "latin";
    const last = runs.at(-1);
    // A space belongs to whichever run it follows; it is the same width in both faces.
    if (last && (last.family === family || (character === " " && last.family === "sinhala"))) last.text += character;
    else runs.push({ family, text: character });
  }
  return runs;
}

type Glyph = { path: string; x: number; y: number; scale: number };

function shapeRun(run: Run, size: number, weight: FontWeight, letterSpacing: number): { glyphs: Glyph[]; width: number } {
  const entry = fontFor(run.family, weight) ?? fontFor(run.family === "sinhala" ? "latin" : "sinhala", weight);
  if (!entry) return { glyphs: [], width: 0 };
  const buffer = new HarfBuzzBuffer();
  buffer.addText(run.text);
  buffer.guessSegmentProperties();
  shape(entry.font, buffer);
  const scale = size / entry.upem;
  const glyphs: Glyph[] = [];
  let pen = 0;
  for (const glyph of buffer.getGlyphInfosAndPositions()) {
    const path = glyphPath(entry, glyph.codepoint);
    if (path) glyphs.push({ path, x: (pen + (glyph.xOffset ?? 0)) * scale, y: -(glyph.yOffset ?? 0) * scale, scale });
    pen += glyph.xAdvance ?? 0;
    if (letterSpacing) pen += letterSpacing / scale;
  }
  return { glyphs, width: pen * scale };
}

export type ShapeOptions = {
  weight?: FontWeight | undefined;
  /** Extra space after every glyph, in the same units as the size; the eyebrow's tracking. */
  letterSpacing?: number | undefined;
  anchor?: "start" | "middle" | "end" | undefined;
  opacity?: number | undefined;
  /** Draws a line through the text, for a price that no longer applies. */
  strike?: boolean | undefined;
};

type Shaped = { glyphs: Glyph[]; width: number };

function shapeText(content: string, size: number, options: ShapeOptions = {}): Shaped {
  const weight = options.weight ?? 400;
  const spacing = options.letterSpacing ?? 0;
  const glyphs: Glyph[] = [];
  let width = 0;
  for (const run of scriptRuns(content)) {
    const shaped = shapeRun(run, size, weight, spacing);
    for (const glyph of shaped.glyphs) glyphs.push({ ...glyph, x: glyph.x + width });
    width += shaped.width;
  }
  // Tracking is added after every glyph, including the last one, which would sit the run's box
  // one step wider than the ink it holds.
  return { glyphs, width: Math.max(0, width - spacing) };
}

/** How wide a string is once shaped: the real advance, not an estimate. */
export function shapedWidth(content: string, size: number, options: ShapeOptions = {}): number {
  return shapeText(content, size, options).width;
}

/** One line of text as SVG paths, with `x`/`y` read as a text element's baseline origin. */
export function shapedText(x: number, y: number, content: string, size: number, fill: string, options: ShapeOptions = {}): string {
  const shaped = shapeText(content, size, options);
  if (!shaped.glyphs.length) return "";
  const anchor = options.anchor ?? "start";
  const left = anchor === "end" ? x - shaped.width : anchor === "middle" ? x - shaped.width / 2 : x;
  const body = shaped.glyphs
    .map((glyph) => `<path d="${glyph.path}" transform="translate(${round(left + glyph.x)} ${round(y + glyph.y)}) scale(${round(glyph.scale, 5)} ${round(-glyph.scale, 5)})"/>`)
    .join("");
  const strike = options.strike ? `<rect x="${round(left)}" y="${round(y - size * 0.28)}" width="${round(shaped.width)}" height="${Math.max(1, round(size * 0.07))}" rx="1"/>` : "";
  // The words themselves are gone once they are outlines, so the group keeps them: a card can then
  // still be read, searched, and tested as the text it was drawn from.
  return `<g fill="${fill}"${options.opacity !== undefined ? ` fill-opacity="${options.opacity}"` : ""} data-text="${escape(content)}">${body}${strike}</g>`;
}

/** Cuts a string to a width, ending in an ellipsis, on a word boundary when one is near. */
export function shapedFit(content: string, size: number, width: number, options: ShapeOptions = {}): string {
  if (shapedWidth(content, size, options) <= width) return content;
  const characters = Array.from(content);
  let cut = characters;
  while (cut.length > 1 && shapedWidth(`${cut.join("")}…`, size, options) > width) cut = cut.slice(0, -1);
  const text = cut.join("");
  const space = text.lastIndexOf(" ");
  return `${(space > text.length * 0.6 ? text.slice(0, space) : text).trimEnd()}…`;
}

const round = (value: number, places = 2): number => Number(value.toFixed(places));
