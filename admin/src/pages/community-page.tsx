import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiEyeLine,
  RiFileCopyLine,
  RiFileList3Line,
  RiInboxLine,
  RiInboxUnarchiveLine,
  RiQuestionLine,
  RiSeedlingLine,
  RiThumbDownLine,
  RiThumbUpLine,
  RiTranslate2,
} from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { StatTile } from "@/components/charts";
import { date, EmptyTableRow, PageFrame, Pagination } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  ApiError,
  communityApi,
  reactionSorts,
  reviewStatuses,
  submissionKinds,
  translationStatuses,
  type Contributor,
  type DishReactionRow,
  type ProductProposalRow,
  type ReactionSort,
  type RecipeSubmissionRow,
  type ReviewBody,
  type ReviewStatus,
  type SubmissionKind,
  type TranslationFeedbackRow,
  type TranslationStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const tabs = ["submissions", "translations", "products", "reactions"] as const;
type Tab = (typeof tabs)[number];
const pageSize = 25;
const count = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const languageLabel: Record<TranslationFeedbackRow["language"], string> = { si: "Sinhala", ta: "Tamil" };

type Notice = { tone: "ok" | "error"; text: string };

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** A URL parameter narrowed to one of the allowed values, "all" for no filter, or the fallback. */
function choice<T extends string>(value: string | null, options: readonly T[], fallback: T | "all"): T | "all" {
  if (value === "all") return "all";
  return options.find((option) => option === value) ?? fallback;
}

/** The current tab's filters live in the URL; changing one starts again at page 1. */
function useTabFilters() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("page") ?? "1");
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const setFilter = (key: string, value: string) => {
    const search = new URLSearchParams(params);
    if (value) search.set(key, value);
    else search.delete(key);
    search.delete("page");
    setParams(search);
  };
  return { params, page, setFilter };
}

/**
 * What signed-in people gave back on the recipe section, for the owner's decision: recipe
 * requests and submitted recipes, verdicts on translations, ingredients the registry lacks,
 * and the thumbs on every dish. Nothing here changes the catalogue by itself: approving a
 * recipe is the signal to merge its JSON into data/recipes by hand.
 */
export function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = tabs.find((candidate) => candidate === params.get("tab")) ?? "submissions";
  const overview = useQuery({
    queryKey: ["community", "overview"],
    queryFn: ({ signal }) => communityApi.overview({ signal }),
  });
  const totals = overview.data;
  // Each tab keeps its own filters, so switching starts the next one from its defaults.
  const selectTab = (next: string) => setParams(new URLSearchParams({ tab: next }));
  const pill = (value: number | undefined) => value ? <span className="ml-1.5 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{count.format(value)}</span> : null;

  return (
    <PageFrame eyebrow="Community" title="Community" description="What people with an account gave back on the recipe section: requests for missing dishes and recipes they wrote, verdicts on the Sinhala and Tamil translations, ingredients the registry does not carry, and the thumbs on every dish. Approving a recipe is the signal to merge its JSON into the corpus by hand; nothing here changes the served catalogue on its own.">
      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          hint="Requests and recipes waiting for a decision"
          icon={<RiInboxLine />}
          label="Pending submissions"
          tone={totals?.pending_submissions ? "warning" : "default"}
          value={totals ? count.format(totals.pending_submissions) : "–"}
        />
        <StatTile
          hint="Translation verdicts nobody has looked at yet"
          icon={<RiTranslate2 />}
          label="New translation feedback"
          tone={totals?.new_translations ? "warning" : "default"}
          value={totals ? count.format(totals.new_translations) : "–"}
        />
        <StatTile
          hint="Ingredients proposed from the recipe editor"
          icon={<RiSeedlingLine />}
          label="Pending ingredients"
          tone={totals?.pending_products ? "warning" : "default"}
          value={totals ? count.format(totals.pending_products) : "–"}
        />
        <StatTile
          hint={totals ? `${count.format(totals.reactions.dislikes)} dislikes · ${count.format(totals.reactions.dishes)} dishes with a reaction` : "Likes across every dish"}
          icon={<RiThumbUpLine />}
          label="Likes"
          value={totals ? count.format(totals.reactions.likes) : "–"}
        />
      </section>
      {overview.isError ? <p className="text-xs text-destructive" role="alert">{message(overview.error, "The community overview did not load.")}</p> : null}

      <Tabs onValueChange={selectTab} value={tab}>
        <TabsList aria-label="Community views" className="w-full sm:w-fit" variant="line">
          <TabsTrigger value="submissions">Submissions{pill(totals?.pending_submissions)}</TabsTrigger>
          <TabsTrigger value="translations">Translations{pill(totals?.new_translations)}</TabsTrigger>
          <TabsTrigger value="products">Products{pill(totals?.pending_products)}</TabsTrigger>
          <TabsTrigger value="reactions">Reactions</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "submissions" ? <SubmissionsTab /> : tab === "translations" ? <TranslationsTab /> : tab === "products" ? <ProductsTab /> : <ReactionsTab />}
    </PageFrame>
  );
}

