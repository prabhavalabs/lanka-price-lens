import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { bytes, date, Pagination, Status } from "@/components/data-display";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Page, type Pdf, type Run, type Source } from "@/lib/api";

export function RunsPage() {
  const page = usePage();
  const runs = useQuery({ queryKey: ["runs", page], queryFn: () => api<Page<Run>>(`/v1/admin/runs?page=${page}&pageSize=20`) });
  return <PageFrame description="Every scheduled, manual, and historical ingestion attempt." title="Ingestion runs">{runs.isPending ? <Skeleton className="h-80" /> : runs.isError ? <Alert variant="destructive">{runs.error.message}</Alert> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead>PDFs</TableHead><TableHead>Observations</TableHead><TableHead>Held</TableHead></TableRow></TableHeader><TableBody>{runs.data.items.map((run) => <TableRow key={run.id}><TableCell>{date(run.started_at)}</TableCell><TableCell>{run.trigger}</TableCell><TableCell><Status value={run.status} /></TableCell><TableCell>{run.fetched_count}/{run.discovered_count}</TableCell><TableCell>{run.parsed_count}</TableCell><TableCell>{run.quarantined_count}</TableCell></TableRow>)}</TableBody></Table><Pagination page={runs.data.page} pages={runs.data.pages} /></CardContent></Card>}</PageFrame>;
}

export function PdfsPage() {
  const page = usePage();
  const pdfs = useQuery({ queryKey: ["pdfs", page], queryFn: () => api<Page<Pdf>>(`/v1/admin/uploads?page=${page}&pageSize=20`) });
  return <PageFrame description="Downloaded and manually submitted source artifacts." title="PDF library">{pdfs.isPending ? <Skeleton className="h-80" /> : pdfs.isError ? <Alert variant="destructive">{pdfs.error.message}</Alert> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>File</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Size</TableHead><TableHead>Parsed</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{pdfs.data.items.map((pdf) => <TableRow key={pdf.artifact_id}><TableCell><p className="max-w-sm truncate font-medium" title={pdf.original_filename}>{pdf.original_filename}</p><p className="font-mono text-[11px] text-muted-foreground">{pdf.sha256.slice(0, 16)}…</p></TableCell><TableCell>{pdf.pdf_type ?? "Pending"}{pdf.page_count ? <span className="block text-xs text-muted-foreground">{pdf.page_count} pages</span> : null}</TableCell><TableCell><Status value={pdf.status} /></TableCell><TableCell>{bytes(pdf.byte_size)}</TableCell><TableCell>{pdf.parsed_count}</TableCell><TableCell>{date(pdf.fetched_at)}</TableCell></TableRow>)}</TableBody></Table><Pagination page={pdfs.data.page} pages={pdfs.data.pages} /></CardContent></Card>}</PageFrame>;
}

export function SourcesPage() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api<Source[]>("/v1/admin/sources") });
  return <PageFrame description="Permission, cadence, and processing health for each configured source." title="Sources">{sources.isPending ? <Skeleton className="h-60" /> : sources.isError ? <Alert variant="destructive">{sources.error.message}</Alert> : <Card><CardHeader><CardTitle className="font-heading">Configured sources</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>State</TableHead><TableHead>Rights</TableHead><TableHead>Review due</TableHead><TableHead>Last parsed</TableHead></TableRow></TableHeader><TableBody>{sources.data.map((source) => <TableRow key={source.id}><TableCell><p className="font-medium">{source.name}</p><p className="text-xs text-muted-foreground">{source.owner}</p></TableCell><TableCell><Status value={source.state} /></TableCell><TableCell className="font-mono text-xs">{source.rights_status}</TableCell><TableCell>{date(source.review_due_at)}</TableCell><TableCell>{date(source.last_parse_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}</PageFrame>;
}

function PageFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="space-y-6"><div><h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{children}</div>;
}

function usePage(): number {
  const [parameters] = useSearchParams();
  const page = Number(parameters.get("page") ?? 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}
