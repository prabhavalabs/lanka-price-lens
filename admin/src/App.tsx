import { useEffect, useState } from "react";
import { Activity, ArchiveX, Database, ShieldCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Overview = { sources: number; running: number; failed: number; quarantined: number };
type Source = { id: string; name: string; rights_status: string; review_due_at: string; enabled: number; state: string; last_parse_at: string | null };
type Run = { id: string; source_id: string; trigger: string; status: string; started_at: string; parsed_count: number; quarantined_count: number; error_code: string | null };
type Quarantine = { id: string; run_id: string; reason_code: string; source_row_ref: string | null; created_at: string };
type Release = { data_version: string; schema_version: string; status: string; built_at: string; build_commit: string | null; notes: string };
type Envelope<T> = { success: boolean; message: string; payload: T };

export function App() {
  const [data, setData] = useState<{ overview: Overview; sources: Source[]; runs: Run[]; quarantine: Quarantine[]; releases: Release[] }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([get<Overview>("overview"), get<Source[]>("sources"), get<Run[]>("runs"), get<Quarantine[]>("quarantine"), get<Release[]>("releases")])
      .then(([overview, sources, runs, quarantine, releases]) => setData({ overview, sources, runs, quarantine, releases }))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/10 bg-forest text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-7 lg:px-8">
          <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.22em] text-mint">Lanka PriceLens</p><h1 className="font-display text-2xl font-semibold">Foundry operations</h1></div>
          <Badge className="border-white/20 bg-white/10 text-white"><ShieldCheck className="mr-1.5 size-3.5" />Owner access</Badge>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8 lg:px-8">
        {error && <Alert><strong>Dashboard unavailable.</strong> {error}</Alert>}
        {!data ? <Loading /> : <>
          <section aria-label="Operational summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric title="Sources" value={data.overview.sources} icon={<Database />} />
            <Metric title="Running now" value={data.overview.running} icon={<Activity />} />
            <Metric title="Failed runs" value={data.overview.failed} icon={<ArchiveX />} tone={data.overview.failed ? "danger" : "normal"} />
            <Metric title="Open quarantine" value={data.overview.quarantined} icon={<ShieldCheck />} tone={data.overview.quarantined ? "warning" : "normal"} />
          </section>
          <Card><CardHeader><CardTitle>Source controls</CardTitle></CardHeader><CardContent className="p-0"><Table><caption className="sr-only">Configured source state and rights review</caption><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>State</TableHead><TableHead>Rights</TableHead><TableHead>Review due</TableHead><TableHead>Last parsed</TableHead></TableRow></TableHeader><TableBody>{data.sources.map((source) => <TableRow key={source.id}><TableCell className="font-medium">{source.name}</TableCell><TableCell><Status value={source.state} /></TableCell><TableCell className="font-mono text-xs">{source.rights_status}</TableCell><TableCell>{date(source.review_due_at)}</TableCell><TableCell>{date(source.last_parse_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
          <Card><CardHeader><CardTitle>Release candidates</CardTitle></CardHeader><CardContent className="p-0"><Table><caption className="sr-only">Immutable release candidates</caption><TableHeader><TableRow><TableHead>Data version</TableHead><TableHead>Status</TableHead><TableHead>Built</TableHead><TableHead>Schema</TableHead><TableHead>Commit</TableHead></TableRow></TableHeader><TableBody>{data.releases.length ? data.releases.map((release) => <TableRow key={release.data_version}><TableCell className="font-mono font-medium">{release.data_version}</TableCell><TableCell><Status value={release.status} /></TableCell><TableCell>{date(release.built_at)}</TableCell><TableCell>{release.schema_version}</TableCell><TableCell className="font-mono text-xs">{release.build_commit}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="text-muted-foreground">No release candidate has been built.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
            <Card><CardHeader><CardTitle>Recent ingestion runs</CardTitle></CardHeader><CardContent className="p-0"><Table><caption className="sr-only">Most recent ingestion executions</caption><TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead>Parsed</TableHead><TableHead>Held</TableHead></TableRow></TableHeader><TableBody>{data.runs.map((run) => <TableRow key={run.id}><TableCell>{date(run.started_at)}</TableCell><TableCell>{run.trigger}</TableCell><TableCell><Status value={run.status} /></TableCell><TableCell>{run.parsed_count}</TableCell><TableCell>{run.quarantined_count}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
            <Card><CardHeader><CardTitle>Latest quarantine</CardTitle></CardHeader><CardContent>{data.quarantine.length ? <ul className="space-y-3">{data.quarantine.slice(0, 8).map((item) => <li key={item.id} className="rounded-xl border border-border bg-muted/40 p-3"><div className="flex items-start justify-between gap-3"><span className="font-mono text-xs font-semibold">{item.reason_code}</span><time className="text-xs text-muted-foreground">{date(item.created_at)}</time></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.source_row_ref ?? item.run_id}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No records are waiting for review.</p>}</CardContent></Card>
          </div>
        </>}
      </div>
    </main>
  );
}

function Metric({ title, value, icon, tone = "normal" }: { title: string; value: number; icon: React.ReactNode; tone?: "normal" | "warning" | "danger" }) {
  return <Card className={tone === "danger" ? "border-red-300" : tone === "warning" ? "border-amber-300" : ""}><CardContent className="flex items-center justify-between pt-5"><div><p className="text-sm font-medium text-muted-foreground">{title}</p><p className="font-display mt-1 text-3xl font-semibold">{value}</p></div><div className="grid size-11 place-items-center rounded-xl bg-mint/30 text-forest [&_svg]:size-5">{icon}</div></CardContent></Card>;
}

function Status({ value }: { value: string }) {
  const bad = ["failed", "blocked", "degraded", "review_required"].includes(value);
  const good = ["healthy", "succeeded"].includes(value);
  return <Badge className={bad ? "border-red-200 bg-red-50 text-red-800" : good ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}>{value.replaceAll("_", " ")}</Badge>;
}

function Loading() { return <div aria-label="Loading operations" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-28" key={index} />)}</div>; }
function date(value: string | null): string { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value)) : "Never"; }
async function get<T>(path: string): Promise<T> { const response = await fetch(`/v1/admin/${path}`); const body = await response.json() as Envelope<T>; if (!response.ok || !body.success) throw new Error(body.message); return body.payload; }
