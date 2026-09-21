import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";

import { WorkflowEventSubscriber } from "@/hooks/use-workflow-events";
import { api, type AdminUser } from "@/lib/api";

const AppShell = lazy(() => import("@/components/app-shell").then((module) => ({ default: module.AppShell })));
const LoginPage = lazy(() => import("@/pages/login-page").then((module) => ({ default: module.LoginPage })));
const OverviewPage = lazy(() => import("@/pages/overview-page").then((module) => ({ default: module.OverviewPage })));
const RunsPage = lazy(() => import("@/pages/operations-pages").then((module) => ({ default: module.RunsPage })));
const RunDetailPage = lazy(() => import("@/pages/operations-pages").then((module) => ({ default: module.RunDetailPage })));
const KnowledgeBasePage = lazy(() => import("@/pages/knowledge-base-page").then((module) => ({ default: module.KnowledgeBasePage })));
const DocumentDetailPage = lazy(() => import("@/pages/knowledge-base-page").then((module) => ({ default: module.DocumentDetailPage })));
const SourcesPage = lazy(() => import("@/pages/operations-pages").then((module) => ({ default: module.SourcesPage })));
const InsightsPage = lazy(() => import("@/pages/insights-page").then((module) => ({ default: module.InsightsPage })));
const PriceExplorerPage = lazy(() => import("@/pages/price-explorer-page").then((module) => ({ default: module.PriceExplorerPage })));
const RecipesPage = lazy(() => import("@/pages/recipes-page").then((module) => ({ default: module.RecipesPage })));
const FeedbackPage = lazy(() => import("@/pages/feedback-page").then((module) => ({ default: module.FeedbackPage })));
const MailPage = lazy(() => import("@/pages/mail-page").then((module) => ({ default: module.MailPage })));
const ChannelPage = lazy(() => import("@/pages/channel-page").then((module) => ({ default: module.ChannelPage })));
const LibraryPage = lazy(() => import("@/pages/library-page").then((module) => ({ default: module.LibraryPage })));
const AgentAccessPage = lazy(() => import("@/pages/agent-access-page").then((module) => ({ default: module.AgentAccessPage })));
const CalendarPage = lazy(() => import("@/pages/calendar-page").then((module) => ({ default: module.CalendarPage })));
const AccountsPage = lazy(() => import("@/pages/accounts-page").then((module) => ({ default: module.AccountsPage })));
const CommunityPage = lazy(() => import("@/pages/community-page").then((module) => ({ default: module.CommunityPage })));

const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppShell />,
          children: [
            { index: true, element: <OverviewPage /> },
            { path: "runs", element: <RunsPage /> },
            { path: "runs/:runId", element: <RunDetailPage /> },
            { path: "knowledge-base", element: <KnowledgeBasePage /> },
            { path: "knowledge-base/:publicationId", element: <DocumentDetailPage /> },
            { path: "pdfs", element: <Navigate to="/knowledge-base" replace /> },
            { path: "sources", element: <SourcesPage /> },
            { path: "insights", element: <InsightsPage /> },
            { path: "explorer", element: <PriceExplorerPage /> },
            { path: "recipes", element: <RecipesPage /> },
            { path: "feedback", element: <FeedbackPage /> },
            { path: "mail", element: <MailPage /> },
            { path: "distribution/facebook", element: <ChannelPage platform="facebook" /> },
            { path: "distribution/instagram", element: <ChannelPage platform="instagram" /> },
            { path: "distribution/library", element: <LibraryPage /> },
            { path: "distribution/calendar", element: <CalendarPage /> },
            { path: "distribution/access", element: <AgentAccessPage /> },
            { path: "accounts", element: <AccountsPage /> },
            { path: "community", element: <CommunityPage /> },
          ],
        },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ],
  { basename: "/admin" },
);

export function App() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Opening operations…</div>}><RouterProvider router={router} /></Suspense>;
}

function RequireAuth() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<AdminUser>("/v1/auth/session"),
    retry: false,
    staleTime: 60_000,
  });
  if (session.isPending) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Opening operations…</div>;
  if (session.isError) return <Navigate to="/login" replace />;
  return <><WorkflowEventSubscriber /><Outlet /></>;
}
