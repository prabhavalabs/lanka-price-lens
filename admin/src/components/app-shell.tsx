import {
  RiCloseLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiFilePdf2Line,
  RiHistoryLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiShieldUserLine,
} from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api, type AdminUser } from "@/lib/api";
import { useUiStore } from "@/store/ui";

const navigation = [
  { to: "/", label: "Overview", icon: RiDashboardLine, end: true },
  { to: "/runs", label: "Ingestion runs", icon: RiHistoryLine, end: false },
  { to: "/pdfs", label: "PDF library", icon: RiFilePdf2Line, end: false },
  { to: "/sources", label: "Sources", icon: RiDatabase2Line, end: false },
];

export function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useQuery({ queryKey: ["session"], queryFn: () => api<AdminUser>("/v1/auth/session"), staleTime: 60_000 });
  const navigationOpen = useUiStore((state) => state.navigationOpen);
  const setNavigationOpen = useUiStore((state) => state.setNavigationOpen);
  const logout = useMutation({
    mutationFn: () => api<null>("/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="min-h-screen bg-muted/30">
      {navigationOpen ? <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavigationOpen(false)} type="button" /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-neutral-950 text-neutral-50 transition-transform lg:translate-x-0 ${navigationOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center gap-3 px-6">
          <img alt="" className="size-10" src="/admin/app-icon.svg" />
          <div><p className="font-heading text-lg font-semibold">Lanka PriceLens</p><p className="text-xs text-neutral-400">Foundry operations</p></div>
          <Button aria-label="Close navigation" className="ml-auto text-neutral-300 lg:hidden" onClick={() => setNavigationOpen(false)} size="icon" variant="ghost"><RiCloseLine /></Button>
        </div>
        <Separator className="bg-white/10" />
        <nav aria-label="Operations" className="flex-1 space-y-1 p-4">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `flex min-h-11 items-center gap-3 px-3 text-sm font-medium transition-colors ${isActive ? "bg-emerald-500 text-neutral-950" : "text-neutral-300 hover:bg-white/10 hover:text-white"}`} end={end} key={to} onClick={() => setNavigationOpen(false)} to={to}><Icon className="size-5" />{label}</NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 px-2"><RiShieldUserLine className="size-5 text-emerald-400" /><div className="min-w-0"><p className="truncate text-sm font-medium">{user.data?.email}</p><p className="text-xs text-neutral-500">Administrator</p></div></div>
          <Button className="w-full justify-start text-neutral-300 hover:bg-white/10 hover:text-white" disabled={logout.isPending} onClick={() => logout.mutate()} variant="ghost"><RiLogoutBoxRLine />Sign out</Button>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <Button aria-label="Open navigation" className="lg:hidden" onClick={() => setNavigationOpen(true)} size="icon" variant="ghost"><RiMenuLine /></Button>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 bg-emerald-500" />System online</div>
        </header>
        <main className="mx-auto max-w-7xl p-4 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
