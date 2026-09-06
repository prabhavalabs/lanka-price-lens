/**
 * Google Analytics 4, loaded only when the deployment names a measurement id and the visitor has
 * not asked not to be tracked. Page views are sent on every route change (the site is a single
 * page app), with IP anonymisation on. Nothing runs at all without an id.
 */

type Gtag = (...args: unknown[]) => void;

let measurementId: string | null = null;
let loading: Promise<void> | null = null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

function doNotTrack(): boolean {
  return typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1");
}

/** Starts analytics for the given id; a second call with the same id is a no-op. Returns whether analytics is active. */
export async function startAnalytics(id: string | null): Promise<boolean> {
  if (!id || doNotTrack() || typeof document === "undefined") return false;
  if (measurementId === id) return true;
  measurementId = id;
  loading ??= new Promise<void>((resolve) => {
    window.dataLayer = window.dataLayer ?? [];
    // gtag.js only treats an `arguments` object on the data layer as a command; a plain array is
    // ignored, so `config` never runs and nothing is sent. Hence a classic function, not rest args.
    window.gtag = function gtag() {
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", id, { send_page_view: false, anonymize_ip: true });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  await loading;
  return true;
}

/** One page view per route change. */
export function trackPageView(path: string, title: string): void {
  if (!measurementId || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: path, page_title: title, page_location: window.location.href });
}

/** A named interaction, such as adding to the basket or sending feedback. Silently ignored without analytics. */
export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}): void {
  if (!measurementId || !window.gtag) return;
  window.gtag("event", name, params);
}
