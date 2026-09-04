import { RiAlertLine, RiCheckLine, RiPauseCircleLine, RiPlayCircleLine, RiRefreshLine, RiRestartLine, RiSave3Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { date, Status } from "@/components/data-display";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type AdapterConfig, type AdapterSchemaProperty, type UnmappedLabel } from "@/lib/api";
import { cn } from "@/lib/utils";

type Overrides = Record<string, unknown>;

/**
 * Everything an operator needs for one retail source: how it is captured, whether it
 * is healthy, the last run, and every adapter setting as a form generated from the
 * adapter's own schema. Blank fields inherit the manifest default; only changed
 * fields are saved as overrides, and the server validates the merged result.
 */
export function AdapterPanel({ sourceId }: { sourceId: string }) {
  const queryClient = useQueryClient();
  const path = `/v1/admin/sources/${encodeURIComponent(sourceId)}`;
  const config = useQuery({
    queryKey: ["adapter", sourceId],
    queryFn: ({ signal }) => api<AdapterConfig>(`${path}/adapter`, { signal }),
    refetchInterval: 10_000,
  });
  const unmapped = useQuery({
    queryKey: ["unmapped-labels", sourceId],
    queryFn: ({ signal }) => api<{ items: UnmappedLabel[]; total: number }>(`${path}/unmapped-labels?limit=12`, { signal }),
    refetchInterval: 30_000,
  });
  const [draft, setDraft] = useState<Overrides | null>(null);
  const invalidate = () => Promise.all(["adapter", "unmapped-labels", "sources", "runs", "overview", "dashboard", "workflow-dispatches"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const save = useMutation({
    mutationFn: (overrides: Overrides) => api<{ overrides: Overrides }>(`${path}/adapter`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides }) }),
    onSuccess: async () => { setDraft(null); await invalidate(); },
  });
  const reset = useMutation({ mutationFn: () => api<{ overrides: Overrides }>(`${path}/adapter`, { method: "DELETE" }), onSuccess: async () => { setDraft(null); await invalidate(); } });
  const capture = useMutation({ mutationFn: () => api<{ id: string }>(`${path}/capture`, { method: "POST" }), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: () => api<unknown>(`${path}/resume`, { method: "POST" }), onSuccess: invalidate });

  if (config.isPending) return <Skeleton className="h-40 rounded-lg" />;
  if (config.isError) return <Alert variant="destructive"><AlertTitle>Adapter unavailable</AlertTitle><AlertDescription>{config.error.message}</AlertDescription></Alert>;
  const data = config.data;
  if (!data.adapter) return null;

  const overrides = draft ?? data.overrides ?? {};
  const properties = Object.entries(data.schema?.properties ?? {});
  const health = data.health;
  const paused = Boolean(health?.paused_until && Date.parse(health.paused_until) > Date.now());
  const running = data.last_run?.status === "running";
  const changed = draft !== null;
  const issues = save.error instanceof ApiError && save.error.payload && typeof save.error.payload === "object" && "issues" in save.error.payload ? (save.error.payload as { issues: string[] }).issues : null;

  const update = (key: string, value: unknown) => {
    const next: Overrides = { ...overrides };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setDraft(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How prices are captured</h3>
          <p className="mt-1 text-sm font-medium">{data.adapter.label}</p>
          <p className="text-xs text-muted-foreground">{data.adapter.description} Prices are filed under the market <span className="font-medium text-foreground">{data.adapter.market_label}</span>.</p>
          {data.mapping_configured ? null : <p className="mt-1 text-xs text-amber-400">No mapping bundle is loaded for this source, so captured prices stay in staging.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {health ? <Status value={paused ? "paused" : health.state} /> : null}
          {health && health.consecutive_failures > 0 ? <Badge variant="outline">{health.consecutive_failures} failure{health.consecutive_failures === 1 ? "" : "s"} in a row</Badge> : null}
          {paused ? <Button disabled={resume.isPending} onClick={() => resume.mutate()} size="sm" variant="outline"><RiPlayCircleLine data-icon="inline-start" />Resume</Button> : null}
          <Button disabled={capture.isPending || running || paused} onClick={() => capture.mutate()} size="sm"><RiRefreshLine className={cn(capture.isPending && "animate-spin")} data-icon="inline-start" />{running ? "Capturing…" : "Capture now"}</Button>
        </div>
      </div>

      {paused && health ? (
        <Alert>
          <RiPauseCircleLine />
          <AlertTitle>Paused until {date(health.paused_until)}</AlertTitle>
          <AlertDescription>The source failed {health.consecutive_failures} times in a row, so captures are on hold. Fix the cause or resume to try again now.{health.last_capture_error ? <span className="mt-1 block font-mono text-[11px]">{health.last_capture_error}</span> : null}</AlertDescription>
        </Alert>
      ) : health?.last_capture_error && health.consecutive_failures > 0 ? (
        <Alert variant="destructive"><RiAlertLine /><AlertTitle>Last capture failed</AlertTitle><AlertDescription className="font-mono text-[11px]">{health.last_capture_error}</AlertDescription></Alert>
      ) : null}
      {capture.isError ? <Alert variant="destructive"><AlertTitle>Capture did not start</AlertTitle><AlertDescription>{capture.error.message}</AlertDescription></Alert> : null}

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-xs text-muted-foreground">Last successful capture</dt>
        <dd>{health?.last_capture_at ? date(health.last_capture_at) : "Not yet"}</dd>
        <dt className="text-xs text-muted-foreground">Last run</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {data.last_run ? (
            <>
              <Status value={data.last_run.status} />
              <span className="text-xs text-muted-foreground">{date(data.last_run.started_at)} · {data.last_run.parsed_count} price rows{data.last_run.error_code ? ` · ${data.last_run.error_code}` : ""}</span>
              <Link className="text-xs underline underline-offset-4 hover:text-primary" to={`/runs/${data.last_run.id}`}>Open run</Link>
            </>
          ) : <span className="text-xs text-muted-foreground">No capture has run yet</span>}
        </dd>
      </dl>

      <Accordion className="rounded-lg border bg-background/40 px-3" collapsible type="single" {...(changed || data.error ? { defaultValue: "settings" } : {})}>
        <AccordionItem className="border-0 border-b" value="labels">
          <AccordionTrigger className="py-2.5 text-sm hover:no-underline">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Labels waiting for a mapping</span>
              <span className="text-[11px] font-normal text-muted-foreground">{unmapped.data ? `${unmapped.data.total.toLocaleString()} store labels are captured but not yet linked to a product` : "Loading…"}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            {unmapped.data?.items.length ? (
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {unmapped.data.items.map((label) => (
                  <li className="flex items-baseline justify-between gap-2 rounded-md border bg-card/60 px-2 py-1.5" key={`${label.label_type}:${label.label}`}>
                    <span className="min-w-0 truncate" title={label.label}>{label.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{label.last_price_minor !== null ? `Rs ${(label.last_price_minor / 100).toLocaleString()} / ${label.last_quantity ?? ""}${label.last_unit ?? ""}` : label.label_type} · {label.occurrences}×</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">Every captured label is mapped.</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">Add a label to the source's mapping bundle (scripts/retail-bundles.mjs) to promote it on the next capture.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem className="border-0" value="settings">
          <AccordionTrigger className="py-2.5 text-sm hover:no-underline">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settings</span>
              <span className="text-[11px] font-normal text-muted-foreground">{data.overrides_updated ? `Changed by ${data.overrides_updated.updated_by} · ${date(data.overrides_updated.updated_at)}` : "Using the manifest defaults"}{changed ? " · unsaved changes" : ""}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
        {data.error ? <Alert className="mb-3" variant="destructive"><AlertTitle>Current settings are invalid</AlertTitle><AlertDescription>{data.error}</AlertDescription></Alert> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {properties.map(([key, property]) => (
            <SettingField
              defaultValue={data.defaults?.[key] ?? property.default}
              effective={data.effective?.[key]}
              key={key}
              name={key}
              onChange={(value) => update(key, value)}
              property={property}
              value={overrides[key]}
            />
          ))}
        </div>
        {issues ? <Alert className="mt-3" variant="destructive"><AlertTitle>Settings rejected</AlertTitle><AlertDescription><ul className="list-disc pl-4">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></AlertDescription></Alert> : save.isError ? <Alert className="mt-3" variant="destructive"><AlertTitle>Could not save</AlertTitle><AlertDescription>{save.error.message}</AlertDescription></Alert> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={!changed || save.isPending} onClick={() => save.mutate(overrides)} size="sm"><RiSave3Line data-icon="inline-start" />Save settings</Button>
          {changed ? <Button onClick={() => setDraft(null)} size="sm" variant="ghost">Discard changes</Button> : null}
          {Object.keys(data.overrides ?? {}).length ? <Button disabled={reset.isPending} onClick={() => reset.mutate()} size="sm" variant="outline"><RiRestartLine data-icon="inline-start" />Reset to defaults</Button> : null}
          {save.isSuccess && !changed ? <span className="inline-flex items-center gap-1 text-xs text-primary"><RiCheckLine className="size-3.5" />Saved</span> : null}
        </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function SettingField({ name, property, value, defaultValue, effective, onChange }: {
  name: string;
  property: AdapterSchemaProperty;
  value: unknown;
  defaultValue: unknown;
  effective: unknown;
  onChange: (value: unknown) => void;
}) {
  const type = Array.isArray(property.type) ? property.type.find((candidate) => candidate !== "null") : property.type;
  const label = humanize(name);
  const id = `setting-${name}`;
  const overridden = value !== undefined;
  const hint = overridden ? `Default ${describe(defaultValue)}` : `Using default ${describe(defaultValue)}`;

  if (type === "boolean") {
    const checked = typeof value === "boolean" ? value : typeof effective === "boolean" ? effective : Boolean(defaultValue);
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border bg-card/60 p-2.5">
        <div className="min-w-0"><Label htmlFor={id}>{label}</Label>{property.description ? <p className="text-[11px] text-muted-foreground">{property.description}</p> : null}<p className="text-[11px] text-muted-foreground">{hint}</p></div>
        <Switch checked={checked} id={id} onCheckedChange={(next) => onChange(next === Boolean(defaultValue) ? undefined : next)} />
      </div>
    );
  }
  if (type === "array") {
    const itemType = property.items?.type;
    const lines = Array.isArray(value) ? value.map(String).join("\n") : "";
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-card/60 p-2.5 md:col-span-2">
        <Label htmlFor={id}>{label}</Label>
        {property.description ? <p className="text-[11px] text-muted-foreground">{property.description}</p> : null}
        <Textarea
          className="min-h-20 font-mono text-xs"
          id={id}
          onChange={(event) => {
            const entries = event.target.value.split("\n").map((entry) => entry.trim()).filter(Boolean);
            onChange(entries.length ? (itemType === "number" || itemType === "integer" ? entries.map(Number) : entries) : undefined);
          }}
          placeholder={Array.isArray(defaultValue) ? defaultValue.map(String).join("\n") : "One value per line"}
          value={lines}
        />
        <p className="text-[11px] text-muted-foreground">One value per line. {hint}</p>
      </div>
    );
  }
  const numeric = type === "number" || type === "integer";
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card/60 p-2.5">
      <Label htmlFor={id}>{label}</Label>
      {property.description ? <p className="text-[11px] text-muted-foreground">{property.description}</p> : null}
      <Input
        className={cn("h-8 text-sm", numeric && "font-mono")}
        id={id}
        inputMode={numeric ? "decimal" : undefined}
        max={property.maximum}
        min={property.minimum}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(undefined);
          onChange(numeric ? Number(raw) : raw);
        }}
        placeholder={describe(defaultValue)}
        type={numeric ? "number" : "text"}
        value={value === undefined ? "" : String(value)}
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/gu, " $1").replace(/^./u, (letter) => letter.toUpperCase()).replace(/\bMs\b/u, "(ms)").replace(/\bPct\b/u, "(%)").replace(/\bUrl\b/u, "URL").replace(/\bIds\b/u, "IDs");
}

function describe(value: unknown): string {
  if (value === undefined || value === null) return "none";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
