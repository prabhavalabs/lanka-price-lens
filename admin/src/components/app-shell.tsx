import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiFilePdf2Line,
  RiHistoryLine,
  RiHome4Line,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiShieldUserLine,
} from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type AdminUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui";

const navigation = [
  { to: "/", label: "Overview", icon: RiDashboardLine, end: true },
  { to: "/runs", label: "Workflows", icon: RiHistoryLine, end: false },
  { to: "/knowledge-base", label: "Knowledge Base", icon: RiFilePdf2Line, end: false },
  { to: "/sources", label: "Sources", icon: RiDatabase2Line, end: false },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useQuery({ queryKey: ["session"], queryFn: () => api<AdminUser>("/v1/auth/session"), staleTime: 60_000 });
  const navigationCollapsed = useUiStore((state) => state.navigationCollapsed);
  const navigationOpen = useUiStore((state) => state.navigationOpen);
  const setNavigationOpen = useUiStore((state) => state.setNavigationOpen);
  const toggleNavigationCollapsed = useUiStore((state) => state.toggleNavigationCollapsed);
  const currentPage = navigation.find(({ to, end }) => end ? location.pathname === "/" : location.pathname.startsWith(to))?.label ?? "Overview";
  const logout = useMutation({
    mutationFn: () => api<null>("/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sheet onOpenChange={setNavigationOpen} open={navigationOpen}>
        <SheetContent className="w-72 border-white/10 bg-sidebar p-0 text-sidebar-foreground lg:hidden" showCloseButton={false} side="left">
          <SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle><SheetDescription>Administrator navigation</SheetDescription></SheetHeader>
          <NavigationPanel email={user.data?.email ?? ""} logoutPending={logout.isPending} onClose={() => setNavigationOpen(false)} onLogout={() => logout.mutate()} />
        </SheetContent>
      </Sheet>
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        navigationCollapsed ? "lg:w-20" : "lg:w-64",
      )}>
        <NavigationPanel collapsed={navigationCollapsed} email={user.data?.email ?? ""} logoutPending={logout.isPending} onCollapse={toggleNavigationCollapsed} onLogout={() => logout.mutate()} />
      </aside>
      <div className={cn("min-w-0 transition-[padding] duration-200", navigationCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-white/10 bg-background/95 px-4 backdrop-blur md:px-6">
          <Button aria-label="Open navigation" className="-ml-2 lg:hidden" onClick={() => setNavigationOpen(true)} size="icon" variant="ghost"><RiMenuLine /></Button>
          <div className="ml-2 flex items-center gap-2 lg:hidden">
            <img alt="" className="size-7" src="/admin/app-icon.svg" />
            <span className="text-sm font-semibold">Lanka PriceLens</span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <RiHome4Line className="size-4" />
            <RiArrowRightSLine className="size-4 text-neutral-600" />
            <span className="font-medium text-foreground">{currentPage}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground sm:text-xs"><span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.1)]" />System online</div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-7"><Outlet /></main>
      </div>
    </div>
  );
}

function NavigationPanel({ collapsed = false, email, logoutPending, onClose, onCollapse, onLogout }: { collapsed?: boolean; email?: string; logoutPending: boolean; onClose?: () => void; onCollapse?: () => void; onLogout: () => void }) {
  return <>
    <div className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4", collapsed && "lg:justify-center lg:px-2")}>
      <img alt="" className="size-9 shrink-0" src="/admin/app-icon.svg" />
      <div className={cn("min-w-0", collapsed && "lg:hidden")}><p className="truncate text-[15px] font-semibold tracking-tight">Lanka PriceLens</p><p className="truncate font-mono text-[10px] text-neutral-500">Foundry operations</p></div>
      {onClose ? <Button aria-label="Close navigation" className="ml-auto" onClick={onClose} size="icon" variant="ghost"><RiCloseLine /></Button> : null}
      {onCollapse ? <Button aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} className={cn("ml-auto border-white/10 text-neutral-400 hover:bg-white/5 hover:text-white", collapsed && "absolute -right-3 top-5 rounded-full bg-neutral-900")} onClick={onCollapse} size="icon-sm" variant="outline">{collapsed ? <RiArrowRightSLine /> : <RiArrowLeftSLine />}</Button> : null}
    </div>
    <ScrollArea className="flex-1">
      <nav aria-label="Operations" className="flex flex-col gap-1.5 p-3">
        {navigation.map(({ to, label, icon: Icon, end }) => <NavLink aria-label={label} className={({ isActive }) => cn("flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 text-[13px] font-medium text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100", isActive && "border-emerald-500/20 bg-emerald-500/10 text-emerald-400", collapsed && "lg:justify-center lg:px-0")} end={end} key={to} onClick={onClose} title={collapsed ? label : undefined} to={to}><Icon className="size-[18px] shrink-0" /><span className={cn(collapsed && "lg:hidden")}>{label}</span></NavLink>)}
      </nav>
    </ScrollArea>
    <div className="border-t border-white/10 p-3">
      <div className={cn("mb-2 flex items-center gap-3 rounded-lg px-3 py-2", collapsed && "lg:justify-center lg:px-0")}><RiShieldUserLine className="size-[18px] shrink-0 text-emerald-400" /><div className={cn("min-w-0", collapsed && "lg:hidden")}><p className="truncate text-xs font-medium">{email}</p><p className="text-[11px] text-neutral-500">Administrator</p></div></div>
      <Button aria-label="Sign out" className={cn("w-full justify-start text-neutral-400 hover:bg-white/5 hover:text-white", collapsed && "lg:justify-center lg:px-0")} disabled={logoutPending} onClick={onLogout} title={collapsed ? "Sign out" : undefined} variant="ghost"><RiLogoutBoxRLine data-icon="inline-start" /><span className={cn(collapsed && "lg:hidden")}>Sign out</span></Button>
    </div>
  </>;
}
