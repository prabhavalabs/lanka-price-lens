#!/usr/bin/env node
/**
 * Regenerates the retail manifests and mapping bundles under data/ from one shared
 * canonical vocabulary. Canonical ids are reused from the official bundles (HARTI,
 * Central Bank, DCS) wherever the same commodity exists, so a retailer's "Carrot" and
 * the wholesale "Carrot" are one item and a supermarket's whole chicken lands on the
 * item the DCS retail survey reports; each retailer gets its own online_store market.
 *
 * Produce is mapped by exact label (stores print one label per vegetable). Essentials
 * sold under many branded, pack-sized labels (chicken, eggs, milk, rice, dhal, sugar,
 * flour, oil, butter, bread) are mapped by pattern rules shared by every retailer.
 * Edit the tables below, run `node scripts/retail-bundles.mjs`, review the diff, and
 * bump the mapping versions.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const official = ["harti_daily_food_prices", "cbsl_daily_price_report", "dcs_weekly_retail_prices"].map((id) => JSON.parse(readFileSync(resolve(root, `data/mappings/${id}.json`), "utf8")));
const hartiProducts = new Map(official.flatMap((bundle) => bundle.products).map((product) => [product.id, product]));
const hartiItems = new Map(official.flatMap((bundle) => bundle.items).map((item) => [item.id, item]));
const REVIEWED = "2026-09-04";
const REVIEW_DUE = "2027-03-04";

const products = {};
const items = {};
const reuseItem = (id) => {
  const item = hartiItems.get(id);
  if (!item) throw new Error(`missing official item ${id}`);
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

// Essentials the official bulletins already report; the supermarket price lands on the same item.
for (const id of [
  "item_chicken", "item_egg", "item_egg_white", "item_egg_red", "item_beef", "item_pork", "item_mutton", "item_milk_powder", "item_bread", "item_tin_fish",
  "item_coconut_oil", "item_salt", "item_sprats", "item_maldive_fish", "item_red_dhal", "item_green_gram", "item_chickpea", "item_cowpea", "item_sugar_white", "item_wheat_flour",
  "item_rice_samba", "item_rice_nadu", "item_rice_nadu_red", "item_rice_kekulu_red", "item_rice_kekulu_white", "item_rice_raw_red", "item_rice_raw_white", "item_rice_ponni_samba_imported",
  "item_dried_chillies",
]) reuseItem(id);
// Cuts and forms only the supermarkets sell.
item("item_chicken_whole_skinless", "product_chicken", "Chicken", "Whole, skinless", "variety");
item("item_chicken_curry_cut", "product_chicken", "Chicken", "Curry cut", "variety");
item("item_chicken_curry_cut_skinless", "product_chicken", "Chicken", "Curry cut, skinless", "variety");
item("item_chicken_breast", "product_chicken", "Chicken", "Breast, boneless", "variety");
item("item_chicken_drumsticks", "product_chicken", "Chicken", "Drumsticks", "variety");
item("item_chicken_thighs", "product_chicken", "Chicken", "Thighs", "variety");
item("item_chicken_legs", "product_chicken", "Chicken", "Whole legs", "variety");
item("item_chicken_wings", "product_chicken", "Chicken", "Wings", "variety");
product("product_fresh_milk", "Fresh Milk", "dairy"); item("item_fresh_milk", "product_fresh_milk", "Fresh Milk");
product("product_butter", "Butter", "dairy");
item("item_butter_salted", "product_butter", "Butter", "Salted", "variety");
item("item_butter_unsalted", "product_butter", "Butter", "Unsalted", "variety");
product("product_rice_keeri_samba", "Keeri Samba Rice", "grain"); item("item_rice_keeri_samba", "product_rice_keeri_samba", "Keeri Samba Rice");

// ---- Pattern rules shared by every retailer (regular expressions, case-insensitive) ----
const weight = ["kg", "g"];
const volume = ["l", "ml"];
const rule = (match, { exclude = [], units = weight, min = null, pack = "as_captured" } = {}) => ({
  match: match.source,
  exclude: exclude.map((pattern) => pattern.source),
  units,
  min_quantity: min,
  pack,
});
// Never an essential, whatever the label says: processed and cooked forms, meat substitutes, pet food, toiletries, kitchenware.
const excludedPatterns = [
  /saus\w*|bockwurst|hot ?dog|frank|salami|pepperoni|mortadella|\bham\b|bacon|gammon|luncheon|lingus|chorizo|nugget|meat ?balls?|burger|patt(y|ies)|cutlet|kiev|satay|kebab|kochchi|bites|fingers\b(?! )|strips|crispy|crumbed|breaded|battered|dumpling|samosa|spring roll|\brolls?\b|pizza|lasagn[ae]|pastry|puff|\bbuns?\b|jerky|murukku|shortbread/,
  /marinated|seasoned|smoke\w*|roast\w*|fried|devilled|grilled|bbq|barbecue|spicy|kuruma|curry paste|curry mix|masala|seasoning|flavou?r|vanilla|strawberry|stock cube|soup|gravy|sauce|spread|paste|pickle|chutney|sambol|badu[mn]|bedun|ready to (eat|cook)|\brte\b|heat ?& ?eat|cooked|snack|cracker|biscuit|cookie|cake|mousse|dessert|ice cream|chocolate|toffee|candy|dosa|\bmix\b|mixture/,
  /soya|\bsoy\b|vegan|tofu|mock|plant.based|analogue/,
  /\bdog\b|puppy|\bcat\b|kitten|\bpet\b|drools|pedigree|whiskas|aquarium|\bbird\b/,
  /soap|shampoo|lotion|body (milk|wash|butter)|\bhair\b|\bface\b|\bskin\b(?!less)|detergent|cleaner|scrub|toothpaste|t\/paste|\bpen\b|\bscales?\b|beater|whisk|scraper|cooker|\bgel\b/,
];
const skinless = /skin ?less|s\/l\b/;
const chickenParts = /breast|thigh|drum ?(stick|let)|wing|\blegs?\b|fillet|gizzard|liver|feet|neck|cubes?/;
// Frozen, marinated, and value-added meat lines: priced as a prepared product, not as the fresh commodity.
const packedBrands = /krest|crizzpy|sam[’'`]?s\b|snacky|goldi|crescent|elephant house|\beh\b|prima\b|wow.?b|drumlet/;
const notEggs = [/omega|free range|organic|quail|duck|colou?ring|mayonn?aise|noodle|eggless|egg ?plants?|hopper|dressing|yolk|liquid|\bnest\b/];
const notButter = [/peanut|p\/butter|b\/butter|cocoa|shea|coconut|garlic|chicken|beans?\b|cashew|almond|\bnuts?\b|caramel|popcorn|ghee|croissant|scotch|milk\b|margarine|butterfly|kiri|naan|prawn|corn|lettuce|cultured|body|curd|chil+i|chiplet|bread/];
const notRice = [/flour|noodle|flake|milk|kanji|porridge|bran|vinegar|paper|wine|bir[iy]?yani|pilau|instant|ready|\bcook\b|\bmix\b|papadam|murukku|hopper|pittu|roti|treat|cereal|oats|quinoa|brown rice|basmati|broken|suduru|glutinous|sticky|jasmine|sushi|arborio|sprout|puffed|\bbags?\b|traditional|heirloom|organic|kalu ?heenati|heenati|suwandel|pachchaperumal|madathawalu|rathdel|kuruluthuda/];
const patterns = {
  // Whole chicken with skin is what the DCS survey prices as "Chicken - Fresh"; skinless, curry-cut, and parts are their own items.
  item_chicken: [rule(/^(?=.*\bwhole\b)(?=.*\bchicken\b)/, { exclude: [skinless, /pre.?cut|precut|\bcut\b|pieces|curry/, chickenParts, /sea chicken/], min: 0.8 })],
  item_chicken_whole_skinless: [rule(/^(?=.*\bwhole\b)(?=.*\bchicken\b)(?=.*(skin ?less|s\/l\b))/, { exclude: [/pre.?cut|precut|\bcut\b|pieces|curry/, chickenParts], min: 0.8 })],
  item_chicken_curry_cut: [rule(/^(?=.*\bchicken\b)(?=.*(pre.?cut|precut|curry cut|curry pieces|chicken pieces))/, { exclude: [skinless, chickenParts, /boneless/], min: 0.8 })],
  item_chicken_curry_cut_skinless: [rule(/^(?=.*\bchicken\b)(?=.*(pre.?cut|precut|curry cut|curry pieces))(?=.*(skin ?less|s\/l\b))/, { exclude: [chickenParts, /boneless/], min: 0.8 })],
  item_chicken_breast: [rule(/^(?=.*\bchicken\b)(?=.*breast)/, { exclude: [/stuffed|sea chicken|bone.?in/, packedBrands], min: 0.25 })],
  item_chicken_drumsticks: [rule(/^(?=.*\bchicken\b)(?=.*drum ?stick)/, { exclude: [packedBrands], min: 0.24 })],
  item_chicken_thighs: [rule(/^(?=.*\bchicken\b)(?=.*thigh)/, { exclude: [packedBrands], min: 0.25 })],
  item_chicken_legs: [rule(/^(?=.*\bchicken\b)(?=.*\blegs?\b)/, { exclude: [/thigh|drum/, packedBrands], min: 0.25 })],
  item_chicken_wings: [rule(/^(?=.*\bchicken\b)(?=.*wing)/, { exclude: [packedBrands], min: 0.25 })],
  item_beef: [rule(/\bbeef\b/, { exclude: [/corned|canned|aust|australian|imported|\bnz\b|new zealand|liver|tripe|babath|bones?\b|peanut|tomato|curry\b(?! beef)/, packedBrands], min: 0.25 })],
  item_pork: [rule(/\bpork\b/, { exclude: [/corned|canned|aust|australian|imported|gammon|mortadella|stuffing|knuckle|bones?\b|belly|fillet|chops?\b|paprika|cumberland/, packedBrands], min: 0.25 })],
  item_mutton: [rule(/\bmutton\b/, { exclude: [/aust|australian|imported|\bnz\b|corned|canned|bir[iy]?yani|bones?\b/, packedBrands], min: 0.25 })],
  // Eggs are counted, not weighed: "10S" is a tray of ten even when the tray weight is printed too.
  item_egg_white: [rule(/^(?=.*\beggs?\b)(?=.*\bwhite\b)/, { exclude: notEggs, units: ["piece"], pack: "count" })],
  item_egg_red: [rule(/^(?=.*\beggs?\b)(?=.*(\bbrown\b|\bred\b))/, { exclude: notEggs, units: ["piece"], pack: "count" })],
  item_egg: [rule(/\beggs?\b/, { exclude: [...notEggs, /\bwhite\b|\bbrown\b|\bred\b/], units: ["piece"], pack: "count" })],
  // Plain drinking milk per litre; small tetra packs and flavoured or fat-reduced milks are left out of the comparison.
  item_fresh_milk: [rule(/^(?=.*\bmilk\b)(?=.*(fresh|uht|u h t|pasteuri[sz]ed|pasturi[sz]ed|full cream|tetra|white milk|pouch))/, { exclude: [/powder|strawberry|vanilla|banana|faluda|coffee|\btea\b|malt|non.?fat|low.?fat|skim|lactose|goat|almond|\bsoy|\boat|coconut|condensed|evaporated|yog|curd|formula|baby|infant|kids|pedia|ensure|anlene|glucerna|horlicks|milo|nestomalt|ovaltine|\bdrink\b|shake|kiri|whipping|cooking cream|sour cream|thickened|creamer/], units: volume, min: 0.45 })],
  // Full cream milk powder only: no fat-reduced, fortified, infant, maternal, or tea-whitener blends ("2 in 1", "Kirithe").
  item_milk_powder: [rule(/milk powder|\bmilk\b.*powder|powder.*\bmilk\b/, { exclude: [/non.?fat|skim|low.?fat|high calcium|anlene|glucerna|ensure|protinex|pediasure|lactogen|lactogrow|activgro|\bnan\b|s-?26|similac|cow ?& ?gate|formula|infant|baby|months|years|\d\s*-\s*\d|kids|junior|coconut|goat|malt|creamer|whitener|ariya|\d\s*in\s*1|kirithe|blend|everyday|melko|enfamama|\bmama\b|materna|anmum/], min: 0.35 })],
  item_butter_unsalted: [rule(/^(?=.*\bbutter\b)(?=.*unsal\w*)/, { exclude: notButter, min: 0.1 })],
  item_butter_salted: [rule(/\bbutter\b/, { exclude: [...notButter, /unsal\w*/], min: 0.1 })],
  item_rice_nadu_red: [rule(/^(?=.*\bnadu\b)(?=.*(\bred\b|rathu|rosa))/, { exclude: notRice, min: 0.1 })],
  item_rice_nadu: [rule(/\bnadu\b/, { exclude: [...notRice, /\bred\b|rathu|rosa/], min: 0.1 })],
  item_rice_keeri_samba: [rule(/kee?ri ?samba|keerisamba/, { exclude: [...notRice, /ponni/], min: 0.1 })],
  item_rice_ponni_samba_imported: [rule(/\bponni\b/, { exclude: notRice, min: 0.1 })],
  item_rice_samba: [rule(/\bsamba\b/, { exclude: [...notRice, /kee?ri|kiri|ponni|\bred\b|rathu|rosa|kekulu/], min: 0.1 })],
  item_rice_kekulu_red: [rule(/^(?=.*kekulu)(?=.*(\bred\b|rosa|rathu))/, { exclude: notRice, min: 0.1 })],
  item_rice_kekulu_white: [rule(/^(?=.*kekulu)(?!.*(\bred\b|rosa|rathu))/, { exclude: notRice, min: 0.1 })],
  item_rice_raw_red: [rule(/^(?=.*\brice\b)(?=.*\braw\b)(?=.*(\bred\b|rathu))/, { exclude: [...notRice, /nadu|samba|kekulu/], min: 0.1 })],
  item_rice_raw_white: [rule(/^(?=.*\brice\b)(?=.*\braw\b)(?=.*(white|sudu))/, { exclude: [...notRice, /nadu|samba|kekulu/], min: 0.1 })],
  item_red_dhal: [rule(/(\bred|mysoo?re?|masoor|masur|jumbo|\bparippu)\s*dha+l|^dhal\s*-?\s*bulk|dha+l\b.*bulk/, { exclude: [/salted|toor|chann?a|gram|orid|urad|moong|vadai|wade|cup dhal|papadam|curry/], min: 0.25 })],
  item_green_gram: [rule(/green gram/, { exclude: [/dha+l|flour|sprout|kadala|papadam/], min: 0.25 })],
  item_chickpea: [rule(/chick ?peas?|\bkadala\b|\bchann?a\b/, { exclude: [/flour|dha+l|boiled|tinned|canned|rata|peanut|ground|besan|parippu|thel/], min: 0.25 })],
  item_cowpea: [rule(/cow ?peas?/, { exclude: [/flour|sprout/], min: 0.25 })],
  item_sugar_white: [rule(/white sugar|sugar white|^sugar\b|sugar bulk/, { exclude: [/soft|brown|icing|castor|caster|cane|jaggery|palm|coconut|cube|syrup|substitute|sweetener|free|less|reduced|zero|jam|drink|juice|cereal|kithul|demerara|vanilla|dark|lump|treacle|plantain|crystals?\b/], min: 0.4 })],
  item_wheat_flour: [rule(/(wheat|all purpose|family|plain) flour|flour.*\bwheat\b/, { exclude: [/steamed|atta|self.?rais|bread flour|whole ?wheat|whole ?meal|rice|kurakkan|gram|besan|chickpea|ulundu|undu|semolina|tapioca|manioc|coconut|oat|almond|tempura|crumb|dosa|idli|kithul|pancake|hopper|pittu|roti|string|batter|corn|maize/], min: 0.5 })],
  item_coconut_oil: [rule(/coconut oil/, { exclude: [/virgin|massage|infused|chilli|garlic|ghee|scented|organic|jelly|miracle/], units: volume, min: 0.35 })],
  item_salt: [rule(/(table|cooking|crystal|iodi[sz]ed|refined|fine|powder|pvd|rock|sea) salt|^salt\b|salt bulk/, { exclude: [/pepper|lime|himalayan|pink|bath|peanut|cashew|butter|mixture|caramel|lemon|garlic|celery|onion|bamboo|black|sprinkle|mint|sozo|spray|epsom|salted/], min: 0.35 })],
  // Packaged sandwich loaves priced by weight; in-store bakery lines sold per loaf without a printed weight are left out.
  item_bread: [rule(/sandwich bread|white bread|\bbread\b/, { exclude: [/kurakkan|garlic|fruit|butter|kimbula|malt|whole|brown|wheat|multigrain|crust|stick|pita|naan|flour|sour|cheese|milk bread|arabic|flat|crumb|talk|diet|\boat|rye|seed|sugar|tea bread|kithul|coconut|pudding|toast|french|banana|bakery|\(\s*[sml]\s*\)/], min: 0.3 })],
  item_sprats: [rule(/\bsprat+s?\b/, { exclude: [/ready to cook|\bhot\b/], min: 0.09 })],
  item_maldive_fish: [rule(/maldive fish|umbalakada/, { exclude: [/katta|\bmix\b/], min: 0.09 })],
  // The survey's "Tin Fish" is canned mackerel; sardines and fish packed in oil are a different product.
  item_tin_fish: [rule(/canned fish|tin(ned)? fish|canned mackerel|\bmackerel\b|jack mackerel/, { exclude: [/ambul|thiyal|fillet|fresh|frozen|in .*oil|canola|sardine|tuna|salmon|dried|dry fish/], min: 0.15 })],
  item_dried_chillies: [rule(/dr(ied|y) (red )?chill?i?e?s?\b|chill?ies? dr(ied|y)/, { exclude: [/powder|flake|crush|pieces|green|capsicum/], min: 0.09 })],
};

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
    item_lemon: ["LEMON"], item_banana_ambul: ["AMBUL Banana, (about 1kg)"], item_banana_kolikuttu: ["KOLIKUTTU Banana, (about 1kg)"], item_banana_seeni: ["SEENI Banana, (about 1kg)"], item_coconut: ["COCONUTS, each"],
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
  keells: { id: "keells_online_prices", name: "Keells Online shelf prices", owner: "John Keells Holdings PLC (Keells Supermarkets)", landing_url: "https://www.keellssuper.com/", formats: ["json"], kind: "keells_api", market: { id: "market_keells_online", label: "Keells Online", scope: "Keells Online web store; prices and stock reported for the configured outlet (default SCDR, Colombo)." }, settings: {}, mapping_version: "keells-online-2026-09-04.5" },
  cargills: { id: "cargills_online_prices", name: "Cargills Online shelf prices", owner: "Cargills (Ceylon) PLC (Cargills Food City)", landing_url: "https://cargillsonline.com/", formats: ["json"], kind: "cargills_api", market: { id: "market_cargills_online", label: "Cargills Online", scope: "Cargills Online web store; prices for the store serving the configured delivery area (default Colombo)." }, settings: { pinCode: "Colombo" }, mapping_version: "cargills-online-2026-09-04.5" },
  spar: { id: "spar_online_prices", name: "SPAR Sri Lanka online shelf prices", owner: "SPAR Sri Lanka (Ceylon Biscuits Limited / SPAR International)", landing_url: "https://spar2u.lk/", formats: ["json"], kind: "spar_shopify", market: { id: "market_spar_online", label: "SPAR Online", scope: "SPAR spar2u.lk Shopify storefront; a single national online price list." }, settings: {}, mapping_version: "spar-online-2026-09-04.5" },
  glomark: { id: "glomark_online_prices", name: "Glomark online shelf prices", owner: "Softlogic Retail (Pvt) Ltd (Glomark)", landing_url: "https://glomark.lk/", formats: ["html"], kind: "glomark_html", market: { id: "market_glomark_online", label: "Glomark Online", scope: "glomark.lk storefront category pages; a single national online price list." }, settings: {}, mapping_version: "glomark-online-2026-09-04.5" },
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
    rights_status: "approved_permission",
    rights_evidence_ref: "docs/retail-capture.md#rights-position",
    attribution_text: `Source: ${retailer.name.replace(" shelf prices", "")}, publicly listed shelf prices. Reproduced with the retailer's permission as recorded by the repository owner.`,
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

  // Exact labels are per retailer; pattern rules are shared, in the order the table above lists them.
  const itemIds = [...new Set([...Object.keys(labels[key]), ...Object.keys(patterns)])];
  const bundleItems = itemIds.map((itemId) => {
    const base = items[itemId];
    if (!base) throw new Error(`unknown item ${itemId} for ${key}`);
    return { ...base, source_labels: labels[key][itemId] ?? [], source_patterns: patterns[itemId] ?? [], expected_market_labels: [retailer.market.label] };
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
      { id: "unit_l_exact", source_unit: "l", normalized_unit: "l", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
      { id: "unit_ml_to_l", source_unit: "ml", normalized_unit: "l", factor_numerator: 1, factor_denominator: 1000, rounding_mode: "half_away_from_zero" },
    ],
    excluded_patterns: excludedPatterns.map((pattern) => pattern.source),
    completeness: { minimum_item_coverage: 0.5, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.01, minimum_score: 0.3 },
  };
  writeFileSync(resolve(root, `data/mappings/${retailer.id}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`${retailer.id}: ${bundleItems.length} items, ${productIds.size} products`);
}
