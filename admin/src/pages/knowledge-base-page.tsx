import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
  RiDatabase2Line,
  RiDeleteBin6Line,
  RiExternalLinkLine,
  RiFilePdf2Line,
  RiListCheck3,
  RiLoader4Line,
  RiLockLine,
  RiMore2Line,
  RiRestartLine,
  RiSearchLine,
  RiTimeLine,
} from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { wholeNumber } from "@/components/charts";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";

import { bytes, date, PageFrame, Pagination, Status, useTableState, type TableState } from "@/components/data-display";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { setKnowledgeProcessingState } from "@/hooks/use-workflow-events";
import {
  api,
  listUrl,
  type Insights,
  type KnowledgeItem,
  type KnowledgeIndexStatus,
  type KnowledgeListItem,
  type Page,
  type Run,
  type RunWorkflow,
  type WorkflowDispatch,
  type WorkflowStep,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const knowledgeIndexStatuses: Array<{ label: string; value: KnowledgeIndexStatus; summary: string; description: string }> = [
  { label: "Prices available", value: "indexed", summary: "Prices available", description: "Prices extracted and shown in Price insights" },
  { label: "Extracting now", value: "indexing", summary: "Extracting now", description: "A processing run is working on them" },
  { label: "Extraction failed", value: "failed", summary: "Failed", description: "The last attempt failed; open the steps to see why" },
  { label: "Not extracted yet", value: "not_indexed", summary: "Not extracted yet", description: "Archived, waiting for a processing run" },
];

const workflowLabels: Partial<Record<WorkflowStep["stage"], { title: string; description: string }>> = {
  retrieve_pdf: { title: "Retrieve PDF", description: "Retrieve and verify the archived document." },
  parse_pdf: { title: "Parse PDF", description: "Read the document layout and positional text." },
  extract_data: { title: "Extract structured data", description: "Convert parsed text into structured price records." },
  validate_data: { title: "Validate extracted data", description: "Check structure, dates, and numeric values." },
  insert_data: { title: "Save validated data", description: "Commit validated records to the operational database." },
  assess_completeness: { title: "Assess completeness", description: "Compare recovered products, markets, cells, and mappings." },
  canonicalize_data: { title: "Promote canonical observations", description: "Apply reviewed taxonomy and source precedence." },
  process: { title: "Extract and process", description: "Read PDF text and build records." },
  validate: { title: "Validate data", description: "Check structure, dates, and values." },
  store: { title: "Store results", description: "Commit validated records." },
};

export function KnowledgeBasePage() {
  const state = useTableState();
  const queryClient = useQueryClient();
  const [workflowDocument, setWorkflowDocument] = useState<KnowledgeListItem | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<KnowledgeListItem | null>(null);
  const knowledge = useQuery({
    queryKey: ["knowledge-base", { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status }],
    queryFn: ({ signal }) => api<Page<KnowledgeListItem>>(listUrl("/v1/admin/knowledge-base", state), { signal }),
    placeholderData: keepPreviousData,
  });
  const processDocument = useMutation({
    mutationKey: ["process-document"],
    mutationFn: (publicationId: string) => api<WorkflowDispatch>(`/v1/admin/knowledge-base/${encodeURIComponent(publicationId)}/process`, { method: "POST" }),
    onMutate: async (publicationId) => {
      await queryClient.cancelQueries({ queryKey: ["knowledge-base"] });
      await queryClient.cancelQueries({ queryKey: ["knowledge-document", publicationId] });
      const lists = queryClient.getQueriesData<Page<KnowledgeListItem>>({ queryKey: ["knowledge-base"] });
      const detail = queryClient.getQueryData<KnowledgeItem>(["knowledge-document", publicationId]);
      setKnowledgeProcessingState(queryClient, publicationId, {
        index_status: "indexing",
        processing_dispatch_id: null,
        processing_run_id: null,
        processing_status: "queued",
      });
      return { detail, lists };
    },
    onError: (_error, publicationId, context) => {
      for (const [key, value] of context?.lists ?? []) queryClient.setQueryData(key, value);
      queryClient.setQueryData(["knowledge-document", publicationId], context?.detail);
    },
    onSuccess: async (dispatch, publicationId) => {
      setKnowledgeProcessingState(queryClient, publicationId, {
        index_status: "indexing",
        processing_dispatch_id: dispatch.id,
        processing_run_id: dispatch.run_id,
        processing_status: dispatch.status,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-base"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-document", publicationId] }),
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-dispatches"] }),
      ]);
    },
  });

  return (
    <PageFrame description="Every HARTI bulletin we know about. A bulletin counts as 'prices available' once its numbers have been extracted into the database, where Price insights can use them." eyebrow="Operations" title="Knowledge Base">
      <KnowledgeSummary state={state} />
      {processDocument.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Document workflow did not queue</AlertTitle>
          <AlertDescription>{processDocument.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {knowledge.isPending ? <Skeleton className="h-[34rem] rounded-xl" /> : knowledge.isError ? (
        <Alert variant="destructive"><AlertTitle>Documents unavailable</AlertTitle><AlertDescription>{knowledge.error.message}</AlertDescription></Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Bulletins</CardTitle>
            <CardDescription>{knowledge.data.total} PDF {knowledge.data.total === 1 ? "bulletin" : "bulletins"}{state.status ? ` · showing "${knowledgeIndexStatuses.find((option) => option.value === state.status)?.label ?? state.status}"` : ""}</CardDescription>
          </CardHeader>
          <KnowledgeControls state={state} />
          <CardContent className="p-0">
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%]">Bulletin</TableHead>
                    <TableHead className="w-[14%]">Published</TableHead>
                    <TableHead className="w-[13%]">Prices extracted</TableHead>
                    <TableHead className="w-[18%]">File</TableHead>
                    <TableHead className="w-[14%]">Status</TableHead>
                    <TableHead className="w-[7%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {knowledge.data.items.length ? knowledge.data.items.map((item) => (
                    <TableRow key={item.publication_id}>
                      <TableCell className="max-w-0 whitespace-normal">
                        <DocumentIdentity item={item} />
                      </TableCell>
                      <TableCell className="min-w-36 text-muted-foreground">{date(item.published_at)}</TableCell>
                      <TableCell className="min-w-28 font-mono text-xs tabular">{item.canonical_count ? `${wholeNumber.format(item.canonical_count)} prices` : <span className="text-muted-foreground">None yet</span>}</TableCell>
                      <TableCell className="min-w-44 whitespace-normal"><FileMetadata item={item} /></TableCell>
                      <TableCell className="min-w-32"><IndexStatusBadge status={item.index_status} /></TableCell>
                      <TableCell className="w-16 text-right">
                        <DocumentActions
                          item={item}
                          onDelete={() => setDeleteDocument(item)}
                          onProcess={() => processDocument.mutate(item.publication_id)}
                          onWorkflow={() => setWorkflowDocument(item)}
                          processing={processDocument.isPending && processDocument.variables === item.publication_id}
                        />
                      </TableCell>
                    </TableRow>
                  )) : <EmptyDocumentRow />}
                </TableBody>
              </Table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {knowledge.data.items.length ? (
                <ul aria-label="Knowledge base documents">
                  {knowledge.data.items.map((item) => (
                    <li className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-3 px-4 py-4" key={item.publication_id}>
                      <div className="min-w-0">
                        <DocumentIdentity item={item} />
                        <div className="mt-3"><IndexStatusBadge status={item.index_status} /></div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{date(item.published_at)}</span>
                          <span aria-hidden>·</span>
                          <span>{fileSummary(item)}</span>
                          <span aria-hidden>·</span>
                          <span className="font-mono tabular">{item.canonical_count ? `${wholeNumber.format(item.canonical_count)} prices` : "No prices yet"}</span>
                        </div>
                      </div>
                      <DocumentActions
                        item={item}
                        onDelete={() => setDeleteDocument(item)}
                        onProcess={() => processDocument.mutate(item.publication_id)}
                        onWorkflow={() => setWorkflowDocument(item)}
                        processing={processDocument.isPending && processDocument.variables === item.publication_id}
                      />
                    </li>
                  ))}
                </ul>
              ) : <EmptyDocuments />}
            </div>
            <Pagination page={knowledge.data.page} pageSize={knowledge.data.pageSize} pages={knowledge.data.pages} pending={knowledge.isPlaceholderData} total={knowledge.data.total} />
          </CardContent>
        </Card>
      )}
      <WorkflowSheet document={workflowDocument} onOpenChange={(open) => { if (!open) setWorkflowDocument(null); }} />
      <ProtectedDeleteDialog document={deleteDocument} onOpenChange={(open) => { if (!open) setDeleteDocument(null); }} />
    </PageFrame>
  );
}

