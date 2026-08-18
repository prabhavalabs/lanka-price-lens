import { RiAlertLine, RiArchiveLine, RiDatabase2Line, RiHistoryLine, RiRefreshLine, RiUploadCloud2Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { bytes, date, Status } from "@/components/data-display";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Overview, type Page, type Pdf, type Quarantine, type Run, type Source } from "@/lib/api";

type Dashboard = { overview: Overview; sources: Source[]; runs: Page<Run>; pdfs: Page<Pdf>; quarantine: Quarantine[] };
type UploadValues = { file: FileList };

async function dashboard(): Promise<Dashboard> {
  const [overview, sources, runs, pdfs, quarantine] = await Promise.all([
    api<Overview>("/v1/admin/overview"),
    api<Source[]>("/v1/admin/sources"),
    api<Page<Run>>("/v1/admin/runs?page=1&pageSize=6"),
    api<Page<Pdf>>("/v1/admin/uploads?page=1&pageSize=6"),
    api<Quarantine[]>("/v1/admin/quarantine"),
  ]);
  return { overview, sources, runs, pdfs, quarantine };
}

export function OverviewPage() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["dashboard"], queryFn: dashboard, refetchInterval: (query) => query.state.data?.overview.running ? 5_000 : false });
  const uploadForm = useForm<UploadValues>();
  const ingestion = useMutation({
    mutationFn: (mode: "backfill" | "sync") => api<{ id: string }>(`/v1/admin/ingestion/${mode}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return api<{ status: string; parsedCount: number }>("/v1/admin/uploads", { method: "POST", body });
    },
    onSuccess: () => {
      uploadForm.reset();
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (data.isPending) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-28" key={index} />)}</div>;
  if (data.isError) return <Alert variant="destructive">{data.error.message}</Alert>;
  const active = data.data.runs.items.find((run) => run.status === "running");

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-primary">Operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Data foundry overview</h1><p className="mt-1 text-sm text-muted-foreground">Monitor the source pipeline, review exceptions, and control ingestion.</p></div>
      <section aria-label="Operational summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<RiDatabase2Line />} label="PDF records" value={data.data.overview.pdfs} />
        <Metric icon={<RiHistoryLine />} label="Running now" value={data.data.overview.running} />
        <Metric icon={<RiAlertLine />} label="Failed runs" value={data.data.overview.failed} />
        <Metric icon={<RiArchiveLine />} label="Open quarantine" value={data.data.overview.quarantined} />
      </section>
      <Card><CardHeader><CardTitle className="font-heading">Automated ingestion</CardTitle><CardDescription>Run the historical import once, then let the daily incremental scheduler maintain coverage.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div>{active ? <p className="text-sm">Running <strong>{active.trigger}</strong>: {active.fetched_count} PDFs fetched, {active.parsed_count} observations parsed.</p> : <p className="text-sm text-muted-foreground">No ingestion is currently running.</p>}{ingestion.isError ? <p className="mt-2 text-sm text-destructive">{ingestion.error.message}</p> : null}</div><div className="flex flex-wrap gap-2"><Button disabled={Boolean(active) || ingestion.isPending} onClick={() => { if (window.confirm("Start the rate-limited full archive import?")) ingestion.mutate("backfill"); }}><RiHistoryLine />Ingest full archive</Button><Button disabled={Boolean(active) || ingestion.isPending} onClick={() => ingestion.mutate("sync")} variant="outline"><RiRefreshLine />Check for updates</Button></div></CardContent></Card>
      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Card><CardHeader><CardTitle className="font-heading">Manual PDF intake</CardTitle><CardDescription>Inspect one HARTI bulletin without waiting for discovery.</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={uploadForm.handleSubmit(({ file }) => upload.mutate(file[0]!))}><div className="space-y-2"><Label htmlFor="pdf-file">PDF file</Label><Input accept=".pdf,application/pdf" id="pdf-file" type="file" {...uploadForm.register("file", { required: "Choose a PDF", validate: (files) => files[0]?.size && files[0].size <= 20 * 1024 * 1024 ? true : "PDF must be 20 MiB or smaller" })} />{uploadForm.formState.errors.file ? <p className="text-xs text-destructive">{uploadForm.formState.errors.file.message}</p> : null}</div><Button disabled={upload.isPending} type="submit"><RiUploadCloud2Line />{upload.isPending ? "Inspecting…" : "Upload and inspect"}</Button>{upload.isSuccess ? <p className="text-sm text-emerald-700">{upload.data.parsedCount} observations extracted.</p> : null}{upload.isError ? <p className="text-sm text-destructive">{upload.error.message}</p> : null}</form></CardContent></Card>
        <Card><CardHeader><CardTitle className="font-heading">Recent PDFs</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead>Parsed</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{data.data.pdfs.items.map((pdf) => <TableRow key={pdf.artifact_id}><TableCell><p className="max-w-72 truncate font-medium" title={pdf.original_filename}>{pdf.original_filename}</p><p className="text-xs text-muted-foreground">{bytes(pdf.byte_size)} · {pdf.page_count ?? "?"} pages</p></TableCell><TableCell><Status value={pdf.status} /></TableCell><TableCell>{pdf.parsed_count}</TableCell><TableCell>{date(pdf.fetched_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Card><CardHeader><CardTitle className="font-heading">Recent runs</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead>PDFs</TableHead><TableHead>Observations</TableHead></TableRow></TableHeader><TableBody>{data.data.runs.items.map((run) => <TableRow key={run.id}><TableCell>{date(run.started_at)}</TableCell><TableCell>{run.trigger}</TableCell><TableCell><Status value={run.status} /></TableCell><TableCell>{run.fetched_count}/{run.discovered_count}</TableCell><TableCell>{run.parsed_count}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle className="font-heading">Source status</CardTitle></CardHeader><CardContent className="space-y-3">{data.data.sources.map((source) => <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0" key={source.id}><div><p className="text-sm font-medium">{source.name}</p><p className="text-xs text-muted-foreground">Last parsed {date(source.last_parse_at)}</p></div><Status value={source.state} /></div>)}</CardContent></Card>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">{label}</p><p className="font-heading mt-1 text-3xl font-semibold">{value}</p></div><div className="grid size-11 place-items-center bg-primary/10 text-primary [&_svg]:size-5">{icon}</div></CardContent></Card>;
}
