import { RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function Status({ value }: { value: string }) {
  const bad = ["failed", "blocked", "degraded", "review_required", "quarantined"].includes(value);
  const good = ["healthy", "succeeded", "parsed"].includes(value);
  return <Badge className={bad ? "border-red-200 bg-red-50 text-red-800" : good ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-muted text-muted-foreground"} variant="outline">{value.replaceAll("_", " ")}</Badge>;
}

export function Pagination({ page, pages }: { page: number; pages: number }) {
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground">Page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button asChild={page > 1} disabled={page <= 1} size="sm" variant="outline">{page > 1 ? <Link to={`?page=${page - 1}`}><RiArrowLeftLine />Previous</Link> : <span><RiArrowLeftLine />Previous</span>}</Button>
        <Button asChild={page < pages} disabled={page >= pages} size="sm" variant="outline">{page < pages ? <Link to={`?page=${page + 1}`}>Next<RiArrowRightLine /></Link> : <span>Next<RiArrowRightLine /></span>}</Button>
      </div>
    </div>
  );
}

export function date(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value)) : "Never";
}

export function bytes(value: number): string {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
