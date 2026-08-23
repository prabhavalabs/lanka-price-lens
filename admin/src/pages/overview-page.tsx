import { RiAlertLine, RiFilePdf2Line, RiHistoryLine, RiPlayCircleLine, RiRefreshLine, RiShieldLine, RiUploadCloud2Line } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { bytes, date, Status } from "@/components/data-display";
import { Alert } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type KnowledgeListItem, type Overview, type Page, type Run, type Source } from "@/lib/api";

type Dashboard = { overview: Overview; sources: Page<Source>; runs: Page<Run>; knowledge: Page<KnowledgeListItem> };
type UploadValues = { file: FileList };

async function dashboard(): Promise<Dashboard> {
  const [overview, sources, runs, knowledge] = await Promise.all([
    api<Overview>("/v1/admin/overview"),
    api<Page<Source>>("/v1/admin/sources?page=1&pageSize=6"),
    api<Page<Run>>("/v1/admin/runs?page=1&pageSize=6"),
    api<Page<KnowledgeListItem>>("/v1/admin/knowledge-base?page=1&pageSize=6"),
  ]);
  return { overview, sources, runs, knowledge };
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
      return api<{ status: string; parsedCount: number; archiveId: string | null; dispatchId: string | null }>("/v1/admin/uploads", { method: "POST", body });
    },
    onSuccess: () => {
      uploadForm.reset();
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-dispatches"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
    },
  });

  if (data.isPending) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-32 rounded-xl" key={index} />)}</div>;
  if (data.isError) return <Alert variant="destructive">{data.error.message}</Alert>;
  const active = data.data.runs.items.find((run) => run.status === "running");

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-[28px]">Data foundry overview</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Monitor the source pipeline, review exceptions, and control ingestion.</p>
      </div>

      <section aria-label="Operational summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <Metric icon={<RiFilePdf2Line />} label="Knowledge records" value={data.data.overview.pdfs} />
        <Metric icon={<RiPlayCircleLine />} label="Running now" value={data.data.overview.running} />
        <Metric icon={<RiAlertLine />} label="Failed runs" tone="warning" value={data.data.overview.failed} />
        <Metric icon={<RiShieldLine />} label="Open quarantine" value={data.data.overview.quarantined} />
      </section>

      <Card>
        <CardContent className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex gap-3">
            <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><RiRefreshLine className="size-5" /></div>
            <div>
              <h2 className="font-heading text-base font-semibold">Automated ingestion</h2>
              {active ? <p className="mt-1.5 text-sm text-muted-foreground">Running <strong className="text-foreground">{active.trigger}</strong>: {active.fetched_count} PDFs fetched, {active.parsed_count} observations parsed.</p> : <p className="mt-1.5 text-sm text-muted-foreground">No ingestion is currently running.</p>}
              {ingestion.isError ? <p className="mt-2 text-sm text-destructive">{ingestion.error.message}</p> : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:flex">
            <AlertDialog>
              <AlertDialogTrigger asChild><Button disabled={Boolean(active) || ingestion.isPending} size="lg"><RiHistoryLine data-icon="inline-start" />Ingest full archive</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Ingest the full archive?</AlertDialogTitle><AlertDialogDescription>This starts a rate-limited import of every available source publication. It may run for a while.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => ingestion.mutate("backfill")}>Start import</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button disabled={Boolean(active) || ingestion.isPending} onClick={() => ingestion.mutate("sync")} size="lg" variant="outline"><RiRefreshLine data-icon="inline-start" />Check for updates</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><RiUploadCloud2Line className="size-5" /></div>
            <div><CardTitle>Manual PDF intake</CardTitle><CardDescription>Archive one HARTI bulletin and queue its monitored processing workflow.</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={uploadForm.handleSubmit(({ file }) => upload.mutate(file[0]!))}>
            <FieldGroup className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <Field data-invalid={Boolean(uploadForm.formState.errors.file)}><FieldLabel htmlFor="pdf-file">PDF file</FieldLabel><Input accept=".pdf,application/pdf" aria-invalid={Boolean(uploadForm.formState.errors.file)} id="pdf-file" type="file" {...uploadForm.register("file", { required: "Choose a PDF", validate: (files) => files[0]?.size && files[0].size <= 20 * 1024 * 1024 ? true : "PDF must be 20 MiB or smaller" })} /><FieldError errors={[uploadForm.formState.errors.file]} /></Field>
              <Button className="w-full lg:w-auto" disabled={upload.isPending} size="lg" type="submit"><RiUploadCloud2Line data-icon="inline-start" />{upload.isPending ? "Uploading…" : "Upload and process"}</Button>
            </FieldGroup>
          </form>
          {upload.isSuccess ? <p className="mt-3 text-sm text-emerald-400">{upload.data.status === "duplicate" ? "This PDF already exists; no duplicate workflow was queued." : `${upload.data.parsedCount} observations extracted. The archived PDF processing workflow is queued.`}</p> : null}
          {upload.isError ? <p className="mt-3 text-sm text-destructive">{upload.error.message}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_1fr_0.82fr]">
        <Card>
          <PanelHeader title="Recent knowledge" to="/knowledge-base" />
          <CardContent className="divide-y divide-white/[0.07] p-0">
            {data.data.knowledge.items.slice(0, 4).map((item) => <div className="flex items-center justify-between gap-3 px-4 py-3" key={item.publication_id}><div className="min-w-0"><Link className="block truncate text-[13px] font-medium underline-offset-4 hover:text-primary hover:underline" title={item.title} to={`/knowledge-base/${encodeURIComponent(item.publication_id)}`}>{item.title}</Link><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.byte_size === null ? "Not cached" : bytes(item.byte_size)} · {item.page_count ?? "?"} pages · {date(item.published_at)}</p></div><Status value={item.status} /></div>)}
          </CardContent>
        </Card>

        <Card>
          <PanelHeader title="Recent workflow executions" to="/runs" />
          <CardContent className="divide-y divide-white/[0.07] p-0">
            {data.data.runs.items.slice(0, 4).map((run) => <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3" key={run.id}><div><p className="text-[13px]">{run.workflow === "pdf_processing" ? "PDF processing" : run.workflow === "source_sync" ? "Source synchronisation" : "Legacy ingestion"}</p><p className="mt-1 text-[10px] text-muted-foreground">{date(run.started_at)} · {run.trigger}</p></div><Status value={run.status} /><span className="font-mono text-xs text-muted-foreground">{run.parsed_count}</span></div>)}
          </CardContent>
        </Card>

        <Card>
          <PanelHeader title="Source status" to="/sources" />
          <CardContent className="space-y-1">
            {data.data.sources.items.map((source) => <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] py-3 last:border-0" key={source.id}><div className="min-w-0"><p className="text-sm font-medium leading-5">{source.name}</p><p className="mt-1 text-xs text-muted-foreground">Last parsed {date(source.last_parse_at)}</p></div><Status value={source.state} /></div>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: number; tone?: "default" | "warning" }) {
  return <Card className="min-h-28"><CardContent className="flex h-full items-center gap-2 p-3 sm:gap-4 sm:p-5"><div className={tone === "warning" ? "grid size-9 shrink-0 place-items-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 sm:size-11" : "grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 sm:size-11"}>{icon}</div><div className="min-w-0"><p className="text-[11px] leading-4 text-muted-foreground sm:text-sm">{label}</p><p className="mt-1 font-mono text-2xl font-medium tracking-tight sm:text-3xl">{value}</p></div></CardContent></Card>;
}

function PanelHeader({ title, to }: { title: string; to: string }) {
  return <CardHeader className="border-b border-white/[0.07]"><div className="flex items-center justify-between gap-4"><CardTitle>{title}</CardTitle><Button asChild size="sm" variant="ghost"><Link to={to}>View all</Link></Button></div></CardHeader>;
}
