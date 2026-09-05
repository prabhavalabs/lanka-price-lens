// Refreshes the screenshots behind the "How to use" guide (web/public/guide) from the live site, with a
// seeded basket so every view has something to show. Run from the repository root with playwright-cli
// (not a package dependency):
//
//   playwright-cli open
//   playwright-cli run-code --filename=web/scripts/guide-screenshots.js
//   playwright-cli close
//   pngquant --quality=65-85 --speed 1 --force --ext .png web/public/guide/*.png
//
// Change `origin` below to shoot another deployment. The runner has no `process`, so there is no env override.
async (page) => {
  const origin = "https://price.prabhavalabs.com";
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

  const contextFor = async (options, theme) => {
    const context = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 1.5, locale: "en-LK", timezoneId: "Asia/Colombo", ...options });
    await context.addInitScript(({ basket, choice }) => {
      window.localStorage.setItem("pricelens.basket.v2", JSON.stringify(basket));
      window.localStorage.setItem("pricelens.theme", choice);
    }, { basket: lines, choice: theme });
    return context;
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
  const cook = tab.locator("section").filter({ has: tab.getByRole("heading", { name: "Cook with your basket" }) });
  await cook.scrollIntoViewIfNeeded();
  await clearHeader(tab);
  await cook.screenshot({ path: `${out}/cook.png`, animations: "disabled" });
  log.push("cook");

  await cook.locator("a[href^='/r/']").first().click();
  await settle(tab, "h2:has-text('Still to buy'), h2:has-text('From your basket')");
  await shot(tab, "recipe");

  await tab.goto(`${origin}/recipes?q=curry`);
  await settle(tab, "a[href^='/r/']");
  await shot(tab, "recipes");

  await tab.goto(`${origin}/`);
  await settle(tab, "h1");
  await tab.locator("header button:has-text('Feedback')").click();
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
