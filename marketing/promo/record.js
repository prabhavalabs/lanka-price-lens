// Records the feature clips behind the promo video from the live site, one WebM per clip, into
// marketing/promo/public/clips. Run from the repository root with playwright-cli:
//
//   playwright-cli open
//   playwright-cli run-code --filename=marketing/promo/record.js
//   playwright-cli close
//
// A fake cursor is drawn on the page (Playwright's recording has none) and every move, click,
// and scroll is eased so the footage reads like a person using the site.
async (page) => {
  const origin = "https://badumila.com";
  const out = "marketing/promo/public/clips";
  // The page is zoomed 1.2x so a 1728x1080 recording lays out like 1440x900 (phone: 468x1013 like 390x844)
  // and lands 1:1 in the 2560x1440 video. Playwright captures at CSS pixels and never upscales.
  const desktop = { width: 1728, height: 1080 };
  const phone = { width: 468, height: 1013 };
  const zoomScript = () => { const style = document.createElement("style"); style.textContent = "html{zoom:1.2}"; (document.head || document.documentElement).appendChild(style); };
  const browser = page.context().browser();
  const log = [];

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
  const few = lines.filter((line) => ["product_potato", "product_tomato", "product_coconut"].includes(line.id));

  const cursorScript = () => {
    const ensure = () => {
      if (document.getElementById("__cursor")) return;
      const el = document.createElement("div");
      el.id = "__cursor";
      const saved = JSON.parse(sessionStorage.getItem("__cursor") || "[720,520]");
      el.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:26px;height:26px;transform:translate(${saved[0]}px,${saved[1]}px);transition:transform 500ms cubic-bezier(.2,.7,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))`;
      el.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l14 9-6.5 1.2L9 19z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      document.documentElement.appendChild(el);
    };
    window.__cursorMove = (x, y, ms) => { ensure(); const el = document.getElementById("__cursor"); el.style.transitionDuration = `${ms}ms`; el.style.transform = `translate(${x - 4}px,${y - 3}px)`; sessionStorage.setItem("__cursor", JSON.stringify([x - 4, y - 3])); };
    window.__cursorClick = (x, y) => { ensure(); const r = document.createElement("div"); r.style.cssText = `position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(31,138,92,.3);border:2px solid rgba(31,138,92,.9);z-index:2147483646;pointer-events:none`; document.documentElement.appendChild(r); r.animate([{ transform: "scale(.4)", opacity: 1 }, { transform: "scale(1.7)", opacity: 0 }], { duration: 500, easing: "ease-out" }).onfinish = () => r.remove(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure); else ensure();
  };

  const open = async ({ viewport, basket, theme = "light", mobile = false, cursor = true }) => {
    const context = await browser.newContext({
      viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, locale: "en-LK", timezoneId: "Asia/Colombo",
      recordVideo: { dir: "marketing/promo/raw", size: viewport },
    });
    await context.addInitScript(({ basket, choice }) => {
      window.localStorage.setItem("pricelens.basket.v2", JSON.stringify(basket));
      window.localStorage.setItem("pricelens.theme", choice);
    }, { basket, choice: theme });
    await context.addInitScript(zoomScript);
    if (cursor) await context.addInitScript(cursorScript);
    const tab = await context.newPage();
    return { context, tab, video: tab.video() };
  };

  const finish = async ({ context, tab, video }, name) => {
    await tab.waitForTimeout(600);
    await tab.close();
    await context.close();
    await video.saveAs(`${out}/${name}.webm`);
    await video.delete();
    log.push(name);
  };

  const settle = async (tab, selector) => {
    if (selector) await tab.waitForSelector(selector, { timeout: 30_000 });
    await tab.waitForLoadState("networkidle").catch(() => undefined);
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(900);
  };

  // Eases the page to `top` (a scroll position) or to `selector` (its top `offset` px below the viewport edge).
  // Under CSS zoom, scroll units and layout pixels differ, so the ratio is measured rather than assumed.
  const glide = (tab, target, ms, offset = 88) => tab.evaluate(([target, ms, offset]) => new Promise((done) => {
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    const start = window.scrollY;
    let end = target;
    if (typeof target === "string") {
      const element = document.querySelector(target);
      const before = element.getBoundingClientRect().top;
      window.scrollTo(0, start + 100);
      const moved = window.scrollY - start;
      const ratio = moved ? (before - element.getBoundingClientRect().top) / moved : 1;
      window.scrollTo(0, start);
      end = start + (before - offset) / (ratio || 1);
    }
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, start + (end - start) * ease(t));
      if (t < 1) requestAnimationFrame(step); else { html.style.scrollBehavior = previous; done(); }
    };
    requestAnimationFrame(step);
  }), [target, ms, offset]);

  const moveTo = async (tab, x, y, ms = 550) => {
    await tab.evaluate(([x, y, ms]) => window.__cursorMove(x, y, ms), [x, y, ms]);
    await tab.mouse.move(x, y, { steps: 8 });
    await tab.waitForTimeout(ms + 60);
  };
  const clickAt = async (tab, x, y) => {
    await tab.evaluate(([x, y]) => window.__cursorClick(x, y), [x, y]);
    await tab.mouse.click(x, y);
  };
  const centre = async (locator) => { const box = await locator.boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
  const clickOn = async (tab, locator, ms = 550) => { const [x, y] = await centre(locator); await moveTo(tab, x, y, ms); await clickAt(tab, x, y); };
  const hoverOn = async (tab, locator, ms = 550) => { const [x, y] = await centre(locator); await moveTo(tab, x, y, ms); };

  // 1. The board.
  {
    const clip = await open({ viewport: desktop, basket: [] });
    const { tab } = clip;
    await tab.goto(`${origin}/`);
    await settle(tab, "h1:has-text('Food prices today')");
    await tab.waitForTimeout(900);
    await hoverOn(tab, tab.locator("a[href^='/p/']").first(), 700);
    await tab.waitForTimeout(700);
    await glide(tab, 900, 2200);
    await tab.waitForTimeout(500);
    await hoverOn(tab, tab.locator("[data-slot='card']:has(button[aria-label^='Add'])").nth(1), 600);
    await tab.waitForTimeout(900);
    await finish(clip, "board");
  }

  // 2. Search in any spelling.
  {
    const clip = await open({ viewport: desktop, basket: [] });
    const { tab } = clip;
    await tab.goto(`${origin}/`);
    await settle(tab, "h1");
    await tab.waitForTimeout(600);
    await clickOn(tab, tab.locator("header [aria-label='Search products']"), 700);
    await tab.waitForTimeout(500);
    await tab.keyboard.type("b onion", { delay: 120 });
    await tab.waitForTimeout(1500);
    const first = tab.locator("[data-radix-popper-content-wrapper] [cmdk-item]").first();
    await first.waitFor({ timeout: 10_000 });
    await clickOn(tab, first, 700);
    await settle(tab, "svg[aria-label='Price history']");
    await tab.waitForTimeout(1200);
    await finish(clip, "search");
  }

  // 3. A product: every seller, the cheapest marked, then the history.
  {
    const clip = await open({ viewport: desktop, basket: few });
    const { tab } = clip;
    await tab.goto(`${origin}/p/product_big_onion?days=90`);
    await settle(tab, "svg[aria-label='Price history']");
    await tab.waitForTimeout(1000);
    await hoverOn(tab, tab.locator("[data-slot='card']").nth(1), 700);
    await tab.waitForTimeout(900);
    await glide(tab, "#history", 1800);
    await tab.waitForTimeout(500);
    const chart = tab.locator("svg[aria-label='Price history']");
    const box = await chart.boundingBox();
    for (let i = 0; i <= 24; i += 1) {
      const x = box.x + box.width * (0.12 + (0.76 * i) / 24);
      const y = box.y + box.height * 0.42;
      await tab.evaluate(([x, y]) => window.__cursorMove(x, y, 100), [x, y]);
      await tab.mouse.move(x, y);
      await tab.waitForTimeout(105);
    }
    await tab.waitForTimeout(1100);
    await finish(clip, "product");
  }

  // 4. Add to the basket, set the amount, open the quick basket, go compare.
  {
    const clip = await open({ viewport: desktop, basket: few });
    const { tab } = clip;
    await tab.goto(`${origin}/p/product_big_onion?days=30`);
    await settle(tab, "h1");
    await tab.waitForTimeout(700);
    await clickOn(tab, tab.locator("button[aria-label='Add Big Onion to basket']").first(), 700);
    await tab.waitForTimeout(800);
    const more = tab.locator("button[aria-label='More Big Onion']").first();
    await clickOn(tab, more, 450);
    await tab.waitForTimeout(450);
    await clickAt(tab, ...(await centre(more)));
    await tab.waitForTimeout(700);
    await clickOn(tab, tab.locator("button[aria-label^='Change Big Onion quantity']").first(), 450);
    await tab.waitForTimeout(700);
    await clickOn(tab, tab.locator("[data-radix-popper-content-wrapper] button:has-text('2 kg')"), 550);
    await tab.waitForTimeout(900);
    await clickOn(tab, tab.locator("header button[aria-label^='Basket,']"), 700);
    await tab.waitForTimeout(1300);
    await clickOn(tab, tab.locator("[data-radix-popper-content-wrapper] a:has-text('Compare stores')"), 650);
    await settle(tab, "tbody tr");
    await tab.waitForTimeout(1200);
    await finish(clip, "add");
  }

  // 5. The basket page: stores compared, then dishes to cook, then one dish.
  {
    const clip = await open({ viewport: desktop, basket: lines });
    const { tab } = clip;
    await tab.goto(`${origin}/basket`);
    await settle(tab, "tbody tr");
    await tab.waitForSelector("a[href^='/r/']", { timeout: 30_000 });
    await tab.waitForTimeout(900);
    await hoverOn(tab, tab.locator("tbody tr").first(), 700);
    await tab.waitForTimeout(1100);
    const cook = tab.locator("section").filter({ has: tab.getByRole("heading", { name: "Cook with your basket" }) });
    await cook.evaluate((el) => { el.id = el.id || "cook"; });
    await glide(tab, "#cook", 1900, 84);
    await tab.waitForTimeout(700);
    const dish = cook.locator("a[href^='/r/']").first();
    await hoverOn(tab, dish, 600);
    await tab.waitForTimeout(500);
    await clickAt(tab, ...(await centre(dish)));
    await settle(tab, "h2:has-text('Still to buy'), h2:has-text('From your basket')");
    await tab.waitForTimeout(900);
    await glide(tab, 500, 1600);
    await tab.waitForTimeout(1200);
    await finish(clip, "basket");
  }

  // 6. Dark theme from the header.
  {
    const clip = await open({ viewport: desktop, basket: few });
    const { tab } = clip;
    await tab.goto(`${origin}/p/product_big_onion?days=365`);
    await settle(tab, "svg[aria-label='Price history']");
    await tab.waitForTimeout(700);
    await clickOn(tab, tab.locator("header button[aria-label^='Theme:']"), 800);
    await tab.waitForTimeout(700);
    await clickOn(tab, tab.locator("[role='menuitemradio']:has-text('Dark')"), 500);
    await tab.waitForTimeout(1600);
    await finish(clip, "dark");
  }

  // 7. A phone: the board and the basket.
  for (const [name, path, selector] of [["phone-board", "/", "h1"], ["phone-basket", "/basket", "tbody tr"]]) {
    const clip = await open({ viewport: phone, basket: lines, mobile: true, cursor: false });
    const { tab } = clip;
    await tab.goto(`${origin}${path}`);
    await settle(tab, selector);
    await tab.waitForTimeout(1000);
    await glide(tab, 1080, 3200);
    await tab.waitForTimeout(900);
    await finish(clip, name);
  }

  return `saved ${log.length} clips: ${log.join(", ")}`;
}
