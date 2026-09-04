import { useEffect, type MouseEvent, type ReactNode } from "react";
import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ListParameters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { paginationItems } from "@/lib/pagination";

export type TableState = ListParameters & {
  update: (values: Partial<ListParameters>, replace?: boolean) => void;
};

export function useTableState(): TableState {
  const [parameters, setParameters] = useSearchParams();
  const requestedPage = Number(parameters.get("page") ?? 1);
  const requestedSize = Number(parameters.get("pageSize") ?? 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = [10, 20, 50, 100].includes(requestedSize) ? requestedSize : 10;
  const search = (parameters.get("search") ?? "").slice(0, 100);
  const status = (parameters.get("status") ?? "").slice(0, 50);
  const signature = parameters.toString();

  useEffect(() => {
    const next = new URLSearchParams(parameters);
    next.set("page", String(page));
    next.set("pageSize", String(pageSize));
    if (next.toString() !== signature) setParameters(next, { replace: true });
  }, [page, pageSize, parameters, setParameters, signature]);

  return {
    page,
    pageSize,
    search,
    status,
    update: (values, replace = false) => {
      const next = new URLSearchParams(parameters);
      for (const [key, value] of Object.entries(values)) {
        if (value === "") next.delete(key);
        else if (value !== undefined) next.set(key, String(value));
      }
      setParameters(next, { replace });
    },
  };
}

export function TableControls({
  state,
  placeholder,
  statuses,
}: {
  state: TableState;
  placeholder: string;
  statuses: Array<{ label: string; value: string }>;
}) {
  const form = useForm<{ search: string }>({ values: { search: state.search } });
  const filtered = Boolean(state.search || state.status);
  return (
    <form className="flex flex-col gap-2 border-b border-white/[0.07] px-3 py-2.5 sm:flex-row sm:items-center" onSubmit={form.handleSubmit(({ search }) => state.update({ page: 1, search: search.trim() }))}>
      <InputGroup className="min-w-0 flex-1 sm:max-w-md">
        <InputGroupAddon><RiSearchLine /></InputGroupAddon>
        <InputGroupInput aria-label="Search table" placeholder={placeholder} {...form.register("search")} />
      </InputGroup>
      <Button type="submit" variant="outline"><RiSearchLine data-icon="inline-start" />Search</Button>
      <Select onValueChange={(value) => state.update({ page: 1, status: value === "all" ? "" : value })} value={state.status || "all"}>
        <SelectTrigger aria-label="Filter by status" className="h-10 w-full sm:w-44"><SelectValue /></SelectTrigger>
        <SelectContent position="popper"><SelectGroup><SelectItem value="all">All statuses</SelectItem>{statuses.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Select onValueChange={(value) => state.update({ page: 1, pageSize: Number(value) })} value={String(state.pageSize)}>
        <SelectTrigger aria-label="Rows per page" className="h-10 w-full sm:w-32"><SelectValue /></SelectTrigger>
        <SelectContent position="popper"><SelectGroup>{[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {filtered ? <Button onClick={() => state.update({ page: 1, search: "", status: "" })} type="button" variant="ghost"><RiCloseLine data-icon="inline-start" />Clear</Button> : null}
    </form>
  );
}

export function Status({ value, className }: { value: string; className?: string }) {
  const bad = ["failed", "blocked", "degraded", "review_required", "quarantined"].includes(value);
  const good = ["healthy", "succeeded", "parsed", "canonicalized", "indexed", "scheduled", "online"].includes(value);
  const active = ["running", "pending", "processing", "discovered", "queued", "indexing"].includes(value);
  return (
    <Badge className={cn("capitalize", className)} variant={bad ? "destructive" : good ? "default" : active ? "secondary" : "outline"}>
      {active ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" data-icon="inline-start" /> : null}
      {value.replaceAll("_", " ")}
    </Badge>
  );
}

export function PageHeader({ title, description, eyebrow, actions }: { title: string; description: string; eyebrow?: string | undefined; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{eyebrow}</p> : null}
        <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div> : null}
    </div>
  );
}

export function PageFrame({ title, description, eyebrow, actions, children }: { title: string; description: string; eyebrow?: string | undefined; actions?: ReactNode; children: ReactNode }) {
  return <div className="flex flex-col gap-3.5"><PageHeader actions={actions} description={description} eyebrow={eyebrow} title={title} />{children}</div>;
}

export function EmptyTableRow({ columns }: { columns: number }) {
  return <TableRow><TableCell colSpan={columns}><Empty className="min-h-28 p-4"><EmptyHeader><EmptyTitle>No matching records</EmptyTitle><EmptyDescription>Try adjusting the search or filters.</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>;
}

export function Pagination({ page, pageSize, pages, pending = false, total }: { page: number; pageSize: number; pages: number; pending?: boolean; total: number }) {
  const [parameters, setParameters] = useSearchParams();
  const currentUrlPage = Number(parameters.get("page") ?? 1);
  useEffect(() => {
    if (pending || currentUrlPage === page) return;
    const next = new URLSearchParams(parameters);
    next.set("page", String(page));
    setParameters(next, { replace: true });
  }, [currentUrlPage, page, parameters, pending, setParameters]);
  const items = paginationItems(page, pages);
  const href = (target: number) => {
    const next = new URLSearchParams(parameters);
    next.set("page", String(target));
    return `?${next}`;
  };
  const navigate = (target: number) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (target < 1 || target > pages || target === page) return;
    const next = new URLSearchParams(parameters);
    next.set("page", String(target));
    setParameters(next);
  };
  const firstItem = total ? (page - 1) * pageSize + 1 : 0;
  const lastItem = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col items-center gap-1.5 border-t border-white/[0.07] px-3 py-2 text-xs">
      <PaginationRoot aria-label="Table pagination">
        <PaginationContent>
          <PaginationItem><PaginationPrevious aria-disabled={page <= 1} className={cn(page <= 1 && "pointer-events-none opacity-50")} href={href(Math.max(1, page - 1))} onClick={navigate(page - 1)} tabIndex={page <= 1 ? -1 : undefined} /></PaginationItem>
          {items.map((item) => typeof item === "number" ? (
            <PaginationItem key={item}><PaginationLink href={href(item)} isActive={item === page} onClick={navigate(item)} size="icon-sm">{item}</PaginationLink></PaginationItem>
          ) : (
            <PaginationItem key={item}><PaginationEllipsis /></PaginationItem>
          ))}
          <PaginationItem><PaginationNext aria-disabled={page >= pages} className={cn(page >= pages && "pointer-events-none opacity-50")} href={href(Math.min(pages, page + 1))} onClick={navigate(page + 1)} tabIndex={page >= pages ? -1 : undefined} /></PaginationItem>
        </PaginationContent>
      </PaginationRoot>
      <span className="font-mono text-muted-foreground">{firstItem}–{lastItem} of {total} · Page {page} of {pages}</span>
    </div>
  );
}

export function date(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value)) : "Never";
}

export function bytes(value: number): string {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
