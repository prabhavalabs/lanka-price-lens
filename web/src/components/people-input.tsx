import { RiAddLine, RiSubtractLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A headcount field that lets the reader clear it and type. The typed text is kept as a draft
 * while the field is focused, so backspace empties it instead of snapping to 1 (which turned a
 * typed "4" into "14"); the value is committed when it is a whole number in range, on blur, or on
 * Enter. Optional −/+ buttons step it.
 */
export function PeopleInput({ value, onChange, min = 1, max = 500, stepper = true, label = "People", className, inputClassName, autoFocus = false }: { value: number; onChange: (value: number) => void; min?: number; max?: number; stepper?: boolean; label?: string; className?: string | undefined; inputClassName?: string | undefined; autoFocus?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = (text: string) => {
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value) onChange(parsed);
  };
  const field = (
    <Input
      aria-label={label}
      autoFocus={autoFocus}
      className={cn("h-8 w-16 text-center text-sm font-semibold tabular-nums", stepper && "border-0 bg-transparent shadow-none focus-visible:ring-0", inputClassName)}
      inputMode="numeric"
      onBlur={() => {
        commit(shown);
        setDraft(null);
      }}
      onChange={(event) => {
        const text = event.target.value.replace(/[^\d]/gu, "");
        setDraft(text);
        commit(text);
      }}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit(shown);
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      value={shown}
    />
  );
  if (!stepper) return <div className={className}>{field}</div>;
  return (
    <div aria-label={`${label} stepper`} className={cn("inline-flex items-center gap-0.5 rounded-lg border border-primary/40 bg-primary/5 p-0.5", className)} role="group">
      {/* type="button": inside a form these must never submit it. */}
      <Button aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} size="icon-sm" type="button" variant="ghost"><RiSubtractLine className="size-3.5" /></Button>
      {field}
      <Button aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} size="icon-sm" type="button" variant="ghost"><RiAddLine className="size-3.5" /></Button>
    </div>
  );
}
