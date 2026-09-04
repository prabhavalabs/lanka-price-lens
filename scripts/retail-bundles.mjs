#!/usr/bin/env node
/**
 * Regenerates the retail manifests and mapping bundles under data/ from one shared
 * canonical vocabulary. Canonical ids are reused from the HARTI bundle wherever the
 * same commodity exists, so a retailer's "Carrot" and the wholesale "Carrot" are one
 * item; each retailer gets its own online_store market. Edit the label tables below,
 * run `node scripts/retail-bundles.mjs`, and review the diff.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const harti = JSON.parse(readFileSync(resolve(root, "data/mappings/harti_daily_food_prices.json"), "utf8"));
const hartiProducts = new Map(harti.products.map((product) => [product.id, product]));
const hartiItems = new Map(harti.items.map((item) => [item.id, item]));
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
const item = (id, productId, label, variety = null, entity = "commodity") => {
  if (!products[productId]) throw new Error(`define product ${productId} before ${id}`);
  items[id] = { id, product_id: productId, entity_type: entity, canonical_label_en: label, canonical_label_si: null, canonical_label_ta: null, variety, origin: null, size: null, grade: null, source_labels: [], expected_market_labels: [] };
};

for (const id of [
  "item_ash_plantains", "item_beans", "item_beetroot_general", "item_bitter_gourd", "item_brinjals", "item_capsicum", "item_carrot", "item_cucumber", "item_drumstick",
  "item_eggplant", "item_green_chillies", "item_knolkhol", "item_ladies_fingers", "item_leeks", "item_long_beans", "item_luffa", "item_manioc", "item_pumpkin", "item_radish",
  "item_snake_gourd", "item_sweet_potato", "item_tomato", "item_lime", "item_papaya", "item_avocado", "item_orange", "item_passion_fruit", "item_wood_apple",
  "item_banana_ambul", "item_banana_kolikuttu", "item_banana_seeni", "item_mango_karathakolomban",
]) reuseItem(id);
product("product_big_onion"); item("item_big_onion", "product_big_onion", "Big Onion");
product("product_cabbage"); item("item_cabbage", "product_cabbage", "Cabbage");
product("product_potato"); item("item_potato", "product_potato", "Potato");
product("product_banana"); item("item_banana", "product_banana", "Banana");
product("product_mango"); item("item_mango", "product_mango", "Mango"); item("item_mango_tjc", "product_mango", "Mango", "TJC", "variety");
product("product_pineapple"); item("item_pineapple", "product_pineapple", "Pineapple");
const fresh = [
  ["red_onion", "Red Onion"], ["garlic", "Garlic"], ["ginger", "Ginger"], ["coconut", "Coconut"], ["cauliflower", "Cauliflower"], ["broccoli", "Broccoli"],
  ["lettuce", "Lettuce"], ["iceberg_lettuce", "Iceberg Lettuce"], ["spinach", "Spinach (Nivithi)"], ["gotukola", "Gotukola"], ["kankun", "Kankun"], ["mukunuwenna", "Mukunuwenna"],
  ["kathurumurunga", "Kathurumurunga"], ["curry_leaves", "Curry Leaves"], ["dambala", "Winged Beans (Dambala)"], ["thalana_batu", "Thalana Batu"], ["tibbatu", "Tibbatu"],
  ["batana", "Batana"], ["kekiri", "Kekiri"], ["celery", "Celery"], ["red_cabbage", "Red Cabbage"], ["chinese_cabbage", "Chinese Cabbage"], ["lemon", "Lemon"],
  ["cherry_tomato", "Cherry Tomato"], ["sweet_corn", "Sweet Corn"], ["spring_onion", "Spring Onion"], ["plantain_flower", "Plantain Flower"], ["cabbage_leaves", "Cabbage Leaves"],
  ["salad_cucumber", "Salad Cucumber"], ["green_cucumber", "Green Cucumber"], ["turmeric", "Fresh Turmeric"], ["tamarind", "Tamarind"], ["kohila", "Kohila"],
  ["ambarella", "Ambarella", "fruit"], ["bread_fruit", "Bread Fruit"], ["polos", "Polos (Young Jackfruit)"], ["oyster_mushroom", "Oyster Mushroom"],
  ["coriander_leaves", "Coriander Leaves"], ["salad_leaves", "Salad Leaves"], ["mint_leaves", "Mint Leaves"], ["onion_leaves", "Onion Leaves"], ["guava", "Guava", "fruit"],
];
for (const [key, label, category] of fresh) {
  product(`product_${key}`, label, category ?? "vegetable");
  item(`item_${key}`, `product_${key}`, label);
}
product("product_bell_pepper", "Bell Pepper");
product("product_zucchini", "Zucchini");
item("item_bell_pepper_green", "product_bell_pepper", "Bell Pepper", "Green", "variety");
item("item_bell_pepper_red", "product_bell_pepper", "Bell Pepper", "Red", "variety");
item("item_bell_pepper_yellow", "product_bell_pepper", "Bell Pepper", "Yellow", "variety");
item("item_zucchini", "product_zucchini", "Zucchini", "Green", "variety");
item("item_zucchini_yellow", "product_zucchini", "Zucchini", "Yellow", "variety");

// Retailer labels exactly as the adapters normalise them (whitespace collapsed, trimmed, case kept).
const labels = {
  keells: {
    item_ash_plantains: ["Ash Plantains"], item_beans: ["Green Beans"], item_beetroot_general: ["Beetroot"], item_bitter_gourd: ["Bitter Gourd"], item_brinjals: ["Brinjals"],
    item_capsicum: ["Capsicum"], item_carrot: ["Carrot"], item_cucumber: ["Cucumber"], item_drumstick: ["Drumsticks"], item_eggplant: ["Egg Plants"], item_green_chillies: ["Green Chilies"],
    item_knolkhol: ["Knol Khol"], item_ladies_fingers: ["Ladies Fingers"], item_leeks: ["Leeks"], item_long_beans: ["Long Beans"], item_luffa: ["Ribbed Gourd"], item_manioc: ["Manioc"],
    item_pumpkin: ["Pumpkin"], item_radish: ["Raddish"], item_snake_gourd: ["Snake Gourd"], item_sweet_potato: ["Sweet Potato"], item_tomato: ["Tomatoes"], item_lime: ["Lime"],
    item_big_onion: ["Big Onions"], item_cabbage: ["Cabbage"], item_potato: ["Potatoes"], item_red_onion: ["Red Onions"], item_garlic: ["Garlic"], item_ginger: ["Ginger"], item_coconut: ["Coconut"],
    item_cauliflower: ["Cauliflower"], item_broccoli: ["Broccoli"], item_iceberg_lettuce: ["Iceberg Lettuce"], item_spinach: ["Nivithi"], item_gotukola: ["Gotukola"], item_kankun: ["Kankun"],
    item_mukunuwenna: ["Mukunuwenna"], item_kathurumurunga: ["Kathurumurunga"], item_curry_leaves: ["Curry Leaves"], item_dambala: ["Dambala"], item_thalana_batu: ["Thalana Batu"],
    item_tibbatu: ["Tib Batu"], item_batana: ["Batana"], item_kekiri: ["Kekiri"], item_celery: ["Celery"], item_red_cabbage: ["Red Cabbage"], item_chinese_cabbage: ["Chinese Cabbage"],
    item_lemon: ["Lemon"], item_cherry_tomato: ["Cherry Tomato"], item_sweet_corn: ["Sweet Corn"], item_plantain_flower: ["Plantain Flower"], item_cabbage_leaves: ["Cabbage Leaves"],
    item_salad_cucumber: ["Salad Cucumber"], item_green_cucumber: ["Green Cucumber"], item_kohila: ["Kohila"], item_ambarella: ["Ambarella"], item_bread_fruit: ["Bread Fruit"], item_polos: ["Polos"],
    item_coriander_leaves: ["Coriander Leaves"], item_salad_leaves: ["Salad Leaves"], item_mint_leaves: ["Minchi Leaves"], item_onion_leaves: ["Onion Leaves"],
    item_bell_pepper_green: ["Bell Pepper Green"], item_bell_pepper_red: ["Bell Pepper Red"], item_bell_pepper_yellow: ["Bell Pepper Yellow"], item_zucchini: ["Zucchini"], item_zucchini_yellow: ["Yellow Zucchini"],
  },
  cargills: {
    item_ash_plantains: ["Ash plantain"], item_beans: ["Green Beans"], item_beetroot_general: ["Beetroot"], item_bitter_gourd: ["Bitter Gourd"], item_brinjals: ["Brinjal"], item_capsicum: ["Capsicum"],
    item_carrot: ["Carrot"], item_cucumber: ["Cucumber"], item_drumstick: ["Drumsticks"], item_green_chillies: ["Green Chillies"], item_knolkhol: ["Knol Khol"], item_ladies_fingers: ["Ladies Fingers"],
    item_leeks: ["Leeks"], item_long_beans: ["Long beans"], item_luffa: ["Luffa"], item_manioc: ["Manioc"], item_pumpkin: ["Pumpkin"], item_radish: ["Long Raddish"], item_snake_gourd: ["Snake Gourd"],
    item_sweet_potato: ["Sweet Potatoes"], item_tomato: ["Tomato"], item_lime: ["Lime"], item_big_onion: ["Big Onion"], item_cabbage: ["Cabbage"], item_potato: ["Potatoes"], item_red_onion: ["Red Onion"],
    item_garlic: ["Garlic"], item_ginger: ["Raw Ginger"], item_coconut: ["Coconut"], item_cauliflower: ["Cauliflower"], item_broccoli: ["Broccoli"], item_lettuce: ["Lettuce"], item_spinach: ["Spinach"],
    item_gotukola: ["Gotukola"], item_kankun: ["Kankun"], item_mukunuwenna: ["Mukunuwanna"], item_dambala: ["Dambala"], item_thalana_batu: ["Thalana Batu"], item_tibbatu: ["Tibbatu"], item_batana: ["Batana"],
    item_kekiri: ["Kakiri"], item_celery: ["Celery"], item_red_cabbage: ["Red Cabbage"], item_lemon: ["Lemon"], item_spring_onion: ["Spring onion"], item_plantain_flower: ["Kesel Muwa"],
    item_cabbage_leaves: ["Cabbage Leaves"], item_green_cucumber: ["Green Cucumber"], item_turmeric: ["Turmeric"], item_tamarind: ["Tamarind"], item_oyster_mushroom: ["Oyster Mushrooms"],
    item_bell_pepper_green: ["Bell Pepper Green"], item_bell_pepper_red: ["Bell Pepper Red"], item_bell_pepper_yellow: ["Bell Pepper Yellow"], item_zucchini: ["Zucchini"], item_zucchini_yellow: ["Yellow Zucchini"],
    item_avocado: ["Avocado"], item_passion_fruit: ["Passion Fruit"], item_wood_apple: ["Wood Apple"], item_pineapple: ["Pineapple"], item_papaya: ["Papaw - Red Lady", "Papaw - Tainung"],
    item_banana: ["Cavendish Banana"], item_banana_kolikuttu: ["Kolikuttu"], item_mango_tjc: ["T. J .C. Mango"], item_mint_leaves: ["Mint"], item_ambarella: ["Ambarella"], item_guava: ["Guava"],
  },
  spar: {
    item_ash_plantains: ["ASH Plantain"], item_beans: ["GREEN Beans"], item_beetroot_general: ["BEETROOT"], item_bitter_gourd: ["BITTER Gourd"], item_brinjals: ["BRINJALS"], item_capsicum: ["CAPSICUM"],
    item_carrot: ["CARROTS"], item_cucumber: ["CUCUMBER"], item_drumstick: ["DRUMSTICKS"], item_eggplant: ["EGG Plants"], item_green_chillies: ["GREEN Chilies"], item_ladies_fingers: ["LADIES Fingers"],
    item_leeks: ["LEEKS"], item_long_beans: ["LONG Beans"], item_luffa: ["RIBBED Gourd"], item_manioc: ["MANIOC"], item_pumpkin: ["PUMPKIN"], item_radish: ["RADDISH"], item_snake_gourd: ["SNAKE Gourd"],
    item_sweet_potato: ["SWEET Potato"], item_tomato: ["TOMATOES"], item_lime: ["LIMES"], item_big_onion: ["BIG Onions"], item_cabbage: ["CABBAGE"], item_potato: ["POTATOES"], item_red_onion: ["Red Onions"],
    item_garlic: ["GARLIC"], item_ginger: ["GINGER"], item_cauliflower: ["CAULIFLOWER"], item_broccoli: ["BROCCOLI"], item_iceberg_lettuce: ["ICEBERG (LETTUCE)"], item_spinach: ["Nivithi"],
    item_curry_leaves: ["CURRY Leaves"], item_thalana_batu: ["Thalana Batu"], item_batana: ["BATANA"], item_plantain_flower: ["PLANTAIN Flower"], item_cabbage_leaves: ["CABBAGE Leaves"],
    item_salad_cucumber: ["SALAD Cucumber"], item_coriander_leaves: ["CORIANDER Leaves"], item_salad_leaves: ["SALAD Leaves"], item_mint_leaves: ["MINCHI Leaves"], item_onion_leaves: ["ONION Leaves"],
    item_bell_pepper_green: ["BELL Pepper, Green"], item_bell_pepper_red: ["BELL Pepper, Red"], item_bell_pepper_yellow: ["BELL Pepper, Yellow"],
    item_avocado: ["AVOCADO"], item_passion_fruit: ["Passion Fruit"], item_wood_apple: ["Woodapple"], item_papaya: ["PAPAYA, each (about 1.2kg)"], item_pineapple: ["PINEAPPLE, each (about 1.3kg)"],
    item_lemon: ["LEMON"], item_banana_ambul: ["AMBUL Banana, (about 1kg)"], item_banana_kolikuttu: ["KOLIKUTTU Banana, (about 1kg)"], item_banana_seeni: ["SEENI Banana, (about 1kg)"],
    item_banana: ["CAVENDISH Banana, (about 1kg)"], item_mango_tjc: ["MANGO TJC, each (about 500g)"], item_mango_karathakolomban: ["MANGO KC, each (about 300g)"], item_orange: ["ORANGE Local, 2's (about 400g)"],
    item_guava: ["GUAVA"],
  },
  glomark: {
    item_chinese_cabbage: ["Chinese Cabbage"], item_zucchini: ["Zucchini"], item_zucchini_yellow: ["Yellow Zucchini"], item_leeks: ["Leeks"], item_curry_leaves: ["Karapincha", "Curry Leaves"],
    item_mukunuwenna: ["Mukunuwenna"], item_kankun: ["Kankun"], item_gotukola: ["Gotukola"], item_carrot: ["Carrot", "Carrots"], item_beetroot_general: ["Beetroot"], item_cabbage: ["Cabbage"],
    item_tomato: ["Tomato", "Tomatoes"], item_potato: ["Potato", "Potatoes"], item_big_onion: ["Big Onion", "Big Onions", "B Onion"], item_red_onion: ["Red Onion", "Red Onions"], item_garlic: ["Garlic"],
    item_ginger: ["Ginger"], item_beans: ["Beans", "Green Beans"], item_brinjals: ["Brinjal", "Brinjals"], item_capsicum: ["Capsicum"], item_cucumber: ["Cucumber"], item_pumpkin: ["Pumpkin"],
    item_lime: ["Lime", "Limes"], item_ladies_fingers: ["Ladies Fingers", "Ladies Finger"], item_bitter_gourd: ["Bitter Gourd"], item_snake_gourd: ["Snake Gourd"], item_manioc: ["Manioc"],
    item_sweet_potato: ["Sweet Potato", "Sweet Potatoes"], item_green_chillies: ["Green Chilli", "Green Chillies", "Green Chili", "Green Chilies"], item_cauliflower: ["Cauliflower"], item_broccoli: ["Broccoli", "Brocolli"],
    item_knolkhol: ["Knol Khol", "Knolkhol"], item_radish: ["Radish", "Raddish"], item_ash_plantains: ["Ash Plantain", "Ash Plantains"], item_drumstick: ["Drumstick", "Drumsticks"], item_coconut: ["Coconut", "COCONUT"],
    item_bell_pepper_green: ["Bell Pepper Green"], item_bell_pepper_red: ["Bell Pepper Red"], item_bell_pepper_yellow: ["Bell Pepper Yellow"], item_cabbage_leaves: ["Cabbage Leaves"], item_celery: ["Celery"],
    item_coriander_leaves: ["Coriander Leaves"], item_iceberg_lettuce: ["Iceberg ( Lettuce )", "Iceberg (Lettuce)", "Iceberg Lettuce"], item_kohila: ["Kohila"], item_long_beans: ["Long Beans"],
    item_mint_leaves: ["Minchi Leaves"], item_luffa: ["Ribbed Gourd"], item_salad_leaves: ["Salad Leaves"], item_spring_onion: ["Spring Onion"], item_ambarella: ["Ambarella"],
  },
};

const retailers = {
  keells: { id: "keells_online_prices", name: "Keells Online shelf prices", owner: "John Keells Holdings PLC (Keells Supermarkets)", landing_url: "https://www.keellssuper.com/", formats: ["json"], kind: "keells_api", market: { id: "market_keells_online", label: "Keells Online", scope: "Keells Online web store; prices and stock reported for the configured outlet (default SCDR, Colombo)." }, settings: {}, mapping_version: "keells-online-2026-09-04.3" },
  cargills: { id: "cargills_online_prices", name: "Cargills Online shelf prices", owner: "Cargills (Ceylon) PLC (Cargills Food City)", landing_url: "https://cargillsonline.com/", formats: ["json"], kind: "cargills_api", market: { id: "market_cargills_online", label: "Cargills Online", scope: "Cargills Online web store; prices for the store serving the configured delivery area (default Colombo)." }, settings: { pinCode: "Colombo" }, mapping_version: "cargills-online-2026-09-04.3" },
  spar: { id: "spar_online_prices", name: "SPAR Sri Lanka online shelf prices", owner: "SPAR Sri Lanka (Ceylon Biscuits Limited / SPAR International)", landing_url: "https://spar2u.lk/", formats: ["json"], kind: "spar_shopify", market: { id: "market_spar_online", label: "SPAR Online", scope: "SPAR spar2u.lk Shopify storefront; a single national online price list." }, settings: {}, mapping_version: "spar-online-2026-09-04.3" },
  glomark: { id: "glomark_online_prices", name: "Glomark online shelf prices", owner: "Softlogic Retail (Pvt) Ltd (Glomark)", landing_url: "https://glomark.lk/", formats: ["html"], kind: "glomark_html", market: { id: "market_glomark_online", label: "Glomark Online", scope: "glomark.lk storefront category pages; a single national online price list." }, settings: {}, mapping_version: "glomark-online-2026-09-04.3" },
};

for (const [key, retailer] of Object.entries(retailers)) {
  const manifest = {
    id: retailer.id,
    name: retailer.name,
    owner: retailer.owner,
    landing_url: retailer.landing_url,
    retrieval_method: "api_snapshot",
    expected_cadence: "daily",
    formats: retailer.formats,
    geographic_scope: "online_store_national",
    price_types: ["retail_online_store"],
    rights_status: "internal_evaluation",
    rights_evidence_ref: "docs/retail-capture.md",
    attribution_text: `Source: ${retailer.name.replace(" shelf prices", "")}, publicly listed shelf prices captured for internal evaluation. Not redistributed until the rights review is complete.`,
    retention_policy: "preserve_source_evidence",
    parser_owner: "Prabhava Labs maintainers",
    reviewed_by: "repository-owner",
    reviewed_at: REVIEWED,
    review_due_at: REVIEW_DUE,
    request_interval_ms: 1500,
    max_attempts: 3,
    enabled: true,
    adapter: { kind: retailer.kind, settings: retailer.settings },
  };
  writeFileSync(resolve(root, `data/manifests/${retailer.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

  const bundleItems = Object.entries(labels[key]).map(([itemId, sourceLabels]) => {
    const base = items[itemId];
    if (!base) throw new Error(`unknown item ${itemId} for ${key}`);
    return { ...base, source_labels: sourceLabels, expected_market_labels: [retailer.market.label] };
  });
  const productIds = new Set(bundleItems.map((bundleItem) => bundleItem.product_id));
  const bundle = {
    schema_version: "1.0.0",
    mapping_version: retailer.mapping_version,
    source_id: retailer.id,
    reviewed_by: "repository-owner",
    reviewed_at: REVIEWED,
    evidence_ref: "docs/retail-capture.md",
    products: [...productIds].sort().map((id) => products[id]),
    items: bundleItems,
    markets: [{ id: retailer.market.id, type: "online_store", label_en: retailer.market.label, label_si: null, label_ta: null, pcode: null, scope_note: retailer.market.scope, source_labels: [retailer.market.label] }],
    units: [
      { id: "unit_kg_exact", source_unit: "kg", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
      { id: "unit_g_to_kg", source_unit: "g", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1000, rounding_mode: "half_away_from_zero" },
      { id: "unit_piece_exact", source_unit: "piece", normalized_unit: "piece", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
      { id: "unit_bunch_exact", source_unit: "bunch", normalized_unit: "bunch", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
    ],
    completeness: { minimum_item_coverage: 0.5, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.01, minimum_score: 0.3 },
  };
  writeFileSync(resolve(root, `data/mappings/${retailer.id}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`${retailer.id}: ${bundleItems.length} items, ${productIds.size} products`);
}
