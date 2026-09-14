import { RiCalendarEventLine, RiRestaurantLine } from "@remixicon/react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { AccountMenu } from "@/components/account-menu";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { PresenceNote } from "@/components/presence";
import { QuickBasket } from "@/components/quick-basket";
import { SearchBox } from "@/components/search-box";
import { SiteMenu } from "@/components/site-menu";
import { VerifyBanner } from "@/components/verify-banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSiteConfig } from "@/lib/site-config";

/**
 * The header keeps what a visitor uses on every visit on one line: the mark, the search box,
 * recipes, menus, the basket, the account. Everything else sits behind the overflow menu, so
 * the bar never wraps under the search box as sections are added. On a phone the search box
 * takes its own row under the icons. The footer is one quiet line: where the site is made,
 * the small print, and who else is here; the disclaimers live on the Terms page. Its right
 * side stays clear of the standing community button in the corner.
 */
export function Layout({ children }: { children: ReactNode }) {
  const invite = useSiteConfig().community.discord_invite_url;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5 sm:flex-nowrap sm:gap-3">
          <Link aria-label="PriceLens, home" className="flex shrink-0 items-center gap-2.5 no-underline" to="/">
            <img alt="" className="size-9 shrink-0 select-none" decoding="async" draggable={false} height={36} src="/mark.png" width={36} />
            <span className="hidden font-heading text-lg font-semibold tracking-tight lg:block">PriceLens</span>
          </Link>
          <div className="order-last w-full min-w-0 sm:order-none sm:ml-2 sm:w-auto sm:max-w-lg sm:flex-1"><SearchBox /></div>
          <nav aria-label="Site" className="ml-auto flex shrink-0 items-center gap-0 sm:gap-0.5">
            <NavLink to="/recipes" className={({ isActive }) => cn("no-underline", isActive && "text-primary")}>
              <Button className="gap-1.5 px-1.5 md:px-2.5" size="sm" variant="ghost"><RiRestaurantLine className="size-4" /><span className="hidden md:inline">Recipes</span></Button>
            </NavLink>
            <NavLink to="/menus" className={({ isActive }) => cn("no-underline", isActive && "text-primary")}>
              <Button className="gap-1.5 px-1.5 md:px-2.5" size="sm" variant="ghost"><RiCalendarEventLine className="size-4" /><span className="hidden md:inline">Menus</span></Button>
            </NavLink>
            <QuickBasket />
            <AccountMenu />
            <SiteMenu discordInviteUrl={invite} />
          </nav>
        </div>
      </header>
      <VerifyBanner />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 py-5 pl-4 pr-16 text-xs text-muted-foreground sm:pr-60">
          <p className="inline-flex items-center gap-1.5">
            <span aria-label="Sri Lankan flag" className="text-base leading-none" role="img">🇱🇰</span>
            Made in Sri Lanka by Prabhava Labs
          </p>
          <nav aria-label="Site information" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link className="underline-offset-2 hover:text-foreground hover:underline" to="/guide">Guide</Link>
            <Link className="underline-offset-2 hover:text-foreground hover:underline" to="/about">Sources</Link>
            <Link className="underline-offset-2 hover:text-foreground hover:underline" to="/privacy">Privacy</Link>
            <Link className="underline-offset-2 hover:text-foreground hover:underline" to="/terms">Terms</Link>
            <FeedbackDialog trigger={<Button className="h-auto p-0 text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" size="sm" variant="link">Feedback</Button>} />
            {invite ? <a className="underline-offset-2 hover:text-foreground hover:underline" href={invite} rel="noopener noreferrer" target="_blank">Discord</a> : null}
          </nav>
          <PresenceNote />
        </div>
      </footer>
    </div>
  );
}
