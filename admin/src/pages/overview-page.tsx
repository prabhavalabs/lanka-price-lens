import {
  RiAlertLine,
  RiArrowRightLine,
  RiDatabase2Line,
  RiFilePdf2Line,
  RiHistoryLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiUploadCloud2Line,
} from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { compactNumber, DocumentsGrowthChart, formatMonth, IndexCoverageChart, RunOutcomesChart, StatTile, wholeNumber } from "@/components/charts";
import { bytes, date, PageFrame, Status } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Insights, type InsightsMonth, type KnowledgeListItem, type Overview, type Page, type Run, type Source } from "@/lib/api";

type Dashboard = { overview: Overview; insights: Insights; sources: Page<Source>; runs: Page<Run>; knowledge: Page<KnowledgeListItem> };
type UploadValues = { file: FileList };
type UploadResult = { status: string; parsedCount: number; archiveId: string | null; dispatchId: string | null };

async function dashboard(): Promise<Dashboard> {
  const [overview, insights, sources, runs, knowledge] = await Promise.all([
    api<Overview>("/v1/admin/overview"),
    api<Insights>("/v1/admin/insights"),
    api<Page<Source>>("/v1/admin/sources?page=1&pageSize=6"),
    api<Page<Run>>("/v1/admin/runs?page=1&pageSize=6"),
    api<Page<KnowledgeListItem>>("/v1/admin/knowledge-base?page=1&pageSize=6"),
  ]);
  return { overview, insights, sources, runs, knowledge };
}

const monthTotal = (month: InsightsMonth) => month.discovered + month.archived + month.canonicalized;

