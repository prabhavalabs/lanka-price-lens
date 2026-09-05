import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { basketStore, useBasketLine } from "@/store/basket";
import { cn } from "@/lib/utils";

/**
 * "Add" until the product is in the basket, then a −/count/+ control in its place. Every copy of it
 * (board card, header basket, product page, basket page) reads and writes the one store, so they stay
 * in step; taking the quantity to zero removes the line. The swap and each count change animate briefly.
 */
export function QuantityControl({ id, label, size = "sm", className }: { id: string; label: string; size?: "sm" | "md"; className?: string | undefined }) {
  const line = useBasketLine(id);
  const iconSize = size === "md" ? "icon" : "icon-sm";
  if (!line) {
    return (
      <Button
        aria-label={`Add ${label} to basket`}
        className={cn("animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none", className)}
        onClick={() => basketStore.add(id, label)}
        size={size === "md" ? "default" : "sm"}
        variant={size === "md" ? "default" : "outline"}
      >
        {size === "md" ? "Add to basket" : "Add"}
      </Button>
    );
  }
  return (
    <div
      aria-label={`${label} quantity`}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-primary/40 bg-primary/5 p-0.5 animate-in fade-in zoom-in-90 duration-150 ease-out motion-reduce:animate-none", className)}
      role="group"
    >
      <Button aria-label={line.quantity === 1 ? `Remove ${label}` : `One less ${label}`} className="transition-transform active:scale-90" onClick={() => basketStore.decrement(id)} size={iconSize} variant="ghost">
        {line.quantity === 1 ? <RiDeleteBinLine className="size-3.5" /> : <RiSubtractLine className="size-3.5" />}
      </Button>
      <span className={cn("min-w-6 text-center font-medium tabular-nums", size === "md" ? "text-sm" : "text-xs")}>
        <span className="inline-block animate-in fade-in zoom-in-50 duration-150 ease-out motion-reduce:animate-none" key={line.quantity}>{line.quantity}</span>
      </span>
      <Button aria-label={`One more ${label}`} className="transition-transform active:scale-90" onClick={() => basketStore.increment(id, label)} size={iconSize} variant="ghost"><RiAddLine className="size-3.5" /></Button>
    </div>
  );
}
