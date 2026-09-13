// Merges validated drafts into data/recipes: the ingredient registry (ingredients.json) and one file per recipe (recipes/<id>.json).
// Usage: node scripts/recipes/merge-drafts.mjs <dir with out-nutrition-*.json and out-recipes-*.json> --reviewed-by "<name>" [--date YYYY-MM-DD]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ingredientRegistrySchema, ingredientSchema, recipeSchema } from "../../shared/src/index.ts";
import { normaliseIngredient, normaliseRecipe } from "./drafts.mjs";

const [directory, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const reviewedBy = flag("--reviewed-by");
const date = flag("--date") ?? new Date().toISOString().slice(0, 10);
const correctionsPath = flag("--corrections") ?? "data/recipes/corrections/ingredients.json";
const corrections = existsSync(correctionsPath) ? JSON.parse(readFileSync(correctionsPath, "utf8")) : {};

/** Owner corrections win over the draft, field by field, one level into objects such as measures. */
function corrected(entry) {
  const patch = corrections[entry.id];
  if (!patch) return entry;
  const merged = { ...entry };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("_")) continue;
    merged[key] = value && typeof value === "object" && !Array.isArray(value) && entry[key] && typeof entry[key] === "object" ? { ...entry[key], ...value } : value;
  }
  return merged;
}
if (!directory || !reviewedBy) {
  console.error('usage: merge-drafts.mjs <dir> --reviewed-by "<name>" [--date YYYY-MM-DD]');
  process.exit(2);
}
const out = resolve("data/recipes");
const files = readdirSync(directory).sort();

const ingredients = [];
for (const file of files.filter((name) => /^out-nutrition-\d+\.json$/u.test(name))) {
  for (const raw of JSON.parse(readFileSync(join(directory, file), "utf8"))) ingredients.push(ingredientSchema.parse(corrected(normaliseIngredient(raw))));
}
ingredients.sort((left, right) => left.id.localeCompare(right.id));
const registry = ingredientRegistrySchema.parse({ schema_version: "1.0.0", reviewed_by: reviewedBy, reviewed_at: date, ingredients });
writeFileSync(join(out, "ingredients.json"), `${JSON.stringify(registry, null, 1)}\n`);
console.log(`ingredients.json: ${registry.ingredients.length} entries, ${Object.keys(corrections).filter((key) => !key.startsWith("_")).length} corrected`);

const ids = new Set(registry.ingredients.map((entry) => entry.id));
mkdirSync(join(out, "recipes"), { recursive: true });
let written = 0;
for (const file of files.filter((name) => /^out-recipes-\d+\.json$/u.test(name))) {
  for (const raw of JSON.parse(readFileSync(join(directory, file), "utf8"))) {
    const recipe = recipeSchema.parse(normaliseRecipe(raw));
    for (const line of recipe.ingredients) if (line.ref && !ids.has(line.ref)) throw new Error(`${recipe.id}: unknown ingredient ${line.ref}`);
    writeFileSync(join(out, "recipes", `${recipe.id}.json`), `${JSON.stringify(recipe, null, 1)}\n`);
    written += 1;
  }
}
console.log(`recipes/: ${written} files`);