export function OverviewPage() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["dashboard"], queryFn: dashboard, refetchInterval: (query) => query.state.data?.overview.running ? 5_000 : false });
  const ingestion = useMutation({
    mutationFn: (mode: "backfill" | "sync") => api<{ id: string }>(`/v1/admin/ingestion/${mode}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  if (data.isPending) return <DashboardSkeleton />;
  if (data.isError) return <Alert variant="destructive"><AlertTitle>Overview unavailable</AlertTitle><AlertDescription>{data.error.message}</AlertDescription></Alert>;

  const { overview, insights, runs, knowledge, sources } = data.data;
  const active = runs.items.find((run) => run.status === "running");
  const indexed = insights.documents.index_status.find((row) => row.status === "indexed")?.count ?? 0;
  const indexedShare = overview.pdfs ? Math.round((indexed / overview.pdfs) * 100) : 0;
  const months = insights.documents.by_month;
  const thisMonth = months.at(-1);
  const lastMonth = months.at(-2);
  const weeks = insights.observations.by_week;
  const thisWeek = weeks.at(-1);
  const lastWeek = weeks.at(-2);
  const quality = insights.quality;
  const assessed = quality.complete + quality.review_required + quality.incomplete + quality.not_configured;
  const busy = Boolean(active) || ingestion.isPending;

  return (
    <PageFrame
      actions={
        <>
          <Button disabled={busy} onClick={() => ingestion.mutate("sync")} variant="outline">{ingestion.isPending && ingestion.variables === "sync" ? <Spinner data-icon="inline-start" /> : <RiRefreshLine data-icon="inline-start" />}{ingestion.isPending && ingestion.variables === "sync" ? "Checking…" : "Check for updates"}</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button disabled={busy} variant="outline"><RiHistoryLine data-icon="inline-start" />Ingest full archive</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Ingest the full archive?</AlertDialogTitle><AlertDialogDescription>This starts a rate-limited import of every available source publication. It may run for a while and cannot overlap another ingestion.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => ingestion.mutate("backfill")}>Start import</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <UploadDialog />
        </>
      }
      description="Pipeline health, archive coverage, and the operational levers for Sri Lanka's public food-price bulletins."
      eyebrow="Operations"
      title="Data foundry overview"
    >
      {active ? (
        <Alert className="items-center *:[svg]:translate-y-0 *:[svg]:self-center">
          <Spinner />
          <AlertTitle>Ingestion is running</AlertTitle>
          <AlertDescription>The <strong>{active.trigger}</strong> run has fetched {active.fetched_count} PDFs and parsed {active.parsed_count} observations so far. <Link className="underline underline-offset-4" to={`/runs/${active.id}`}>Follow the execution</Link>.</AlertDescription>
        </Alert>
      ) : null}
      {ingestion.isError ? <Alert variant="destructive"><AlertTitle>Ingestion did not start</AlertTitle><AlertDescription>{ingestion.error.message}</AlertDescription></Alert> : null}

      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          delta={thisMonth && lastMonth ? { value: monthTotal(thisMonth) - monthTotal(lastMonth), label: `vs ${formatMonth(lastMonth.month)}`, upIsGood: true } : null}
          hint="Source bulletins in the knowledge base"
          icon={<RiFilePdf2Line className="size-4" />}
          label="Knowledge records"
          trend={months.map(monthTotal)}
          value={wholeNumber.format(overview.pdfs)}
        />
        <StatTile
          delta={thisWeek && lastWeek ? { value: thisWeek.count - lastWeek.count, label: "vs previous week", upIsGood: true, format: (value) => compactNumber.format(Math.abs(value)) } : null}
          hint={`${insights.observations.products} products · ${insights.observations.markets} markets`}
          icon={<RiDatabase2Line className="size-4" />}
          label="Canonical observations"
          trend={weeks.map((week) => week.count)}
          value={compactNumber.format(insights.observations.total)}
        />
        <StatTile
          hint={<span className="flex items-center gap-2"><Progress aria-label="Indexed share of the knowledge base" className="h-1.5 w-24" value={indexedShare} /><span className="tabular">{indexedShare}% of the archive</span></span>}
          icon={<RiShieldCheckLine className="size-4" />}
          label="Indexed documents"
          value={wholeNumber.format(indexed)}
        />
        <StatTile
          hint={`${wholeNumber.format(insights.runs.succeeded_30d)} succeeded · ${overview.quarantined} open quarantine`}
          icon={<RiAlertLine className="size-4" />}
          label="Failed runs, 30 days"
          tone={insights.runs.failed_30d ? "warning" : "default"}
          value={wholeNumber.format(insights.runs.failed_30d)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Knowledge base growth</CardTitle>
            <CardDescription>Bulletins by publication month and pipeline stage, last 12 months.</CardDescription>
          </CardHeader>
          <CardContent>
            {months.length ? (
              <Tabs defaultValue="chart">
                <TabsList aria-label="Growth views" className="mb-3" variant="line"><TabsTrigger value="chart">Chart</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList>
                <TabsContent value="chart"><DocumentsGrowthChart months={months} /></TabsContent>
                <TabsContent value="table">
                  <div className="max-h-64 overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Discovered</TableHead><TableHead className="text-right">Archived</TableHead><TableHead className="text-right">Canonicalized</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                      <TableBody>{[...months].reverse().map((month) => <TableRow key={month.month}><TableCell>{formatMonth(month.month)}</TableCell><TableCell className="text-right font-mono tabular">{month.discovered}</TableCell><TableCell className="text-right font-mono tabular">{month.archived}</TableCell><TableCell className="text-right font-mono tabular">{month.canonicalized}</TableCell><TableCell className="text-right font-mono tabular">{monthTotal(month)}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            ) : <EmptyState description="Run a source sync to discover the first bulletins." title="No publications yet" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Index coverage</CardTitle>
            <CardDescription>How much of the archive already has queryable canonical prices.</CardDescription>
            <CardAction><Button asChild size="sm" variant="ghost"><Link to="/knowledge-base">Open<RiArrowRightLine data-icon="inline-end" /></Link></Button></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <IndexCoverageChart statuses={insights.documents.index_status} />
            <Separator />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Structural completeness</p>
                <span className="font-mono text-xs tabular">{quality.average_score === null ? "Not assessed" : `${Math.round(quality.average_score * 100)}% avg`}</span>
              </div>
              <Progress aria-label="Average completeness score" value={quality.average_score === null ? 0 : quality.average_score * 100} />
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="default">{quality.complete} complete</Badge>
                <Badge variant="secondary">{quality.review_required} review</Badge>
                <Badge variant="outline">{quality.incomplete} incomplete</Badge>
                {quality.not_configured ? <Badge variant="outline">{quality.not_configured} unconfigured</Badge> : null}
              </div>
              <p className="text-[11px] text-muted-foreground">{assessed} processed document{assessed === 1 ? "" : "s"} assessed against the reviewed source profile.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Workflow outcomes</CardTitle>
            <CardDescription>Executions per day for the last 30 days. Failures are highlighted; successes recede.</CardDescription>
            <CardAction><Button asChild size="sm" variant="ghost"><Link to="/runs?view=history">History<RiArrowRightLine data-icon="inline-end" /></Link></Button></CardAction>
          </CardHeader>
          <CardContent><RunOutcomesChart days={insights.runs.by_day} /></CardContent>
        </Card>
        <Card className="pb-2">
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>Permission, cadence, and parse health.</CardDescription>
            <CardAction><Button asChild size="sm" variant="ghost"><Link to="/sources">All<RiArrowRightLine data-icon="inline-end" /></Link></Button></CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0 divide-y">
              {sources.items.map((source) => (
                <Item className="rounded-none px-0 py-2" key={source.id} size="sm">
                  <ItemContent>
                    <ItemTitle>{source.name}</ItemTitle>
                    <ItemDescription>{source.owner} · last parsed {date(source.last_parse_at)}</ItemDescription>
                  </ItemContent>
                  <ItemActions><Status value={source.state} /></ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="pb-2">
          <CardHeader>
            <CardTitle>Recent knowledge</CardTitle>
            <CardDescription>Latest bulletins discovered in the source archive.</CardDescription>
            <CardAction><Button asChild size="sm" variant="ghost"><Link to="/knowledge-base">View all<RiArrowRightLine data-icon="inline-end" /></Link></Button></CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0 divide-y">
              {knowledge.items.slice(0, 5).map((item) => (
                <Item asChild className="rounded-none px-0 py-2" key={item.publication_id} size="sm">
                  <Link to={`/knowledge-base/${encodeURIComponent(item.publication_id)}`}>
                    <ItemMedia variant="icon"><RiFilePdf2Line /></ItemMedia>
                    <ItemContent>
                      <ItemTitle className="line-clamp-1" title={item.title}>{item.title}</ItemTitle>
                      <ItemDescription>{item.byte_size === null ? "Not cached" : bytes(item.byte_size)} · {item.page_count ?? "?"} pages · {date(item.published_at)}</ItemDescription>
                    </ItemContent>
                    <ItemActions><Status value={item.index_status} /></ItemActions>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
        <Card className="pb-2">
          <CardHeader>
            <CardTitle>Recent executions</CardTitle>
            <CardDescription>Latest workflow runs across sources.</CardDescription>
            <CardAction><Button asChild size="sm" variant="ghost"><Link to="/runs?view=history">View all<RiArrowRightLine data-icon="inline-end" /></Link></Button></CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0 divide-y">
              {runs.items.slice(0, 5).map((run) => (
                <Item asChild className="rounded-none px-0 py-2" key={run.id} size="sm">
                  <Link to={`/runs/${run.id}`}>
                    <ItemMedia variant="icon"><RiHistoryLine /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>{run.workflow === "pdf_processing" ? "Extract prices" : run.workflow === "source_sync" ? "Collect bulletins" : "Legacy ingestion"}</ItemTitle>
                      <ItemDescription>{date(run.started_at)} · {run.trigger} · {run.parsed_count} records</ItemDescription>
                    </ItemContent>
                    <ItemActions><Status value={run.status} /></ItemActions>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      </section>
    </PageFrame>
  );
}

function UploadDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<UploadValues>();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return api<UploadResult>("/v1/admin/uploads", { method: "POST", body });
    },
    onSuccess: () => {
      form.reset();
      for (const key of ["dashboard", "knowledge-base", "runs", "workflow-dispatches", "workflow-definitions"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <Dialog onOpenChange={(next) => { setOpen(next); if (!next) { upload.reset(); form.reset(); } }} open={open}>
      <DialogTrigger asChild><Button><RiUploadCloud2Line data-icon="inline-start" />Upload PDF</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual PDF intake</DialogTitle>
          <DialogDescription>Archive one HARTI bulletin and queue its monitored processing workflow. Duplicates are detected by checksum.</DialogDescription>
        </DialogHeader>
        <form id="upload-form" onSubmit={form.handleSubmit(({ file }) => upload.mutate(file[0]!))}>
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.file)}>
              <FieldLabel htmlFor="pdf-file">PDF file</FieldLabel>
              <Input accept=".pdf,application/pdf" aria-invalid={Boolean(form.formState.errors.file)} id="pdf-file" type="file" {...form.register("file", { required: "Choose a PDF", validate: (files) => files[0]?.size && files[0].size <= 20 * 1024 * 1024 ? true : "PDF must be 20 MiB or smaller" })} />
              <FieldDescription>Up to 20 MiB. Text-based and scanned bulletins are both accepted; scans are routed through OCR.</FieldDescription>
              <FieldError errors={[form.formState.errors.file]} />
            </Field>
          </FieldGroup>
        </form>
        {upload.isSuccess ? <Alert><RiShieldCheckLine /><AlertTitle>{upload.data.status === "duplicate" ? "Already archived" : "Queued for processing"}</AlertTitle><AlertDescription>{upload.data.status === "duplicate" ? "This PDF already exists; no duplicate workflow was queued." : `${upload.data.parsedCount} observations extracted. The archived PDF processing workflow is queued.`}</AlertDescription></Alert> : null}
        {upload.isError ? <Alert variant="destructive"><AlertTitle>Upload failed</AlertTitle><AlertDescription>{upload.error.message}</AlertDescription></Alert> : null}
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="ghost">{upload.isSuccess ? "Done" : "Cancel"}</Button>
          <Button disabled={upload.isPending} form="upload-form" type="submit">{upload.isPending ? <><Spinner data-icon="inline-start" />Uploading…</> : <><RiUploadCloud2Line data-icon="inline-start" />Upload and process</>}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <Empty className="min-h-48"><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-72" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-32 rounded-xl" key={index} />)}</div>
      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]"><Skeleton className="h-80 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>
    </div>
  );
}
