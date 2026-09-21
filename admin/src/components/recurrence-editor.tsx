import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * When a job runs, in the owner's terms.
 *
 * The server keeps a cron expression, because that is the one notation that can say anything —
 * every six hours, weekdays only, the first and the fifteenth. Nobody should have to write one to
 * say "every day at half past seven", so the shapes people actually want are offered as fields and
 * compiled here, with the expression itself left open for the rest. What the server will store is
 * shown at the bottom, so the two never drift apart in someone's head.
 */

export type RecurrenceKind = "hourly" | "every_n_hours" | "daily" | "weekly" | "monthly" | "cron";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The five fields, or null when the expression is not five fields. */
function fields(expression: string): [string, string, string, string, string] | null {
  const parts = expression.trim().split(/\s+/u);
  return parts.length === 5 ? (parts as [string, string, string, string, string]) : null;
}

const numbers = (field: string): number[] => field.split(",").flatMap((part) => (/^\d+$/u.test(part) ? [Number(part)] : []));
const clockOf = (minute: string, hour: string): string => `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;

/** The shape an expression was written in, so opening the editor shows the way it was set. */
export function readRecurrence(expression: string): { kind: RecurrenceKind; at: string; minute: number; hours: number; weekdays: number[]; days: number[] } {
  const parts = fields(expression);
  const fallback = { kind: "cron" as RecurrenceKind, at: "07:30", minute: 0, hours: 6, weekdays: [1], days: [1] };
  if (!parts) return fallback;
  const [minute, hour, day, month, weekday] = parts;
  const plainMinute = /^\d+$/u.test(minute);
  if (month !== "*") return { ...fallback, kind: "cron" };
  if (plainMinute && hour === "*" && day === "*" && weekday === "*") return { ...fallback, kind: "hourly", minute: Number(minute) };
  if (plainMinute && /^\*\/\d+$/u.test(hour) && day === "*" && weekday === "*") return { ...fallback, kind: "every_n_hours", minute: Number(minute), hours: Number(hour.slice(2)) };
  if (plainMinute && /^\d+$/u.test(hour) && day === "*" && weekday === "*") return { ...fallback, kind: "daily", at: clockOf(minute, hour) };
  if (plainMinute && /^\d+$/u.test(hour) && day === "*" && weekday !== "*" && numbers(weekday).length) {
    return { ...fallback, kind: "weekly", at: clockOf(minute, hour), weekdays: numbers(weekday) };
  }
  if (plainMinute && /^\d+$/u.test(hour) && weekday === "*" && day !== "*" && numbers(day).length) {
    return { ...fallback, kind: "monthly", at: clockOf(minute, hour), days: numbers(day) };
  }
  return { ...fallback, kind: "cron" };
}

/** The fields as the expression the server stores. */
export function buildCron(form: { kind: RecurrenceKind; at: string; minute: number; hours: number; weekdays: number[]; days: number[] }, custom: string): string {
  const [hour, minute] = form.at.split(":").map((part) => Number(part));
  switch (form.kind) {
    case "hourly":
      return `${form.minute} * * * *`;
    case "every_n_hours":
      return `${form.minute} */${form.hours} * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${[...form.weekdays].sort((a, b) => a - b).join(",") || "1"}`;
    case "monthly":
      return `${minute} ${hour} ${[...form.days].sort((a, b) => a - b).join(",") || "1"} * *`;
    case "cron":
      return custom.trim();
  }
}

export function RecurrenceEditor({ busy, onCancel, onSave, value }: { busy?: boolean; onCancel: () => void; onSave: (cron: string) => void; value: string }) {
  const [form, setForm] = useState(() => readRecurrence(value));
  const [custom, setCustom] = useState(value);
  useEffect(() => {
    setForm(readRecurrence(value));
    setCustom(value);
  }, [value]);
  const cron = buildCron(form, custom);
  const valid = cron.trim().split(/\s+/u).length === 5;

  return (
    <div className="grid gap-3 rounded-lg border bg-background/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground" htmlFor="recurrence-kind">Runs</Label>
          <Select onValueChange={(kind) => setForm({ ...form, kind: kind as RecurrenceKind })} value={form.kind}>
            <SelectTrigger className="w-44" id="recurrence-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Every hour</SelectItem>
              <SelectItem value="every_n_hours">Every few hours</SelectItem>
              <SelectItem value="daily">Every day</SelectItem>
              <SelectItem value="weekly">Every week</SelectItem>
              <SelectItem value="monthly">Every month</SelectItem>
              <SelectItem value="cron">Cron of my own</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.kind === "hourly" || form.kind === "every_n_hours" ? (
          <>
            {form.kind === "every_n_hours" ? (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="recurrence-hours">Every</Label>
                <Select onValueChange={(hours) => setForm({ ...form, hours: Number(hours) })} value={String(form.hours)}>
                  <SelectTrigger className="w-32" id="recurrence-hours"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2, 3, 4, 6, 8, 12].map((hours) => <SelectItem key={hours} value={String(hours)}>{hours} hours</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="recurrence-minute">At minute</Label>
              <Input className="w-24" id="recurrence-minute" max={59} min={0} onChange={(event) => setForm({ ...form, minute: Math.min(59, Math.max(0, Number(event.target.value) || 0)) })} type="number" value={form.minute} />
            </div>
          </>
        ) : null}

        {form.kind === "daily" || form.kind === "weekly" || form.kind === "monthly" ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="recurrence-at">At</Label>
            <Input className="w-32" id="recurrence-at" onChange={(event) => setForm({ ...form, at: event.target.value })} type="time" value={form.at} />
          </div>
        ) : null}

        {form.kind === "cron" ? (
          <div className="grid flex-1 gap-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="recurrence-cron">Expression</Label>
            <Input className="font-mono" id="recurrence-cron" onChange={(event) => setCustom(event.target.value)} placeholder="30 7 * * *" value={custom} />
          </div>
        ) : null}
      </div>

      {form.kind === "weekly" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">On</Label>
          <ToggleGroup onValueChange={(days) => setForm({ ...form, weekdays: days.map(Number) })} size="sm" type="multiple" value={form.weekdays.map(String)} variant="outline">
            {weekdayNames.map((name, index) => <ToggleGroupItem key={name} value={String(index)}>{name}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      ) : null}

      {form.kind === "monthly" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground" htmlFor="recurrence-days">On days of the month</Label>
          <Input
            className="w-48"
            id="recurrence-days"
            onChange={(event) => setForm({ ...form, days: event.target.value.split(",").flatMap((part) => { const day = Number(part.trim()); return day >= 1 && day <= 31 ? [day] : []; }) })}
            placeholder="1, 15"
            value={form.days.join(", ")}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* What is actually stored, so nobody has to guess what the fields above compiled to. */}
        <p className="font-mono text-xs text-muted-foreground">{valid ? cron : "Five fields, such as 30 7 * * *"}</p>
        <div className="flex items-center gap-2">
          <Button onClick={onCancel} size="sm" variant="ghost">Cancel</Button>
          <Button disabled={!valid || busy} onClick={() => onSave(cron)} size="sm">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
