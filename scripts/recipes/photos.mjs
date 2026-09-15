#!/usr/bin/env node
/**
 * Recipe photographs: one ultra-realistic picture per dish, made with the Codex CLI's built-in
 * image tool (the owner's ChatGPT subscription; no API key) and kept in
 * data/images/recipes/<slug>.jpg (slug = dish id without `dish_`), served at /images/recipes/.
 *
 *   node scripts/recipes/photos.mjs [--only dish_a,dish_b] [--batch-size 18] [--concurrency 6]
 *                                   [--passes 2] [--work <dir>] [--dry-run] [--list] [--convert-only]
 *
 * Dishes are grouped into batches; each batch is one `codex exec` run in its own work
 * directory with a brief listing every dish, and Codex saves `<slug>.png` there. Batches run
 * several at a time. When a pass ends, every PNG found is turned into a 900 px JPEG with
 * `sips`; dishes still without a picture go into the next pass. Re-running skips dishes that
 * already have a JPEG, so the command is safe to repeat until the folder is complete.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const cataloguePath = resolve(root, "data/recipes/catalogue.json");
const recipesDir = resolve(root, "data/recipes/recipes");
const outputDir = resolve(root, "data/images/recipes");

const flags = parseFlags(process.argv.slice(2));
const batchSize = Number(flags["batch-size"] ?? 18);
const concurrency = Number(flags.concurrency ?? 6);
const passes = Number(flags.passes ?? 2);
const workRoot = resolve(flags.work ?? resolve(tmpdir(), "lpl-recipe-photos"));
const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((id) => id.trim()).filter(Boolean)) : null;
const model = flags.model ?? "gpt-5.6-sol";
const dryRun = Boolean(flags["dry-run"]);

const categoryLabels = {
  rice_and_grains: "rice or grain dish",
  vegetable: "vegetable curry or dish",
  pulses_and_eggs: "pulse or egg dish",
  sambol_and_condiment: "sambol or condiment",
  fish_and_seafood: "fish or seafood dish",
  meat_and_poultry: "meat or poultry dish",
  snack: "snack",
  sweet: "sweet",
  drink: "drink",
};

const scenes = {
  rice_and_grains: "served on a plate or a banana leaf as part of a Sri Lankan rice-and-curry table, a curry or sambol just visible beside it",
  vegetable: "in a small clay or ceramic curry bowl, with red rice and a second curry just visible beside it",
  pulses_and_eggs: "in a small clay or ceramic curry bowl, with red rice just visible beside it",
  sambol_and_condiment: "in a small bowl beside a plate of rice or hoppers, the texture of the sambol sharp and close",
  fish_and_seafood: "in a clay or ceramic curry dish, with rice and a wedge of lime beside it",
  meat_and_poultry: "in a clay or ceramic curry dish, with rice or bread beside it",
  snack: "on a plate or in a paper-lined basket the way a Sri Lankan tea shop serves it, a cup of plain tea in soft focus behind",
  sweet: "on a small plate as served at a Sri Lankan festive table, a cup of tea in soft focus behind",
  drink: "in a glass or a clay cup on a wooden table, a few of its ingredients beside it",
};

function parseFlags(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) continue;
    const name = argument.slice(2);
    const next = arguments_[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      parsed[name] = next;
      index += 1;
    } else {
      parsed[name] = true;
    }
  }
  return parsed;
}

const slugOf = (dishId) => dishId.replace(/^dish_/u, "");
const jpegFor = (dishId) => resolve(outputDir, `${slugOf(dishId)}.jpg`);

function loadDishes() {
  const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
  return catalogue.dishes.map((dish) => {
    const file = resolve(recipesDir, `${dish.id}.json`);
    const recipe = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    return { dish, recipe };
  });
}

/** The words the image tool gets for one dish: what it is, what is in it, how it is served. */
function briefFor({ dish, recipe }, number) {
  const ingredients = (recipe?.ingredients ?? [])
    .filter((line) => !line.optional)
    .map((line) => line.label?.en)
    .filter(Boolean)
    .slice(0, 8);
  const fallback = [...dish.key_ingredients.map((id) => id.replace(/^product_/u, "").replaceAll("_", " ")), ...dish.other_ingredients].slice(0, 8);
  const visible = (ingredients.length ? ingredients : fallback).join(", ");
  const serving = recipe?.serving?.description?.en ? `${recipe.serving.description.en}; ` : "";
  const scene = scenes[dish.category] ?? "on a rustic wooden table";
  return `${number}. File \`${slugOf(dish.id)}.png\`: ${dish.names.en} (Sri Lankan ${categoryLabels[dish.category] ?? "dish"}) — ${dish.summary} Ingredients that should be visible or implied: ${visible}. Serving: ${serving}${scene}.`;
}

