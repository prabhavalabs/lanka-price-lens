/**
 * The Meta pixel, loaded only when the deployment names a pixel id and the visitor has not asked
 * not to be tracked. Page views are sent on every route change (the site is a single page app).
 * Nothing runs at all without an id, which mirrors how Google Analytics is handled next door.
 *
 * Only Meta's standard event names are sent. They need no setup in Events Manager and the ad
 * platform can optimise delivery towards them, which custom events cannot do without a wait.
 */

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: unknown;
};

/** The standard events this site reports. `PageView` is sent by the route watcher, not by hand. */
export type PixelEvent = "PageView" | "ViewContent" | "AddToWishlist" | "CompleteRegistration" | "Subscribe";

let pixelId: string | null = null;
let loading: Promise<void> | null = null;

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function doNotTrack(): boolean {
  return typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1");
}

/** The queue Meta's own snippet builds, written out so it can be read. Calls made before the script lands are replayed by it. */
function installQueue(): Fbq {
  const queued = function fbq(...args: unknown[]) {
    if (queued.callMethod) queued.callMethod.apply(queued, args);
    else queued.queue.push(args);
  } as Fbq;
  queued.queue = [];
  queued.loaded = true;
  queued.version = "2.0";
  queued.push = queued;
  return queued;
}

/** Starts the pixel for the given id; a second call with the same id is a no-op. Returns whether the pixel is active. */
export async function startPixel(id: string | null): Promise<boolean> {
  if (!id || doNotTrack() || typeof document === "undefined") return false;
  if (pixelId === id) return true;
  pixelId = id;
  loading ??= new Promise<void>((resolve) => {
    window.fbq ??= installQueue();
    window._fbq ??= window.fbq;
    // Automatic page views are off: the router reports them, so a single page app does not send one view for the whole visit.
    window.fbq("set", "autoConfig", false, id);
    window.fbq("init", id);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  await loading;
  return true;
}

/** One page view per route change. */
export function trackPixelPageView(): void {
  if (!pixelId || !window.fbq) return;
  window.fbq("track", "PageView");
}

/** A standard event, such as a wishlist addition or a completed registration. Silently ignored without a pixel. */
export function trackPixelEvent(name: PixelEvent, params: Record<string, string | number | boolean> = {}): void {
  if (!pixelId || !window.fbq) return;
  window.fbq("track", name, params);
}
