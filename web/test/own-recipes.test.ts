import assert from "node:assert/strict";
import test from "node:test";

import { draftFromRecipe, draftToInput, emptyDraft, emptyIngredient, emptyStep, hasErrorUnder, toRecipeView, validateDraft, type RecipeDraft } from "../src/lib/own-recipes.ts";

function fullDraft(): RecipeDraft {
  const draft = emptyDraft();
  draft.name = " Ambul thiyal ";
  draft.category = "fish_and_seafood";
  draft.summary = "Sour fish, dry enough to keep.";
  draft.serving.portion_g = "120";
  draft.serving.description.en = "Two pieces with rice";
  draft.yield_g = "480";
  draft.times = { prep_minutes: "20", cook_minutes: "40", passive_minutes: "" };
  const tuna = emptyIngredient({ ref: "product_tuna", name: "Tuna", names: { si: "බලයා", ta: null } });
  tuna.quantity = "500";
  tuna.household = "1 large slice";
  tuna.preparation.en = "cut in chunks";
  const goraka = emptyIngredient({ ref: null, name: "Goraka" });
  goraka.quantity = "4";
  goraka.unit = "piece";
  goraka.scaling = "sublinear";
  draft.ingredients = [tuna, goraka];
  draft.steps.en = [{ ...emptyStep(), text: "Rub the fish with the goraka paste.", minutes: "" }, { ...emptyStep(), text: "Cook covered on a low fire.", minutes: "35" }];
  draft.steps.si = [{ ...emptyStep(), text: "", minutes: "" }];
  draft.equipment = ["clay pot", " "];
  draft.tags = ["high_protein"];
  draft.tips.en = "Better the next day.";
  return draft;
}

test("an empty draft says what is missing, beside the field it is missing from", () => {
  const checked = validateDraft(emptyDraft());
  assert.equal(checked.ok, false);
  assert.equal(checked.errors.name, "Write something here");
  assert.equal(checked.errors.ingredients, "Add at least one ingredient");
  assert.ok(!("serving.portion_g" in checked.errors) && !("yield_g" in checked.errors), "a new draft starts with a plate-side portion and a pot for four");
  const weightless = validateDraft({ ...emptyDraft(), serving: { ...emptyDraft().serving, portion_g: "" }, yield_g: "abc" });
  assert.equal(weightless.errors["serving.portion_g"], "Enter a number");
  assert.equal(weightless.errors.yield_g, "Enter a number");
  assert.equal(checked.errors["steps.en.0.text"], "Write something here");
  assert.ok(!("steps.si" in checked.errors), "an untouched language is simply absent");
  assert.ok(hasErrorUnder(checked.errors, "steps.en"));
  assert.ok(!hasErrorUnder(checked.errors, "steps.ta"));
});

test("a full draft becomes a valid recipe input and reads back into the same draft", () => {
  const checked = validateDraft(fullDraft());
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const recipe = checked.value!;
  assert.equal(recipe.name, "Ambul thiyal");
  assert.equal(recipe.visibility, "private");
  assert.deepEqual(recipe.steps.si, null, "blank Sinhala steps mean no Sinhala, not empty Sinhala");
  assert.deepEqual(recipe.equipment, ["clay pot"]);
  assert.equal(recipe.times.passive_minutes, 0);
  assert.deepEqual(recipe.ingredients[0]!.label, { en: "Tuna", si: "බලයා", ta: null });
  assert.equal(recipe.ingredients[1]!.ref, null);
  assert.equal(recipe.ingredients[1]!.preparation, null);
  assert.equal(recipe.steps.en[1]!.minutes, 35);
  assert.deepEqual(recipe.tips, { en: "Better the next day.", si: null, ta: null });
  const again = draftFromRecipe(recipe);
  assert.equal(again.serving.portion_g, "120");
  assert.equal(again.times.passive_minutes, "0");
  assert.deepEqual(again.steps.si, []);
  assert.equal(again.ingredients[0]!.label.si, "බලයා");
  const round = validateDraft(again);
  assert.equal(round.ok, true);
  assert.deepEqual(round.value, recipe);
});

test("numbers that do not read as numbers, and limits, are reported per line", () => {
  const draft = fullDraft();
  draft.ingredients[0]!.quantity = "half a kilo";
  draft.ingredients[1]!.quantity = "0";
  draft.serving.portion_g = "9000";
  draft.steps.en[1]!.minutes = "-5";
  draft.steps.ta = [{ ...emptyStep(), text: "First", minutes: "" }, { ...emptyStep(), text: "  ", minutes: "" }];
  const checked = validateDraft(draft);
  assert.equal(checked.ok, false);
  assert.equal(checked.errors["ingredients.0.quantity"], "Enter a number");
  assert.equal(checked.errors["ingredients.1.quantity"], "Must be more than zero");
  assert.equal(checked.errors["serving.portion_g"], "Keep it at 5000 or less");
  assert.equal(checked.errors["steps.en.1.minutes"], "Must be more than zero");
  assert.equal(checked.errors["steps.ta.1.text"], "Write something here", "a half-written language is checked line by line");
  assert.ok(hasErrorUnder(checked.errors, "ingredients"));
  const input = draftToInput(draft) as { ingredients: Array<{ quantity: unknown }> };
  assert.ok(Number.isNaN(input.ingredients[0]!.quantity));
});

test("the account's computed view reads as the recipe page expects, never as machine drafted", () => {
  assert.equal(toRecipeView(null), null);
  assert.equal(toRecipeView({ ingredients: [] }), null);
  const view = toRecipeView({
    id: "urecipe_1",
    servings: 6,
    base_servings: 4,
    serving: { role: "with_rice", portion_g: 120, description: null },
    yield_g: 720,
    ingredients: [],
    steps: { en: [{ text: "Cook.", minutes: null, uses: [] }], si: [{ text: "උයන්න.", minutes: null, uses: [] }] },
    times: { prep_minutes: 20, cook_minutes: 40, passive_minutes: 0 },
    nutrition: { per_serving: { kcal: 1, protein_g: 1, fat_g: 1, carb_g: 1, fibre_g: null, sugar_g: null, sodium_mg: null }, total: { kcal: 6, protein_g: 6, fat_g: 6, carb_g: 6, fibre_g: null, sugar_g: null, sodium_mg: null }, servings: 6, coverage: { counted: 0, with_nutrition: 0, missing: [] }, edible_g_per_serving: 120 },
    review: { en: false, si: false, ta: false },
  });
  assert.ok(view);
  assert.deepEqual(view.review, { en: true, si: true, ta: true });
  assert.deepEqual(view.languages, ["en", "si"]);
  assert.equal(view.steps.ta, null);
  assert.equal(view.cost, null);
  assert.deepEqual(view.tags, []);
  assert.equal(view.health_note, null);
});