export function DocumentDetailPage() {
  const { publicationId = "" } = useParams();
  const document = useQuery({
    queryKey: ["knowledge-document", publicationId],
    queryFn: ({ signal }) => api<KnowledgeItem>(`/v1/admin/knowledge-base/${encodeURIComponent(publicationId)}`, { signal }),
    enabled: Boolean(publicationId),
  });

  return (
    <PageFrame description="The archived copy of this bulletin and what we know about it." eyebrow="Knowledge Base" title="Bulletin">
      <div><Button asChild size="sm" variant="ghost"><Link to="/knowledge-base"><RiArrowLeftLine data-icon="inline-start" />Back to Knowledge Base</Link></Button></div>
      {document.isPending ? <Skeleton className="h-[40rem] rounded-xl" /> : document.isError ? (
        <Alert variant="destructive"><AlertTitle>Document unavailable</AlertTitle><AlertDescription>{document.error.message}</AlertDescription></Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><RiFilePdf2Line /></span>
                <div className="min-w-0">
                  <CardTitle className="break-words">{document.data.title}</CardTitle>
                  <DocumentCode id={document.data.document_id} className="mt-2" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <DetailValue label="Published" value={date(document.data.published_at)} />
              <DetailValue label="Document type" value={formatPdfType(document.data.pdf_type)} />
              <DetailValue label="Pages" value={document.data.page_count ? String(document.data.page_count) : "Not recorded"} />
              <DetailValue label="File size" value={document.data.byte_size === null ? "Not cached" : bytes(document.data.byte_size)} />
            </CardContent>
          </Card>
          {document.data.archive_id ? (
            <Card>
              <CardHeader>
                <CardTitle>Stored PDF</CardTitle>
                <CardDescription>This viewer reads the retained archive copy, not the external source website.</CardDescription>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button asChild size="sm" variant="outline"><a href={storedPdfPath(document.data.publication_id)} rel="noreferrer" target="_blank"><RiExternalLinkLine data-icon="inline-start" />Open stored PDF</a></Button>
                  {isExternalUrl(document.data.download_url) ? <Button asChild size="sm" variant="ghost"><a href={document.data.download_url} rel="noreferrer" target="_blank">Open source<RiExternalLinkLine data-icon="inline-end" /></a></Button> : null}
                </div>
              </CardHeader>
              <CardContent>
                <iframe className="h-[68dvh] min-h-[32rem] w-full rounded-lg border bg-muted" src={storedPdfPath(document.data.publication_id)} title={`PDF viewer for ${document.data.title}`} />
              </CardContent>
            </Card>
          ) : (
            <Alert>
              <RiLockLine />
              <AlertTitle>No retained file is available yet</AlertTitle>
              <AlertDescription>The publication metadata is in the knowledge base, but the PDF has not been archived. {isExternalUrl(document.data.download_url) ? <a href={document.data.download_url} rel="noreferrer" target="_blank">Open the source copy</a> : null}</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </PageFrame>
  );
}

function KnowledgeControls({ state }: { state: TableState }) {
  const form = useForm<{ search: string }>({ values: { search: state.search } });
  const clearSearch = () => {
    form.setValue("search", "");
    state.update({ page: 1, search: "" });
  };
  return (
    <form className="grid gap-2 border-b px-4 py-4 sm:grid-cols-[minmax(18rem,1fr)_11rem_8rem]" onSubmit={form.handleSubmit(({ search }) => state.update({ page: 1, search: search.trim() }))} role="search">
      <InputGroup className="h-11 sm:h-10">
        <InputGroupAddon><RiSearchLine /></InputGroupAddon>
        <InputGroupInput aria-label="Search knowledge base documents" autoComplete="off" enterKeyHint="search" placeholder="Search documents by name or ID…" type="search" {...form.register("search")} />
        <InputGroupAddon align="inline-end">
          <span className="hidden whitespace-nowrap text-[10px] sm:inline">Press Enter</span>
          {state.search ? <InputGroupButton aria-label="Clear document search" onClick={clearSearch} size="icon-xs"><RiCloseLine /></InputGroupButton> : null}
        </InputGroupAddon>
      </InputGroup>
      <Select onValueChange={(value) => state.update({ page: 1, status: value === "all" ? "" : value })} value={state.status || "all"}>
        <SelectTrigger aria-label="Filter by index status" className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-10"><SelectValue /></SelectTrigger>
        <SelectContent position="popper"><SelectGroup><SelectItem value="all">All bulletins</SelectItem>{knowledgeIndexStatuses.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Select onValueChange={(value) => state.update({ page: 1, pageSize: Number(value) })} value={String(state.pageSize)}>
        <SelectTrigger aria-label="Documents per page" className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-10"><SelectValue /></SelectTrigger>
        <SelectContent position="popper"><SelectGroup>{[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </form>
  );
}

function DocumentIdentity({ item }: { item: KnowledgeListItem }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><RiFilePdf2Line /></span>
      <div className="min-w-0">
        <Link className="line-clamp-2 font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:line-clamp-1" title={item.title} to={documentPath(item.publication_id)}>{item.title}</Link>
        <DocumentCode className="mt-1.5" id={item.document_id} />
      </div>
    </div>
  );
}

function DocumentCode({ id, className }: { id: string; className?: string }) {
  return <code className={cn("block w-fit max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground", className)} title={id}>{id}</code>;
}

function FileMetadata({ item }: { item: KnowledgeListItem }) {
  return <div><p className="font-medium text-foreground">{formatPdfType(item.pdf_type)}</p><p className="mt-1 text-xs text-muted-foreground">{item.page_count ? `${item.page_count} ${item.page_count === 1 ? "page" : "pages"}` : "Pages not recorded"} · {item.byte_size === null ? "Not cached" : bytes(item.byte_size)}</p></div>;
}

const indexStatusCopy: Record<KnowledgeIndexStatus, string> = {
  indexed: "Prices from this bulletin are in the database and appear in Price insights.",
  indexing: "Prices are being extracted from this bulletin right now.",
  failed: "The last extraction attempt failed. Choose 'See processing steps' to find out why.",
  not_indexed: "No prices have been extracted from this bulletin yet. Choose 'Extract prices' to process it.",
};

function IndexStatusBadge({ status }: { status: KnowledgeIndexStatus }) {
  const badge = status === "indexed" ? <Badge><RiCheckLine data-icon="inline-start" />Prices available</Badge>
    : status === "indexing" ? <Badge variant="secondary"><RiLoader4Line className="animate-spin" data-icon="inline-start" />Extracting</Badge>
      : status === "failed" ? <Badge variant="destructive"><RiCloseLine data-icon="inline-start" />Failed</Badge>
        : <Badge variant="outline"><RiDatabase2Line data-icon="inline-start" />Not extracted</Badge>;
  return <Tooltip><TooltipTrigger asChild><span className="inline-flex">{badge}</span></TooltipTrigger><TooltipContent>{indexStatusCopy[status]}</TooltipContent></Tooltip>;
}

function DocumentActions({ item, onDelete, onProcess, onWorkflow, processing }: { item: KnowledgeListItem; onDelete: () => void; onProcess: () => void; onWorkflow: () => void; processing: boolean }) {
  const workflowActive = processing || item.index_status === "indexing" || ["queued", "running"].includes(item.processing_status ?? "");
  const canProcess = Boolean(item.archive_id) && !workflowActive;
  const canViewWorkflow = workflowActive || Boolean(item.processing_dispatch_id || item.processing_run_id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Actions for ${item.title}`} className="size-11 justify-self-end sm:size-10" size="icon-lg" variant="ghost"><RiMore2Line /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><Link to={documentPath(item.publication_id)}><RiFilePdf2Line />Open the PDF</Link></DropdownMenuItem>
          <DropdownMenuItem disabled={!canViewWorkflow} onSelect={onWorkflow}>{workflowActive ? <RiLoader4Line className="animate-spin" /> : <RiListCheck3 />}See processing steps</DropdownMenuItem>
          {isExternalUrl(item.download_url) ? <DropdownMenuItem asChild><a href={item.download_url} rel="noreferrer" target="_blank"><RiExternalLinkLine />Open on HARTI website</a></DropdownMenuItem> : <DropdownMenuItem disabled><RiExternalLinkLine />Open on HARTI website</DropdownMenuItem>}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!canProcess} onSelect={onProcess}>{workflowActive ? <RiLoader4Line className="animate-spin" /> : <RiRestartLine />}{processing ? "Queueing…" : workflowActive ? "Extracting prices…" : item.processing_run_id ? "Extract prices again" : "Extract prices"}</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onDelete} variant="destructive"><RiDeleteBin6Line />Delete</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkflowSheet({ document, onOpenChange }: { document: KnowledgeListItem | null; onOpenChange: (open: boolean) => void }) {
  const mobile = useMediaQuery("(max-width: 639px)");
  const detail = useQuery({
    queryKey: ["knowledge-document", document?.publication_id],
    queryFn: ({ signal }) => api<KnowledgeItem>(`/v1/admin/knowledge-base/${encodeURIComponent(document?.publication_id ?? "")}`, { signal }),
    enabled: Boolean(document),
  });
  const currentDocument = detail.data ?? document;
  const workflowActive = currentDocument?.index_status === "indexing" || ["queued", "running"].includes(currentDocument?.processing_status ?? "");
  const runId = currentDocument?.processing_run_id ?? "";
  const workflow = useQuery({
    queryKey: ["run-workflow", runId],
    queryFn: async ({ signal }) => normalizeWorkflow(await api<RawWorkflow>(`/v1/admin/runs/${encodeURIComponent(runId)}`, { signal })),
    enabled: Boolean(document && runId),
  });
  const expanded = workflow.data?.stages.find((step) => step.status === "failed")?.stage ?? workflow.data?.stages[0]?.stage;
  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(document)}>
      <SheetContent className={cn("w-full min-w-0 overflow-hidden data-[side=right]:sm:max-w-xl", mobile && "max-h-[88dvh] rounded-t-xl data-[side=bottom]:h-[88dvh]")} side={mobile ? "bottom" : "right"}>
        <SheetHeader className="border-b pr-14">
          <SheetTitle>Processing steps</SheetTitle>
          <SheetDescription className="truncate" title={document?.title}>{document?.title ?? "How this bulletin was processed"}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          <div className="w-0 min-w-full space-y-5 p-5 sm:p-6">
            {detail.isPending ? <Skeleton className="h-32 rounded-lg" /> : detail.isError ? <Alert variant="destructive"><AlertTitle>Document details unavailable</AlertTitle><AlertDescription>{detail.error.message}</AlertDescription></Alert> : <WorkflowSummary document={detail.data} workflow={workflow.data ?? null} />}
            {!runId && workflowActive ? (
              <Alert><RiLoader4Line className="animate-spin" /><AlertTitle>Workflow is {currentDocument?.processing_status ?? "starting"}</AlertTitle><AlertDescription>The scheduler has accepted this document. Its steps will appear here automatically as soon as execution begins.</AlertDescription></Alert>
            ) : runId && workflow.isPending ? <Skeleton className="h-80 rounded-lg" /> : workflow.isError ? (
              <Alert variant="destructive"><AlertTitle>Workflow unavailable</AlertTitle><AlertDescription>{workflow.error.message}</AlertDescription></Alert>
            ) : workflow.data ? (
              <section aria-labelledby="workflow-steps-title">
                <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-heading text-sm font-semibold" id="workflow-steps-title">Processing steps</h3><Badge variant="outline">{workflow.data.stages.length} steps</Badge></div>
                <Accordion {...(expanded ? { defaultValue: expanded } : {})} key={workflow.data.run.id} type="single" collapsible>
                  {workflow.data.stages.map((step, index) => {
                    const label = stepLabel(step.stage);
                    return (
                      <AccordionItem key={step.stage} value={step.stage}>
                        <AccordionTrigger className="min-h-14 px-3 py-3 hover:no-underline">
                          <span className="flex min-w-0 items-start gap-3">
                            <StepIcon status={step.status} />
                            <span className="min-w-0"><span className="block font-medium text-foreground">{index + 1}. {label.title}</span><span className="mt-0.5 block text-[10px] font-normal capitalize text-muted-foreground">{step.status.replaceAll("_", " ")} · {formatDuration(step.duration_ms)}</span></span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-3">
                          <p className="text-muted-foreground">{label.description}</p>
                          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3">
                            <DetailValue label="Input records" value={String(step.input_count)} compact />
                            <DetailValue label="Output records" value={String(step.output_count)} compact />
                            <DetailValue label="Warnings" value={String(step.warning_count)} compact />
                            <DetailValue label="Attempts" value={String(step.attempt_count)} compact />
                          </div>
                          {step.error_message ? <Alert className="mt-3" variant="destructive"><AlertTitle>{step.error_code ?? "Step failed"}</AlertTitle><AlertDescription>{step.error_message}</AlertDescription></Alert> : null}
                          <WorkflowData label="Input" value={step.input} />
                          <WorkflowData label="Extracted output" value={step.output} />
                          {step.logs.length ? <div className="mt-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Latest log entries</p><div className="divide-y rounded-lg border">{step.logs.slice(-3).map((log) => <div className="px-3 py-2" key={log.id}><p className="font-medium">{log.message}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{date(log.created_at)} · {log.level}</p></div>)}</div></div> : null}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </section>
            ) : <Alert><AlertTitle>No workflow execution</AlertTitle><AlertDescription>This document has not entered the processing pipeline yet.</AlertDescription></Alert>}
          </div>
        </ScrollArea>
        {runId ? <SheetFooter className="border-t bg-popover"><Button asChild className="w-full"><Link to={`/runs/${runId}`}>View full workflow<RiArrowRightLine data-icon="inline-end" /></Link></Button></SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}

function WorkflowSummary({ document, workflow }: { document: KnowledgeItem; workflow: RunWorkflow | null }) {
  return (
    <section aria-labelledby="workflow-summary-title">
      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-heading text-sm font-semibold" id="workflow-summary-title">Execution summary</h3><Status value={workflow?.run.status ?? document.processing_status ?? "unknown"} /></div>
      <div className="grid grid-cols-2 border-y">
        <SummaryValue icon={<RiTimeLine />} label="Duration" value={workflow ? durationBetween(workflow.run.started_at, workflow.run.finished_at) : "Not recorded"} />
        <SummaryValue icon={<RiFilePdf2Line />} label="Pages" value={document.page_count ? String(document.page_count) : "Unknown"} />
        <SummaryValue icon={<RiListCheck3 />} label="Extracted" value={`${document.parsed_count} records`} />
        <SummaryValue icon={<RiDatabase2Line />} label="Saved" value={`${document.canonical_count} canonical`} />
      </div>
      {document.processing_error_message ? <Alert className="mt-3" variant="destructive"><AlertTitle>{document.processing_error_code ?? "Processing issue"}</AlertTitle><AlertDescription>{document.processing_error_message}</AlertDescription></Alert> : null}
    </section>
  );
}

function SummaryValue({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2 border-b border-r p-3 even:border-r-0 nth-last-[-n+2]:border-b-0"><span className="mt-0.5 text-muted-foreground">{icon}</span><span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span><span className="mt-1 block truncate font-mono text-xs text-foreground" title={value}>{value}</span></span></div>;
}

function WorkflowData({ label, value }: { label: string; value: unknown }) {
  return <div className="mt-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p><ScrollArea className="h-40 w-full min-w-0 rounded-lg border bg-background/50"><div className="w-0 min-w-full"><pre className="whitespace-pre-wrap break-words p-3 pr-5 font-mono text-[10px] leading-4 text-muted-foreground">{formatJson(value)}</pre></div></ScrollArea></div>;
}

function ProtectedDeleteDialog({ document, onOpenChange }: { document: KnowledgeListItem | null; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={Boolean(document)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><RiLockLine /></AlertDialogMedia>
          <AlertDialogTitle>Deletion is protected</AlertDialogTitle>
          <AlertDialogDescription>This PDF is source evidence for workflow and price records. It cannot be safely removed until a retention-aware deletion workflow can verify dependencies and preserve the audit trail.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction>Understood</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DetailValue({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className={cn("mt-1 text-foreground", compact ? "font-mono text-xs" : "text-sm font-medium")}>{value}</p></div>;
}

function EmptyDocumentRow() {
  return <TableRow><TableCell colSpan={5}><EmptyDocuments /></TableCell></TableRow>;
}

function EmptyDocuments() {
  return <Empty className="min-h-48 p-6"><EmptyHeader><EmptyTitle>No matching bulletins</EmptyTitle><EmptyDescription>Try another name, ID, or filter.</EmptyDescription></EmptyHeader></Empty>;
}

function KnowledgeSummary({ state }: { state: TableState }) {
  const insights = useQuery({ queryKey: ["insights"], queryFn: ({ signal }) => api<Insights>("/v1/admin/insights", { signal }), staleTime: 60_000 });
  if (!insights.data) return null;
  const rows = insights.data.documents.index_status;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section aria-label="Bulletins by status" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {knowledgeIndexStatuses.map((option) => {
        const count = rows.find((row) => row.status === option.value)?.count ?? 0;
        const active = state.status === option.value;
        return (
          <Card
            aria-pressed={active}
            className={cn("cursor-pointer gap-1 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "border-primary/60 bg-primary/5")}
            key={option.value}
            onClick={() => state.update({ page: 1, status: active ? "" : option.value })}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); state.update({ page: 1, status: active ? "" : option.value }); } }}
            role="button"
            size="sm"
            tabIndex={0}
          >
            <CardContent className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{option.summary}</p><IndexStatusBadge status={option.value} /></div>
              <p className="font-heading text-2xl font-semibold tracking-tight">{wholeNumber.format(count)}<span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">{total ? `${Math.round((count / total) * 100)}%` : ""}</span></p>
              <p className="text-[11px] text-muted-foreground">{option.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

type RawWorkflow = { run: Run; stages: Array<Partial<WorkflowStep> & { stage: string; status: string }>; children: Run[] };

function normalizeWorkflow(data: RawWorkflow): RunWorkflow {
  return {
    run: data.run,
    children: data.children ?? [],
    stages: data.stages.map((row) => {
      const stage = row.stage as WorkflowStep["stage"];
      const startedAt = typeof row.started_at === "string" ? row.started_at : null;
      const finishedAt = typeof row.finished_at === "string" ? row.finished_at : null;
      return {
        stage,
        status: row.status ?? "blocked",
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : startedAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null,
        input_count: row.input_count ?? 0,
        output_count: row.output_count ?? 0,
        warning_count: row.warning_count ?? 0,
        attempt_count: row.attempt_count ?? 0,
        error_code: row.error_code ?? null,
        error_message: row.error_message ?? null,
        input: row.input ?? null,
        output: row.output ?? null,
        can_retry: row.can_retry ?? false,
        retry_reason: row.retry_reason ?? null,
        missing_dependencies: row.missing_dependencies ?? [],
        logs: row.logs ?? [],
        log_count: row.log_count ?? 0,
      } satisfies WorkflowStep;
    }),
  };
}

function stepLabel(stage: WorkflowStep["stage"]): { title: string; description: string } {
  return workflowLabels[stage] ?? {
    title: stage.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase()),
    description: "Workflow execution step.",
  };
}

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><RiCheckLine /></span>;
  if (status === "running") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><RiLoader4Line className="animate-spin" /></span>;
  if (status === "failed") return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"><RiCloseLine /></span>;
  return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><RiLockLine /></span>;
}

function fileSummary(item: KnowledgeListItem): string {
  const pages = item.page_count ? `${item.page_count}p` : "Pages unknown";
  const size = item.byte_size === null ? "Not cached" : bytes(item.byte_size);
  return `${formatPdfType(item.pdf_type)} · ${pages} · ${size}`;
}

function formatPdfType(value: string | null): string {
  if (!value) return "PDF";
  if (value.toLowerCase() === "textbased") return "Text-based PDF";
  if (value.toLowerCase() === "imagebased") return "Image-based PDF";
  return value.replace(/([a-z])([A-Z])/gu, "$1 $2");
}

function documentPath(publicationId: string): string {
  return `/knowledge-base/${encodeURIComponent(publicationId)}`;
}

function storedPdfPath(publicationId: string): string {
  return `/v1/admin/knowledge-base/${encodeURIComponent(publicationId)}/file`;
}

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//u.test(value);
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
