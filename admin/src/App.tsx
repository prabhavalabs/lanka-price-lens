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
