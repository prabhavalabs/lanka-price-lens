import {
  RiDashboardLine,
  RiDatabase2Line,
  RiExpandUpDownLine,
  RiFilePdf2Line,
  RiHistoryLine,
  RiLineChartLine,
  RiLogoutBoxRLine,
  RiShieldUserLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type AdminUser, type SchedulerMonitor } from "@/lib/api";
import { cn } from "@/lib/utils";

type NavigationItem = { to: string; label: string; icon: RemixiconComponentType; end: boolean; detail?: string };

const operations: NavigationItem[] = [
  { to: "/", label: "Overview", icon: RiDashboardLine, end: true },
  { to: "/runs", label: "Workflows", icon: RiHistoryLine, end: false, detail: "Execution" },
  { to: "/knowledge-base", label: "Knowledge Base", icon: RiFilePdf2Line, end: false, detail: "Document" },
  { to: "/sources", label: "Sources", icon: RiDatabase2Line, end: false },
];
const intelligence: NavigationItem[] = [
  { to: "/insights", label: "Price insights", icon: RiLineChartLine, end: false },
];
const navigation = [...operations, ...intelligence];

function sidebarPreference(): boolean {
  return typeof document === "undefined" || !document.cookie.split("; ").includes("sidebar_state=false");
}

export function AppShell() {
  const location = useLocation();
  const current = navigation.find(({ to, end }) => end ? location.pathname === "/" : location.pathname.startsWith(to));
  const detail = current?.detail && location.pathname.split("/").filter(Boolean).length > 1 ? current.detail : null;

  return (
    <SidebarProvider defaultOpen={sidebarPreference()}>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="Lanka PriceLens">
                <Link to="/">
                  <img alt="" className="size-8 shrink-0 rounded-lg" src="/admin/app-icon.svg" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-heading text-sm font-semibold">Lanka PriceLens</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">Foundry operations</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavigationGroup items={operations} label="Operations" pathname={location.pathname} />
          <NavigationGroup items={intelligence} label="Intelligence" pathname={location.pathname} />
        </SidebarContent>
        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:rounded-t-xl">
          <SidebarTrigger className="-ml-1" />
          <Separator className="mr-1 data-[orientation=vertical]:h-4" orientation="vertical" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block"><BreadcrumbLink asChild><Link to="/">Operations</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              {detail && current ? (
                <>
                  <BreadcrumbItem><BreadcrumbLink asChild><Link to={current.to}>{current.label}</Link></BreadcrumbLink></BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem><BreadcrumbPage>{detail}</BreadcrumbPage></BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem><BreadcrumbPage>{current?.label ?? "Overview"}</BreadcrumbPage></BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2"><SchedulerStatus /></div>
        </header>
        <main className="flex-1 p-3 md:p-4 xl:p-5">
          <div className="mx-auto w-full max-w-[1480px]"><Outlet /></div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NavigationGroup({ items, label, pathname }: { items: NavigationItem[]; label: string; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ to, label: itemLabel, icon: Icon, end }) => {
            const active = end ? pathname === "/" : pathname.startsWith(to);
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={active} tooltip={itemLabel}>
                  <NavLink end={end} onClick={() => { if (isMobile) setOpenMobile(false); }} to={to}>
                    <Icon className="size-4" />
                    <span>{itemLabel}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isMobile } = useSidebar();
  const user = useQuery({ queryKey: ["session"], queryFn: () => api<AdminUser>("/v1/auth/session"), staleTime: 60_000 });
  const email = user.data?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase() || "LP";
  const logout = useMutation({
    mutationFn: () => api<null>("/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" size="lg">
              <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-primary/15 font-mono text-[11px] font-semibold text-primary">{initials}</AvatarFallback></Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-xs font-medium">{email || "Administrator"}</span>
                <span className="truncate text-[10px] text-muted-foreground">Administrator</span>
              </div>
              <RiExpandUpDownLine className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60" side={isMobile ? "bottom" : "right"} sideOffset={8}>
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <RiShieldUserLine className="size-4 text-primary" />
              <span className="grid leading-tight"><span className="truncate text-xs font-medium">{email}</span><span className="text-[10px] text-muted-foreground">Owner session · HttpOnly cookie</span></span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
              <RiLogoutBoxRLine />{logout.isPending ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function SchedulerStatus() {
  const monitor = useQuery({
    queryKey: ["workflow-schedules"],
    queryFn: ({ signal }) => api<SchedulerMonitor>("/v1/admin/workflow-schedules", { signal }),
    refetchInterval: 30_000,
  });
  const healthy = monitor.data?.instances.some((instance) => instance.healthy) ?? false;
  const label = monitor.isPending ? "Checking scheduler" : healthy ? "Scheduler online" : "Scheduler offline";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="gap-1.5 font-mono text-[10px]" variant="outline">
          <span aria-hidden className={cn("size-1.5 rounded-full", healthy ? "bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_25%,transparent)]" : monitor.isPending ? "bg-muted-foreground" : "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]")} />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {healthy
          ? `${monitor.data?.instances.filter((instance) => instance.healthy).length ?? 0} scheduler instance(s) heart-beating within ${monitor.data?.stale_after_seconds ?? 45}s.`
          : "No live scheduler heartbeat. Queued workflows wait until the Foundry scheduler starts."}
      </TooltipContent>
    </Tooltip>
  );
}
