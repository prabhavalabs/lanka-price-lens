import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { Layout } from "@/components/layout";
import { startAnalytics, trackPageView } from "@/lib/analytics";
import { AboutPage } from "@/pages/about";
import { BasketPage } from "@/pages/basket";
import { BoardPage } from "@/pages/board";
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
    void startAnalytics(id).then((active) => { if (active) trackPageView(`${location.pathname}${location.search}`, document.title); });
    // Only re-run when the id or the route changes; the title is read at send time.
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
        <Route path="*" element={<p className="py-16 text-center text-muted-foreground">This page does not exist.</p>} />
      </Routes>
    </Layout>
  );
}
