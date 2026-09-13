// Mechanical clean-up of drafted entries before they meet the schemas: the drafts are model
// output and vary in small ways the schema should not have to forgive.
import { atwaterEnergy } from "../../shared/src/index.ts";

const measureKeys = ["tsp_g", "tbsp_g", "cup_g", "piece_g", "bunch_g"];
const nutritionKeys = ["kcal", "protein_g", "fat_g", "carb_g", "fibre_g", "sugar_g", "sodium_mg"];

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function normaliseIngredient(raw) {
  const entry = { ...raw };
  entry.names = { en: text(raw.names?.en) ?? raw.name_en ?? raw.id, si: text(raw.names?.si), si_latn: text(raw.names?.si_latn), ta: text(raw.names?.ta), ta_latn: text(raw.names?.ta_latn) };
  entry.as_purchased_note = text(raw.as_purchased_note);
  entry.edible_portion = number(raw.edible_portion) ?? 1;
  entry.density_g_per_ml = number(raw.density_g_per_ml);
  entry.measures = Object.fromEntries(measureKeys.map((key) => [key, number(raw.measures?.[key])]));
  const nutrition = Object.fromEntries(nutritionKeys.map((key) => [key, number(raw.nutrition?.[key])]));
  const core = ["kcal", "protein_g", "fat_g", "carb_g"];
  if (core.every((key) => nutrition[key] === null)) entry.nutrition = null;
  else {
    for (const key of core) nutrition[key] = nutrition[key] ?? 0;
    entry.nutrition = nutrition;
  }
  entry.sources = Array.isArray(raw.sources) ? raw.sources.filter((source) => source && typeof source === "object" && text(source.name) && text(source.entry)).map((source) => ({ name: source.name.trim(), entry: source.entry.trim(), kcal: number(source.kcal), protein_g: number(source.protein_g), fat_g: number(source.fat_g), carb_g: number(source.carb_g) })) : [];
  entry.basis = text(raw.basis) ?? "Drafted without a stated basis.";
  entry.confidence = ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low";
  entry.notes = text(raw.notes);
  entry.reviewed = false;
  return entry;
}

/** Wraps a bare string into localized text; passes objects through with trimmed fields. */
function localized(value) {
  if (typeof value === "string") return text(value) ? { en: value.trim(), si: null, ta: null } : null;
  if (value && typeof value === "object" && text(value.en)) return { en: value.en.trim(), si: text(value.si), ta: text(value.ta) };
  return null;
}

function steps(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const list = value.map((step) => (typeof step === "string" ? { text: step.trim(), minutes: null } : { text: text(step?.text) ?? "", minutes: number(step?.minutes) === null || number(step?.minutes) <= 0 ? null : Math.round(number(step.minutes)) })).filter((step) => step.text);
  return list.length ? list : null;
}

