// Prints one drafted recipe's ingredient lines with their calorie contribution, for review.
// Usage: node scripts/recipes/inspect.mjs <dir> <dish id>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gramsOf, recipeNutrition, recipeSchema } from "../../shared/src/index.ts";
import { normaliseRecipe } from "./drafts.mjs";

const [directory, dishId] = process.argv.slice(2);
const registry = new Map(JSON.parse(readFileSync("data/recipes/ingredients.json", "utf8")).ingredients.map((entry) => [entry.id, entry]));
for (const file of readdirSync(directory).filter((name) => /^out-recipes-\d+\.json$/u.test(name))) {
  for (const raw of JSON.parse(readFileSync(join(directory, file), "utf8"))) {
    if (raw.id !== dishId) continue;
    const recipe = recipeSchema.parse(normaliseRecipe(raw));
    console.log(`${recipe.id} (${file}) base ${recipe.base_servings}, role ${recipe.serving.role}, portion ${recipe.serving.portion_g} g, yield ${recipe.yield_g} g`);
    for (const line of recipe.ingredients) {
      const entry = line.ref ? registry.get(line.ref) : undefined;
      const grams = gramsOf(line, entry);
      const kcal = entry?.nutrition && grams !== null ? (grams * entry.edible_portion * entry.nutrition.kcal) / 100 : null;
      console.log(`  ${String(line.quantity).padStart(6)} ${line.unit.padEnd(5)} ${line.label.en.padEnd(38)} ${(line.ref ?? "-").padEnd(28)} ${line.part.padEnd(9)} ${line.optional ? "opt " : "    "} ${kcal === null ? "?" : Math.round(kcal)} kcal${line.preparation?.en ? `  (${line.preparation.en})` : ""}`);
    }
    const nutrition = recipeNutrition(recipe, (id) => registry.get(id));
    console.log(`  per serving: ${nutrition.per_serving.kcal} kcal, ${nutrition.per_serving.protein_g} g protein, ${nutrition.per_serving.fat_g} g fat, ${nutrition.per_serving.carb_g} g carb; missing: ${nutrition.coverage.missing.join(", ") || "none"}`);
  }
}
