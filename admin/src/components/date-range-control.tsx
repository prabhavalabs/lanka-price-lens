import { RiCalendarLine, RiCheckLine } from "@remixicon/react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { priceRangePresets, type PriceRangePreset, type RangeSelection } from "@/lib/api";
import { cn } from "@/lib/utils";

const presetLabel: Record<PriceRangePreset, { short: string; long: string }> = {
  30: { short: "30d", long: "Last 30 days" },
  90: { short: "90d", long: "Last 90 days" },
  180: { short: "6m", long: "Last 6 months" },
  365: { short: "1y", long: "Last year" },
};
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function describeRange(selection: RangeSelection): string {
  if ("preset" in selection) return presetLabel[selection.preset].long;
  return `${dateFormatter.format(parseDate(selection.from))} – ${dateFormatter.format(parseDate(selection.to))}`;
}

export function DateRangeControl({ value, onChange, earliest, latest, className }: {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  /** Earliest and latest dates with data; the calendar disables everything outside. */
  earliest?: string | null | undefined;
  latest?: string | null | undefined;
  className?: string | undefined;
}) {
  const custom = "from" in value ? value : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(custom ? { from: parseDate(custom.from), to: parseDate(custom.to) } : undefined);
  const disabled = [
    ...(earliest ? [{ before: parseDate(earliest) }] : []),
    ...(latest ? [{ after: parseDate(latest) }] : []),
  ];
  const apply = () => {
    if (!draft?.from || !draft.to) return;
    onChange({ from: isoDate(draft.from), to: isoDate(draft.to) });
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ToggleGroup
        aria-label="Preset date ranges"
        className="h-9 rounded-lg border bg-background/60 p-0.5"
        onValueChange={(next) => { if (next) onChange({ preset: Number(next) as PriceRangePreset }); }}
        size="sm"
        type="single"
        value={"preset" in value ? String(value.preset) : ""}
      >
        {priceRangePresets.map((preset) => (
          <ToggleGroupItem
            aria-label={presetLabel[preset].long}
            className="h-full min-w-11 rounded-md px-3 font-medium text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
            key={preset}
            value={String(preset)}
          >
            {presetLabel[preset].short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover onOpenChange={(next) => { setOpen(next); if (next) setDraft(custom ? { from: parseDate(custom.from), to: parseDate(custom.to) } : undefined); }} open={open}>
        <PopoverTrigger asChild>
          <Button aria-label={custom ? `Custom range ${describeRange(custom)}` : "Choose a custom date range"} className="h-9" variant={custom ? "default" : "outline"}>
            <RiCalendarLine data-icon="inline-start" />
            {custom ? describeRange(custom) : "Custom range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            autoFocus
            {...(draft?.from ? { defaultMonth: draft.from } : latest ? { defaultMonth: previousMonth(parseDate(latest)) } : {})}
            disabled={disabled}
            mode="range"
            numberOfMonths={2}
            onSelect={setDraft}
            selected={draft}
          />
          <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {draft?.from && draft.to
                ? `${dateFormatter.format(draft.from)} – ${dateFormatter.format(draft.to)} · ${Math.round((draft.to.getTime() - draft.from.getTime()) / 86_400_000) + 1} days`
                : draft?.from
                  ? "Pick the end of the range"
                  : "Pick a start and end date"}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => { setDraft(undefined); onChange({ preset: 90 }); setOpen(false); }} size="sm" variant="ghost">Reset</Button>
              <Button disabled={!draft?.from || !draft.to} onClick={apply} size="sm"><RiCheckLine data-icon="inline-start" />Apply</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
