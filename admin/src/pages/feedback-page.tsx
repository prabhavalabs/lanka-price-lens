import { RiBugLine, RiChat3Line, RiCheckDoubleLine, RiEyeLine, RiExternalLinkLine, RiInboxUnarchiveLine } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { EmptyTableRow, PageFrame, Pagination } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type FeedbackItem, type FeedbackList, type FeedbackStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const statuses: Array<{ value: FeedbackStatus | "all"; label: string }> = [
  { value: "new", label: "New" },
  { value: "seen", label: "Seen" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

/** Feedback and bug reports sent from the public site, worked through as new, seen, and done. */
export function FeedbackPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "new") as FeedbackStatus | "all";
  const page = Number(params.get("page") ?? "1");
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["feedback", status, page],
    queryFn: () => api<FeedbackList>(`/v1/admin/feedback?${new URLSearchParams({ ...(status === "all" ? {} : { status }), page: String(page), pageSize: "25" })}`),
    placeholderData: keepPreviousData,
  });
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: FeedbackStatus }) => api<FeedbackItem>(`/v1/admin/feedback/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feedback"] }),
  });
  const counts = list.data?.counts;
  const setStatus = (next: string) => {
    const search = new URLSearchParams(params);
    search.set("status", next);
    search.delete("page");
    setParams(search);
  };

  return (
    <PageFrame eyebrow="Public site" title="Feedback" description="What visitors to the price site sent: bug reports and suggestions, newest first. Mark a message seen while you look into it and done when it is handled.">
      <Tabs onValueChange={setStatus} value={status}>
        <TabsList>
          {statuses.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
              {counts && entry.value !== "all" && counts[entry.value] ? <span className="ml-1.5 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{counts[entry.value]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kind</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="hidden lg:table-cell">From</TableHead>
                <TableHead className="w-40">Received</TableHead>
                <TableHead className="w-44 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data && !list.data.items.length ? <EmptyTableRow columns={5} /> : null}
              {(list.data?.items ?? []).map((item) => (
                <TableRow key={item.id} className={cn(item.status === "done" && "opacity-70")}>
                  <TableCell>
                    <Badge variant={item.kind === "bug" ? "destructive" : "secondary"} className="gap-1">
                      {item.kind === "bug" ? <RiBugLine className="size-3" /> : <RiChat3Line className="size-3" />}
                      {item.kind === "bug" ? "Bug" : "Feedback"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="max-w-xl whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                    {item.page ? <a className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary" href={item.page} rel="noreferrer" target="_blank"><RiExternalLinkLine className="size-3" />{item.page.replace(/^https?:\/\//u, "")}</a> : null}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {item.email ? <a className="block text-foreground hover:text-primary" href={`mailto:${item.email}`}>{item.email}</a> : <span>anonymous</span>}
                    {item.user_agent ? <span className="mt-0.5 block max-w-56 truncate" title={item.user_agent}>{item.user_agent}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {item.status !== "seen" && item.status !== "done" ? <Button disabled={update.isPending} onClick={() => update.mutate({ id: item.id, next: "seen" })} size="sm" variant="outline"><RiEyeLine className="size-3.5" />Seen</Button> : null}
                      {item.status !== "done" ? <Button disabled={update.isPending} onClick={() => update.mutate({ id: item.id, next: "done" })} size="sm" variant="outline"><RiCheckDoubleLine className="size-3.5" />Done</Button> : null}
                      {item.status === "done" ? <Button disabled={update.isPending} onClick={() => update.mutate({ id: item.id, next: "new" })} size="sm" variant="ghost"><RiInboxUnarchiveLine className="size-3.5" />Reopen</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} pages={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))} total={list.data.total} pending={list.isFetching} /> : null}
    </PageFrame>
  );
}