function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] px-3 py-2.5">{children}</div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="h-8 w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent position="popper"><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return <p className={cn("border-b border-white/[0.07] px-3 py-2 text-xs", notice.tone === "error" ? "text-destructive" : "text-muted-foreground")} role="status">{notice.text}</p>;
}

function LoadingRow({ columns, label }: { columns: number; label: string }) {
  return <TableRow><TableCell className="py-8 text-center text-sm text-muted-foreground" colSpan={columns}>{label}</TableCell></TableRow>;
}

function ErrorRow({ columns, error, fallback }: { columns: number; error: unknown; fallback: string }) {
  return <TableRow><TableCell className="py-8 text-center text-sm text-destructive" colSpan={columns}>{message(error, fallback)}</TableCell></TableRow>;
}

/** Where a review ended up: pending and new pulse, approved and applied are green, rejected is red. */
function OutcomeBadge({ value }: { value: ReviewStatus | TranslationStatus }) {
  const open = value === "pending" || value === "new";
  const variant = value === "approved" || value === "applied" ? "default" : value === "rejected" ? "destructive" : open ? "secondary" : "outline";
  return (
    <Badge className="capitalize" variant={variant}>
      {open ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" data-icon="inline-start" /> : null}
      {value}
    </Badge>
  );
}

function ContributorCell({ row, className }: { row: Contributor; className?: string }) {
  const addressable = row.email.includes("@");
  return (
    <div className={cn("min-w-0", className)}>
      <span className="block truncate text-xs font-medium text-foreground">{row.display_name}</span>
      {addressable ? <a className="block truncate text-[11px] text-muted-foreground hover:text-primary" href={`mailto:${row.email}`}>{row.email}</a> : <span className="block truncate text-[11px] text-muted-foreground">{row.email}</span>}
    </div>
  );
}

function ExpandButton({ expanded, label }: { expanded: boolean; label: string }) {
  return (
    <Button aria-expanded={expanded} aria-label={label} className="text-muted-foreground" size="icon-xs" tabIndex={-1} variant="ghost">
      {expanded ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
    </Button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button onClick={() => void copy()} size="sm" variant="outline">
      {copied ? <RiCheckLine className="text-primary" data-icon="inline-start" /> : <RiFileCopyLine data-icon="inline-start" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function KindBadge({ kind }: { kind: SubmissionKind }) {
  return (
    <Badge className="gap-1" variant={kind === "recipe" ? "secondary" : "outline"}>
      {kind === "recipe" ? <RiFileList3Line className="size-3" /> : <RiQuestionLine className="size-3" />}
      {kind === "recipe" ? "Recipe" : "Request"}
    </Badge>
  );
}

const reviewOptions: Array<{ value: ReviewStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All statuses" },
];

function SubmissionsTab() {
  const { params, page, setFilter } = useTabFilters();
  const status = choice(params.get("status") ?? "pending", reviewStatuses, "pending");
  const kind = choice(params.get("kind"), submissionKinds, "all");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["community", "submissions", status, kind, page],
    queryFn: ({ signal }) => communityApi.submissions({ status: status === "all" ? undefined : status, kind: kind === "all" ? undefined : kind, page, pageSize }, { signal }),
    placeholderData: keepPreviousData,
  });
  const columns = 5;

  return (
    <Card>
      <CardContent className="p-0">
        <FilterBar>
          <FilterSelect label="Filter by status" onChange={(value) => setFilter("status", value)} options={reviewOptions} value={status} />
          <FilterSelect label="Filter by kind" onChange={(value) => setFilter("kind", value === "all" ? "" : value)} options={[{ value: "all", label: "Requests and recipes" }, { value: "request", label: "Requests" }, { value: "recipe", label: "Recipes" }]} value={kind} />
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Open a row to read the notes, the recipe JSON, and decide.</span>
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Kind</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden lg:table-cell">Contributor</TableHead>
              <TableHead className="w-44">Created</TableHead>
              <TableHead className="w-28 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? <LoadingRow columns={columns} label="Loading submissions…" /> : null}
            {list.isError ? <ErrorRow columns={columns} error={list.error} fallback="The submissions list did not load." /> : null}
            {list.data && !list.data.items.length ? <EmptyTableRow columns={columns} /> : null}
            {(list.data?.items ?? []).map((item) => (
              <TableRow key={item.id} className={cn("cursor-pointer", item.status !== "pending" && "opacity-80")} onClick={() => setSelected(item.id)}>
                <TableCell><KindBadge kind={item.kind} /></TableCell>
                <TableCell>
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  {item.notes ? <span className="block max-w-xl truncate text-[11px] text-muted-foreground" title={item.notes}>{item.notes}</span> : null}
                </TableCell>
                <TableCell className="hidden lg:table-cell"><ContributorCell row={item} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{date(item.created_at)}</TableCell>
                <TableCell className="text-right"><OutcomeBadge value={item.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} pages={Math.max(1, list.data.pages)} total={list.data.total} pending={list.isFetching} /> : null}
      </CardContent>
      <SubmissionSheet id={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

/** One submission in full: the notes, who sent it, the recipe JSON when there is one, and the decision. */
function SubmissionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const mobile = useMediaQuery("(max-width: 639px)");
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const detail = useQuery({
    queryKey: ["community", "submission", id],
    queryFn: ({ signal }) => communityApi.submission(id ?? "", { signal }),
    enabled: id !== null,
  });
  const review = useMutation({
    mutationFn: ({ target, status }: { target: string; status: ReviewStatus }) => {
      const trimmed = note.trim();
      const body: ReviewBody = trimmed && status !== "pending" ? { status, review_note: trimmed } : { status };
      return communityApi.reviewSubmission(target, body);
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["community", "submission", row.id], row);
      void queryClient.invalidateQueries({ queryKey: ["community"] });
      setNote("");
      setNotice({ tone: "ok", text: row.status === "pending" ? "Reopened; it is back in the pending queue." : row.status === "approved" ? (row.kind === "recipe" ? "Approved. Copy the JSON below and merge it into data/recipes." : "Approved.") : "Rejected; the contributor sees the status and your note." });
    },
    onError: (error) => setNotice({ tone: "error", text: message(error, "The decision did not save. Try again.") }),
  });
  const close = (open: boolean) => {
    if (open) return;
    onClose();
    setNote("");
    setNotice(null);
    review.reset();
  };
  const row = detail.data;
  const json = row?.recipe ? JSON.stringify(row.recipe, null, 2) : null;

  return (
    <Sheet onOpenChange={close} open={id !== null}>
      <SheetContent className={cn("w-full min-w-0 overflow-hidden data-[side=right]:sm:max-w-xl", mobile && "max-h-[88dvh] rounded-t-xl data-[side=bottom]:h-[88dvh]")} side={mobile ? "bottom" : "right"}>
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="truncate">{row?.name ?? "Submission"}</SheetTitle>
          <SheetDescription>{row ? `${row.kind === "recipe" ? "A recipe" : "A request"} from ${row.display_name}, ${date(row.created_at)}` : "Loading the submission…"}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          <div className="w-0 min-w-full space-y-5 p-4 sm:p-5">
            {detail.isPending && id !== null ? <Skeleton className="h-40 rounded-lg" /> : null}
            {detail.isError ? <p className="text-sm text-destructive" role="alert">{message(detail.error, "The submission did not load.")}</p> : null}
            {row ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <KindBadge kind={row.kind} />
                  <OutcomeBadge value={row.status} />
                  {row.reviewed_at ? <span className="text-[11px] text-muted-foreground">Reviewed {date(row.reviewed_at)}{row.reviewed_by ? ` by ${row.reviewed_by}` : ""}</span> : null}
                </div>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Contributor</dt>
                  <dd><ContributorCell row={row} /></dd>
                  {row.source_recipe_id ? <><dt className="text-muted-foreground">Own recipe</dt><dd className="font-mono text-[11px]">{row.source_recipe_id}</dd></> : null}
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap leading-relaxed">{row.notes ?? <span className="text-muted-foreground">None</span>}</dd>
                  {row.review_note ? <><dt className="text-muted-foreground">Review note</dt><dd className="whitespace-pre-wrap leading-relaxed">{row.review_note}</dd></> : null}
                </dl>
                {json ? (
                  <section aria-labelledby="submission-json-title" className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-heading text-sm font-semibold" id="submission-json-title">Recipe JSON</h3>
                      <CopyButton label="Copy JSON" text={json} />
                    </div>
                    <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{json}</pre>
                  </section>
                ) : row.kind === "recipe" ? <p className="text-xs text-muted-foreground">The recipe JSON is missing from this submission.</p> : null}
                {row.status === "pending" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="submission-review-note">Review note (optional)</Label>
                    <Textarea id="submission-review-note" onChange={(event) => setNote(event.target.value)} placeholder="Shown to the contributor beside the outcome, for instance why a recipe was not taken." rows={3} value={note} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </ScrollArea>
        <SheetFooter className="border-t">
          {notice ? <p className={cn("text-xs", notice.tone === "error" ? "text-destructive" : "text-muted-foreground")} role="status">{notice.text}</p> : null}
          {row ? (
            <div className="flex flex-wrap justify-end gap-2">
              {row.status === "pending" ? (
                <>
                  <Button disabled={review.isPending} onClick={() => review.mutate({ target: row.id, status: "rejected" })} variant="outline"><RiCloseLine data-icon="inline-start" />Reject</Button>
                  <Button disabled={review.isPending} onClick={() => review.mutate({ target: row.id, status: "approved" })}><RiCheckLine data-icon="inline-start" />Approve</Button>
                </>
              ) : (
                <Button disabled={review.isPending} onClick={() => review.mutate({ target: row.id, status: "pending" })} variant="outline"><RiInboxUnarchiveLine data-icon="inline-start" />Reopen</Button>
              )}
            </div>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const translationOptions: Array<{ value: TranslationStatus | "all"; label: string }> = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "applied", label: "Applied" },
  { value: "all", label: "All statuses" },
];

function TranslationsTab() {
  const { params, page, setFilter } = useTabFilters();
  const status = choice(params.get("status") ?? "new", translationStatuses, "new");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["community", "translations", status, page],
    queryFn: ({ signal }) => communityApi.translations({ status: status === "all" ? undefined : status, page, pageSize }, { signal }),
    placeholderData: keepPreviousData,
  });
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: TranslationStatus }) => communityApi.reviewTranslation(id, next),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["community"] });
      setNotice({ tone: "ok", text: `${row.dish_name ?? row.dish_id} (${languageLabel[row.language]}): marked ${row.status}.` });
    },
    onError: (error) => setNotice({ tone: "error", text: message(error, "The status did not save. Try again.") }),
  });
  const act = (id: string, next: TranslationStatus) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    update.mutate({ id, next });
  };
  const columns = 7;

  return (
    <Card>
      <CardContent className="p-0">
        <FilterBar>
          <FilterSelect label="Filter by status" onChange={(value) => setFilter("status", value)} options={translationOptions} value={status} />
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Open a row for the correction and note. Reviewed means read; applied means the corpus was changed.</span>
        </FilterBar>
        <NoticeLine notice={notice} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dish</TableHead>
              <TableHead className="w-24">Language</TableHead>
              <TableHead className="w-28">Verdict</TableHead>
              <TableHead className="hidden lg:table-cell">Contributor</TableHead>
              <TableHead className="hidden w-44 md:table-cell">Created</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-64 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? <LoadingRow columns={columns} label="Loading translation feedback…" /> : null}
            {list.isError ? <ErrorRow columns={columns} error={list.error} fallback="The translation feedback did not load." /> : null}
            {list.data && !list.data.items.length ? <EmptyTableRow columns={columns} /> : null}
            {(list.data?.items ?? []).flatMap((item) => {
              const open = expanded === item.id;
              const rows = [
                <TableRow key={item.id} className={cn("cursor-pointer", item.status === "applied" && "opacity-80")} onClick={() => setExpanded(open ? null : item.id)}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ExpandButton expanded={open} label={open ? "Hide the correction" : "Show the correction"} />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium">{item.dish_name ?? item.dish_id}</span>
                        {item.dish_name ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{item.dish_id}</span> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{languageLabel[item.language]}</Badge></TableCell>
                  <TableCell>
                    <Badge className="gap-1" variant={item.verdict === "correct" ? "default" : "destructive"}>
                      {item.verdict === "correct" ? <RiCheckLine className="size-3" /> : <RiCloseLine className="size-3" />}
                      {item.verdict === "correct" ? "Correct" : "Incorrect"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell"><ContributorCell row={item} /></TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{date(item.created_at)}</TableCell>
                  <TableCell><OutcomeBadge value={item.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      {item.status === "new" ? <Button disabled={update.isPending} onClick={act(item.id, "reviewed")} size="sm" variant="outline"><RiEyeLine data-icon="inline-start" />Mark reviewed</Button> : null}
                      {item.status !== "applied" ? <Button disabled={update.isPending} onClick={act(item.id, "applied")} size="sm" variant="outline"><RiCheckDoubleLine data-icon="inline-start" />Mark applied</Button> : null}
                      {item.status !== "new" ? <Button disabled={update.isPending} onClick={act(item.id, "new")} size="sm" variant="ghost"><RiInboxUnarchiveLine data-icon="inline-start" />Reopen</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>,
              ];
              if (open) {
                rows.push(
                  <TableRow key={`${item.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell className="py-3" colSpan={columns}>
                      <dl className="grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[7rem_1fr]">
                        <dt className="text-muted-foreground">Correction</dt>
                        <dd className="max-w-3xl whitespace-pre-wrap leading-relaxed">{item.correction ?? <span className="text-muted-foreground">No corrected text was offered.</span>}</dd>
                        <dt className="text-muted-foreground">Note</dt>
                        <dd className="max-w-3xl whitespace-pre-wrap leading-relaxed">{item.note ?? <span className="text-muted-foreground">None</span>}</dd>
                        <dt className="text-muted-foreground">Contributor</dt>
                        <dd><ContributorCell row={item} /></dd>
                        {item.reviewed_at ? <><dt className="text-muted-foreground">Reviewed</dt><dd>{date(item.reviewed_at)}{item.reviewed_by ? ` by ${item.reviewed_by}` : ""}</dd></> : null}
                      </dl>
                    </TableCell>
                  </TableRow>,
                );
              }
              return rows;
            })}
          </TableBody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} pages={Math.max(1, list.data.pages)} total={list.data.total} pending={list.isFetching} /> : null}
      </CardContent>
    </Card>
  );
}

type ProposalDecision = { row: ProductProposalRow; status: "approved" | "rejected" };

function ProductsTab() {
  const { params, page, setFilter } = useTabFilters();
  const status = choice(params.get("status") ?? "pending", reviewStatuses, "pending");
  const [decision, setDecision] = useState<ProposalDecision | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["community", "products", status, page],
    queryFn: ({ signal }) => communityApi.products({ status: status === "all" ? undefined : status, page, pageSize }, { signal }),
    placeholderData: keepPreviousData,
  });
  const review = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewBody }) => communityApi.reviewProduct(id, body),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["community"] });
      setDecision(null);
      setNote("");
      setNotice({ tone: "ok", text: row.status === "pending" ? `“${row.label}” is back in the pending queue.` : row.status === "approved" ? `Approved “${row.label}”. Add it to the product registry and map the recipe lines by hand.` : `Rejected “${row.label}”.` });
    },
    onError: (error) => setNotice({ tone: "error", text: message(error, "The decision did not save. Try again.") }),
  });
  const closeDialog = (open: boolean) => {
    if (open) return;
    setDecision(null);
    setNote("");
    review.reset();
  };
  const confirm = () => {
    if (!decision) return;
    const trimmed = note.trim();
    review.mutate({ id: decision.row.id, body: trimmed ? { status: decision.status, review_note: trimmed } : { status: decision.status } });
  };
  const columns = 8;

  return (
    <Card>
      <CardContent className="p-0">
        <FilterBar>
          <FilterSelect label="Filter by status" onChange={(value) => setFilter("status", value)} options={reviewOptions} value={status} />
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Approving is the signal to add the product to the registry and map the recipe lines.</span>
        </FilterBar>
        <NoticeLine notice={notice} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead className="w-28">Kind</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="hidden md:table-cell">Note</TableHead>
              <TableHead className="hidden lg:table-cell">Contributor</TableHead>
              <TableHead className="hidden w-44 xl:table-cell">Created</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? <LoadingRow columns={columns} label="Loading proposals…" /> : null}
            {list.isError ? <ErrorRow columns={columns} error={list.error} fallback="The proposals list did not load." /> : null}
            {list.data && !list.data.items.length ? <EmptyTableRow columns={columns} /> : null}
            {(list.data?.items ?? []).map((item) => (
              <TableRow key={item.id} className={cn(item.status !== "pending" && "opacity-80")}>
                <TableCell><span className="block truncate text-sm font-medium">{item.label}</span></TableCell>
                <TableCell className="text-xs capitalize text-muted-foreground">{item.category ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{item.unit_hint ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {item.note ? <span className="block max-w-sm truncate text-xs text-muted-foreground" title={item.note}>{item.note}</span> : <span className="text-xs text-muted-foreground">—</span>}
                  {item.review_note ? <span className="block max-w-sm truncate text-[11px] text-muted-foreground" title={item.review_note}>Review: {item.review_note}</span> : null}
                </TableCell>
                <TableCell className="hidden lg:table-cell"><ContributorCell row={item} /></TableCell>
                <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">{date(item.created_at)}</TableCell>
                <TableCell><OutcomeBadge value={item.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    {item.status === "pending" ? (
                      <>
                        <Button disabled={review.isPending} onClick={() => setDecision({ row: item, status: "approved" })} size="sm" variant="outline"><RiCheckLine data-icon="inline-start" />Approve</Button>
                        <Button disabled={review.isPending} onClick={() => setDecision({ row: item, status: "rejected" })} size="sm" variant="ghost"><RiCloseLine data-icon="inline-start" />Reject</Button>
                      </>
                    ) : (
                      <Button disabled={review.isPending} onClick={() => review.mutate({ id: item.id, body: { status: "pending" } })} size="sm" variant="ghost"><RiInboxUnarchiveLine data-icon="inline-start" />Reopen</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} pages={Math.max(1, list.data.pages)} total={list.data.total} pending={list.isFetching} /> : null}
      </CardContent>

      <Dialog onOpenChange={closeDialog} open={decision !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.status === "approved" ? "Approve" : "Reject"} “{decision?.row.label}”?</DialogTitle>
            <DialogDescription>
              {decision?.status === "approved"
                ? "The contributor sees the proposal as approved. The registry itself is edited by hand: add the product and map the recipe lines that carry this label."
                : "The contributor sees the proposal as rejected, with your note when you leave one. The recipe lines keep the typed label."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="proposal-review-note">Review note (optional)</Label>
            <Textarea id="proposal-review-note" onChange={(event) => setNote(event.target.value)} placeholder={decision?.status === "approved" ? "For instance which registry product it became." : "For instance that the registry already carries it under another name."} rows={3} value={note} />
          </div>
          {review.isError ? <p className="text-sm text-destructive" role="alert">{message(review.error, "The decision did not save. Try again.")}</p> : null}
          <DialogFooter>
            <Button onClick={() => closeDialog(false)} type="button" variant="outline">Cancel</Button>
            <Button disabled={review.isPending} onClick={confirm} type="button" variant={decision?.status === "rejected" ? "destructive" : "default"}>
              {review.isPending ? "Saving…" : decision?.status === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const sortOptions: Array<{ value: ReactionSort; label: string }> = [
  { value: "score", label: "Highest score" },
  { value: "dislikes", label: "Most dislikes" },
  { value: "recent", label: "Most recent" },
];

function ReactionsTab() {
  const { params, page, setFilter } = useTabFilters();
  const sort: ReactionSort = reactionSorts.find((candidate) => candidate === params.get("sort")) ?? "score";
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["community", "reactions", sort, page],
    queryFn: ({ signal }) => communityApi.reactions({ sort, page, pageSize }, { signal }),
    placeholderData: keepPreviousData,
  });
  const columns = 5;

  return (
    <Card>
      <CardContent className="p-0">
        <FilterBar>
          <FilterSelect label="Sort dishes" onChange={(value) => setFilter("sort", value === "score" ? "" : value)} options={sortOptions} value={sort} />
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">The public sees only the score, likes minus dislikes and never below zero. Open a row to see who reacted.</span>
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dish</TableHead>
              <TableHead className="w-24 text-right">Likes</TableHead>
              <TableHead className="w-24 text-right">Dislikes</TableHead>
              <TableHead className="w-24 text-right">Score</TableHead>
              <TableHead className="w-44 text-right">Last reaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? <LoadingRow columns={columns} label="Loading reactions…" /> : null}
            {list.isError ? <ErrorRow columns={columns} error={list.error} fallback="The reactions list did not load." /> : null}
            {list.data && !list.data.items.length ? <EmptyTableRow columns={columns} /> : null}
            {(list.data?.items ?? []).flatMap((item) => {
              const open = expanded === item.dish_id;
              const rows = [
                <TableRow key={item.dish_id} className="cursor-pointer" onClick={() => setExpanded(open ? null : item.dish_id)}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ExpandButton expanded={open} label={open ? "Hide who reacted" : "Show who reacted"} />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium">{item.name ?? item.dish_id}</span>
                        {item.name ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{item.dish_id}</span> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{count.format(item.likes)}</TableCell>
                  <TableCell className={cn("text-right font-mono text-xs tabular-nums", item.dislikes > item.likes && "text-destructive")}>{count.format(item.dislikes)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{count.format(item.score)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{date(item.last_at)}</TableCell>
                </TableRow>,
              ];
              if (open) rows.push(<ReactionsOfRow key={`${item.dish_id}-detail`} columns={columns} item={item} />);
              return rows;
            })}
          </TableBody>
        </Table>
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} pages={Math.max(1, list.data.pages)} total={list.data.total} pending={list.isFetching} /> : null}
      </CardContent>
    </Card>
  );
}

/** Who gave a dish its thumbs, loaded when the row is opened. */
function ReactionsOfRow({ item, columns }: { item: DishReactionRow; columns: number }) {
  const detail = useQuery({
    queryKey: ["community", "reactions", "of", item.dish_id],
    queryFn: ({ signal }) => communityApi.reactionsOf(item.dish_id, { signal }),
  });
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell className="py-3" colSpan={columns}>
        {detail.isPending ? <p className="text-xs text-muted-foreground">Loading who reacted…</p> : null}
        {detail.isError ? <p className="text-xs text-destructive" role="alert">{message(detail.error, "The reactions did not load.")}</p> : null}
        {detail.data && !detail.data.reactions.length ? <p className="text-xs text-muted-foreground">Nobody has a reaction on this dish any more.</p> : null}
        {detail.data?.reactions.length ? (
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {detail.data.reactions.map((reaction) => (
              <li key={`${reaction.email}-${reaction.updated_at}`} className="flex items-center gap-2 rounded-md border border-white/[0.07] px-2.5 py-1.5">
                {reaction.value === "up" ? <RiThumbUpLine aria-label="Liked" className="size-3.5 shrink-0 text-primary" /> : <RiThumbDownLine aria-label="Disliked" className="size-3.5 shrink-0 text-destructive" />}
                <ContributorCell className="flex-1" row={reaction} />
                <span className="shrink-0 text-[10px] text-muted-foreground">{date(reaction.updated_at)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
