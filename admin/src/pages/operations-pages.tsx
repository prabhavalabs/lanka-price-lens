import { RiArrowLeftLine, RiArrowRightLine, RiCheckLine, RiCloseLine, RiExternalLinkLine, RiLoader4Line, RiLockLine, RiPlayLine, RiRestartLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { bytes, date, EmptyTableRow, Pagination, Status, TableControls, useTableState } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, listUrl, type KnowledgeItem, type Page, type Run, type RunWorkflow, type Source, type WorkflowStep } from "@/lib/api";
import { cn } from "@/lib/utils";

const runStatuses = [
  { label: "Running", value: "running" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Blocked", value: "blocked" },
];
const knowledgeStatuses = [
  { label: "Discovered", value: "discovered" },
  { label: "Archived", value: "stored" },
  { label: "Fetched", value: "fetched" },
  { label: "Parsed", value: "parsed" },
  { label: "Quarantined", value: "quarantined" },
];
const sourceStatuses = [
  { label: "Healthy", value: "healthy" },
  { label: "Paused", value: "paused" },
  { label: "Degraded", value: "degraded" },
  { label: "Blocked", value: "blocked" },
  { label: "Review required", value: "review_required" },
];

export function RunsPage() {
  const state = useTableState();
  const queryClient = useQueryClient();
  const runs = useQuery({
    queryKey: ["runs", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<Run>>(listUrl("/v1/admin/runs", state), { signal }),
    placeholderData: keepPreviousData,
  });
  const sync = useMutation({
    mutationFn: () => api<{ id: string }>("/v1/admin/ingestion/sync", { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-base"] }),
      ]);
    },
  });
  return (
    <PageFrame description="Two linked workflows: archive newly published PDFs, then process each new document into validated records." title="Workflows">
      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <Card size="sm">
          <CardHeader>
            <CardTitle>1. Source synchronisation</CardTitle>
            <CardDescription>Daily at 18:00 Asia/Colombo. Compares the official source with database and R2 inventory.</CardDescription>
            <CardAction>
              <Button disabled={sync.isPending} onClick={() => sync.mutate()} size="sm">
                {sync.isPending ? <RiLoader4Line className="animate-spin" data-icon="inline-start" /> : <RiPlayLine data-icon="inline-start" />}
                {sync.isPending ? "Starting…" : "Run now"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {["Check source", "Compare inventory", "Download new", "Upload R2", "Record metadata"].map((step) => <Badge key={step} variant="outline">{step}</Badge>)}
          </CardContent>
        </Card>
        <div className="hidden items-center text-muted-foreground lg:flex"><RiArrowRightLine aria-hidden /></div>
        <Card size="sm">
          <CardHeader>
            <CardTitle>2. PDF processing</CardTitle>
            <CardDescription>Triggered once for every newly archived PDF, with dependency-aware retry at each processing step.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {["Retrieve", "Parse", "Extract", "Validate", "Insert"].map((step) => <Badge key={step} variant="outline">{step}</Badge>)}
          </CardContent>
        </Card>
      </div>
      {sync.isError ? <Alert variant="destructive"><AlertTitle>Source sync did not start</AlertTitle><AlertDescription>{sync.error.message}</AlertDescription></Alert> : null}
      {runs.isPending ? <Skeleton className="h-80 rounded-xl" /> : runs.isError ? <Alert variant="destructive">{runs.error.message}</Alert> : (
        <Card>
          <CardHeader><CardTitle>Execution history</CardTitle><CardDescription>{runs.data.total} workflow {runs.data.total === 1 ? "execution" : "executions"} found</CardDescription></CardHeader>
          <TableControls placeholder="Search workflow, trigger, status, or error…" state={state} statuses={runStatuses} />
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Workflow</TableHead><TableHead className="hidden sm:table-cell">Trigger</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">PDFs</TableHead><TableHead className="hidden lg:table-cell">Records</TableHead></TableRow></TableHeader>
              <TableBody>{runs.data.items.length ? runs.data.items.map((run) => <TableRow key={run.id}><TableCell className="text-muted-foreground"><Link className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" to={run.id}>{date(run.started_at)}</Link><span className="mt-1 block text-xs capitalize text-foreground sm:hidden">{run.trigger}</span></TableCell><TableCell><span className="text-xs font-medium">{workflowTitle(run.workflow)}</span></TableCell><TableCell className="hidden capitalize sm:table-cell">{run.trigger}</TableCell><TableCell><Status value={run.status} /></TableCell><TableCell className="hidden font-mono md:table-cell">{run.fetched_count}/{run.discovered_count || 1}</TableCell><TableCell className="hidden font-mono lg:table-cell">{run.parsed_count}</TableCell></TableRow>) : <EmptyTableRow columns={6} />}</TableBody>
            </Table>
            <Pagination page={runs.data.page} pageSize={runs.data.pageSize} pages={runs.data.pages} pending={runs.isPlaceholderData} total={runs.data.total} />
          </CardContent>
        </Card>
      )}
    </PageFrame>
  );
}

const workflowLabels: Partial<Record<WorkflowStep["stage"], { title: string; description: string }>> = {
  check_source: { title: "Check official source", description: "Discover the complete current source publication list" },
  compare_inventory: { title: "Compare PDF inventory", description: "Compare source PDFs with database and R2 records" },
  download_new_pdfs: { title: "Download new PDFs", description: "Download only documents missing from both inventories" },
  upload_to_r2: { title: "Upload PDFs to R2", description: "Store new source documents in the private archive" },
  record_pdf_metadata: { title: "Record PDF metadata", description: "Persist source, storage, checksum, and execution metadata" },
  retrieve_pdf: { title: "Retrieve PDF", description: "Retrieve and verify the archived document from R2" },
  parse_pdf: { title: "Parse PDF", description: "Read the document layout and positional text" },
  extract_data: { title: "Extract structured data", description: "Convert parsed text into machine-readable records" },
  validate_data: { title: "Validate extracted data", description: "Check structure, dates, and numeric values" },
  insert_data: { title: "Insert validated data", description: "Commit validated records to the operational database" },
  crawl: { title: "Crawl source", description: "Discover current source publications" },
  download: { title: "Download PDFs", description: "Retain the source documents" },
  process: { title: "Extract & process", description: "Read PDF text and build records" },
  validate: { title: "Validate data", description: "Check structure, dates, and values" },
  store: { title: "Store results", description: "Commit validated records" },
};

function stepLabel(stage: WorkflowStep["stage"]): { title: string; description: string } {
  return workflowLabels[stage] ?? {
    title: stage.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase()),
    description: "Legacy workflow step",
  };
}

function workflowTitle(workflow: Run["workflow"]): string {
  if (workflow === "source_sync") return "Source synchronisation";
  if (workflow === "pdf_processing") return "PDF processing";
  return "Legacy ingestion";
}

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const [parameters, setParameters] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflow = useQuery({
    queryKey: ["run-workflow", runId],
    queryFn: async ({ signal }) => normalizeWorkflow(await api<RawWorkflow>(`/v1/admin/runs/${encodeURIComponent(runId)}`, { signal })),
    enabled: Boolean(runId),
    refetchInterval: (query) => query.state.data?.run.status === "running" ? 2_000 : false,
  });
  const retry = useMutation({
    mutationFn: (stage: WorkflowStep["stage"]) => api<{ run_id: string; stage: string }>(`/v1/admin/runs/${encodeURIComponent(runId)}/stages/${stage}/retry`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["run-workflow", runId] }),
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
  });
  const rerun = useMutation({
    mutationFn: () => api<{ id: string }>(`/v1/admin/runs/${encodeURIComponent(runId)}/rerun`, { method: "POST" }),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${run.id}`);
    },
  });
  const requestedStage = parameters.get("step");
  const selected = workflow.data?.stages.find((stage) => stage.stage === requestedStage)
    ?? workflow.data?.stages.find((stage) => stage.status === "failed")
    ?? workflow.data?.stages[0];
  const selectStage = (stage: WorkflowStep["stage"]) => {
    const next = new URLSearchParams(parameters);
    next.set("step", stage);
    setParameters(next);
  };

  return (
    <PageFrame description="Follow every dependency, inspect step inputs and outputs, and retry failures safely." title={workflow.data ? `${workflowTitle(workflow.data.run.workflow)} execution` : "Workflow execution"}>
      <Button asChild size="sm" variant="ghost"><Link to="/runs"><RiArrowLeftLine data-icon="inline-start" />Back to runs</Link></Button>
      {workflow.isPending ? <Skeleton className="h-[36rem] rounded-xl" /> : workflow.isError ? <Alert variant="destructive"><AlertTitle>Workflow unavailable</AlertTitle><AlertDescription>{workflow.error.message}</AlertDescription></Alert> : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{workflowTitle(workflow.data.run.workflow)} <Status value={workflow.data.run.status} /></CardTitle>
              <CardDescription>{workflow.data.run.source_id} · {workflow.data.run.trigger} · Started {date(workflow.data.run.started_at)}{workflow.data.run.parent_run_id ? <> · <Link className="underline-offset-4 hover:underline" to={`/runs/${workflow.data.run.parent_run_id}`}>Parent source sync</Link></> : null}</CardDescription>
              <CardAction className="flex items-center gap-3"><span className="font-mono text-xs text-muted-foreground">{durationBetween(workflow.data.run.started_at, workflow.data.run.finished_at)}</span><Button disabled={rerun.isPending} onClick={() => rerun.mutate()} size="sm" variant="outline"><RiRestartLine className={cn(rerun.isPending && "animate-spin")} data-icon="inline-start" />{rerun.isPending ? "Starting…" : "Rerun workflow"}</Button></CardAction>
            </CardHeader>
            <CardContent>
              <ScrollArea className="w-full pb-3">
                <div className="flex min-w-max items-stretch gap-2 pb-3">
                  {workflow.data.stages.map((stage, index) => (
                    <div className="flex items-center gap-2" key={stage.stage}>
                      <Button
                        aria-pressed={selected?.stage === stage.stage}
                        className={cn("h-auto w-52 items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left", selected?.stage === stage.stage && "border-primary/60 bg-primary/10")}
                        onClick={() => selectStage(stage.stage)}
                        variant="outline"
                      >
                        <StepIcon status={stage.status} />
                        <span className="min-w-0"><span className="block font-semibold">{stepLabel(stage.stage).title}</span><span className="mt-1 block text-[11px] font-normal leading-4 text-muted-foreground">{stage.status === "blocked" && stage.missing_dependencies.length ? `Waiting for ${stage.missing_dependencies.join(", ")}` : formatDuration(stage.duration_ms)}</span></span>
                      </Button>
                      {index < workflow.data.stages.length - 1 ? <RiArrowRightLine aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>
          {workflow.data.children.length ? <Card size="sm"><CardHeader><CardTitle>Triggered PDF-processing executions</CardTitle><CardDescription>{workflow.data.children.length} new PDF {workflow.data.children.length === 1 ? "workflow was" : "workflows were"} started by this source sync.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{workflow.data.children.map((child) => <Button asChild className="h-auto justify-between px-3 py-2" key={child.id} variant="outline"><Link to={`/runs/${child.id}`}><span className="truncate">{child.archive_id ?? child.id}</span><Status value={child.status} /></Link></Button>)}</CardContent></Card> : null}
          {selected ? <StepInspector mutationError={retry.error?.message ?? null} pending={retry.isPending && retry.variables === selected.stage} retry={() => retry.mutate(selected.stage)} stage={selected} /> : null}
          {rerun.isError ? <Alert variant="destructive"><AlertTitle>Workflow rerun did not start</AlertTitle><AlertDescription>{rerun.error.message}</AlertDescription></Alert> : null}
        </>
      )}
    </PageFrame>
  );
}

type RawWorkflow = { run: Run; stages: Array<Partial<WorkflowStep> & { stage: string; status: string }>; children: Run[] };

function normalizeWorkflow(data: RawWorkflow): RunWorkflow {
  const stages = data.stages.map((row) => {
    const stage = row.stage as WorkflowStep["stage"];
    const startedAt = typeof row?.started_at === "string" ? row.started_at : null;
    const finishedAt = typeof row?.finished_at === "string" ? row.finished_at : null;
    return {
      stage,
      status: row?.status ?? "blocked",
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: typeof row?.duration_ms === "number" ? row.duration_ms : startedAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null,
      input_count: row?.input_count ?? 0,
      output_count: row?.output_count ?? 0,
      warning_count: row?.warning_count ?? 0,
      attempt_count: row?.attempt_count ?? (row ? 1 : 0),
      error_code: row?.error_code ?? null,
      error_message: row?.error_message ?? (row ? null : "No execution data is available for this step"),
      input: row?.input ?? null,
      output: row?.output ?? null,
      can_retry: row?.can_retry ?? false,
      retry_reason: row?.retry_reason ?? null,
      missing_dependencies: row?.missing_dependencies ?? [],
      logs: row?.logs ?? [],
      log_count: row?.log_count ?? 0,
    } satisfies WorkflowStep;
  });
  return { run: data.run, stages, children: data.children ?? [] };
}

function StepInspector({ stage, retry, pending, mutationError }: { stage: WorkflowStep; retry: () => void; pending: boolean; mutationError: string | null }) {
  const label = stepLabel(stage.stage);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">{label.title} <Status value={stage.status} /></CardTitle>
        <CardDescription>{label.description}</CardDescription>
        <CardAction>
          <Button disabled={!stage.can_retry || pending} onClick={retry} size="sm" title={stage.retry_reason ?? "Retry this step"} variant="outline">
            <RiRestartLine className={cn(pending && "animate-spin")} data-icon="inline-start" />{pending ? "Starting…" : "Retry step"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Duration" value={formatDuration(stage.duration_ms)} />
          <Metric label="Attempts" value={String(stage.attempt_count ?? 0)} />
          <Metric label="Input records" value={String(stage.input_count ?? 0)} />
          <Metric label="Output records" value={String(stage.output_count ?? 0)} />
        </div>
        {stage.error_message ? <Alert variant="destructive"><RiCloseLine /><AlertTitle>{stage.error_code ?? "Step failed"}</AlertTitle><AlertDescription>{stage.error_message}</AlertDescription></Alert> : null}
        {stage.retry_reason && !stage.can_retry ? <Alert><RiLockLine /><AlertTitle>Retry unavailable</AlertTitle><AlertDescription>{stage.retry_reason}</AlertDescription></Alert> : null}
        {mutationError ? <Alert variant="destructive"><AlertTitle>Retry did not start</AlertTitle><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonPanel title="Input" value={stage.input} />
          <JsonPanel title="Output" value={stage.output} />
        </div>
        <Separator />
        <div>
          <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-heading text-sm font-semibold">Execution logs</h3><Badge variant="outline">{stage.log_count} entries</Badge></div>
          <ScrollArea className="h-72 rounded-lg border bg-background/40">
            <div className="divide-y divide-border">
              {stage.logs.length ? stage.logs.map((log) => <div className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_5rem_1fr] sm:gap-3" key={log.id}><time className="font-mono text-[10px] text-muted-foreground">{date(log.created_at)}</time><Badge className="self-start" variant={log.level === "error" ? "destructive" : log.level === "warning" ? "secondary" : "outline"}>{log.level}</Badge><div className="min-w-0"><p className="text-xs font-medium">{log.message}</p>{log.data !== null ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-muted-foreground">{formatJson(log.data)}</pre> : null}</div></div>) : <p className="p-6 text-center text-xs text-muted-foreground">No structured logs were recorded for this step.</p>}
            </div>
          </ScrollArea>
          {stage.log_count > stage.logs.length ? <p className="mt-2 text-[10px] text-muted-foreground">Showing the latest {stage.logs.length} entries.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-background/40 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-medium">{value}</p></div>;
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return <div><h3 className="mb-2 font-heading text-sm font-semibold">{title}</h3><ScrollArea className="h-44 rounded-lg border bg-background/40"><pre className="p-4 font-mono text-[11px] leading-5 text-muted-foreground">{formatJson(value)}</pre></ScrollArea></div>;
}

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><RiCheckLine className="size-4" /></span>;
  if (status === "running") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><RiLoader4Line className="size-4 animate-spin" /></span>;
  if (status === "failed") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"><RiCloseLine className="size-4" /></span>;
  return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><RiLockLine className="size-4" /></span>;
}

function formatJson(value: unknown): string {
  return value === null || value === undefined ? "No data recorded" : JSON.stringify(value, null, 2);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "Not completed";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function durationBetween(startedAt: string, finishedAt: string | null): string {
  return formatDuration(Math.max(0, Date.parse(finishedAt ?? new Date().toISOString()) - Date.parse(startedAt)));
}

export function KnowledgeBasePage() {
  const state = useTableState();
  const knowledge = useQuery({
    queryKey: ["knowledge-base", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<KnowledgeItem>>(listUrl("/v1/admin/knowledge-base", state), { signal }),
    placeholderData: keepPreviousData,
  });
  return (
    <PageFrame description="Every discovered source bulletin, with processing metadata and direct access to the original PDF." title="Knowledge Base">
      {knowledge.isPending ? <Skeleton className="h-80 rounded-xl" /> : knowledge.isError ? <Alert variant="destructive">{knowledge.error.message}</Alert> : (
        <Card>
          <CardHeader><CardTitle>Source documents</CardTitle><CardDescription>{knowledge.data.total} PDF {knowledge.data.total === 1 ? "document" : "documents"} found</CardDescription></CardHeader>
          <TableControls placeholder="Search title, URL, or checksum…" state={state} statuses={knowledgeStatuses} />
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Status</TableHead><TableHead className="hidden sm:table-cell">Published</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden lg:table-cell">Size</TableHead><TableHead className="hidden lg:table-cell">Parsed</TableHead></TableRow></TableHeader>
              <TableBody>{knowledge.data.items.length ? knowledge.data.items.map((item) => {
                const downloadable = /^https?:\/\//u.test(item.download_url);
                return <TableRow key={item.publication_id}><TableCell className="min-w-0">{downloadable ? <a className="group inline-flex max-w-64 items-center gap-1.5 font-medium text-foreground hover:text-primary sm:max-w-md" href={item.download_url} rel="noreferrer" target="_blank"><span className="truncate" title={item.title}>{item.title}</span><RiExternalLinkLine className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" /></a> : <p className="max-w-64 truncate font-medium sm:max-w-md" title={item.title}>{item.title}</p>}<p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.sha256 ? `${item.sha256.slice(0, 16)}…` : item.publication_id.replace("publication_", "")}</p><p className="mt-1 text-[11px] text-muted-foreground sm:hidden">{date(item.published_at)} · {item.pdf_type ?? "PDF"}</p></TableCell><TableCell><Status value={item.status} /></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{date(item.published_at)}</TableCell><TableCell className="hidden md:table-cell">{item.pdf_type ?? "PDF"}{item.page_count ? <span className="mt-1 block text-xs text-muted-foreground">{item.page_count} pages</span> : null}</TableCell><TableCell className="hidden font-mono lg:table-cell">{item.byte_size === null ? "Not cached" : bytes(item.byte_size)}</TableCell><TableCell className="hidden font-mono lg:table-cell">{item.parsed_count}</TableCell></TableRow>;
              }) : <EmptyTableRow columns={6} />}</TableBody>
            </Table>
            <Pagination page={knowledge.data.page} pageSize={knowledge.data.pageSize} pages={knowledge.data.pages} pending={knowledge.isPlaceholderData} total={knowledge.data.total} />
          </CardContent>
        </Card>
      )}
    </PageFrame>
  );
}

export function SourcesPage() {
  const state = useTableState();
  const sources = useQuery({
    queryKey: ["sources", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<Source>>(listUrl("/v1/admin/sources", state), { signal }),
    placeholderData: keepPreviousData,
  });
  return (
    <PageFrame description="Permission, cadence, and processing health for each configured source." title="Sources">
      {sources.isPending ? <Skeleton className="h-60 rounded-xl" /> : sources.isError ? <Alert variant="destructive">{sources.error.message}</Alert> : (
        <Card>
          <CardHeader><CardTitle>Configured sources</CardTitle><CardDescription>{sources.data.total} monitored {sources.data.total === 1 ? "source" : "sources"} found</CardDescription></CardHeader>
          <TableControls placeholder="Search source, owner, or rights…" state={state} statuses={sourceStatuses} />
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>State</TableHead><TableHead className="hidden sm:table-cell">Rights</TableHead><TableHead className="hidden lg:table-cell">Review due</TableHead><TableHead className="hidden md:table-cell">Last parsed</TableHead></TableRow></TableHeader>
              <TableBody>{sources.data.items.length ? sources.data.items.map((source) => <TableRow key={source.id}><TableCell><p className="max-w-56 truncate font-medium">{source.name}</p><p className="mt-1 text-xs text-muted-foreground">{source.owner}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground sm:hidden">{source.rights_status}</p></TableCell><TableCell><Status value={source.state} /></TableCell><TableCell className="hidden font-mono text-xs sm:table-cell">{source.rights_status}</TableCell><TableCell className="hidden text-muted-foreground lg:table-cell">{date(source.review_due_at)}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{date(source.last_parse_at)}</TableCell></TableRow>) : <EmptyTableRow columns={5} />}</TableBody>
            </Table>
            <Pagination page={sources.data.page} pageSize={sources.data.pageSize} pages={sources.data.pages} pending={sources.isPlaceholderData} total={sources.data.total} />
          </CardContent>
        </Card>
      )}
    </PageFrame>
  );
}

function PageFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 lg:gap-6"><div><h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1><p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{description}</p></div>{children}</div>;
}
