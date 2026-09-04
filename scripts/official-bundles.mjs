#!/usr/bin/env node
/**
 * Regenerates the manifests and mapping bundles for the official PDF sources
 * (Central Bank daily price report, DCS weekly retail prices). Canonical ids are
 * shared with the HARTI and retailer bundles wherever the same commodity exists.
 * Edit the label tables, run `node scripts/official-bundles.mjs`, review the diff.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const harti = JSON.parse(readFileSync(resolve(root, "data/mappings/harti_daily_food_prices.json"), "utf8"));
const hartiProducts = new Map(harti.products.map((product) => [product.id, product]));
const hartiItems = new Map(harti.items.map((item) => [item.id, item]));
const hartiMarkets = new Map(harti.markets.map((market) => [market.id, market]));
const REVIEWED = "2026-09-04";
const REVIEW_DUE = "2027-03-04";

const products = {};
const items = {};
const reuseItem = (id) => {
  const item = hartiItems.get(id);
  if (!item) throw new Error(`missing HARTI item ${id}`);
  items[id] = { ...item, source_labels: [], expected_market_labels: [] };
  products[item.product_id] = hartiProducts.get(item.product_id);
};
const product = (id, label, category = "vegetable") => {
  products[id] = hartiProducts.get(id) ?? { id, category, canonical_label_en: label, canonical_label_si: null, canonical_label_ta: null };
};
const item = (id, productId, label, { variety = null, origin = null, grade = null, entity = "commodity" } = {}) => {
  if (!products[productId]) throw new Error(`define product ${productId} before ${id}`);
  items[id] = { id, product_id: productId, entity_type: entity, canonical_label_en: label, canonical_label_si: null, canonical_label_ta: null, variety, origin, size: null, grade, source_labels: [], expected_market_labels: [] };
};

for (const id of [
  "item_ash_plantains", "item_beans", "item_beetroot_general", "item_bitter_gourd", "item_brinjals", "item_capsicum", "item_carrot", "item_cucumber", "item_drumstick",
  "item_green_chillies", "item_knolkhol", "item_ladies_fingers", "item_leeks", "item_long_beans", "item_luffa", "item_manioc", "item_pumpkin", "item_radish", "item_snake_gourd",
  "item_sweet_potato", "item_tomato", "item_lime", "item_papaya", "item_pineapple_medium", "item_big_onion_imported", "item_potato_imported", "item_banana_ambul", "item_banana_anamalu",
  "item_banana_kolikuttu", "item_orange", "item_avocado", "item_passion_fruit", "item_wood_apple",
]) reuseItem(id);
product("product_big_onion"); item("item_big_onion_local", "product_big_onion", "Big Onion", { origin: "Local" });
product("product_cabbage"); item("item_cabbage", "product_cabbage", "Cabbage");
product("product_potato"); item("item_potato_local", "product_potato", "Potato", { origin: "Local" });
product("product_pineapple"); item("item_pineapple", "product_pineapple", "Pineapple");
product("product_red_onion", "Red Onion"); item("item_red_onion", "product_red_onion", "Red Onion"); item("item_red_onion_local", "product_red_onion", "Red Onion", { origin: "Local" }); item("item_red_onion_imported", "product_red_onion", "Red Onion", { origin: "Imported" });
product("product_coconut", "Coconut"); item("item_coconut", "product_coconut", "Coconut"); item("item_coconut_large", "product_coconut", "Coconut", { grade: "Large" }); item("item_coconut_medium", "product_coconut", "Coconut", { grade: "Medium" }); item("item_coconut_small", "product_coconut", "Coconut", { grade: "Small" });
const simple = [
  ["dried_chillies", "Dried Chillies", "other"], ["coconut_oil", "Coconut Oil", "other"], ["red_dhal", "Red Dhal (Mysore Dhal)", "grain"], ["sugar_white", "White Sugar", "other"], ["egg", "Egg", "other"],
  ["dried_fish_katta", "Dried Fish (Katta)", "fish"], ["sprats", "Sprats (Dried)", "fish"], ["apple", "Apple", "fruit"], ["rice_samba", "Samba Rice", "grain"], ["rice_nadu", "Nadu Rice", "grain"],
  ["rice_kekulu_white", "Kekulu Rice (White)", "grain"], ["rice_kekulu_red", "Kekulu Rice (Red)", "grain"], ["rice_ponni_samba", "Ponni Samba Rice", "grain"], ["rice_raw_red", "Raw Red Rice", "grain"],
  ["rice_raw_white", "Raw White Rice", "grain"], ["rice_nadu_red", "Nadu Rice (Red)", "grain"], ["wheat_flour", "Wheat Flour", "grain"], ["cowpea", "Cowpea", "grain"], ["green_gram", "Green Gram", "grain"],
  ["chickpea", "Chickpea (Kadalai)", "grain"], ["bread", "Bread", "other"], ["beef", "Beef", "meat"], ["mutton", "Mutton", "meat"], ["chicken", "Chicken", "meat"], ["pork", "Pork", "meat"],
  ["prawns", "Prawns", "fish"], ["tin_fish", "Tinned Fish", "fish"], ["milk_powder", "Full Cream Milk Powder", "dairy"], ["infant_milk", "Infant Milk Formula", "dairy"],
  ["kelawalla", "Kelawalla (Yellowfin Tuna)", "fish"], ["thalapath", "Thalapath (Sailfish)", "fish"], ["balaya", "Balaya (Skipjack Tuna)", "fish"], ["paraw", "Paraw (Trevally)", "fish"],
  ["salaya", "Salaya (Sardinella)", "fish"], ["hurulla", "Hurulla (Herring)", "fish"], ["linna", "Linna", "fish"], ["mullet", "Mullet", "fish"], ["mora", "Mora (Shark)", "fish"], ["parati", "Parati", "fish"],
  ["ash_pumpkin", "Ash Pumpkin"], ["kohila", "Kohila (Lasia)"], ["gotukola", "Gotukola"], ["kankun", "Kankun"], ["mukunuwenna", "Mukunuwenna"], ["kathurumurunga", "Kathurumurunga"], ["spinach", "Spinach (Nivithi)"],
  ["sarana", "Sarana"], ["thampala", "Thampala"], ["butter_beans", "Butter Beans"], ["garlic", "Garlic"], ["ginger", "Ginger"], ["tamarind", "Tamarind", "other"], ["coriander", "Coriander Seed", "other"],
  ["pepper", "Black Pepper", "other"], ["turmeric", "Turmeric", "other"], ["cumin", "Cumin Seed", "other"], ["fennel", "Fennel Seed", "other"], ["mustard", "Mustard Seed", "other"], ["fenugreek", "Fenugreek (Methi)", "other"],
  ["cinnamon", "Cinnamon", "other"], ["gorakka", "Gorakka (Garcinia)", "other"], ["maldive_fish", "Maldive Fish", "fish"], ["salt", "Salt", "other"], ["betel_leaves", "Betel Leaves", "other"], ["arecanut", "Arecanut", "other"],
];
for (const [key, label, category] of simple) {
  product(`product_${key}`, label, category ?? "vegetable");
  item(`item_${key}`, `product_${key}`, label);
}
item("item_egg_white", "product_egg", "Egg", { variety: "White", entity: "variety" });
item("item_egg_red", "product_egg", "Egg", { variety: "Red", entity: "variety" });
item("item_chicken_broiler", "product_chicken", "Chicken", { variety: "Broiler", entity: "variety" });
item("item_apple_imported", "product_apple", "Apple", { origin: "Imported" });
item("item_orange_imported", "product_orange", "Orange", { origin: "Imported" });
item("item_kohila_leaves", "product_kohila", "Kohila Leaves", { variety: "Leaves", entity: "variety" });
item("item_rice_ponni_samba_imported", "product_rice_ponni_samba", "Ponni Samba Rice", { origin: "Imported" });
item("item_coconut_oil_750ml", "product_coconut_oil", "Coconut Oil", { entity: "packaged_product" });

const sources = {
  cbsl: {
    manifest: {
      id: "cbsl_daily_price_report",
      name: "CBSL Daily Price Report",
      owner: "Central Bank of Sri Lanka",
      landing_url: "https://www.cbsl.gov.lk/en/statistics/economic-indicators/price-report",
      retrieval_method: "scheduled_download",
      expected_cadence: "business_daily",
      formats: ["pdf"],
      geographic_scope: "selected_wholesale_and_retail_markets",
      price_types: ["wholesale_observed", "retail_observed"],
      document_adapter: "cbsl_daily_price",
      request_interval_ms: 3000,
    },
    markets: [
      { id: "market_pettah", type: "wholesale_market", label_en: "Pettah", scope_note: "Pettah (Colombo) wholesale market, CBSL daily price report", source_labels: ["Pettah (wholesale)"] },
      { ...hartiMarkets.get("market_dambulla"), source_labels: ["Dambulla (wholesale)"] },
      { ...hartiMarkets.get("market_peliyagoda"), source_labels: ["Peliyagoda (wholesale)"] },
      { id: "market_negombo", type: "wholesale_market", label_en: "Negombo", scope_note: "Negombo wholesale fish market, CBSL daily price report", source_labels: ["Negombo (wholesale)"] },
      { id: "market_pettah_retail", type: "retail_market", label_en: "Pettah (retail)", scope_note: "Pettah retail prices, CBSL daily price report", source_labels: ["Pettah (retail)"] },
      { id: "market_dambulla_retail", type: "retail_market", label_en: "Dambulla (retail)", scope_note: "Dambulla retail prices, CBSL daily price report", source_labels: ["Dambulla (retail)"] },
      { id: "market_narahenpita_retail", type: "retail_market", label_en: "Narahenpita (retail)", scope_note: "Narahenpita economic centre retail prices, CBSL daily price report", source_labels: ["Narahenpita (retail)"] },
      { id: "market_negombo_retail", type: "retail_market", label_en: "Negombo (retail)", scope_note: "Negombo retail fish prices, CBSL daily price report", source_labels: ["Negombo (retail)"] },
    ],
    labels: {
      item_beans: ["Beans"], item_carrot: ["Carrot"], item_cabbage: ["Cabbage"], item_tomato: ["Tomato"], item_brinjals: ["Brinjal"], item_pumpkin: ["Pumpkin"], item_snake_gourd: ["Snake gourd"],
      item_green_chillies: ["Green Chilli"], item_lime: ["Lime"], item_red_onion_local: ["Red Onion (Local)"], item_red_onion_imported: ["Red Onion (lmp)", "Red Onion (Imp)"], item_big_onion_local: ["Big Onion (Local)"],
      item_big_onion_imported: ["Big Onion (Imp)"], item_potato_local: ["Potato (Local)"], item_potato_imported: ["Potato (Imp)"], item_dried_chillies: ["Dried Chilli (Imp)"], item_coconut: ["Coconut (Avg.)"],
      item_coconut_oil: ["Coconut oil"], item_red_dhal: ["Red Dhal"], item_sugar_white: ["Sugar (White)"], item_egg_white: ["Egg (White)"], item_dried_fish_katta: ["Katta (Imp)"], item_sprats: ["Sprat (Imp)"],
      item_banana_ambul: ["Banana (Sour)"], item_papaya: ["Papaw"], item_pineapple: ["Pineapple"], item_apple_imported: ["Apple (Imp)"], item_orange_imported: ["Orange (Imp)"], item_rice_samba: ["Samba"],
      item_rice_nadu: ["Nadu"], item_rice_kekulu_white: ["Kekulu (White)"], item_rice_kekulu_red: ["Kekulu (Red)"], item_rice_ponni_samba_imported: ["Ponni Samba (Imp)"],
      item_kelawalla: ["Kelawalla"], item_thalapath: ["Thalapath"], item_balaya: ["Balaya"], item_paraw: ["Paraw"], item_salaya: ["Salaya"], item_hurulla: ["Hurulla"], item_linna: ["Linna"],
    },
    units: ["kg", "piece", "l"],
    completeness: { minimum_item_coverage: 0.6, minimum_market_coverage: 0.6, minimum_cell_coverage: 0.4, minimum_mapping_coverage: 0.8, minimum_score: 0.5 },
    mapping_version: "cbsl-daily-2026-09-04.1",
  },
  dcs: {
    manifest: {
      id: "dcs_weekly_retail_prices",
      name: "DCS Weekly Retail Prices (Colombo District)",
      owner: "Department of Census and Statistics",
      landing_url: "https://www.statistics.gov.lk/InflationAndPrices/StaticalInformation/RetailPrices",
      retrieval_method: "scheduled_download",
      expected_cadence: "weekly",
      formats: ["pdf"],
      geographic_scope: "colombo_district_main_markets",
      price_types: ["retail_observed"],
      document_adapter: "dcs_weekly_retail",
      request_interval_ms: 2000,
    },
    markets: [
      { id: "market_colombo_district_retail", type: "retail_market", label_en: "Colombo District (retail)", scope_note: "Weekly average open-market retail prices across the main markets in the Colombo district (DCS)", source_labels: ["Colombo District (retail)"] },
    ],
    labels: {
      item_ash_plantains: ["Ash Plantain"], item_ash_pumpkin: ["Ash Pumpkin"], item_ladies_fingers: ["Bandakka"], item_brinjals: ["Brinjal"], item_bitter_gourd: ["Bitter Guard", "Bitter Gourd"], item_cucumber: ["Cucumber"],
      item_pumpkin: ["Red Pumpkin"], item_snake_gourd: ["Snake Gourd"], item_gotukola: ["Gotukola"], item_kankun: ["Kankun"], item_kathurumurunga: ["Kathurumurunga"], item_kohila_leaves: ["Kohila Leaves"],
      item_kohila: ["Kohila Yams"], item_luffa: ["Vetakolu"], item_green_chillies: ["Green Chillies"], item_capsicum: ["Capsicum"], item_leeks: ["Leeks"], item_lime: ["Limes"], item_coconut: ["Coconut - Average"],
      item_coconut_large: ["Coconut ( Large )"], item_coconut_medium: ["Coconut ( Medium)"], item_coconut_small: ["Coconut ( small)"], item_betel_leaves: ["Betel Leaves ( Average )"], item_arecanut: ["Arecanuts ( Average )"],
      item_potato_local: ["Potatoes - Local"], item_potato_imported: ["Potatoes - Imported"], item_coconut_oil_750ml: ["Coconut Oil"], item_mukunuwenna: ["Mukunuwenna"], item_spinach: ["Nivithi"], item_sarana: ["Sarana"],
      item_thampala: ["Thampala"], item_butter_beans: ["Beans - Butter"], item_beans: ["Beans - Green"], item_long_beans: ["Long Beans"], item_beetroot_general: ["BeetRoot", "Beetroot"], item_cabbage: ["Cabbagge Seed", "Cabbage"],
      item_carrot: ["Carrot"], item_drumstick: ["Drumstick"], item_knolkhol: ["Knol Khol"], item_radish: ["Raddish"], item_tomato: ["Tomatoe - No 1.", "Tomato"], item_dried_chillies: ["Dried Chillies - No 1."],
      item_coriander: ["Corriander"], item_pepper: ["Pepper - Powder"], item_turmeric: ["Turmeric -Powder"], item_garlic: ["Garlic"], item_cumin: ["Cummin Seed"], item_fennel: ["Fennel Seed"], item_mustard: ["Mustard"],
      item_fenugreek: ["Mathe Seed"], item_cinnamon: ["Cinnamon"], item_gorakka: ["Gorakka"], item_maldive_fish: ["Maldive Fish"], item_salt: ["Salt"], item_tamarind: ["Tamarind"], item_red_onion: ["Red Onions - Average"],
      item_big_onion_imported: ["B.Onions - Imported"], item_big_onion_local: ["B.Onions - Local"], item_rice_raw_red: ["Raw Red - ( Average )"], item_rice_raw_white: ["Raw White local"], item_rice_nadu_red: ["Nadu - Red"],
      item_rice_nadu: ["Nadu - White local"], item_rice_samba: ["Samba - ( Average )"], item_rice_ponni_samba_imported: ["Ponni Samba Imported"], item_wheat_flour: ["Wheat Flour"], item_red_dhal: ["Mysore Dhall - ( Average )"],
      item_cowpea: ["Cowpea Whole - Average"], item_green_gram: ["Green Gram - Average"], item_chickpea: ["Kadalai - Average"], item_sugar_white: ["Sugar"], item_paraw: ["Fresh Fish - Paraw"], item_mullet: ["Mullet"],
      item_thalapath: ["Thalapath"], item_balaya: ["Balaya"], item_kelawalla: ["Kelewella", "Kelawalla"], item_mora: ["Mora"], item_salaya: ["Salaya"], item_parati: ["Parati"], item_hurulla: ["Hurulla"], item_linna: ["Linna"],
      item_prawns: ["Prawns"], item_dried_fish_katta: ["Dried Fish - Katta"], item_sprats: ["Spratts"], item_beef: ["Beef"], item_mutton: ["Mutton"], item_chicken: ["Chicken - Fresh"], item_chicken_broiler: ["Chicken - Broiler"],
      item_pork: ["Pork"], item_egg: ["Egg - ( Average )"], item_egg_red: ["Egg - Red"], item_egg_white: ["Egg - White"], item_tin_fish: ["Tin Fish"], item_banana_ambul: ["Sour Plantain"], item_banana_anamalu: ["Anamalu"],
      // The weekly table lists full cream milk powder (400 g) by brand under one heading; the brand rows are that item.
      item_milk_powder: ["Anchor", "Maliban", "Pelwatta"],
      item_banana_kolikuttu: ["Kolikuttu"], item_papaya: ["Papaw"], item_pineapple: ["Pineapple"], item_bread: ["Bread"],
    },
    units: ["kg", "g", "piece", "bunch", "ml", "l"],
    completeness: { minimum_item_coverage: 0.6, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.7, minimum_score: 0.5 },
    mapping_version: "dcs-weekly-2026-09-04.2",
  },
};

const unitRules = {
  kg: { id: "unit_kg_exact", source_unit: "kg", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1 },
  g: { id: "unit_g_to_kg", source_unit: "g", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1000 },
  piece: { id: "unit_piece_exact", source_unit: "piece", normalized_unit: "piece", factor_numerator: 1, factor_denominator: 1 },
  bunch: { id: "unit_bunch_exact", source_unit: "bunch", normalized_unit: "bunch", factor_numerator: 1, factor_denominator: 1 },
  ml: { id: "unit_ml_to_l", source_unit: "ml", normalized_unit: "l", factor_numerator: 1, factor_denominator: 1000 },
  l: { id: "unit_l_exact", source_unit: "l", normalized_unit: "l", factor_numerator: 1, factor_denominator: 1 },
};

for (const source of Object.values(sources)) {
  const manifest = {
    ...source.manifest,
    rights_status: "approved_permission",
    rights_evidence_ref: "docs/official-sources.md#rights",
    attribution_text: `Source: ${source.manifest.name}, ${source.manifest.owner}. Official statistics reproduced with permission as recorded by the repository owner; attribution required on any release.`,
    retention_policy: "preserve_source_evidence",
    parser_owner: "Prabhava Labs maintainers",
    reviewed_by: "repository-owner",
    reviewed_at: REVIEWED,
    review_due_at: REVIEW_DUE,
    max_attempts: 3,
    enabled: true,
  };
  writeFileSync(resolve(root, `data/manifests/${manifest.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  const marketLabels = source.markets.map((market) => market.label_en);
  const bundleItems = Object.entries(source.labels).map(([itemId, sourceLabels]) => {
    const base = items[itemId];
    if (!base) throw new Error(`unknown item ${itemId} for ${manifest.id}`);
    return { ...base, source_labels: sourceLabels, expected_market_labels: marketLabels.length === 1 ? marketLabels : [] };
  });
  const productIds = new Set(bundleItems.map((bundleItem) => bundleItem.product_id));
  const bundle = {
    schema_version: "1.0.0",
    mapping_version: source.mapping_version,
    source_id: manifest.id,
    reviewed_by: "repository-owner",
    reviewed_at: REVIEWED,
    evidence_ref: "docs/official-sources.md",
    products: [...productIds].sort().map((id) => products[id]),
    items: bundleItems,
    markets: source.markets.map((market) => ({ label_si: null, label_ta: null, pcode: null, ...market })),
    units: source.units.map((unit) => ({ ...unitRules[unit], rounding_mode: "half_away_from_zero" })),
    completeness: source.completeness,
  };
  writeFileSync(resolve(root, `data/mappings/${manifest.id}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`${manifest.id}: ${bundleItems.length} items, ${productIds.size} products, ${bundle.markets.length} markets`);
}
