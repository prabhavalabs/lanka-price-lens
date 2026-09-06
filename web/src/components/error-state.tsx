import { RiErrorWarningLine, RiRefreshLine, RiSearchLine, RiWifiOffLine } from "@remixicon/react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  error: unknown;
  /** Runs the request again; shown as a button when the failure is worth retrying. */
  onRetry?: (() => void) | undefined;
  /** True while the retry is in flight. */
  retrying?: boolean | undefined;
  /** Where to send someone when there is nothing to retry (a product that does not exist). */
  fallback?: { to: string; label: string } | undefined;
  className?: string | undefined;
};

/** What a page shows when its request failed: what happened, in plain words, and what to do next. */
export function ErrorState({ error, onRetry, retrying = false, fallback, className }: Props) {
  const failure = error instanceof ApiError ? error : new ApiError(0, error instanceof Error ? error.message : "Something went wrong.", true);
  const offline = failure.status === 0 && typeof navigator !== "undefined" && navigator.onLine === false;
  const Icon = failure.status === 404 ? RiSearchLine : offline || failure.status === 0 ? RiWifiOffLine : RiErrorWarningLine;
  const title = failure.status === 404 ? "Nothing here" : offline ? "You are offline" : failure.status === 0 ? "Could not reach PriceLens" : failure.retryable ? "Prices are not available right now" : "Something went wrong";
  return (
    <Empty className={cn("py-12", className)} role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription className="text-sm">{failure.message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {failure.retryable && onRetry ? (
          <Button disabled={retrying} onClick={onRetry} size="sm">
            {retrying ? <Spinner className="size-4" /> : <RiRefreshLine className="size-4" />}
            {retrying ? "Trying again" : "Try again"}
          </Button>
        ) : null}
        {fallback ? <Button asChild size="sm" variant={failure.retryable && onRetry ? "outline" : "default"}><Link to={fallback.to}>{fallback.label}</Link></Button> : null}
      </EmptyContent>
    </Empty>
  );
}
