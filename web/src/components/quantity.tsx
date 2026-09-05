import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { basketStore, useBasketLine } from "@/store/basket";
import { cn } from "@/lib/utils";

/**
 * Add-to-basket that turns into a quantity control once the product is in the basket. Every copy
 * of it (board card, header basket, product page, basket page) reads and writes the one store, so
 * they stay in step; taking the quantity to zero removes the line.
 */
export function QuantityControl({ id, label, size = "sm", className }: { id: string; label: string; size?: "sm" | "md"; className?: string | undefined }) {
  const line = useBasketLine(id);
  const iconSize = size === "md" ? "icon" : "icon-sm";
  if (!line) {
    return (
      <Button aria-label={`Add ${label} to basket`} className={cn("gap-1.5", className)} onClick={() => basketStore.add(id, label)} size={size === "md" ? "default" : "sm"} variant="outline">
        <RiAddLine className="size-4" />{size === "md" ? "Add to basket" : "Add"}
      </Button>
    );
  }
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 p-0.5", className)} role="group" aria-label={`${label} quantity`}>
      <Button aria-label={line.quantity === 1 ? `Remove ${label}` : `One less ${label}`} onClick={() => basketStore.decrement(id)} size={iconSize} variant="ghost">
        {line.quantity === 1 ? <RiDeleteBinLine className="size-3.5" /> : <RiSubtractLine className="size-3.5" />}
      </Button>
      <span className={cn("min-w-6 text-center font-medium tabular", size === "md" ? "text-sm" : "text-xs")}>{line.quantity}</span>
      <Button aria-label={`One more ${label}`} onClick={() => basketStore.increment(id, label)} size={iconSize} variant="ghost"><RiAddLine className="size-3.5" /></Button>
    </div>
  );
}
