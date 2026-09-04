import {
  RiAlertLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCalendarScheduleLine,
  RiCheckLine,
  RiCloseLine,
  RiDatabase2Line,
  RiExternalLinkLine,
  RiFilePdf2Line,
  RiHistoryLine,
  RiStore2Line,
  RiLoader4Line,
  RiLockLine,
  RiPlayLine,
  RiRestartLine,
  RiShieldCheckLine,
  RiTimeLine,
} from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { AdapterPanel } from "@/components/adapter-panel";
import { compactNumber, wholeNumber } from "@/components/charts";
import { date, EmptyTableRow, PageFrame, Pagination, Status, TableControls, useTableState } from "@/components/data-display";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, listUrl, type Page, type Run, type RunWorkflow, type SchedulerMonitor, type Source, type WorkflowDefinition, type WorkflowDispatch, type WorkflowKey, type WorkflowStep } from "@/lib/api";
import { cn } from "@/lib/utils";

const runStatuses = [
  { label: "Running", value: "running" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Blocked", value: "blocked" },
];
const sourceStatuses = [
  { label: "Healthy", value: "healthy" },
  { label: "Paused", value: "paused" },
  { label: "Degraded", value: "degraded" },
  { label: "Blocked", value: "blocked" },
  { label: "Review required", value: "review_required" },
];

const automationIcons: Record<WorkflowKey, typeof RiHistoryLine> = {
  latest_document_collection: RiCalendarScheduleLine,
  historical_backfill: RiHistoryLine,
  document_processing_pipeline: RiDatabase2Line,
  retail_price_capture: RiStore2Line,
};
const automationPlainNames: Record<WorkflowKey, string> = {
  latest_document_collection: "Collect new bulletins",
  historical_backfill: "Fill gaps in the archive",
  document_processing_pipeline: "Extract prices from bulletins",
  retail_price_capture: "Capture supermarket prices",
};
const automationPlainSummaries: Record<WorkflowKey, string> = {
  latest_document_collection: "Looks at the HARTI website for bulletins published since the last check and downloads any that are missing.",
  historical_backfill: "Walks back through HARTI's history and downloads older bulletins the archive does not have yet, a few at a time.",
  document_processing_pipeline: "Reads each archived PDF, pulls out the price table, checks it, and saves the prices so they show up in Price insights.",
  retail_price_capture: "Every morning, reads the shelf prices listed by each supermarket's online store, keeps the snapshot as evidence, and saves the mapped items as retail prices.",
};

export function RunsPage() {
  const state = useTableState();
  const [parameters, setParameters] = useSearchParams();
  const queryClient = useQueryClient();
  const view = parameters.get("view") === "history" ? "history" : parameters.get("view") === "cron" ? "cron" : "workflows";
  const runs = useQuery({
    queryKey: ["runs", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<Run>>(listUrl("/v1/admin/runs", state), { signal }),
    placeholderData: keepPreviousData,
    enabled: view === "history",
  });
  const workflows = useQuery({
    queryKey: ["workflow-definitions"],
    queryFn: ({ signal }) => api<WorkflowDefinition[]>("/v1/admin/workflows", { signal }),
    enabled: view === "workflows",
    refetchInterval: 10_000,
  });
  const monitor = useQuery({
    queryKey: ["workflow-schedules"],
    queryFn: ({ signal }) => api<SchedulerMonitor>("/v1/admin/workflow-schedules", { signal }),
    refetchInterval: 10_000,
  });
  const dispatches = useQuery({
    queryKey: ["workflow-dispatches", "latest"],
    queryFn: ({ signal }) => api<Page<WorkflowDispatch>>("/v1/admin/workflow-dispatches?page=1&pageSize=10", { signal }),
    enabled: view === "cron",
    refetchInterval: 5_000,
  });
  const runWorkflow = useMutation({
    mutationFn: (key: WorkflowKey) => api<WorkflowDispatch>(`/v1/admin/workflows/${key}/run`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all(["runs", "workflow-definitions", "workflow-dispatches", "overview", "knowledge-base", "dashboard"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
  });
  const toggleSchedule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api<{ id: string; enabled: boolean }>(`/v1/admin/workflow-schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["workflow-schedules"] }), queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] })]);
    },
  });
  const selectView = (nextView: typeof view) => {
    const next = new URLSearchParams(parameters);
    next.set("view", nextView);
    next.delete("page");
    next.delete("search");
    next.delete("status");
    setParameters(next);
  };
  const schedulerOnline = monitor.data?.instances.some((instance) => instance.healthy) ?? false;

  return (
    <PageFrame description="Four automations keep the data current: one collects new bulletins, one fills historical gaps, one extracts prices from them, and one captures supermarket shelf prices each morning. Each runs on a schedule and can also be started by hand." eyebrow="Operations" title="Automations">
      <Tabs onValueChange={(value) => selectView(value as typeof view)} value={view}>
        <TabsList aria-label="Automation views" className="w-full sm:w-fit" variant="line">
          <TabsTrigger value="workflows">Automations</TabsTrigger>
          <TabsTrigger value="history">Run history</TabsTrigger>
          <TabsTrigger value="cron">Scheduler</TabsTrigger>
        </TabsList>
      </Tabs>

      {monitor.isSuccess && !schedulerOnline ? (
        <Alert className="items-center *:[svg]:self-center *:[svg]:translate-y-0">
          <RiAlertLine />
          <AlertTitle>The scheduler is not running</AlertTitle>
          <AlertDescription>Scheduled automations will not start until it is. Manual runs are queued and will start as soon as it comes back. Locally, start it with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">pnpm dev:scheduler</code>.</AlertDescription>
        </Alert>
      ) : null}

      {view === "workflows" ? workflows.isPending ? <Skeleton className="h-96 rounded-xl" /> : workflows.isError ? <Alert variant="destructive"><AlertTitle>Automations unavailable</AlertTitle><AlertDescription>{workflows.error.message}</AlertDescription></Alert> : (
        <div className="grid gap-4 xl:grid-cols-3">
          {workflows.data.map((workflow) => <AutomationCard key={workflow.key} pending={runWorkflow.isPending && runWorkflow.variables === workflow.key} run={() => runWorkflow.mutate(workflow.key)} workflow={workflow} />)}
          {runWorkflow.isError ? <Alert className="xl:col-span-3" variant="destructive"><AlertTitle>The automation could not be queued</AlertTitle><AlertDescription>{runWorkflow.error.message}</AlertDescription></Alert> : null}
        </div>
      ) : null}

      {view === "history" ? runs.isPending ? <Skeleton className="h-80 rounded-xl" /> : runs.isError ? <Alert variant="destructive"><AlertTitle>Run history unavailable</AlertTitle><AlertDescription>{runs.error.message}</AlertDescription></Alert> : (
        <Card>
          <CardHeader>
            <CardTitle>Run history</CardTitle>
            <CardDescription>{runs.data.total} {runs.data.total === 1 ? "run" : "runs"} so far. Click a row to see every step, its inputs, outputs, and logs.</CardDescription>
          </CardHeader>
          <TableControls placeholder="Search by automation, trigger, or error message…" state={state} statuses={runStatuses} />
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Automation</TableHead><TableHead className="hidden sm:table-cell">Started by</TableHead><TableHead>Outcome</TableHead><TableHead className="hidden md:table-cell">Work done</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
              <TableBody>{runs.data.items.length ? runs.data.items.map((run) => (
                <TableRow className="cursor-pointer" key={run.id} onClick={() => window.location.assign(`/admin/runs/${run.id}`)}>
                  <TableCell><Link className="font-medium underline-offset-4 hover:underline" onClick={(event) => event.stopPropagation()} to={run.id}>{date(run.started_at)}</Link><span className="mt-1 block text-[11px] text-muted-foreground">{durationBetween(run.started_at, run.finished_at)}</span></TableCell>
                  <TableCell><span className="text-xs font-medium">{workflowTitle(run.workflow)}</span><span className="mt-0.5 block text-[11px] text-muted-foreground sm:hidden">{triggerLabel(run.trigger)}</span></TableCell>
                  <TableCell className="hidden sm:table-cell">{triggerLabel(run.trigger)}</TableCell>
                  <TableCell><Status value={run.status} />{run.error_message ? <span className="mt-1 block max-w-64 truncate text-[11px] text-destructive" title={run.error_message}>{run.error_message}</span> : null}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{workSummary(run)}</TableCell>
                  <TableCell className="text-right"><RiArrowRightLine className="size-4 text-muted-foreground" /></TableCell>
                </TableRow>
              )) : <EmptyTableRow columns={6} />}</TableBody>
            </Table>
            <Pagination page={runs.data.page} pageSize={runs.data.pageSize} pages={runs.data.pages} pending={runs.isPlaceholderData} total={runs.data.total} />
          </CardContent>
        </Card>
      ) : null}

      {view === "cron" ? monitor.isPending || dispatches.isPending ? <Skeleton className="h-96 rounded-xl" /> : monitor.isError || dispatches.isError ? <Alert variant="destructive"><AlertTitle>Scheduler details unavailable</AlertTitle><AlertDescription>{monitor.error?.message ?? dispatches.error?.message}</AlertDescription></Alert> : (
        <>
          <section className="grid gap-4 xl:grid-cols-[1fr_1.6fr]">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Scheduler</CardTitle>
                <CardDescription>The background service that starts automations on time and picks up manual requests. A heartbeat older than {monitor.data.stale_after_seconds} seconds means it has stopped.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-lg border bg-background/40 p-3">
                  <span className={cn("size-2.5 shrink-0 rounded-full", schedulerOnline ? "bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_25%,transparent)]" : "bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.2)]")} />
                  <div className="min-w-0"><p className="text-sm font-medium">{schedulerOnline ? "Online" : "Offline"}</p><p className="text-[11px] text-muted-foreground">{schedulerOnline ? "Automations will start on schedule." : "Nothing will start until it is running again."}</p></div>
                </div>
                {monitor.data.instances.length ? (
                  <ItemGroup>
                    {monitor.data.instances.map((instance, index) => (
                      <div key={instance.id}>
                        {index ? <ItemSeparator /> : null}
                        <Item className="px-0" size="sm">
                          <ItemContent>
                            <ItemTitle className="font-mono text-xs">{instance.id}</ItemTitle>
                            <ItemDescription>{instance.environment} · last heartbeat {relativeTime(instance.heartbeat_at)}{instance.last_error ? ` · ${instance.last_error}` : ""}</ItemDescription>
                          </ItemContent>
                          <ItemActions><Status value={instance.healthy ? "online" : "stale"} /></ItemActions>
                        </Item>
                      </div>
                    ))}
                  </ItemGroup>
                ) : <p className="text-xs text-muted-foreground">No scheduler has ever reported in.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Timetable</CardTitle>
                <CardDescription>When each automation runs. Switch one off to pause it; nothing already running is interrupted.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Automation</TableHead><TableHead>Runs</TableHead><TableHead>Next run</TableHead><TableHead className="text-right">Enabled</TableHead></TableRow></TableHeader>
                  <TableBody>{monitor.data.items.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell><span className="font-medium">{automationPlainNames[schedule.workflow_key]}</span><span className="block text-[11px] text-muted-foreground">{workflowTitleFromKey(schedule.workflow_key)}</span></TableCell>
                      <TableCell>{scheduleLabelFromKey(schedule.workflow_key)}<span className="block font-mono text-[10px] text-muted-foreground">{schedule.cron_expression} · {schedule.timezone}</span></TableCell>
                      <TableCell>{schedule.enabled ? <>{dateInZone(schedule.next_run_at, schedule.timezone)}<span className="block text-[11px] text-muted-foreground">{relativeTime(schedule.next_run_at)}</span></> : <span className="text-muted-foreground">Paused</span>}</TableCell>
                      <TableCell className="text-right"><div className="flex items-center justify-end gap-2"><Label className="text-[11px] text-muted-foreground" htmlFor={`schedule-${schedule.id}`}>{schedule.enabled ? "On" : "Off"}</Label><Switch aria-label={`${schedule.enabled ? "Pause" : "Resume"} ${automationPlainNames[schedule.workflow_key]}`} checked={Boolean(schedule.enabled)} disabled={toggleSchedule.isPending} id={`schedule-${schedule.id}`} onCheckedChange={(enabled) => toggleSchedule.mutate({ id: schedule.id, enabled })} /></div></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Recent requests</CardTitle>
              <CardDescription>Each row is one request to run an automation, whether from the timetable or a manual click. The scheduler works through them in order.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Scheduled for</TableHead><TableHead>Automation</TableHead><TableHead className="hidden sm:table-cell">Requested by</TableHead><TableHead>Status</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>{dispatches.data.items.length ? dispatches.data.items.map((dispatch) => (
                  <TableRow key={dispatch.id}>
                    <TableCell>{date(dispatch.scheduled_for)}<span className="block text-[11px] text-muted-foreground">{relativeTime(dispatch.scheduled_for)}</span></TableCell>
                    <TableCell>{automationPlainNames[dispatch.workflow_key]}</TableCell>
                    <TableCell className="hidden sm:table-cell">{triggerLabel(dispatch.trigger)}</TableCell>
                    <TableCell><Status value={dispatch.status} /></TableCell>
                    <TableCell>{dispatch.run_id ? <Button asChild size="sm" variant="outline"><Link to={`/runs/${dispatch.run_id}`}>Open run<RiArrowRightLine data-icon="inline-end" /></Link></Button> : <span className="text-xs text-muted-foreground">{dispatch.error_message ?? (dispatch.status === "succeeded" ? "Nothing new to do" : dispatch.status === "failed" ? "Failed before a run started" : dispatch.status === "skipped" ? "Skipped" : "Waiting for the scheduler")}</span>}</TableCell>
                  </TableRow>
                )) : <EmptyTableRow columns={5} />}</TableBody>
              </Table>
            </CardContent>
          </Card>
          {toggleSchedule.isError ? <Alert variant="destructive"><AlertTitle>The timetable was not updated</AlertTitle><AlertDescription>{toggleSchedule.error.message}</AlertDescription></Alert> : null}
        </>
      ) : null}
    </PageFrame>
  );
}

function AutomationCard({ workflow, pending, run }: { workflow: WorkflowDefinition; pending: boolean; run: () => void }) {
  const Icon = automationIcons[workflow.key];
  const lastStatus = workflow.schedule?.last_status ?? null;
  const running = workflow.schedule?.running_count ?? 0;
  const failed = workflow.schedule?.failed_count ?? 0;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary"><Icon className="size-5" /></span>
          <div className="min-w-0">
            <CardTitle>{automationPlainNames[workflow.key]}</CardTitle>
            <CardDescription className="mt-1">{automationPlainSummaries[workflow.key]}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {running ? <Badge variant="secondary"><RiLoader4Line className="animate-spin" data-icon="inline-start" />{running} running now</Badge> : null}
          {lastStatus ? <Badge variant={lastStatus === "failed" ? "destructive" : lastStatus === "succeeded" ? "default" : "outline"}>{lastStatus === "succeeded" ? <RiCheckLine data-icon="inline-start" /> : lastStatus === "failed" ? <RiCloseLine data-icon="inline-start" /> : null}Last run {lastStatus}</Badge> : <Badge variant="outline">Never run</Badge>}
          {failed ? <Tooltip><TooltipTrigger asChild><Badge variant="outline"><RiAlertLine data-icon="inline-start" />{failed} failed</Badge></TooltipTrigger><TooltipContent>Requests that failed before a run could start. See the Scheduler tab.</TooltipContent></Tooltip> : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <Fact icon={<RiCalendarScheduleLine />} label="Runs">{workflow.scheduleLabel} <span className="text-muted-foreground">({workflow.timezone})</span></Fact>
          <Fact icon={<RiTimeLine />} label="Next run">{workflow.schedule?.enabled ? <>{dateInZone(workflow.schedule.next_run_at, workflow.timezone)} <span className="text-muted-foreground">· {relativeTime(workflow.schedule.next_run_at)}</span></> : <span className="text-muted-foreground">Paused in the timetable</span>}</Fact>
          <Fact icon={<RiShieldCheckLine />} label="Limit">{workflow.key === "retail_price_capture" ? "One store per run, paced with pauses between page requests, so no retailer is overwhelmed" : `At most ${workflow.maxItems} bulletins per run, so one run never overwhelms HARTI or the database`}</Fact>
          <Fact icon={<RiHistoryLine />} label="Last finished">{workflow.schedule?.last_finished_at ? date(workflow.schedule.last_finished_at) : <span className="text-muted-foreground">Not yet</span>}</Fact>
        </dl>
        <Accordion collapsible type="single">
          <AccordionItem className="border-b-0" value="steps">
            <AccordionTrigger className="py-2 text-xs hover:no-underline">What it does, step by step ({workflow.steps.length} steps)</AccordionTrigger>
            <AccordionContent>
              <ol className="flex flex-col gap-2">
                {workflow.steps.map((step, index) => {
                  const label = stepLabel(step);
                  return <li className="flex gap-2.5" key={step}><span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px]">{index + 1}</span><span><span className="block text-xs font-medium">{label.title}</span><span className="block text-[11px] text-muted-foreground">{label.description}</span></span></li>;
                })}
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter className="mt-auto">
        {workflow.key === "document_processing_pipeline"
          ? <Button asChild className="w-full" variant="outline"><Link to="/knowledge-base"><RiFilePdf2Line data-icon="inline-start" />Pick a bulletin to extract</Link></Button>
          : <Button className="w-full" disabled={pending} onClick={run}>{pending ? <RiLoader4Line className="animate-spin" data-icon="inline-start" /> : <RiPlayLine data-icon="inline-start" />}{pending ? "Queueing…" : "Run now"}</Button>}
      </CardFooter>
    </Card>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <><dt className="flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5">{icon}{label}</dt><dd className="min-w-0">{children}</dd></>;
}

function workflowTitleFromKey(key: WorkflowKey): string {
  if (key === "latest_document_collection") return "Latest Document Collection";
  if (key === "historical_backfill") return "Historical Backfill";
  return "Document Processing Pipeline";
}

function scheduleLabelFromKey(key: WorkflowKey): string {
  if (key === "latest_document_collection") return "Every hour, at quarter past";
  if (key === "historical_backfill") return "Every night at 00:15";
  return "After each new bulletin, plus a sweep every 5 minutes";
}

function triggerLabel(trigger: string): string {
  if (trigger === "scheduled") return "Timetable";
  if (trigger === "manual") return "Manually";
  if (trigger === "backfill") return "Backfill request";
  return trigger.replaceAll("_", " ");
}

function workSummary(run: Run): string {
  const parts: string[] = [];
  if (run.discovered_count) parts.push(`${compactNumber.format(run.discovered_count)} bulletins seen`);
  if (run.fetched_count) parts.push(`${run.fetched_count} downloaded`);
  if (run.parsed_count) parts.push(`${wholeNumber.format(run.parsed_count)} prices extracted`);
  if (run.quarantined_count) parts.push(`${run.quarantined_count} rows held for review`);
  return parts.length ? parts.join(" · ") : "Nothing to do";
}

const workflowLabels: Partial<Record<WorkflowStep["stage"], { title: string; description: string }>> = {
  check_source: { title: "Check the HARTI website", description: "List every bulletin currently published on the source website" },
  compare_inventory: { title: "Compare with the archive", description: "Work out which bulletins the archive is still missing" },
  download_new_pdfs: { title: "Download missing bulletins", description: "Fetch only the PDFs that are not archived yet" },
  upload_to_r2: { title: "Store the PDFs", description: "Keep the originals in the private archive" },
  record_pdf_metadata: { title: "Record what was stored", description: "Save checksums, sizes, and where each PDF came from" },
  retrieve_pdf: { title: "Fetch the PDF", description: "Get the archived copy and verify its checksum" },
  parse_pdf: { title: "Read the PDF", description: "Read the page layout and the positions of every piece of text" },
  extract_data: { title: "Find the price table", description: "Turn the text into rows of product, market, and price" },
  validate_data: { title: "Check the rows", description: "Reject rows with impossible dates, prices, or structure" },
  insert_data: { title: "Save the rows", description: "Write the checked rows to the database" },
  assess_completeness: { title: "Score completeness", description: "Compare what was found with what this bulletin normally contains" },
  canonicalize_data: { title: "Publish the prices", description: "Map product and market names to the reviewed list so Price insights can use them" },
  fetch_snapshot: { title: "Fetch the store's prices", description: "Call the retailer's online store the same way its website does and collect every listed item" },
  normalize_records: { title: "Tidy the records", description: "Turn each listing into one row of product, pack size, and price" },
  validate_records: { title: "Check the snapshot", description: "Drop broken rows and hold the snapshot for review if it looks too small or very different from yesterday" },
  store_snapshot: { title: "Store the snapshot", description: "Keep the raw snapshot as evidence and save the rows, skipping it when prices are unchanged" },
  crawl: { title: "Crawl source", description: "Discover current source publications" },
  download: { title: "Download PDFs", description: "Retain the source documents" },
  process: { title: "Extract and process", description: "Read PDF text and build records" },
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
  if (workflow === "source_sync") return "Collect bulletins";
  if (workflow === "pdf_processing") return "Extract prices";
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
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["run-workflow", runId] }), queryClient.invalidateQueries({ queryKey: ["runs"] }), queryClient.invalidateQueries({ queryKey: ["overview"] })]);
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
  const run = workflow.data?.run;
  const failedStage = workflow.data?.stages.find((stage) => stage.status === "failed");

  return (
    <PageFrame description="Every step this run went through, with what went in, what came out, and the log of what happened." eyebrow="Automations" title={run ? `${workflowTitle(run.workflow)} · ${date(run.started_at)}` : "Run"}>
      <div><Button asChild size="sm" variant="ghost"><Link to="/runs?view=history"><RiArrowLeftLine data-icon="inline-start" />Back to run history</Link></Button></div>
      {workflow.isPending ? <Skeleton className="h-[36rem] rounded-xl" /> : workflow.isError || !workflow.data || !run ? <Alert variant="destructive"><AlertTitle>Run unavailable</AlertTitle><AlertDescription>{workflow.error?.message ?? "This run could not be loaded."}</AlertDescription></Alert> : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{workflowTitle(run.workflow)} <Status value={run.status} /></CardTitle>
              <CardDescription>
                {run.status === "succeeded" ? "Finished without problems." : run.status === "failed" ? `Stopped at "${failedStage ? stepLabel(failedStage.stage).title : "an unknown step"}".` : run.status === "running" ? "Still working; this page refreshes itself." : "Waiting on an earlier step."}
                {" "}{workSummary(run)}.
              </CardDescription>
              <CardAction className="flex items-center gap-3"><Button disabled={rerun.isPending} onClick={() => rerun.mutate()} size="sm" variant="outline"><RiRestartLine className={cn(rerun.isPending && "animate-spin")} data-icon="inline-start" />{rerun.isPending ? "Starting…" : "Run again"}</Button></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Started" value={date(run.started_at)} />
                <Metric label="Took" value={durationBetween(run.started_at, run.finished_at)} />
                <Metric label="Started by" value={triggerLabel(run.trigger)} />
                <Metric label="Source" value={run.source_id} />
              </dl>
              {run.parent_run_id ? <p className="text-xs text-muted-foreground">This extraction was started by a <Link className="underline underline-offset-4" to={`/runs/${run.parent_run_id}`}>bulletin collection run</Link>.</p> : null}
              <div>
                <p className="mb-2 text-xs font-medium">Steps <span className="font-normal text-muted-foreground">· click one to inspect it</span></p>
                <ScrollArea className="w-full pb-3" orientation="horizontal">
                  <div className="flex min-w-max items-stretch gap-2 pb-3">
                    {workflow.data.stages.map((stage, index) => (
                      <div className="flex items-center gap-2" key={stage.stage}>
                        <Button aria-pressed={selected?.stage === stage.stage} className={cn("h-auto w-52 items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left", selected?.stage === stage.stage && "border-primary/60 bg-primary/10")} onClick={() => selectStage(stage.stage)} variant="outline">
                          <StepIcon status={stage.status} />
                          <span className="min-w-0"><span className="block font-semibold">{index + 1}. {stepLabel(stage.stage).title}</span><span className="mt-1 block text-[11px] font-normal leading-4 text-muted-foreground">{stage.status === "blocked" && stage.missing_dependencies.length ? `Waiting for ${stage.missing_dependencies.map((dependency) => stepLabel(dependency as WorkflowStep["stage"]).title).join(", ")}` : `${stage.status.replaceAll("_", " ")} · ${formatDuration(stage.duration_ms)}`}</span></span>
                        </Button>
                        {index < workflow.data.stages.length - 1 ? <RiArrowRightLine aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
          {workflow.data.children.length ? <Card size="sm"><CardHeader><CardTitle>Extractions started by this run</CardTitle><CardDescription>{workflow.data.children.length} new {workflow.data.children.length === 1 ? "bulletin was" : "bulletins were"} downloaded, and each one got its own extraction run.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{workflow.data.children.map((child) => <Button asChild className="h-auto justify-between px-3 py-2" key={child.id} variant="outline"><Link to={`/runs/${child.id}`}><span className="truncate">{child.archive_id ?? child.id}</span><Status value={child.status} /></Link></Button>)}</CardContent></Card> : null}
          {selected ? <StepInspector mutationError={retry.error?.message ?? null} pending={retry.isPending && retry.variables === selected.stage} retry={() => retry.mutate(selected.stage)} stage={selected} /> : null}
          {rerun.isError ? <Alert variant="destructive"><AlertTitle>The run could not be started again</AlertTitle><AlertDescription>{rerun.error.message}</AlertDescription></Alert> : null}
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
        <CardDescription>{label.description}.</CardDescription>
        <CardAction>
          <Button disabled={!stage.can_retry || pending} onClick={retry} size="sm" title={stage.retry_reason ?? "Retry this step"} variant="outline">
            <RiRestartLine className={cn(pending && "animate-spin")} data-icon="inline-start" />{pending ? "Starting…" : "Retry this step"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Took" value={formatDuration(stage.duration_ms)} />
          <Metric label="Attempts" value={String(stage.attempt_count ?? 0)} />
          <Metric label="Went in" value={`${wholeNumber.format(stage.input_count ?? 0)} records`} />
          <Metric label="Came out" value={`${wholeNumber.format(stage.output_count ?? 0)} records`} />
        </div>
        {stage.error_message ? <Alert variant="destructive"><RiCloseLine /><AlertTitle>{stage.error_code ?? "This step failed"}</AlertTitle><AlertDescription>{stage.error_message}</AlertDescription></Alert> : null}
        {stage.retry_reason && !stage.can_retry ? <Alert><RiLockLine /><AlertTitle>Cannot retry just this step</AlertTitle><AlertDescription>{stage.retry_reason}</AlertDescription></Alert> : null}
        {mutationError ? <Alert variant="destructive"><AlertTitle>Retry did not start</AlertTitle><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <JsonPanel title="What went in" value={stage.input} />
          <JsonPanel title="What came out" value={stage.output} />
        </div>
        <Separator />
        <div>
          <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-heading text-sm font-semibold">Log</h3><Badge variant="outline">{stage.log_count} entries</Badge></div>
          <ScrollArea className="h-72 rounded-lg border bg-background/40">
            <div className="divide-y divide-border">
              {stage.logs.length ? stage.logs.map((log) => <div className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_5rem_1fr] sm:gap-3" key={log.id}><time className="font-mono text-[10px] text-muted-foreground">{date(log.created_at)}</time><Badge className="self-start" variant={log.level === "error" ? "destructive" : log.level === "warning" ? "secondary" : "outline"}>{log.level}</Badge><div className="min-w-0"><p className="text-xs font-medium">{log.message}</p>{log.data !== null ? <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-muted-foreground">{formatJson(log.data)}</pre> : null}</div></div>) : <p className="p-6 text-center text-xs text-muted-foreground">Nothing was logged for this step.</p>}
            </div>
          </ScrollArea>
          {stage.log_count > stage.logs.length ? <p className="mt-2 text-[10px] text-muted-foreground">Showing the latest {stage.logs.length} entries.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-background/40 p-3"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-mono text-sm font-medium" title={value}>{value}</dd></div>;
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return <div className="min-w-0"><h3 className="mb-2 font-heading text-sm font-semibold">{title}</h3><ScrollArea className="h-44 w-full min-w-0 rounded-lg border bg-background/40" orientation="both"><pre className="w-max min-w-full p-4 font-mono text-[11px] leading-5 text-muted-foreground">{formatJson(value)}</pre></ScrollArea></div>;
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
  if (milliseconds === null) return "Not finished";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function durationBetween(startedAt: string, finishedAt: string | null): string {
  return formatDuration(Math.max(0, Date.parse(finishedAt ?? new Date().toISOString()) - Date.parse(startedAt)));
}

function relativeTime(value: string | null): string {
  if (!value) return "not scheduled";
  const milliseconds = Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return "unknown time";
  const absolute = Math.abs(milliseconds);
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60_000
    ? [1_000, "second"]
    : absolute < 3_600_000
      ? [60_000, "minute"]
      : absolute < 86_400_000
        ? [3_600_000, "hour"]
        : [86_400_000, "day"];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" }).format(Math.round(milliseconds / divisor), unit);
}

function dateInZone(value: string | null, timezone: string): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value))
    : "Not scheduled";
}

const rightsLabels: Record<string, { label: string; description: string }> = {
  approved_permission: { label: "Permission granted", description: "HARTI has given written permission for non-commercial data preparation." },
  approved_open: { label: "Open data", description: "The source is published for reuse." },
  internal_evaluation: { label: "Internal evaluation", description: "Publicly listed prices are captured for internal analysis only and are not redistributed until the rights review is complete." },
  link_only: { label: "Link only", description: "We may point to the source but not store its data." },
  public_domain: { label: "Public domain", description: "The source is free to reuse." },
  open_license: { label: "Open licence", description: "The source is published under an open licence." },
  unknown: { label: "Not yet confirmed", description: "Rights have not been confirmed, so nothing from this source can be published." },
  restricted: { label: "Restricted", description: "Reuse is restricted; only internal processing is allowed." },
};
const cadenceLabels: Record<string, string> = { business_daily: "Every working day", daily: "Every day", weekly: "Every week", event_driven: "Whenever published" };
const methodLabels: Record<string, string> = { scheduled_download: "Automatic download on a timetable", manual: "Uploaded by hand", partner_feed: "Delivered by the partner", api_snapshot: "Daily snapshot of the online store" };
const retentionLabels: Record<string, string> = { preserve_source_evidence: "Original PDFs are kept as evidence", metadata_and_checksum_only: "Only metadata and checksums are kept" };
const scopeLabels: Record<string, string> = { selected_wholesale_markets: "Selected wholesale markets across Sri Lanka", online_store_national: "Online store shelf prices (one national price list)" };
const stateCopy: Record<string, string> = {
  healthy: "Recent runs succeeded and the rights review is current.",
  degraded: "A recent run failed. Check the run history for the error.",
  paused: "Captures are on hold after repeated failures; resume from the source card once the cause is fixed.",
  blocked: "Rights or review are overdue, so nothing can run.",
  review_required: "The rights review is due; confirm it to keep collecting.",
};

export function SourcesPage() {
  const state = useTableState();
  const sources = useQuery({
    queryKey: ["sources", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<Source>>(listUrl("/v1/admin/sources", state), { signal }),
    placeholderData: keepPreviousData,
  });
  return (
    <PageFrame description="Where the price data comes from, whether we are allowed to use it, and how collection is going." eyebrow="Operations" title="Sources">
      {sources.isPending ? <Skeleton className="h-96 rounded-xl" /> : sources.isError ? <Alert variant="destructive"><AlertTitle>Sources unavailable</AlertTitle><AlertDescription>{sources.error.message}</AlertDescription></Alert> : (
        <>
          {sources.data.total > 1 ? <Card size="sm"><TableControls placeholder="Search by name, owner, or rights…" state={state} statuses={sourceStatuses} /></Card> : null}
          {sources.data.items.length ? sources.data.items.map((source) => <SourceCard key={source.id} source={source} />) : <Empty className="min-h-48"><EmptyHeader><EmptyTitle>No sources configured</EmptyTitle><EmptyDescription>Add a source manifest under data/manifests to start collecting.</EmptyDescription></EmptyHeader></Empty>}
          {sources.data.pages > 1 ? <Card size="sm"><Pagination page={sources.data.page} pageSize={sources.data.pageSize} pages={sources.data.pages} pending={sources.isPlaceholderData} total={sources.data.total} /></Card> : null}
        </>
      )}
    </PageFrame>
  );
}

function SourceCard({ source }: { source: Source }) {
  const rights = rightsLabels[source.rights_status] ?? { label: source.rights_status.replaceAll("_", " "), description: "" };
  const reviewOverdue = Date.parse(source.review_due_at) < Date.now();
  const extractedShare = source.publication_count ? Math.round((source.canonicalized_count / source.publication_count) * 100) : 0;
  const retail = Boolean(source.adapter_kind);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><RiDatabase2Line className="size-5" /></span>
          <div className="min-w-0">
            <CardTitle className="text-lg">{source.name}</CardTitle>
            <CardDescription className="mt-1">{retail ? `Online store run by ${source.owner}.` : `Published by ${source.owner}.`}</CardDescription>
          </div>
        </div>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Status value={source.state} /></span></TooltipTrigger><TooltipContent>{stateCopy[source.state] ?? "Current collection state."}</TooltipContent></Tooltip>
          {source.enabled ? null : <Badge variant="outline">Collection off</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <section aria-label="What we collect">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">What we collect</h3>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <Definition label="How often">{cadenceLabels[source.expected_cadence ?? ""] ?? source.expected_cadence ?? "Unknown"}</Definition>
              <Definition label="How">{methodLabels[source.retrieval_method ?? ""] ?? source.retrieval_method ?? "Unknown"}</Definition>
              <Definition label="Covers">{scopeLabels[source.geographic_scope ?? ""] ?? source.geographic_scope ?? "Unknown"}</Definition>
              <Definition label="We keep">{retail && source.retention_policy === "preserve_source_evidence" ? "Every price snapshot is kept as evidence" : retentionLabels[source.retention_policy ?? ""] ?? source.retention_policy ?? "Unknown"}</Definition>
              <Definition label="Website"><a className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-primary" href={source.landing_url} rel="noreferrer" target="_blank">{source.landing_url.replace(/^https?:\/\//u, "")}<RiExternalLinkLine className="size-3.5" /></a></Definition>
            </dl>
          </section>
          <section aria-label="Permission">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Permission to use it</h3>
            <div className="rounded-lg border bg-background/40 p-3">
              <div className="flex flex-wrap items-center gap-2"><RiShieldCheckLine className={cn("size-4", source.rights_status === "approved_permission" ? "text-primary" : "text-amber-400")} /><p className="text-sm font-medium">{rights.label}</p>{reviewOverdue ? <Badge variant="destructive">Review overdue</Badge> : null}</div>
              {rights.description ? <p className="mt-1 text-xs text-muted-foreground">{rights.description}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">Reviewed {date(source.reviewed_at)} · next review due {date(source.review_due_at)}{source.rights_evidence_ref ? <> · evidence: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{source.rights_evidence_ref}</code></> : null}</p>
              {source.attribution_text ? <p className="mt-2 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">{source.attribution_text}</p> : null}
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section aria-label="Progress">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress so far</h3>
            <div className="grid grid-cols-2 gap-3">
              <Figure label={retail ? "Daily snapshots" : "Bulletins found"} value={wholeNumber.format(source.publication_count)} />
              <Figure hint={`${extractedShare}% of ${retail ? "snapshots" : "bulletins"}`} label={retail ? "Snapshots published" : "Prices extracted"} value={wholeNumber.format(source.canonicalized_count)} />
              <Figure label="Price rows" value={compactNumber.format(source.observation_count)} />
              <Figure label="Failed runs, 30 days" tone={source.failed_runs_30d ? "warning" : "default"} value={wholeNumber.format(source.failed_runs_30d)} />
            </div>
          </section>
          <section aria-label="Recent activity">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent activity</h3>
            <ItemGroup className="rounded-lg border">
              {retail ? <Activity label="Last successful capture" value={source.last_capture_at} /> : <><Activity label="Last checked the website" value={source.last_discovery_at} /><ItemSeparator /><Activity label="Last downloaded a bulletin" value={source.last_fetch_at} /><ItemSeparator /><Activity label="Last extracted prices" value={source.last_parse_at} /></>}
              {source.last_failure_at ? <><ItemSeparator /><Item size="sm"><ItemMedia variant="icon"><RiAlertLine className="text-destructive" /></ItemMedia><ItemContent><ItemTitle>Last failure {date(source.last_failure_at)}</ItemTitle><ItemDescription className="line-clamp-2" title={source.last_error_message ?? undefined}>{source.last_error_message ?? "No error message was recorded."}</ItemDescription></ItemContent></Item></> : null}
            </ItemGroup>
          </section>
        </div>
        {retail ? <div className="border-t pt-4 lg:col-span-2"><AdapterPanel sourceId={source.id} /></div> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
        {retail ? null : <Button asChild size="sm" variant="outline"><Link to="/knowledge-base"><RiFilePdf2Line data-icon="inline-start" />See its bulletins</Link></Button>}
        <Button asChild size="sm" variant="outline"><Link to="/runs?view=history"><RiHistoryLine data-icon="inline-start" />See its runs</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link to="/insights">Explore prices<RiArrowRightLine data-icon="inline-end" /></Link></Button>
      </CardFooter>
    </Card>
  );
}

function Definition({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt><dd className="min-w-0 text-sm">{children}</dd></>;
}

function Figure({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warning" }) {
  return <div className="rounded-lg border bg-background/40 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className={cn("mt-1 font-heading text-2xl font-semibold tracking-tight", tone === "warning" && "text-amber-400")}>{value}</p>{hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}</div>;
}

function Activity({ label, value }: { label: string; value: string | null }) {
  return <Item size="sm"><ItemMedia variant="icon"><RiTimeLine /></ItemMedia><ItemContent><ItemTitle>{label}</ItemTitle><ItemDescription>{value ? `${date(value)} · ${relativeTime(value)}` : "Never"}</ItemDescription></ItemContent></Item>;
}
