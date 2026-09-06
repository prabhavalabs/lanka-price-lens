import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { Layout } from "@/components/layout";
import { startAnalytics, trackPageView } from "@/lib/analytics";
import { AboutPage } from "@/pages/about";
import { BasketPage } from "@/pages/basket";
import { BoardPage } from "@/pages/board";
import { GuidePage } from "@/pages/guide";
import { ProductPage } from "@/pages/product";
import { RecipePage } from "@/pages/recipe";
import { RecipesPage } from "@/pages/recipes";

type SiteConfig = { analytics: { ga_measurement_id: string | null } };

/** Loads analytics when the deployment has an id, and reports a page view on every route change. */
function useAnalytics(): void {
  const location = useLocation();
  const config = useQuery({ queryKey: ["config"], queryFn: async () => ((await (await fetch("/v1/public/config")).json()) as { payload: SiteConfig }).payload, staleTime: Number.POSITIVE_INFINITY, retry: false });
  const id = config.data?.analytics.ga_measurement_id ?? null;
  useEffect(() => {
    if (!id) return;
    const path = `${location.pathname}${location.search}`;
    let sent = false;
    let stop: (() => void) | undefined;
    const send = () => {
      if (sent) return;
      sent = true;
      stop?.();
      trackPageView(path, document.title);
    };
    void startAnalytics(id).then((active) => {
      if (!active || sent) return;
      // Pages set their title after they render (a product or a dish, after it loads). Report the view when
      // the title changes, or after a moment if it does not; leaving the route early reports it at once.
      const observer = new MutationObserver(send);
      observer.observe(document.head, { childList: true, characterData: true, subtree: true });
      const timer = window.setTimeout(send, 1500);
      stop = () => { observer.disconnect(); window.clearTimeout(timer); };
    });
    return () => { if (stop) send(); else sent = true; };
  }, [id, location.pathname, location.search]);
}

export function App() {
  useAnalytics();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/p/:id" element={<ProductPage />} />
        <Route path="/basket" element={<BasketPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/r/:id" element={<RecipePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<p className="py-16 text-center text-muted-foreground">This page does not exist.</p>} />
      </Routes>
    </Layout>
  );
}
