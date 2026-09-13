// Checks the drafted ingredient registry and recipe batches before they are merged into data/recipes.
// Usage: node scripts/recipes/validate-drafts.mjs <dir with out-nutrition-*.json and out-recipes-*.json> [--registry data/recipes/ingredients.json]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { atwaterEnergy, computedTags, ingredientSchema, recipeNutrition, recipeSchema } from "../../shared/src/index.ts";
import { normaliseIngredient, normaliseRecipe } from "./drafts.mjs";

const directory = process.argv[2];
if (!directory) {
  console.error("usage: validate-drafts.mjs <dir>");
  process.exit(2);
}
const catalogue = JSON.parse(readFileSync("data/recipes/catalogue.json", "utf8")).dishes;
const dishes = new Map(catalogue.map((dish) => [dish.id, dish]));
const files = readdirSync(directory).sort();
const problems = [];
const warnings = [];
const note = (file, id, message) => problems.push({ file, id, message });
const warn = (file, id, message) => warnings.push({ file, id, message });

// Ingredient registry drafts
const registry = new Map();
const skeleton = existsSync(join(directory, "registry-skeleton.json")) ? JSON.parse(readFileSync(join(directory, "registry-skeleton.json"), "utf8")) : [];
const expectedIds = new Set(skeleton.map((entry) => entry.id));
const kcalRange = { vegetable: [10, 160], leafy: [15, 120], fruit: [20, 400], grain: [300, 400], flour: [300, 420], pulse: [280, 420], meat: [100, 400], poultry: [100, 300], fish: [60, 250], seafood: [50, 200], dried_fish: [150, 400], egg: [130, 170], dairy: [30, 900], fat_oil: [700, 900], spice: [200, 600], herb: [20, 350], sweetener: [250, 420], condiment: [0, 600], nut_seed: [450, 700], beverage: [0, 400], prepared: [50, 600], other: [0, 900] };
for (const file of files.filter((name) => /^out-nutrition-\d+\.json$/u.test(name))) {
  let entries;
  try {
    entries = JSON.parse(readFileSync(join(directory, file), "utf8"));
  } catch (error) {
    note(file, null, `not JSON: ${error.message}`);
    continue;
  }
  for (const draft of entries) {
    const raw = normaliseIngredient(draft);
    const parsed = ingredientSchema.safeParse(raw);
    if (!parsed.success) {
      note(file, raw?.id ?? "?", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      continue;
    }
    const entry = parsed.data;
    if (expectedIds.size && !expectedIds.has(entry.id)) note(file, entry.id, "id not in the registry skeleton");
    if (registry.has(entry.id)) note(file, entry.id, "duplicate id across batches");
    registry.set(entry.id, entry);
    if (!entry.nutrition) {
      warn(file, entry.id, "no nutrition (unknown; counted as missing in recipes)");
      continue;
    }
    const { kcal } = entry.nutrition;
    const atwater = atwaterEnergy(entry.nutrition);
    if (atwater > 20 && Math.abs(kcal - atwater) / atwater > 0.2) warn(file, entry.id, `kcal ${kcal} vs macros ${atwater.toFixed(0)}`);
    const range = kcalRange[entry.group];
    if (range && (kcal < range[0] || kcal > range[1])) warn(file, entry.id, `kcal ${kcal} outside the usual ${range[0]}–${range[1]} for ${entry.group}`);
    if (entry.sources.length < 1) warn(file, entry.id, "no sources");
    if (!entry.names.si) warn(file, entry.id, "no Sinhala name");
    if (!entry.names.ta) warn(file, entry.id, "no Tamil name");
    if (entry.density_g_per_ml === null && entry.state !== "dried" && /milk|oil|treacle|vinegar|sauce|juice|water|toddy|syrup|honey/iu.test(entry.names.en)) warn(file, entry.id, "liquid without a density");
  }
}

// Recipe drafts
const perServingRanges = {
  meat_and_poultry: { protein: ["meat", "poultry"], grams: [90, 220] },
  fish_and_seafood: { protein: ["fish", "seafood", "dried_fish"], grams: [80, 200] },
  pulses_and_eggs: { protein: ["pulse", "egg"], grams: [25, 120] },
};
const recipes = new Map();
for (const file of files.filter((name) => /^out-recipes-\d+\.json$/u.test(name))) {
  let entries;
  try {
    entries = JSON.parse(readFileSync(join(directory, file), "utf8"));
  } catch (error) {
    note(file, null, `not JSON: ${error.message}`);
    continue;
  }
  for (const draft of entries) {
    const raw = normaliseRecipe(draft);
    const parsed = recipeSchema.safeParse(raw);
    if (!parsed.success) {
      note(file, raw?.id ?? "?", parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      continue;
    }
    const recipe = parsed.data;
    const dish = dishes.get(recipe.id);
    if (!dish) note(file, recipe.id, "not in the catalogue");
    if (recipes.has(recipe.id)) note(file, recipe.id, "duplicate recipe across batches");
    recipes.set(recipe.id, recipe);
    for (const [index, ingredient] of recipe.ingredients.entries()) {
      if (ingredient.ref && expectedIds.size && !expectedIds.has(ingredient.ref)) note(file, recipe.id, `ingredient ${index} ref ${ingredient.ref} unknown`);
      if (ingredient.ref === null) warn(file, recipe.id, `ingredient ${index} "${ingredient.label.en}" has no ref`);
      if (!ingredient.label.si || !ingredient.label.ta) warn(file, recipe.id, `ingredient ${index} "${ingredient.label.en}" lacks si/ta label`);
      if (ingredient.unit === "piece" && ingredient.ref && registry.size && registry.get(ingredient.ref)?.measures.piece_g === null) warn(file, recipe.id, `ingredient ${index} "${ingredient.label.en}" counted in pieces but ${ingredient.ref} has no piece weight`);
    }
    if (!recipe.steps.si) warn(file, recipe.id, "no Sinhala steps");
    if (!recipe.steps.ta) warn(file, recipe.id, "no Tamil steps");
    if (recipe.steps.en.length < 3) warn(file, recipe.id, `only ${recipe.steps.en.length} steps`);
    // Quantity sanity: main protein grams per serving for the protein categories.
    const rule = dish ? perServingRanges[dish.category] : null;
    if (rule && registry.size) {
      let proteinGrams = 0;
      for (const ingredient of recipe.ingredients) {
        const entry = ingredient.ref ? registry.get(ingredient.ref) : null;
        if (entry && rule.protein.includes(entry.group) && !ingredient.optional) proteinGrams += ingredient.unit === "piece" ? ingredient.quantity * (entry.measures.piece_g ?? 0) : ingredient.quantity;
      }
      const perServing = proteinGrams / recipe.base_servings;
      if (perServing && (perServing < rule.grams[0] || perServing > rule.grams[1])) warn(file, recipe.id, `${Math.round(perServing)} g of ${rule.protein.join("/")} per serving, outside ${rule.grams[0]}–${rule.grams[1]}`);
    }
    const rawGrams = recipe.ingredients.reduce((sum, ingredient) => sum + (ingredient.unit === "piece" ? 0 : ingredient.quantity), 0);
    if (recipe.yield_g > rawGrams * 3.5 + 200) warn(file, recipe.id, `yield ${recipe.yield_g} g against ${Math.round(rawGrams)} g of weighed ingredients`);
    if (recipe.serving.portion_g * recipe.base_servings > recipe.yield_g * 1.5) warn(file, recipe.id, `portion ${recipe.serving.portion_g} g × ${recipe.base_servings} exceeds yield ${recipe.yield_g} g`);
    if (registry.size) {
      const nutrition = recipeNutrition(recipe, (id) => registry.get(id));
      const kcal = nutrition.per_serving.kcal;
      if (kcal < 15) warn(file, recipe.id, `only ${kcal} kcal per serving (missing: ${nutrition.coverage.missing.join(", ") || "none"})`);
      if (kcal > 1200) warn(file, recipe.id, `${kcal} kcal per serving`);
      recipe.computed = { kcal, tags: computedTags(nutrition.per_serving, recipe.serving.role), missing: nutrition.coverage.missing };
    }
  }
}

const quiet = process.argv.includes("--quiet");
console.log(`registry entries: ${registry.size} / ${expectedIds.size || "?"}; recipes: ${recipes.size} / ${catalogue.length}`);
for (const problem of problems) console.log(`ERROR ${problem.file} ${problem.id ?? ""}: ${problem.message}`);
if (!quiet) for (const warning of warnings) console.log(`warn  ${warning.file} ${warning.id ?? ""}: ${warning.message}`);
const tally = (list) => Object.fromEntries([...list.reduce((map, item) => map.set(item.file, (map.get(item.file) ?? 0) + 1), new Map())]);
console.log(`errors: ${problems.length}`, tally(problems));
console.log(`warnings: ${warnings.length}`, tally(warnings));
if (problems.length) process.exitCode = 1;
if (recipes.size && registry.size) {
  const kcals = [...recipes.values()].map((recipe) => recipe.computed.kcal).sort((a, b) => a - b);
  console.log(`kcal per serving: min ${kcals[0]}, median ${kcals[Math.floor(kcals.length / 2)]}, max ${kcals.at(-1)}`);
}