export function normaliseRecipe(raw) {
  const recipe = { ...raw };
  recipe.base_servings = number(raw.base_servings) ?? 4;
  recipe.serving = { role: raw.serving?.role ?? "side", portion_g: number(raw.serving?.portion_g) ?? 100, description: localized(raw.serving?.description) };
  recipe.yield_g = number(raw.yield_g) ?? recipe.serving.portion_g * recipe.base_servings;
  recipe.ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map((line) => ({
    ref: text(line.ref),
    label: localized(line.label) ?? { en: text(line.ref)?.replace(/^(?:product|pantry)_/u, "").replace(/_/gu, " ") ?? "ingredient", si: null, ta: null },
    quantity: number(line.quantity) ?? 1,
    unit: ["g", "ml", "piece"].includes(line.unit) ? line.unit : line.unit === "pieces" || line.unit === "pc" || line.unit === "pcs" ? "piece" : "g",
    household: text(line.household),
    preparation: localized(line.preparation),
    optional: Boolean(line.optional),
    scaling: ["linear", "sublinear", "fixed"].includes(line.scaling) ? line.scaling : "linear",
    part: ["main", "tempering", "marinade", "batter", "dough", "filling", "sauce", "syrup", "garnish", "serving", "frying"].includes(line.part) ? line.part : "main",
  }));
  // Thin (second-squeeze) coconut milk has its own registry entry; drafts name the squeeze in the preparation.
  for (const line of recipe.ingredients) {
    if (line.ref !== "pantry_coconut_milk") continue;
    const wording = `${line.label.en} ${line.preparation?.en ?? ""} ${line.household ?? ""}`;
    if (/\bthin\b|second|third|light|diluted/iu.test(wording) && !/\bthick\b|first/iu.test(wording.replace(/second|third/giu, ""))) line.ref = "pantry_coconut_milk_thin";
  }
  // Oil listed for deep frying is bought whole but mostly comes back out of the pan; mark it so the calculator counts the absorbed share.
  const fryingWords = /deep[- ]?fr(?:y|ied|ying)|for (?:deep )?frying|to (?:deep )?fry|frying oil|shallow[- ]?fry/iu;
  for (const line of recipe.ingredients) {
    const oil = /oil$|^oil\b|_oil$|ghee|margarine/iu.test(`${line.ref ?? ""} ${line.label.en}`);
    const wording = [line.label.en, line.preparation?.en ?? "", line.household ?? ""].join(" ");
    if (oil && line.part !== "tempering" && line.unit !== "piece" && line.quantity >= 100 && fryingWords.test(wording)) line.part = "frying";
  }
  recipe.steps = { en: steps(raw.steps?.en) ?? [{ text: "Method to be written.", minutes: null }], si: steps(raw.steps?.si), ta: steps(raw.steps?.ta) };
  recipe.times = { prep_minutes: Math.max(0, Math.round(number(raw.times?.prep_minutes) ?? 0)), cook_minutes: Math.max(0, Math.round(number(raw.times?.cook_minutes) ?? 0)), passive_minutes: Math.max(0, Math.round(number(raw.times?.passive_minutes) ?? 0)) };
  recipe.equipment = Array.isArray(raw.equipment) ? raw.equipment.map(text).filter(Boolean) : [];
  recipe.tips = localized(raw.tips);
  recipe.health_note = localized(raw.health_note);
  recipe.tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.map(text).filter(Boolean))] : [];
  const flags = new Set();
  for (const value of Array.isArray(raw.review_needed) ? raw.review_needed : []) {
    const lower = String(value).toLowerCase();
    if (/\bsi\b|sinhala/u.test(lower)) flags.add("si");
    if (/\bta\b|tamil/u.test(lower)) flags.add("ta");
    if (/quant/u.test(lower)) flags.add("quantities");
  }
  recipe.review_needed = [...flags];
  recipe.review = { en: false, si: false, ta: false };
  delete recipe.computed;
  return recipe;
}

/** True when the energy sits near what the macros account for (fibre discounted), the check the schema also applies. */
export function energyConsistent(nutrition, tolerance = 0.3) {
  const expected = atwaterEnergy(nutrition);
  return expected <= 20 || Math.abs(nutrition.kcal - expected) / expected <= tolerance;
}

/**
 * Reads every out-recipes-NN.json in a directory as one pool. Drafting agents shared scratch
 * files and some recipes landed in a sibling batch's output; a recipe is taken from the file
 * of the batch that owns its id when that file has it, otherwise from wherever it is.
 */
export function poolDrafts(readdirSync, readFileSync, join, directory) {
  const files = readdirSync(directory).sort();
  const owner = new Map();
  for (const file of files.filter((name) => /^recipe-batch-\d+\.json$/u.test(name))) {
    const number = /(\d+)\.json$/u.exec(file)[1];
    for (const dish of JSON.parse(readFileSync(join(directory, file), "utf8"))) owner.set(dish.id, number);
  }
  const pool = new Map();
  const problems = [];
  for (const file of files.filter((name) => /^out-recipes-\d+\.json$/u.test(name))) {
    const number = /(\d+)\.json$/u.exec(file)[1];
    let entries;
    try {
      entries = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch (error) {
      problems.push({ file, id: null, message: `not JSON: ${error.message}` });
      continue;
    }
    if (!Array.isArray(entries)) {
      problems.push({ file, id: null, message: "not an array" });
      continue;
    }
    for (const raw of entries) {
      const id = raw?.id;
      if (typeof id !== "string") {
        problems.push({ file, id: null, message: "entry without an id" });
        continue;
      }
      const own = owner.get(id) === number;
      const existing = pool.get(id);
      if (existing && existing.own && !own) continue;
      if (existing && existing.own && own) {
        problems.push({ file, id, message: "listed twice in its own batch" });
        continue;
      }
      pool.set(id, { raw, file, own });
    }
  }
  return { pool, problems, owner };
}
