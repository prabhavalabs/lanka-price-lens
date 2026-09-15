// Refreshes the screenshots behind the "How to use" guide (web/public/guide) from the live site, with a
// seeded basket so every view has something to show. Run from the repository root with playwright-cli
// (not a package dependency):
//
//   playwright-cli open
//   playwright-cli run-code --filename=web/scripts/guide-screenshots.js
//   playwright-cli close
//   pngquant --quality=65-85 --speed 1 --force --ext .png web/public/guide/*.png
//
// Change `origin` below to shoot another deployment, and put a real account in `account` (menus live on the
// account, so the menu shot needs one; use a throwaway, never commit credentials). The runner has no
// `process`, so there is no env override.
async (page) => {
  const origin = "https://price.prabhavalabs.com";
  const account = { email: "", password: "" };
  const out = "web/public/guide";
  const desktop = { width: 1280, height: 800 };
  const browser = page.context().browser();
  const log = [];

  // The same basket in every shot: a week's curry ingredients, in real units from the API.
  const wanted = [
    ["product_big_onion", 1], ["product_potato", 1], ["product_tomato", 0.5], ["product_green_chillies", 0.1],
    ["product_coconut", 2], ["product_garlic", 0.25], ["product_rice_nadu", 5],
  ];
  const lines = [];
  for (const [id, quantity] of wanted) {
    const response = await page.request.get(`${origin}/v1/public/products/${id}?days=30`);
    const { payload } = await response.json();
    const unit = payload.latest[0]?.unit ?? "kg";
    lines.push({ id, label: payload.product.label, quantity: unit === "kg" || unit === "l" ? quantity : Math.max(1, Math.round(quantity)), unit });
  }

  // Every context is signed in (the API call shares the context's cookie jar), with the same basket seeded.
  const contextFor = async (options, theme) => {
    const context = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 1.5, locale: "en-LK", timezoneId: "Asia/Colombo", ...options });
    await context.addInitScript(({ basket, choice }) => {
      window.localStorage.setItem("pricelens.basket.v2", JSON.stringify(basket));
      window.localStorage.setItem("pricelens.theme", choice);
    }, { basket: lines, choice: theme });
    if (account.email) {
      const signIn = await context.request.post(`${origin}/v1/account/login`, { data: { email: account.email, password: account.password, remember: true }, headers: { origin } });
      if (!signIn.ok()) throw new Error(`sign-in failed: ${signIn.status()} ${await signIn.text()}`);
    }
    return context;
  };

  // One menu in every shot: a Sunday lunch for eight, three recipes, the sambol made for the table. Kept on the account.
  const menuName = "Sunday lunch";
  const menuFor = async (context) => {
    const listing = await context.request.get(`${origin}/v1/account/menus`);
    const existing = (await listing.json()).payload?.items?.find((menu) => menu.name === menuName);
    if (existing) return existing.id;
    const created = await context.request.post(`${origin}/v1/account/menus`, {
      headers: { origin },
      data: { name: menuName, occasion: "Family", people: 8, items: [{ recipe_id: "dish_plain_red_rice", servings: null }, { recipe_id: "dish_chicken_kottu", servings: null }, { recipe_id: "dish_onion_sambol", servings: 4 }], updated_at: new Date().toISOString() },
    });
    if (!created.ok()) throw new Error(`menu failed: ${created.status()} ${await created.text()}`);
    return (await created.json()).payload.id;
  };

  const settle = async (tab, selector) => {
    if (selector) await tab.waitForSelector(selector, { timeout: 30_000 });
    await tab.waitForLoadState("networkidle").catch(() => undefined);
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(1400); // chart draw-in and image fades
  };

  const shot = async (tab, name, options = {}) => {
    const path = `${out}/${name}.png`;
    await tab.screenshot({ path, animations: "disabled", ...options });
    log.push(name);
  };

  // A region around one or more elements, clipped to the viewport; the header popovers live at the top of the page.
  const around = async (locators, pad = 16) => {
    const boxes = [];
    for (const locator of locators) boxes.push(await locator.boundingBox());
    const found = boxes.filter(Boolean);
    const x = Math.max(0, Math.min(...found.map((box) => box.x)) - pad);
    const y = Math.max(0, Math.min(...found.map((box) => box.y)) - pad);
    const right = Math.min(desktop.width, Math.max(...found.map((box) => box.x + box.width)) + pad);
    const bottom = Math.min(desktop.height, Math.max(...found.map((box) => box.y + box.height)) + pad);
    return { x, y, width: right - x, height: bottom - y };
  };

  const popover = (tab) => tab.locator("[data-radix-popper-content-wrapper]").last();

  // scrollIntoView puts an element at the very top, under the sticky header; step back so the header is out of its shot.
  const clearHeader = async (tab) => {
    await tab.evaluate(() => window.scrollBy(0, -96));
    await tab.waitForTimeout(400);
  };

  // Desktop, light.
  const context = await contextFor({ viewport: desktop }, "light");
  const tab = await context.newPage();

  await tab.goto(`${origin}/`);
  await settle(tab, "h1:has-text('Food prices today')");
  await shot(tab, "board");

  await tab.locator("header [aria-label='Search products']").click();
  await tab.getByPlaceholder("Type a product in any spelling…").fill("b onion");
  await tab.waitForTimeout(1200);
  await shot(tab, "search", { clip: await around([tab.getByRole("banner"), popover(tab)], 0) });
  await tab.keyboard.press("Escape");

  await tab.goto(`${origin}/p/product_big_onion?days=90`);
  await settle(tab, "svg[aria-label='Price history']");
  await shot(tab, "product");

  const history = tab.locator("#history");
  await history.scrollIntoViewIfNeeded();
  await clearHeader(tab);
  const chart = tab.locator("svg[aria-label='Price history']");
  const chartBox = await chart.boundingBox();
  await chart.hover({ position: { x: chartBox.width * 0.62, y: chartBox.height * 0.45 } });
  await tab.waitForTimeout(400);
  await history.screenshot({ path: `${out}/history.png`, animations: "disabled" });
  log.push("history");

  await tab.goto(`${origin}/p/product_kelawalla?days=30`);
  await settle(tab, "h1");
  const outdated = tab.getByText("outdated", { exact: true }).first();
  await outdated.scrollIntoViewIfNeeded();
  await clearHeader(tab);
  const staleCard = outdated.locator("xpath=ancestor::*[@data-slot='card'][1]");
  await ((await staleCard.count()) ? staleCard : outdated.locator("xpath=ancestor::table[1]")).screenshot({ path: `${out}/outdated.png`, animations: "disabled" });
  log.push("outdated");

  await tab.goto(`${origin}/p/product_big_onion?days=30`);
  await settle(tab, "h1");
  const amount = tab.locator("button[aria-label^='Change Big Onion quantity']");
  await amount.click();
  await tab.waitForTimeout(400);
  await shot(tab, "quantity", { clip: await around([tab.getByRole("banner"), tab.locator("[role='group'][aria-label='Big Onion quantity']"), popover(tab)], 20) });
  await tab.keyboard.press("Escape");

  await tab.locator("button[aria-label^='Basket,']").click();
  await tab.waitForTimeout(500);
  await shot(tab, "quick-basket", { clip: await around([tab.getByRole("banner"), popover(tab)], 0) });
  await tab.keyboard.press("Escape");

  await tab.goto(`${origin}/basket`);
  await settle(tab, "tbody tr");
  await tab.waitForSelector("a[href^='/r/']", { timeout: 30_000 });
  await shot(tab, "basket");
  // The section's heading and its first row of dish cards: the cards carry photos now, so the whole section
  // runs past one screen, and the sticky header and the community pill would sit over an element screenshot.
  const cook = tab.locator("section").filter({ has: tab.getByRole("heading", { name: "Cook with your basket" }) });
  await cook.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 12));
  await clearHeader(tab);
  const hidden = await tab.addStyleTag({ content: "header, a[aria-label='Join the community'] { visibility: hidden !important; }" });
  await shot(tab, "cook", { clip: await around([cook.getByRole("heading", { name: "Cook with your basket" }), ...[0, 1, 2].map((index) => cook.locator("a[href^='/r/']").nth(index))], 8) });
  await hidden.evaluate((element) => element.remove());

  await cook.locator("a[href^='/r/']").first().click();
  await settle(tab, "h2:has-text('Ingredients for'), h2:has-text('Still to buy')");
  await shot(tab, "recipe");

  await tab.goto(`${origin}/recipes?q=curry`);
  await settle(tab, "a[href^='/r/']");
  await shot(tab, "recipes");

  // A full recipe scaled to ten, with calories and cost per serving.
  await tab.goto(`${origin}/r/dish_hoppers?people=10`);
  await settle(tab, "h2:has-text('Ingredients for 10')");
  await tab.getByRole("group", { name: "People stepper" }).scrollIntoViewIfNeeded();
  await clearHeader(tab);
  await shot(tab, "servings");

  // The recipes page asked a question: weight loss, fewest calories first.
  await tab.goto(`${origin}/recipes?tags=weight_loss_friendly&sort=kcal`);
  await settle(tab, "a[href^='/r/']");
  await shot(tab, "recipes-filters");

  // A menu for eight: per-person totals, each recipe's servings, the shopping list.
  await tab.goto(`${origin}/menus/${await menuFor(context)}`);
  await settle(tab, "h2:has-text('Shopping list')");
  await shot(tab, "menu");

  await tab.goto(`${origin}/`);
  await settle(tab, "h1");
  await tab.locator("header button[aria-label='More']").click();
  await tab.getByRole("menuitem", { name: "Send feedback" }).click();
  await tab.waitForTimeout(500);
  await tab.locator("[role='dialog']").last().screenshot({ path: `${out}/feedback.png`, animations: "disabled" });
  log.push("feedback");
  await tab.keyboard.press("Escape");
  await context.close();

  // Desktop, dark.
  const dark = await contextFor({ viewport: desktop }, "dark");
  const darkTab = await dark.newPage();
  await darkTab.goto(`${origin}/p/product_big_onion?days=365`);
  await settle(darkTab, "svg[aria-label='Price history']");
  await shot(darkTab, "dark");
  await dark.close();

  // A phone.
  const phone = await contextFor({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, "light");
  const phoneTab = await phone.newPage();
  await phoneTab.goto(`${origin}/`);
  await settle(phoneTab, "h1");
  await shot(phoneTab, "phone-board");
  await phoneTab.goto(`${origin}/basket`);
  await settle(phoneTab, "tbody tr");
  await shot(phoneTab, "phone-basket");
  await phone.close();

  return `saved ${log.length} screenshots: ${log.join(", ")}`;
}
