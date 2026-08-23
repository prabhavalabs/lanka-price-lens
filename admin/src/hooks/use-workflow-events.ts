import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  type KnowledgeItem,
  type KnowledgeListItem,
  type Page,
  type WorkflowEvent,
} from "@/lib/api";

type ProcessingPatch = Pick<KnowledgeListItem, "index_status" | "processing_dispatch_id" | "processing_run_id" | "processing_status">;

export function setKnowledgeProcessingState(
  queryClient: QueryClient,
  publicationId: string,
  patch: Partial<ProcessingPatch>,
): void {
  queryClient.setQueriesData<Page<KnowledgeListItem>>({ queryKey: ["knowledge-base"] }, (current) => {
    if (!current?.items.some((item) => item.publication_id === publicationId)) return current;
    return {
      ...current,
      items: current.items.map((item) => item.publication_id === publicationId ? { ...item, ...patch } : item),
    };
  });
  queryClient.setQueryData<KnowledgeItem>(["knowledge-document", publicationId], (current) => current
    ? { ...current, ...patch }
    : current);
}

export function applyWorkflowEvent(queryClient: QueryClient, event: WorkflowEvent): void {
  if (!event.publication_id) return;
  const isActive = (event.event_type === "dispatch" && ["queued", "running"].includes(event.status))
    || (event.event_type === "run" && event.status === "running");
  if (!isActive) return;
  setKnowledgeProcessingState(queryClient, event.publication_id, {
    index_status: "indexing",
    processing_dispatch_id: event.dispatch_id,
    processing_run_id: event.run_id,
    processing_status: event.status,
  });
}

export function WorkflowEventSubscriber() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/v1/admin/events/workflows");
    const publications = new Set<string>();
    const runs = new Set<string>();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      refreshTimer = null;
      const publicationIds = [...publications];
      const runIds = [...runs];
      publications.clear();
      runs.clear();
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-base"] }),
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-dispatches"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        ...publicationIds.map((id) => queryClient.invalidateQueries({ queryKey: ["knowledge-document", id] })),
        ...runIds.map((id) => queryClient.invalidateQueries({ queryKey: ["run-workflow", id] })),
      ]);
    };
    const scheduleRefresh = () => {
      if (refreshTimer === null) refreshTimer = setTimeout(flush, 80);
    };
    const handleReady = () => { scheduleRefresh(); };
    const handleWorkflow = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as WorkflowEvent;
        applyWorkflowEvent(queryClient, event);
        if (event.publication_id) publications.add(event.publication_id);
        if (event.run_id) runs.add(event.run_id);
        scheduleRefresh();
      } catch {
        scheduleRefresh();
      }
    };

    source.addEventListener("ready", handleReady);
    source.addEventListener("workflow", handleWorkflow as EventListener);
    return () => {
      source.removeEventListener("ready", handleReady);
      source.removeEventListener("workflow", handleWorkflow as EventListener);
      source.close();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
    };
  }, [queryClient]);

  return null;
}
