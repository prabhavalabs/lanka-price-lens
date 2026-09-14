/**
 * The "How to use" guide: eleven sections of steps with screenshots of the live site. The screenshots
 * live in public/guide and are refreshed by scripts/guide-screenshots.js; the test checks that every
 * file here exists at the declared size. The same guide is docs/user-guide.md in the repository.
 */
export type GuideFigure = {
  /** File name under /guide, without the .png extension. */
  file: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  /** Half the width of the article on wide screens, so two can sit side by side. */
  half?: true;
};

export type GuideSection = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  figures: GuideFigure[];
  tips?: string[];
};

export const guideSections: GuideSection[] = [
  {
    id: "start",
    title: "Start here",
    summary: "The front page is the price board: every product with a published price, grouped by category, with open markets and supermarkets side by side. The figures at the top say how many products, supermarkets, and official sources are behind the day's board, and when the latest observations were made.",
    steps: [
      "“Rising this month” and “Falling this month” pick out the biggest 30-day movers.",
      "The category chips narrow the board to vegetables, rice, fish, and so on; “All” brings everything back.",
      "Open any card for that product's sellers and history.",
    ],
    figures: [
      { file: "board", alt: "The PriceLens front page with the month's rising and falling prices, category chips, and product cards", caption: "The front page: the day's movers, categories, and every product with a price.", width: 1920, height: 1200 },
    ],
  },
  {
    id: "find",
    title: "Find a product",
    summary: "The search box in the header matches names in English, Sinhala, and Tamil and forgives spelling: “potatos”, “b onion”, and “dhal” all land. After a short pause it also adds products by the wording a store or bulletin uses, so a shelf label finds the product it belongs to.",
    steps: [
      "Click or tap the search box, or start typing on the front page.",
      "With nothing typed it lists the products most people look at today.",
      "Use the arrow keys and Enter, or tap a result, to open the product.",
    ],
    figures: [
      { file: "search", alt: "The search box open with “b onion” typed and Big Onion suggested with its price range", caption: "Search understands rough spelling and store wording: “b onion” finds Big Onion.", width: 1920, height: 281 },
    ],
  },
  {
    id: "read",
    title: "Read a price",
    summary: "A product's page lists every seller with a current price, by group: open markets (retail prices surveyed by the Central Bank of Sri Lanka and the Department of Census and Statistics), supermarkets (the online stores of Keells, Cargills, Glomark, and SPAR), and wholesale markets (the HARTI daily bulletin). Every price carries the date it was observed.",
    steps: [
      "Within each group the cheapest seller is marked; the summary cards give each group's average, and the supermarket card says how far above wholesale the shelves are today.",
      "A product sold in several varieties shows them as badges; the sellers' ranges pool the varieties unless the product compares by a base variety.",
      "A price older than its source allows (a week for a daily source, three weeks for a weekly one) is struck through with an “outdated” badge and how long ago it was seen. It never counts as the cheapest.",
    ],
    figures: [
      { file: "product", alt: "The Big Onion page: photo, varieties, the quantity control, and summary cards for open markets, supermarkets, and wholesale", caption: "A product: sellers by group with the cheapest marked, and the supermarket average against wholesale.", width: 1920, height: 1200 },
      { file: "outdated", alt: "An open-markets table where one seller's price is struck through and marked outdated, seen three months ago", caption: "A price older than its source allows is struck through and marked outdated.", width: 1680, height: 452 },
    ],
    tips: [
      "Open-market prices come from surveys of selected markets and may differ at another stall on the same day.",
      "Supermarket prices are the online store's, which can differ from a branch.",
    ],
  },
  {
    id: "history",
    title: "Follow the history",
    summary: "Below the sellers, the history chart draws every seller's price over time.",
    steps: [
      "Choose 30 days, 90 days, or a year.",
      "Switch seller groups on and off with the round buttons above the chart to compare, say, supermarkets against wholesale alone.",
      "Hover, or tap on a phone, any day to read every seller's price on it; the list under the chart names each line.",
      "The range and the groups are kept in the page address, so copying the link, or using “Share”, shows someone exactly the view you have.",
    ],
    figures: [
      { file: "history", alt: "The price history chart over 90 days with open markets and supermarkets on, a day hovered, and a tooltip listing each seller's price", caption: "The history: pick a range, switch groups, hover or tap a day for every seller's price.", width: 1680, height: 1049 },
    ],
  },
  {
    id: "basket",
    title: "Build a basket",
    summary: "The basket is your shopping list, in real amounts. It lives only in your browser: nothing is uploaded and there is no account.",
    steps: [
      "“Add” on a card or a product page puts the product in the basket, starting at half a kilo (or half a litre, or one piece). The button becomes the amount with − and + around it.",
      "− and + step by a quarter kilo or litre, or one piece. Going below 50 g or one piece removes the item.",
      "Tap the amount itself for presets (100 g to 5 kg, 250 ml to 2 l, 1 to 30 pieces) or type an exact figure in grams or kilos and press “Set”.",
      "The basket icon in the header opens a small dropdown from any page: adjust or remove items, clear the list (the bin asks once), or go to the comparison.",
    ],
    figures: [
      { file: "quantity", alt: "The quantity control on the Big Onion page opened to presets from 100 g to 5 kg and a field for an exact amount", caption: "Tap the amount for presets or an exact figure in grams or kilos.", width: 1920, height: 735 },
      { file: "quick-basket", alt: "The basket dropdown in the header listing seven items with − and + controls and a button to compare stores", caption: "The basket from any page: adjust, remove, clear, or compare stores.", width: 1920, height: 732 },
    ],
  },
  {
    id: "compare",
    title: "Compare stores",
    summary: "“Compare stores for this basket” opens the basket page, which prices the list at every seller with observations from the last 30 days, in the amounts you set.",
    steps: [
      "“Where it costs least” lists stores that carry the whole list first, then by total. The cheapest is badged; a store missing items says which, and the total is for what it carries.",
      "“Your list” has the same −, +, and amount controls, and a search box to add more without leaving the page.",
      "“Share” copies a link or opens WhatsApp with the list; “Clear” empties it.",
    ],
    figures: [
      { file: "basket", alt: "The basket page: a table of sellers ordered by coverage and total with the cheapest badged, and the list of seven items with amounts", caption: "The basket page: stores that carry the whole list first, then by total; your list with amounts.", width: 1920, height: 1200 },
    ],
  },
  {
    id: "cook",
    title: "Cook from your basket",
    summary: "Under the store comparison, “Cook with your basket” suggests dishes from a catalogue of 363 Sri Lankan dishes, best fit first: how many of a dish's key ingredients you already have, how much of your basket it uses, and what is still to buy.",
    steps: [
      "Each card names the dish, its kind, time, and difficulty, and what it still needs.",
      "A dish page marks the ingredients already in your basket and prices the rest at today's cheapest seller, with an “Add” for each; the cost card says how many you have and what the rest would cost. Then variants and what it goes well with.",
      "“Recipes” in the header browses the whole catalogue by name in any language or by ingredient.",
    ],
    figures: [
      { file: "cook", alt: "Dish cards under the basket, each with its category, time, difficulty, and what it still needs", caption: "Dishes that fit what you have, best fit first, each saying what is still to buy.", width: 1680, height: 1061 },
      { file: "recipe", alt: "A dish page with ingredients still to buy at today's cheapest price and the ingredients already in the basket", caption: "A dish: every ingredient at today's cheapest price, the ones already in your basket marked, and the cost for the table.", width: 1920, height: 1200 },
      { file: "recipes", alt: "The recipe catalogue filtered by “curry”, one card per dish", caption: "The whole catalogue, searchable by name in any language or by ingredient.", width: 1920, height: 1200 },
    ],
  },
  {
    id: "servings",
    title: "Cook for any number",
    summary: "Every dish carries a full recipe: quantities as you buy them, the method step by step, and the numbers that follow from them. Set how many you are cooking for and every amount scales; calories per serving and the cost per serving at today's cheapest sellers come with it. The time does not change: a pot for twenty simmers as long as a pot for four.",
    steps: [
      "Use the “Cooking for” control or the 4, 6, 10, and 20 buttons. Salt, oil for tempering, and whole spices grow a little slower than the headcount, as they do in a real kitchen.",
      "“Per serving” gives energy, protein, fat, carbohydrate, fibre, and sodium for one person's portion, computed from each ingredient's edible weight against a nutrition table built for Sri Lankan foods and checked against published composition tables.",
      "The cost card prices the ingredients for the headcount at today's cheapest published seller, with the per-serving figure under it and how many ingredients are already in your basket. A “≈” means something is not priced yet or a price is older than a week; the card says which.",
      "“Read in” switches the method between English, Sinhala, and Tamil. Sinhala and Tamil text is machine drafted until a person has reviewed it, and the page says so.",
      "On the recipes page the chips and the calorie cap ask a question of the whole catalogue: weight loss, high protein, low calorie, quick, budget, and so on, sorted by fewest calories, most protein, quickest, or cheapest.",
      "“Surprise me” beside the search, or in the ⋯ menu, opens one dish at random. Signed in, it follows the food preferences on your account and the banner above the recipe says why it was picked; “Another one” draws again without repeating a dish this tab has shown, and the banner links to the preferences.",
    ],
    figures: [
      { file: "servings", alt: "A hoppers recipe scaled to ten people, with calories, cost, and time per serving and the ingredient list in grams", caption: "One recipe for ten: every amount, the calories, and the cost follow the headcount; the time stays.", width: 1920, height: 1200 },
      { file: "recipes-filters", alt: "The recipes page filtered to weight-loss-friendly dishes, fewest calories first, each card showing calories and protein per serving", caption: "Ask the catalogue a question: weight loss, fewest calories first.", width: 1920, height: 1200 },
    ],
  },
  {
    id: "menus",
    title: "Plan a menu",
    summary: "A menu is a meal for an occasion: a Sunday lunch, a poya dana, a birthday tea. Name it, say how many are coming, add recipes from their pages, and the whole meal is worked out: calories per person, cost per person at today's prices, and one shopping list summed across every recipe.",
    steps: [
      "On any recipe, “Add to a menu” adds it to a menu you have or starts a new one. “Menus” in the header lists them.",
      "Each recipe follows the headcount unless you set its own servings: a sambol made for the table, a sweet for half the guests. “Follow headcount” puts it back.",
      "Change the number of people and everything recomputes. “Add priced items to basket” moves the shopping list into your basket in real amounts, so the store comparison prices the whole meal; lines already in your basket are marked and left alone.",
      "Menus are kept on your account, so they follow you to another phone. Menus made before you signed in are offered for saving the first time you open the page signed in.",
    ],
    figures: [
      { file: "menu", alt: "A Sunday lunch menu for eight: three recipes with their servings, calories and cost per person, and the merged shopping list", caption: "A menu for eight: per-person totals, each recipe's servings, and one shopping list.", width: 1920, height: 1200 },
    ],
  },
  {
    id: "account",
    title: "Your account",
    summary: "Reading prices never needs an account. One keeps your menus and your own recipes on the server, so they follow you to another phone or browser, and later carries price alerts. Sign in with an email and a password, or with Google.",
    steps: [
      "“Sign in” at the right of the header opens the sign-in page, on its own without the header and footer; “Create an account” asks for a name, an email, and a password of ten characters or more. Long beats complicated: a few words you will remember are better than a short jumble. “Continue as a guest” under the form goes back to the prices.",
      "Menus, your own recipes, and the account page need an account: open one signed out and the sign-in page appears, and once you are in you land straight back on the page you were opening. Prices, recipes, and the basket never ask.",
      "A verification link goes to the address. Until you open it you can sign in and read everything, but menus and recipes wait; the thin bar under the header resends the link.",
      "“Continue with Google” signs in with a Google account and needs no password. If the address already has a PriceLens account, Google joins it.",
      "Your picture or initials in the header open the account menu: Account, Menus, My recipes, Sign out. The account page holds your name and language, your food preferences, your wishlist, your email and password, which mail you want, every device signed in (with “Sign out everywhere else”), and, at the bottom, deleting the account.",
      "Food preferences shape “Surprise me” and the daily recipe ideas: what you eat (everything, vegetarian, vegan, pescatarian), what you avoid (egg, dairy, fish, meat, gluten), what you are after (weight loss, high protein, quick, budget, and so on), and the kinds of dish you like. Each choice saves as you make it. Under Notifications, switch on the daily recipe ideas or the daily price digest; the mails go out once the newsletters run.",
      "The star beside a product on the board, its page, or a recipe's ingredient line puts it on your wishlist. The Wishlist section on the account page shows each starred product at today's cheapest seller with the move since yesterday. Switch on Price alerts under Notifications and each product gets a rule: any drop, or a price of your own; a morning mail arrives when one is met.",
      "Forgot the password? “Forgot password?” on the sign-in page mails a link that works for an hour; using it signs every other device out.",
    ],
    figures: [],
    tips: [
      "Five wrong passwords in a row lock sign-in for fifteen minutes; the wait is the same whether the address has an account or not.",
      "Deleting the account removes your menus and recipes with it. The basket in this browser stays, since it was never uploaded.",
    ],
  },
  {
    id: "phone",
    title: "Phone and theme",
    summary: "Everything works on a phone: the header keeps the search box, recipes, menus, the basket, and your account, with the rest behind the ⋯ menu; cards stack in one column; the chart answers to a tap instead of a hover.",
    steps: [
      "The theme follows your device. The ⋯ menu at the right of the header offers Light, Dark, or Device setting, and remembers the choice in this browser.",
      "Add the site to your home screen from the browser's share menu to open it like an app.",
    ],
    figures: [
      { file: "dark", alt: "The Big Onion page in the dark theme with a year of history", caption: "Dark theme, chosen from the header or following your device.", width: 1920, height: 1200 },
      { file: "phone-board", alt: "The price board on a phone screen", caption: "The board on a phone.", width: 780, height: 1688, half: true },
      { file: "phone-basket", alt: "The basket page on a phone screen", caption: "The basket on a phone.", width: 780, height: 1688, half: true },
    ],
  },
  {
    id: "feedback",
    title: "Feedback and privacy",
    summary: "“Send feedback” in the ⋯ menu at the right of the header, or the link in the footer, opens a short form: choose Feedback or Report a bug, write at least ten characters, and leave an email only if you want a reply. The page you were on is attached automatically and the message is forwarded to the site's owner.",
    steps: [
      "The footer quietly counts how many people are on the site right now, using a random id kept only for the open tab; no cookies.",
      "Your basket and theme stay in your browser. Where the site runs Google Analytics it does so with IP anonymisation and respects the browser's “do not track” setting.",
      "The footer is one line: where the site is made (Sri Lanka), then Guide, Sources, Privacy, Terms, Feedback, and Discord. The privacy policy says what the site keeps about you and the terms of use carry the disclaimers about prices; sources, permissions, and method are on the About page.",
      "The Discord button in the bottom corner joins the Prabhava Labs community, where PriceLens updates land first; the same link sits in the ⋯ menu and the footer.",
    ],
    figures: [
      { file: "feedback", alt: "The feedback dialog with a choice between feedback and a bug report, a message field, and an optional email", caption: "Feedback or a bug report, with the page you were on attached automatically.", width: 672, height: 546, half: true },
    ],
  },
];
