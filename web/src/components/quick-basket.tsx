import { RiDeleteBinLine, RiShoppingBasket2Line } from "@remixicon/react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ProductImage } from "@/components/product-image";
import { QuantityControl } from "@/components/quantity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { basketStore, useBasket } from "@/store/basket";

/** The basket from anywhere: a small dropdown to adjust, remove, or clear items on the go, and a button to the full comparison. */
export function QuickBasket() {
  const basket = useBasket();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <Popover onOpenChange={(next) => { setOpen(next); if (!next) setConfirmClear(false); }} open={open}>
      <PopoverTrigger asChild>
        <Button aria-label={`Basket, ${basket.count} items`} className="gap-1.5" size="sm" variant="ghost">
          <RiShoppingBasket2Line className="size-4" />
          <span className="hidden sm:inline">Basket</span>
          {basket.count ? <Badge className="h-5 min-w-5 justify-center px-1.5 tabular-nums" variant="default">{basket.count}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Your basket</p>
          <p className="text-xs text-muted-foreground">{basket.lines.length} {basket.lines.length === 1 ? "item" : "items"}</p>
        </div>
        {basket.lines.length ? (
          <ScrollArea className="[&_[data-slot=scroll-area-viewport]]:max-h-80">
            <ul className="divide-y">
              {basket.lines.map((line) => (
                <li key={line.id} className="flex items-center gap-2.5 px-3 py-2">
                  <ProductImage id={line.id} label={line.label} size="xs" />
                  <Link className="min-w-0 flex-1 truncate text-sm no-underline hover:text-primary" onClick={() => setOpen(false)} to={`/p/${line.id}`}>{line.label}</Link>
                  <QuantityControl id={line.id} label={line.label} unit={line.unit} />
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. Tap “Add” on a product to start a list.</p>
        )}
        <div className="flex items-center gap-2 border-t p-2">
          {basket.lines.length ? (
            confirmClear ? (
              <div className="flex flex-1 items-center gap-1 animate-in fade-in duration-150 motion-reduce:animate-none">
                <Button className="flex-1" onClick={() => { basketStore.clear(); setConfirmClear(false); }} size="sm" variant="destructive">Clear all {basket.lines.length}</Button>
                <Button onClick={() => setConfirmClear(false)} size="sm" variant="ghost">Keep</Button>
              </div>
            ) : (
              <>
                <Button aria-label="Clear the basket" onClick={() => setConfirmClear(true)} size="sm" variant="ghost"><RiDeleteBinLine className="size-4" /></Button>
                <Button asChild className="flex-1" size="sm" variant="default">
                  <Link onClick={() => setOpen(false)} to="/basket">Compare stores for this basket</Link>
                </Button>
              </>
            )
          ) : (
            <Button asChild className="w-full" size="sm" variant="outline">
              <Link onClick={() => setOpen(false)} to="/basket">Open the basket</Link>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
