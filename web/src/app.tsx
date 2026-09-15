import { useEffect } from "react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";

import { AuthLayout } from "@/components/auth-layout";
import { CommunityInvite } from "@/components/community-invite";
import { Layout } from "@/components/layout";
import { startAnalytics, trackPageView } from "@/lib/analytics";
import { useSiteConfig } from "@/lib/site-config";
import { AboutPage } from "@/pages/about";
import { ConfirmEmailPage } from "@/pages/account/confirm-email";
import { ForgotPasswordPage } from "@/pages/account/forgot";
import { LoginPage } from "@/pages/account/login";
import { ProfilePage } from "@/pages/account/profile";
import { MyRecipeEditorPage, MyRecipePage, MyRecipesPage } from "@/pages/account/recipes";
import { RegisterPage } from "@/pages/account/register";
import { ResetPasswordPage } from "@/pages/account/reset";
import { VerifyEmailPage } from "@/pages/account/verify";
import { BasketPage } from "@/pages/basket";
import { BoardPage } from "@/pages/board";
import { GuidePage } from "@/pages/guide";
import { PrivacyPage, TermsPage } from "@/pages/legal";
import { ProductPage } from "@/pages/product";
import { RecipePage } from "@/pages/recipe";
import { MenuPage, MenusPage } from "@/pages/menus";
import { RecipesPage } from "@/pages/recipes";

/** Loads analytics when the deployment has an id, and reports a page view on every route change. */
function useAnalytics(id: string | null): void {
  const location = useLocation();
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

/** The site proper: header, footer, the community invite, and the page. */
function SiteFrame({ invite }: { invite: string | null }) {
  return (
    <Layout>
      <CommunityInvite url={invite} />
      <Outlet />
    </Layout>
  );
}

export function App() {
  const config = useSiteConfig();
  useAnalytics(config.analytics.ga_measurement_id);
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/account/login" element={<LoginPage />} />
        <Route path="/account/register" element={<RegisterPage />} />
        <Route path="/account/forgot" element={<ForgotPasswordPage />} />
        <Route path="/account/reset" element={<ResetPasswordPage />} />
        <Route path="/account/verify" element={<VerifyEmailPage />} />
        <Route path="/account/confirm-email" element={<ConfirmEmailPage />} />
      </Route>
      <Route element={<SiteFrame invite={config.community.discord_invite_url} />}>
        <Route path="/" element={<BoardPage />} />
        <Route path="/p/:id" element={<ProductPage />} />
        <Route path="/basket" element={<BasketPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/r/:id" element={<RecipePage />} />
        <Route path="/menus" element={<MenusPage />} />
        <Route path="/menus/:id" element={<MenuPage />} />
        <Route path="/account" element={<ProfilePage />} />
        <Route path="/account/recipes" element={<MyRecipesPage />} />
        <Route path="/account/recipes/new" element={<MyRecipeEditorPage />} />
        <Route path="/account/recipes/:id" element={<MyRecipePage />} />
        <Route path="/account/recipes/:id/edit" element={<MyRecipeEditorPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<p className="py-16 text-center text-muted-foreground">This page does not exist.</p>} />
      </Route>
    </Routes>
  );
}
