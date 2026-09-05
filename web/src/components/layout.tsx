import { RiInformationLine, RiShoppingBasket2Line } from "@remixicon/react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { SearchBox } from "@/components/search-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBasket } from "@/lib/basket";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: ReactNode }) {
  const basket = useBasket();
  const count = basket.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <span className="grid size-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground shadow-sm">₨</span>
            <span className="leading-tight">
              <span className="block font-heading text-lg font-semibold tracking-tight">PriceLens</span>
              <span className="hidden text-[11px] text-muted-foreground sm:block">Sri Lanka food prices, every day</span>
            </span>
          </Link>
          <div className="order-last w-full sm:order-none sm:ml-4 sm:w-auto sm:flex-1 sm:max-w-md"><SearchBox /></div>
          <nav className="ml-auto flex items-center gap-1">
            <NavLink to="/basket" className={({ isActive }) => cn("no-underline", isActive && "text-primary")}>
              <Button className="gap-1.5" size="sm" variant="ghost">
                <RiShoppingBasket2Line className="size-4" />
                <span className="hidden sm:inline">Basket</span>
                {count ? <Badge className="h-5 min-w-5 justify-center px-1.5 tabular" variant="default">{count}</Badge> : null}
              </Button>
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => cn("no-underline", isActive && "text-primary")}>
              <Button className="gap-1.5" size="sm" variant="ghost"><RiInformationLine className="size-4" /><span className="hidden sm:inline">About</span></Button>
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-border/70">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-muted-foreground">
          <p>Prices are as observed on the date shown and may differ in store or at the stall. Rupees, per unit as stated.</p>
          <p>
            Open-market prices: Central Bank of Sri Lanka daily price report, Department of Census and Statistics weekly retail prices, HARTI daily bulletin. Supermarket prices: the retailers' online stores.{" "}
            <Link to="/about" className="underline">Sources and method</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