function batchPrompt(entries) {
  const lines = entries.map((entry, index) => briefFor(entry, index + 1));
  return `You are producing recipe photographs for a Sri Lankan food website. Use your image generation tool with the newest image model available (ChatGPT Image 2.5). For EACH dish listed below, generate exactly one photograph and save it in the current working directory under the file name given (PNG). Work through the list in order, one image at a time; if one fails, retry it once and move on. Do not write any other files, do not read or change anything else, and do not ask questions. At the end, list the files you wrote.

Style for every photo, kept consistent across the set: ultra-realistic editorial food photography, exactly as the dish looks in the real world in a Sri Lankan home; natural soft daylight from a window, shallow depth of field, a 50 mm lens at a 45-degree angle, true textures, a little steam where the dish is hot; a rustic wooden table, banana leaf, clay, brass, or plain ceramic; landscape 3:2 at 1536 × 1024 pixels; no text, no captions, no watermarks, no logos, no people, no hands, no cutlery clutter.

Dishes:
${lines.join("\n")}
`;
}

function runBatch(entries, index) {
  const directory = resolve(workRoot, `batch-${String(index).padStart(2, "0")}-${Date.now().toString(36)}`);
  mkdirSync(directory, { recursive: true });
  const prompt = batchPrompt(entries);
  writeFileSync(resolve(directory, "brief.txt"), prompt);
  const log = resolve(directory, "run.log");
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn("codex", ["exec", "-m", model, "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", directory, prompt], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), 45 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(log, Buffer.concat(chunks));
      const minutes = ((Date.now() - started) / 60_000).toFixed(1);
      const found = entries.filter((entry) => existsSync(resolve(directory, `${slugOf(entry.dish.id)}.png`))).length;
      console.log(`batch ${index}: exit ${code}, ${found} of ${entries.length} pictures, ${minutes} min, ${directory}`);
      resolvePromise({ directory, entries, code });
    });
  });
}

/** A PNG from Codex becomes the served JPEG: at most 900 px on the long side, quality 74 (about 180 KB a dish). */
function convert(source, target) {
  execFileSync("sips", ["-Z", "900", "-s", "format", "jpeg", "-s", "formatOptions", "74", source, "--out", target], { stdio: "ignore" });
  const size = statSync(target).size;
  if (size < 20_000) throw new Error(`${basename(target)} is only ${size} bytes`);
}

async function runQueue(batches, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, batches.length) }, async () => {
    while (next < batches.length) {
      const index = next;
      next += 1;
      results.push(await runBatch(batches[index], index + 1));
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(workRoot, { recursive: true });
  const all = loadDishes().filter((entry) => !only || only.has(entry.dish.id));
  let pending = all.filter((entry) => !existsSync(jpegFor(entry.dish.id)));
  console.log(`${all.length} dishes, ${all.length - pending.length} with a picture, ${pending.length} to make; work in ${workRoot}`);
  if (flags.list) {
    for (const entry of pending) console.log(`${entry.dish.id}\t${entry.dish.names.en}`);
    return;
  }
  if (dryRun) {
    console.log(batchPrompt(pending.slice(0, batchSize)));
    return;
  }
  // Every PNG a past run left in the work directories, converted again (after a change of size or quality).
  if (flags["convert-only"]) {
    const slugs = new Set(all.map((entry) => slugOf(entry.dish.id)));
    let converted = 0;
    for (const batch of readdirSync(workRoot)) {
      const directory = resolve(workRoot, batch);
      if (!statSync(directory).isDirectory()) continue;
      for (const file of readdirSync(directory)) {
        if (!file.endsWith(".png") || !slugs.has(file.slice(0, -4))) continue;
        try {
          convert(resolve(directory, file), resolve(outputDir, `${file.slice(0, -4)}.jpg`));
          converted += 1;
        } catch (error) {
          console.warn(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    console.log(`${converted} converted into ${outputDir}`);
    return;
  }
  for (let pass = 1; pass <= passes && pending.length; pass += 1) {
    const batches = [];
    for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize));
    console.log(`pass ${pass}: ${pending.length} dishes in ${batches.length} batches, ${concurrency} at a time`);
    const results = await runQueue(batches, concurrency);
    let converted = 0;
    for (const result of results) {
      for (const entry of result.entries) {
        const source = resolve(result.directory, `${slugOf(entry.dish.id)}.png`);
        const target = jpegFor(entry.dish.id);
        if (!existsSync(source) || existsSync(target)) continue;
        try {
          convert(source, target);
          converted += 1;
        } catch (error) {
          console.warn(`${entry.dish.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    pending = all.filter((entry) => !existsSync(jpegFor(entry.dish.id)));
    console.log(`pass ${pass} done: ${converted} converted, ${pending.length} still missing`);
  }
  if (pending.length) {
    console.log(`Still missing: ${pending.map((entry) => entry.dish.id).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${all.length} dishes have a picture in ${outputDir} (${readdirSync(outputDir).length} files).`);
  }
}

await main();
