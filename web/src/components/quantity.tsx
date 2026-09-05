import { RiAddLine, RiDeleteBinLine, RiSubtractLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { basketStore, formatQuantity, stepFor, useBasketLine } from "@/store/basket";
import { cn } from "@/lib/utils";

/**
 * "Add" until the product is in the basket, then a −/amount/+ control in its place. Every copy of it
 * (board card, header basket, product page, basket page, recipe page) reads and writes the one store,
 * so they stay in step. Steps are a quarter kilo or litre, or one piece; tapping the amount opens
 * presets (100 g … 2 kg) and a free field for exactly what the shopper needs. Below 50 g, 50 ml, or
 * one piece the line is removed.
 */
export function QuantityControl({ id, label, unit, size = "sm", className }: { id: string; label: string; unit: string; size?: "sm" | "md"; className?: string | undefined }) {
  const line = useBasketLine(id);
  const iconSize = size === "md" ? "icon" : "icon-sm";
  if (!line) {
    return (
      <Button
        aria-label={`Add ${label} to basket`}
        className={cn("animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none", className)}
        onClick={() => basketStore.add(id, label, unit, defaultQuantity(unit))}
        size={size === "md" ? "default" : "sm"}
        variant={size === "md" ? "default" : "outline"}
      >
        {size === "md" ? "Add to basket" : "Add"}
      </Button>
    );
  }
  const atMinimum = line.quantity - stepFor(line.unit) < (line.unit === "kg" || line.unit === "l" ? 0.05 : 1) - 1e-9;
  return (
    <div
      aria-label={`${label} quantity`}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-primary/40 bg-primary/5 p-0.5 animate-in fade-in zoom-in-90 duration-150 ease-out motion-reduce:animate-none", className)}
      role="group"
    >
      <Button aria-label={atMinimum ? `Remove ${label}` : `Less ${label}`} className="transition-transform active:scale-90" onClick={() => basketStore.decrement(id)} size={iconSize} variant="ghost">
        {atMinimum ? <RiDeleteBinLine className="size-3.5" /> : <RiSubtractLine className="size-3.5" />}
      </Button>
      <AmountPicker id={id} label={label} quantity={line.quantity} unit={line.unit} size={size} />
      <Button aria-label={`More ${label}`} className="transition-transform active:scale-90" onClick={() => basketStore.increment(id)} size={iconSize} variant="ghost"><RiAddLine className="size-3.5" /></Button>
    </div>
  );
}

/** The amount a fresh line starts with: half a kilo or litre, one piece. */
function defaultQuantity(unit: string): number {
  return unit === "kg" || unit === "l" ? 0.5 : 1;
}

const presets: Record<string, Array<{ label: string; value: number }>> = {
  kg: [{ label: "100 g", value: 0.1 }, { label: "250 g", value: 0.25 }, { label: "500 g", value: 0.5 }, { label: "1 kg", value: 1 }, { label: "2 kg", value: 2 }, { label: "5 kg", value: 5 }],
  l: [{ label: "250 ml", value: 0.25 }, { label: "500 ml", value: 0.5 }, { label: "750 ml", value: 0.75 }, { label: "1 l", value: 1 }, { label: "2 l", value: 2 }],
  piece: [{ label: "1", value: 1 }, { label: "2", value: 2 }, { label: "6", value: 6 }, { label: "10", value: 10 }, { label: "12", value: 12 }, { label: "30", value: 30 }],
};

function AmountPicker({ id, label, quantity, unit, size }: { id: string; label: string; quantity: number; unit: string; size: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftUnit, setDraftUnit] = useState<"small" | "large">(quantity < 1 ? "small" : "large");
  const metric = unit === "kg" || unit === "l";
  const smallUnit = unit === "kg" ? "g" : "ml";
  const apply = () => {
    const value = Number(draft.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return;
    basketStore.setQuantity(id, metric && draftUnit === "small" ? value / 1000 : value);
    setOpen(false);
    setDraft("");
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button aria-label={`Change ${label} quantity, now ${formatQuantity(quantity, unit)}`} className={cn("min-w-12 rounded px-1 text-center font-medium tabular-nums hover:bg-primary/10", size === "md" ? "text-sm" : "text-xs")} type="button">
          <span className="inline-block animate-in fade-in zoom-in-50 duration-150 ease-out motion-reduce:animate-none" key={quantity}>{formatQuantity(quantity, unit)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 p-3">
        <p className="mb-2 text-xs font-medium">How much {label.toLowerCase()}?</p>
        <div className="flex flex-wrap gap-1.5">
          {(presets[unit] ?? presets.piece!).map((preset) => (
            <Button className="rounded-full" key={preset.value} onClick={() => { basketStore.setQuantity(id, preset.value); setOpen(false); }} size="sm" variant={Math.abs(preset.value - quantity) < 1e-9 ? "default" : "outline"}>{preset.label}</Button>
          ))}
        </div>
        <form className="mt-3 flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); apply(); }}>
          <Input aria-label="Exact amount" className="h-8 flex-1 tabular-nums" inputMode="decimal" min="0" onChange={(event) => setDraft(event.target.value)} placeholder={metric ? (draftUnit === "small" ? "e.g. 300" : "e.g. 1.5") : "e.g. 4"} step="any" type="number" value={draft} />
          {metric ? (
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              <button className={cn("rounded px-2 py-0.5", draftUnit === "small" && "bg-primary text-primary-foreground")} onClick={() => setDraftUnit("small")} type="button">{smallUnit}</button>
              <button className={cn("rounded px-2 py-0.5", draftUnit === "large" && "bg-primary text-primary-foreground")} onClick={() => setDraftUnit("large")} type="button">{unit}</button>
            </div>
          ) : <span className="text-xs text-muted-foreground">{unit === "piece" ? "pcs" : unit}</span>}
          <Button className="h-8" disabled={!draft} size="sm" type="submit">Set</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
