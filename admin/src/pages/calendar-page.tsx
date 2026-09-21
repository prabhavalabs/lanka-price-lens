import { useState } from "react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiFacebookCircleLine, RiInstagramLine, RiRefreshLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { PageFrame } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, distributionApi, type CalendarEntry } from "@/lib/api";

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const statusTone: Record<CalendarEntry["status"], string> = {
  published: "border-emerald-500/40 bg-emerald-500/10",
  scheduled: "border-border bg-muted/40",
  queued: "border-amber-500/40 bg-amber-500/10",
  failed: "border-destructive/50 bg-destructive/10",
  cancelled: "border-border bg-muted/20 opacity-60",
};

/** The days of a month, starting on the Monday that carries its first day, always six weeks. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  // getDay() counts from Sunday; the grid starts on Monday.
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clock = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Everything planned and everything already out, month by month. */
export function CalendarPage() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const queryClient = useQueryClient();
  const days = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const from = days[0] as Date;
  const to = new Date(days[41] as Date);
  to.setDate(to.getDate() + 1);

  const calendar = useQuery({
    queryKey: ["calendar", cursor.getFullYear(), cursor.getMonth()],
    queryFn: ({ signal }) => distributionApi.calendar(from.toISOString(), to.toISOString(), { signal }),
  });
  const tick = useMutation({
    mutationFn: () => distributionApi.tick(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const entries = calendar.data?.entries ?? [];
  const planned = entries.filter((entry) => entry.status === "scheduled").length;
  const out = entries.filter((entry) => entry.status === "published").length;
  const wrong = entries.filter((entry) => entry.status === "failed").length;

  return (
    <PageFrame
      description="When each post from the library goes out, and where. The server checks every minute and publishes what is due; the day's deals post is not shown here because it is drawn and sent by the morning run."
      eyebrow="Distribution channels"
      title="Calendar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} size="sm" variant="outline"><RiArrowLeftSLine className="size-4" /></Button>
          <Button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} size="sm" variant="outline"><RiArrowRightSLine className="size-4" /></Button>
        </div>
        <h2 className="font-heading text-lg font-semibold">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
        <Button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} size="sm" variant="ghost">Today</Button>
        <p className="text-xs text-muted-foreground">{planned} planned · {out} posted{wrong ? ` · ${wrong} failed` : ""}</p>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline"><Link to="/distribution/library">Open the library</Link></Button>
          <Button disabled={tick.isPending} onClick={() => tick.mutate()} size="sm" variant="outline"><RiRefreshLine className="size-4" />{tick.isPending ? "Checking…" : "Run due posts now"}</Button>
        </div>
      </div>

      {calendar.isError ? <Alert variant="destructive"><AlertTitle>The calendar did not load</AlertTitle><AlertDescription>{message(calendar.error, "The server did not answer.")}</AlertDescription></Alert> : null}
      {tick.data ? <Alert><AlertTitle>Checked</AlertTitle><AlertDescription>{tick.data.due ? `${tick.data.published} posted, ${tick.data.failed} failed.` : "Nothing was due."}</AlertDescription></Alert> : null}

      <Card>
        <CardContent className="p-2 sm:p-3">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {dayNames.map((name) => (
              <div className="px-1 pb-1 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground" key={name}>{name}</div>
            ))}
            {days.map((day) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const onDay = entries.filter((entry) => sameDay(new Date(entry.scheduled_for), day));
              return (
                <div className={`min-h-24 rounded-lg border p-1 ${inMonth ? "" : "opacity-40"} ${sameDay(day, today) ? "border-primary/50" : ""}`} key={day.toISOString()}>
                  <p className={`px-1 text-right font-mono text-[10px] ${sameDay(day, today) ? "text-primary" : "text-muted-foreground"}`}>{day.getDate()}</p>
                  <div className="grid gap-1">
                    {onDay.map((entry) => (
                      <Link
                        className={`grid gap-0.5 rounded border p-1 text-left transition-colors hover:border-primary/40 ${statusTone[entry.status]}`}
                        key={entry.id}
                        title={`${entry.title} · ${entry.status}${entry.error ? ` · ${entry.error}` : ""}`}
                        to="/distribution/library"
                      >
                        <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                          {entry.platform === "facebook" ? <RiFacebookCircleLine className="size-3 shrink-0" /> : <RiInstagramLine className="size-3 shrink-0" />}
                          {clock(entry.scheduled_for)}
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-tight">{entry.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>This month, in order</CardTitle><CardDescription>Every planned and published post in the span above.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {!entries.length ? <p className="text-sm text-muted-foreground">Nothing planned in this month. Write a post in the library and give it a time.</p> : null}
          {entries.map((entry) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5" key={entry.id}>
              <div className="flex min-w-0 items-center gap-3">
                {entry.thumbnail ? <img alt="" className="size-12 shrink-0 rounded border object-cover" loading="lazy" src={entry.thumbnail} /> : null}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {entry.platform === "facebook" ? <RiFacebookCircleLine className="size-3.5" /> : <RiInstagramLine className="size-3.5" />}
                    <span className="truncate font-medium">{entry.title}</span>
                    <Badge variant={entry.status === "published" ? "default" : entry.status === "failed" ? "destructive" : "secondary"}>{entry.status}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{new Date(entry.scheduled_for).toLocaleString()}</p>
                  {entry.error ? <p className="mt-0.5 break-words text-xs text-destructive">{entry.error}</p> : null}
                </div>
              </div>
              {entry.post_url ? <a className="text-xs text-muted-foreground hover:text-primary" href={entry.post_url} rel="noreferrer" target="_blank">Open the post</a> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageFrame>
  );
}
