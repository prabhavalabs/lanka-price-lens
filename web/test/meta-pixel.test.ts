import assert from "node:assert/strict";
import test from "node:test";

/**
 * The pixel talks to the browser, so each case builds a small stand-in for `window`, `document` and
 * `navigator` before importing a fresh copy of the module. A query string on the import makes the
 * module loader hand back a new instance, because the pixel remembers its id once it has started.
 */
type Stub = {
  calls: unknown[][];
  scripts: Array<{ src: string; onload?: () => void; onerror?: () => void }>;
};

function browser(options: { doNotTrack?: string } = {}): Stub {
  const stub: Stub = { calls: [], scripts: [] };
  const head = {
    appendChild(script: { src: string; onload?: () => void }) {
      stub.scripts.push(script);
      // The real script loads and calls back; do the same so a start does not hang.
      script.onload?.();
    },
  };
  const window = {
    fbq: undefined as unknown,
    _fbq: undefined as unknown,
  };
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = {
    head,
    createElement: () => ({ src: "", async: false }) as unknown,
  } as unknown as Document;
  // Node gives `navigator` a getter of its own, so it has to be redefined rather than assigned.
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { doNotTrack: options.doNotTrack ?? "0" } });
  return stub;
}

function record(stub: Stub): void {
  // Stand in for the loaded fbevents.js: every queued and later call lands in `calls`.
  const queue = (globalThis.window as unknown as { fbq?: { queue: unknown[]; callMethod?: (...args: unknown[]) => void } }).fbq;
  if (!queue) return;
  for (const call of queue.queue) stub.calls.push(call as unknown[]);
  queue.callMethod = (...args: unknown[]) => stub.calls.push(args);
}

let instance = 0;
async function load() {
  instance += 1;
  return (await import(`../src/lib/meta-pixel.ts?case=${instance}`)) as typeof import("../src/lib/meta-pixel.ts");
}

test("without an id the pixel never starts and events go nowhere", async () => {
  const stub = browser();
  const pixel = await load();
  assert.equal(await pixel.startPixel(null), false, "no id, not active");
  assert.equal(await pixel.startPixel(""), false, "an empty id is no id");
  pixel.trackPixelEvent("ViewContent");
  pixel.trackPixelPageView();
  assert.deepEqual(stub.scripts, [], "nothing is loaded");
  assert.deepEqual(stub.calls, [], "nothing is sent");
});

test("a visitor who asked not to be tracked is left alone", async () => {
  const stub = browser({ doNotTrack: "1" });
  const pixel = await load();
  assert.equal(await pixel.startPixel("123456789012345"), false, "do not track wins over the id");
  pixel.trackPixelEvent("CompleteRegistration");
  assert.deepEqual(stub.scripts, [], "no script");
  assert.deepEqual(stub.calls, [], "no events");
});

test("with an id the pixel loads once, turns automatic page views off, and reports what it is given", async () => {
  const stub = browser();
  const pixel = await load();

  assert.equal(await pixel.startPixel("123456789012345"), true, "active");
  record(stub);

  assert.equal(stub.scripts.length, 1, "one script");
  assert.match(stub.scripts[0]!.src, /connect\.facebook\.net\/.+\/fbevents\.js$/u, "Meta's own script");

  assert.deepEqual(stub.calls[0], ["set", "autoConfig", false, "123456789012345"], "the router reports page views, not the script");
  assert.deepEqual(stub.calls[1], ["init", "123456789012345"], "initialised with the id");

  pixel.trackPixelPageView();
  pixel.trackPixelEvent("AddToWishlist", { content_ids: "rice-nadu" });
  pixel.trackPixelEvent("Subscribe", { content_name: "notify_digest" });
  assert.deepEqual(stub.calls.slice(2), [
    ["track", "PageView"],
    ["track", "AddToWishlist", { content_ids: "rice-nadu" }],
    ["track", "Subscribe", { content_name: "notify_digest" }],
  ], "each event passes through with its parameters");

  assert.equal(await pixel.startPixel("123456789012345"), true, "starting again is allowed");
  assert.equal(stub.scripts.length, 1, "but the script is not loaded twice");
});
