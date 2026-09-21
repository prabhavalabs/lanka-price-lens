import { RiArrowDownLine, RiArrowRightLine, RiArrowUpLine, RiCheckLine, RiFileCopyLine, RiMailSendLine, RiPlayLine, RiRefreshLine, RiRestartLine, RiSave3Line } from "@remixicon/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { date, EmptyTableRow, PageFrame, Status } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ApiError,
  dealsApi,
  mailFieldNames,
  mailKinds,
  mailTemplatesApi,
  newslettersApi,
  type Deal,
  type DealBaseline,
  type DealKind,
  type DealsDay,
  type EssentialWatch,
  type MailFields,
  type MailKind,
  type MailPlaceholder,
  type MailTemplate,
  type NewsletterKind,
  type NewsletterRun,
  type NewsletterRunReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What the preview frame may do. Scripts stay forbidden — a mail carries none, and without
 * allow-scripts nothing inside the frame can reach out of it — but the frame keeps this origin. A
 * frame sandboxed all the way has an origin belonging to nobody, and a browser hands such a frame
 * no subresource at all: every picture in the mail came out as the broken-image box.
 */
const previewSandbox = "allow-same-origin";

const kindCopy: Record<MailKind, { label: string; when: string }> = {
  verify_email: { label: "Verify email", when: "After sign-up, asking the person to confirm their address." },
  welcome: { label: "Welcome", when: "Once the address is verified." },
  reset_password: { label: "Reset password", when: "When someone asks for a password reset link." },
  password_changed: { label: "Password changed", when: "After a password is changed, so the person knows." },
  change_email: { label: "Change email", when: "To the new address, asking the person to confirm the change." },
  email_changed: { label: "Email changed", when: "To the old address, once the change has gone through." },
  account_deleted: { label: "Account deleted", when: "When an account is deleted." },
  recipes_daily: { label: "Daily recipes", when: "Every morning to people who switched on daily recipe ideas: three recipes picked for their preferences." },
  deals_daily: { label: "Daily deals", when: "Every morning to people who switched on the price digest: today's supermarket deals and the essentials watch." },
  price_alerts: { label: "Price alerts", when: "Every morning to people with price alerts on, listing the starred products whose rule fired." },
};

const fieldCopy: Record<keyof MailFields, { label: string; hint: string; long: boolean }> = {
  subject: { label: "Subject", hint: "The subject line.", long: false },
  preheader: { label: "Preheader", hint: "The short line mail apps show after the subject in the inbox.", long: false },
  heading: { label: "Heading", hint: "The title at the top of the mail.", long: false },
  intro: { label: "Intro", hint: "The paragraph before the button, the recipe cards, or the deal rows. Blank lines start new paragraphs.", long: true },
  outro: { label: "Outro", hint: "The paragraph after the button or the cards.", long: true },
  button_label: { label: "Button label", hint: "The wording on the button, where the mail has one.", long: false },
  reason: { label: "Reason", hint: "Why the person received this mail: a boxed note in account mail (amber for security notices), the footer's small print in the daily mails.", long: true },
};

const newsletterOrder: NewsletterKind[] = ["recipes_daily", "deals_daily", "price_alerts"];
const baselineCopy: Record<DealBaseline, string> = { yesterday: "yesterday", median14: "the 14-day median", other_stores: "the next cheapest store" };
const dealKindCopy: Record<DealKind, { label: string; variant: "default" | "secondary" | "outline" }> = {
  offer: { label: "Offer", variant: "default" },
  drop: { label: "Drop", variant: "secondary" },
  cheapest: { label: "Cheapest", variant: "outline" },
};

const rupeeFormat = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Prices arrive in minor units: 123450 renders as "Rs 1,234.50". */
function rupeesMinor(minor: number): string {
  return `Rs ${rupeeFormat.format(minor / 100)}`;
}

function percent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} %`;
}

/** A Colombo day ("2026-09-14") as "Mon, 14 Sept". */
function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type Notice = { tone: "ok" | "error"; text: string };

/**
 * The wording of every mail the site sends, with a live preview, and the two daily newsletters:
 * their runs, a way to run one by hand, and the deals the deals mail is built from.
 */
export function MailPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "newsletters" ? "newsletters" : "templates";
  const selectTab = (next: string) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    setParams(search);
  };

  return (
    <PageFrame eyebrow="Public site" title="Mail" description="The wording of every mail the site sends, with a preview beside the editor, and the two daily newsletters: what ran, a way to run one now, and the deals the deals mail is built from. The layout of the mails stays in code.">
      <Tabs onValueChange={selectTab} value={tab}>
        <TabsList aria-label="Mail views" className="w-full sm:w-fit" variant="line">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="newsletters">Newsletters</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "templates" ? <TemplatesTab /> : <NewslettersTab />}
    </PageFrame>
  );
}

function TemplatesTab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("kind");
  const kind: MailKind = mailKinds.find((candidate) => candidate === requested) ?? "verify_email";
  const templates = useQuery({
    queryKey: ["mail-templates"],
    queryFn: ({ signal }) => mailTemplatesApi.list({ signal }),
  });
  const byKind = new Map((templates.data ?? []).map((template) => [template.kind, template]));
  const selected = byKind.get(kind);
  const select = (next: MailKind) => {
    const search = new URLSearchParams(params);
    search.set("kind", next);
    setParams(search, { replace: true });
  };

  if (templates.isPending) return <Skeleton className="h-[40rem] rounded-xl" />;
  if (templates.isError) return <Alert variant="destructive"><AlertTitle>Mail templates unavailable</AlertTitle><AlertDescription>{templates.error.message}</AlertDescription></Alert>;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <Card className="py-0" size="sm">
        <ul aria-label="Mail kinds" className="divide-y divide-border">
          {mailKinds.map((entry) => {
            const template = byKind.get(entry);
            const active = entry === kind;
            return (
              <li key={entry}>
                <button
                  aria-current={active ? "true" : undefined}
                  className={cn("flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30", active && "bg-primary/10")}
                  onClick={() => select(entry)}
                  type="button"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className={cn("truncate text-sm font-medium", active && "text-primary")}>{kindCopy[entry].label}</span>
                    {template?.edited ? <Badge className="ml-auto shrink-0" variant="secondary">Edited</Badge> : null}
                  </span>
                  <span className="block w-full truncate text-xs text-muted-foreground">{template?.fields.subject ?? "Not available"}</span>
                  {template?.edited && template.updated_at ? <span className="block text-[11px] text-muted-foreground">Updated {date(template.updated_at)}{template.updated_by ? ` by ${template.updated_by}` : ""}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {selected ? <TemplateEditor key={selected.kind} template={selected} /> : (
        <Empty className="min-h-48 rounded-xl border"><EmptyHeader><EmptyTitle>This kind is not on the server yet</EmptyTitle><EmptyDescription>The API did not list a template for {kindCopy[kind].label}. Pick another kind on the left.</EmptyDescription></EmptyHeader></Empty>
      )}
    </div>
  );
}

function TemplateEditor({ template }: { template: MailTemplate }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<MailFields>(template.fields);
  // When the server's copy changes (a save, a reset, a refetch) the form follows it.
  const [synced, setSynced] = useState(template.fields);
  if (synced !== template.fields) {
    setSynced(template.fields);
    setFields(template.fields);
  }
  const [plain, setPlain] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const debounced = useDebouncedValue(fields, 500);
  const dirty = mailFieldNames.some((name) => fields[name] !== template.fields[name]);
  const preview = useQuery({
    queryKey: ["mail-preview", template.kind, debounced],
    queryFn: ({ signal }) => mailTemplatesApi.preview(template.kind, debounced, { signal }),
    placeholderData: keepPreviousData,
  });
  const settle = (next: MailTemplate) => {
    queryClient.setQueryData<MailTemplate[]>(["mail-templates"], (current) => current?.map((entry) => entry.kind === next.kind ? next : entry));
    setFields(next.fields);
  };
  const save = useMutation({
    mutationFn: () => mailTemplatesApi.save(template.kind, fields),
    onSuccess: (saved) => {
      settle(saved);
      setNotice({ tone: "ok", text: "Saved. Mail of this kind uses this wording from now on." });
    },
    onError: (error) => setNotice({ tone: "error", text: message(error, "The template did not save. Try again.") }),
  });
  const reset = useMutation({
    mutationFn: () => mailTemplatesApi.reset(template.kind),
    onSuccess: (restored) => {
      setConfirmReset(false);
      settle(restored);
      setNotice({ tone: "ok", text: "Back to the default wording." });
    },
  });
  const test = useMutation({
    mutationFn: () => mailTemplatesApi.test(template.kind, fields),
    onSuccess: (result) => setNotice(result.ok
      ? { tone: "ok", text: `Test mail sent to your address (reference ${result.reference}). It uses the wording as it is here, saved or not.` }
      : { tone: "error", text: `The mail service did not accept the test mail (reference ${result.reference}).` }),
    onError: (error) => setNotice({ tone: "error", text: message(error, "The test mail could not be sent.") }),
  });
  const update = (name: keyof MailFields, value: string) => {
    setNotice(null);
    setFields((current) => ({ ...current, [name]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">{kindCopy[template.kind].label}{template.edited ? <Badge variant="secondary">Edited</Badge> : <Badge variant="outline">Default wording</Badge>}</CardTitle>
        <CardDescription>{kindCopy[template.kind].when}{template.edited && template.updated_at ? ` Last edited ${date(template.updated_at)}${template.updated_by ? ` by ${template.updated_by}` : ""}.` : ""}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3">
            {mailFieldNames.map((name) => {
              const copy = fieldCopy[name];
              const id = `mail-${template.kind}-${name}`;
              const atDefault = fields[name] === template.defaults[name];
              return (
                <div className="flex flex-col gap-1" key={name}>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={id}>{copy.label}</Label>
                    {atDefault ? null : <Button onClick={() => update(name, template.defaults[name])} size="xs" type="button" variant="ghost">Use default</Button>}
                  </div>
                  {copy.long
                    ? <Textarea id={id} onChange={(event) => update(name, event.target.value)} rows={3} value={fields[name]} />
                    : <Input id={id} onChange={(event) => update(name, event.target.value)} value={fields[name]} />}
                  <p className="text-[11px] text-muted-foreground">{copy.hint}</p>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border bg-background/40 p-3">
            <p className="text-xs font-medium">Placeholders</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Click one to copy it, then paste it into a field. Each is filled in when the mail is sent.</p>
            {template.placeholders.length ? <div className="mt-2 flex flex-wrap gap-1.5">{template.placeholders.map((placeholder) => <PlaceholderChip key={placeholder.name} placeholder={placeholder} />)}</div> : <p className="mt-2 text-[11px] text-muted-foreground">This mail has no placeholders.</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">The layout is fixed in code: the header, colours, button, footer, recipe cards, and deal rows do not change here. A field left blank falls back to its default.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()} type="button"><RiSave3Line data-icon="inline-start" />{save.isPending ? "Saving…" : "Save"}</Button>
            <Button disabled={(!template.edited && !dirty) || reset.isPending} onClick={() => setConfirmReset(true)} type="button" variant="outline"><RiRestartLine data-icon="inline-start" />Reset to default</Button>
            <Button disabled={test.isPending} onClick={() => test.mutate()} type="button" variant="outline"><RiMailSendLine data-icon="inline-start" />{test.isPending ? "Sending…" : "Send test to me"}</Button>
            {dirty ? <span className="text-[11px] text-muted-foreground">Unsaved changes</span> : null}
          </div>
          {notice ? <p className={cn("text-xs", notice.tone === "error" ? "text-destructive" : "text-muted-foreground")} role="status">{notice.text}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">Preview</p>
              <p className="truncate text-[11px] text-muted-foreground" title={preview.data?.subject}>{preview.data ? `Subject: ${preview.data.subject}` : "Rendering…"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Label className="text-[11px] text-muted-foreground" htmlFor={`mail-${template.kind}-plain`}>Plain text</Label>
              <Switch checked={plain} id={`mail-${template.kind}-plain`} onCheckedChange={setPlain} />
            </div>
          </div>
          <div className={cn("overflow-hidden rounded-lg border transition-opacity", preview.isFetching && "opacity-70")}>
            {preview.isError ? (
              <Alert className="m-2" variant="destructive"><AlertTitle>The preview did not render</AlertTitle><AlertDescription>{message(preview.error, "The preview route did not answer.")}</AlertDescription></Alert>
            ) : preview.data ? plain ? (
              <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap bg-background/40 p-3 font-mono text-[11px] leading-relaxed">{preview.data.text}</pre>
            ) : (
              <iframe className="h-[42rem] w-full bg-white" sandbox={previewSandbox} srcDoc={preview.data.html} title={`Preview of the ${kindCopy[template.kind].label} mail`} />
            ) : <Skeleton className="h-[42rem] rounded-none" />}
          </div>
          <p className="text-[11px] text-muted-foreground">Rendered with sample data (today's deals or three real recipes when available) and refreshed as you type.</p>
        </div>
      </CardContent>

      <AlertDialog onOpenChange={(open) => { if (!open) { setConfirmReset(false); reset.reset(); } }} open={confirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {kindCopy[template.kind].label} to its default wording?</AlertDialogTitle>
            <AlertDialogDescription>Every field goes back to the wording in code and the edits here are dropped. Mail sent from then on uses the defaults.</AlertDialogDescription>
          </AlertDialogHeader>
          {reset.isError ? <p className="text-sm text-destructive" role="alert">{message(reset.error, "That did not reset. Try again.")}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the edits</AlertDialogCancel>
            <AlertDialogAction
              disabled={reset.isPending}
              onClick={(event) => {
                // Stays open until the API has answered, so a refusal shows here.
                event.preventDefault();
                reset.mutate();
              }}
            >
              {reset.isPending ? "Resetting…" : "Reset to default"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PlaceholderChip({ placeholder }: { placeholder: MailPlaceholder }) {
  const [copied, setCopied] = useState(false);
  const token = `{{${placeholder.name}}}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the token is still visible to copy by hand.
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-input/20 px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => void copy()} type="button">
          {token}
          {copied ? <RiCheckLine className="size-3 text-primary" /> : <RiFileCopyLine className="size-3 text-muted-foreground" />}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{placeholder.description}{copied ? " · Copied" : ""}</TooltipContent>
    </Tooltip>
  );
}

function NewslettersTab() {
  const recipes = useQuery({
    queryKey: ["newsletter-runs", "recipes_daily"],
    queryFn: ({ signal }) => newslettersApi.runs({ kind: "recipes_daily", limit: 20 }, { signal }),
  });
  const deals = useQuery({
    queryKey: ["newsletter-runs", "deals_daily"],
    queryFn: ({ signal }) => newslettersApi.runs({ kind: "deals_daily", limit: 20 }, { signal }),
  });
  const alerts = useQuery({
    queryKey: ["newsletter-runs", "price_alerts"],
    queryFn: ({ signal }) => newslettersApi.runs({ kind: "price_alerts", limit: 20 }, { signal }),
  });
  const queries: Record<NewsletterKind, UseQueryResult<NewsletterRun[]>> = { recipes_daily: recipes, deals_daily: deals, price_alerts: alerts };
  const runs = [...(recipes.data ?? []), ...(deals.data ?? []), ...(alerts.data ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 20);
  const loading = recipes.isPending || deals.isPending || alerts.isPending;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
        {newsletterOrder.map((kind) => <NewsletterCard key={kind} kind={kind} runs={queries[kind]} />)}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>The last 20 runs of the daily mails, newest first. A kind with a sent run for the day does not run again that day unless forced.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-9" key={index} />)}</div> : recipes.isError || deals.isError || alerts.isError ? (
            <Alert className="m-4" variant="destructive"><AlertTitle>Runs unavailable</AlertTitle><AlertDescription>{message(recipes.error ?? deals.error ?? alerts.error, "The runs list did not load.")}</AlertDescription></Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Newsletter</TableHead>
                  <TableHead className="hidden md:table-cell">Day</TableHead>
                  <TableHead className="hidden sm:table-cell">Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length ? runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-xs">{date(run.started_at)}</TableCell>
                    <TableCell className="text-xs font-medium">{kindCopy[run.kind].label}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{formatDay(run.day)}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground capitalize sm:table-cell">{run.trigger.replaceAll("_", " ")}</TableCell>
                    <TableCell><Status value={run.status} />{run.error ? <span className="mt-1 block max-w-64 truncate text-[11px] text-destructive" title={run.error}>{run.error}</span> : null}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{run.recipients}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{run.sent}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{run.skipped}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs tabular-nums", run.failed > 0 && "text-destructive")}>{run.failed}</TableCell>
                  </TableRow>
                )) : <EmptyTableRow columns={9} />}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <DealsSection />
    </>
  );
}

function NewsletterCard({ kind, runs }: { kind: NewsletterKind; runs: UseQueryResult<NewsletterRun[]> }) {
  const queryClient = useQueryClient();
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [report, setReport] = useState<NewsletterRunReport | null>(null);
  const run = useMutation({
    mutationFn: () => newslettersApi.run({ kind, dry_run: dryRun, force }),
    onSuccess: (result) => {
      setReport(result);
      void queryClient.invalidateQueries({ queryKey: ["newsletter-runs", kind] });
      // The deals run computes and saves the day first when it is missing.
      if (kind === "deals_daily") void queryClient.invalidateQueries({ queryKey: ["deals-today"] });
    },
  });
  const last = runs.data?.[0];
  const dryId = `newsletter-${kind}-dry-run`;
  const forceId = `newsletter-${kind}-force`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{kindCopy[kind].label}</CardTitle>
        <CardDescription>{kindCopy[kind].when}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border bg-background/40 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last run</p>
          {runs.isPending ? <Skeleton className="h-16" /> : runs.isError ? <p className="text-xs text-destructive">{message(runs.error, "The runs did not load.")}</p> : last ? <RunSummary run={last} /> : <p className="text-xs text-muted-foreground">Never run.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Switch checked={dryRun} className="mt-0.5" id={dryId} onCheckedChange={setDryRun} />
            <Label className="flex-col items-start gap-0.5" htmlFor={dryId}><span>Dry run</span><span className="font-normal text-muted-foreground">Build the mails and list who would receive them, without sending anything.</span></Label>
          </div>
          <div className="flex items-start gap-3">
            <Switch checked={force} className="mt-0.5" id={forceId} onCheckedChange={setForce} />
            <Label className="flex-col items-start gap-0.5" htmlFor={forceId}><span>Force</span><span className="font-normal text-muted-foreground">Run again even when today's mail has already been sent.</span></Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={run.isPending} onClick={() => run.mutate()} type="button" variant={dryRun ? "outline" : "default"}><RiPlayLine data-icon="inline-start" />{run.isPending ? "Running…" : dryRun ? "Run now (dry run)" : "Run now"}</Button>
          {!dryRun ? <span className="text-[11px] text-muted-foreground">Sends real mail to every recipient.</span> : null}
        </div>
        {run.isError ? <Alert variant="destructive"><AlertTitle>The run did not start</AlertTitle><AlertDescription>{message(run.error, "The API refused the run.")}</AlertDescription></Alert> : null}
        {report ? (
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Report{report.deliveries ? " · dry run" : ""}</p>
              <Button onClick={() => setReport(null)} size="xs" type="button" variant="ghost">Dismiss</Button>
            </div>
            <RunSummary run={report} />
            {report.deliveries ? (
              report.deliveries.length ? (
                <div className="mt-3 max-h-64 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Would go to</TableHead><TableHead>Subject</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {report.deliveries.map((delivery) => (
                        <TableRow key={delivery.account_id}>
                          <TableCell className="text-xs">{delivery.email}</TableCell>
                          <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={delivery.subject}>{delivery.subject}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="mt-2 text-xs text-muted-foreground">Nobody would receive this mail today.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunSummary({ run }: { run: NewsletterRun }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Status value={run.status} />
        <span className="font-medium">{formatDay(run.day)}</span>
        <span className="text-muted-foreground">· {run.trigger.replaceAll("_", " ")} · started {date(run.started_at)}{run.finished_at ? `, finished ${date(run.finished_at)}` : ""}</span>
      </div>
      <dl className="grid grid-cols-4 gap-2">
        <Count label="Recipients" value={run.recipients} />
        <Count label="Sent" value={run.sent} />
        <Count label="Skipped" value={run.skipped} />
        <Count label="Failed" tone={run.failed > 0 ? "bad" : "default"} value={run.failed} />
      </dl>
      {run.error ? <p className="text-xs text-destructive">{run.error}</p> : null}
    </div>
  );
}

function Count({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "bad" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-sm tabular-nums", tone === "bad" && "text-destructive")}>{value}</dd>
    </div>
  );
}

function DealsSection() {
  const queryClient = useQueryClient();
  const today = useQuery({
    queryKey: ["deals-today"],
    queryFn: ({ signal }) => dealsApi.today({ signal }),
    // A 503 means no day has been computed yet; retrying will not change that.
    retry: (count, error) => !(error instanceof ApiError && error.status === 503) && count < 2,
  });
  const compute = useMutation({
    mutationFn: () => dealsApi.compute(),
    onSuccess: (day) => queryClient.setQueryData<DealsDay>(["deals-today"], day),
  });
  const unavailable = today.isError && today.error instanceof ApiError && today.error.status === 503;
  const recompute = <Button disabled={compute.isPending} onClick={() => compute.mutate()} size="sm" type="button" variant="outline"><RiRefreshLine className={cn(compute.isPending && "animate-spin")} data-icon="inline-start" />{compute.isPending ? "Computing…" : "Recompute"}</Button>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's deals</CardTitle>
        <CardDescription>What the deals mail is built from: price drops against yesterday and the fortnight, the cheapest store for a product, and the watch on household essentials, over the four online stores. Recompute reads the warehouse again for today.</CardDescription>
        <CardAction>{recompute}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {compute.isError ? <Alert variant="destructive"><AlertTitle>The deals did not recompute</AlertTitle><AlertDescription>{message(compute.error, "The warehouse did not answer.")}</AlertDescription></Alert> : null}
        {today.isPending ? <Skeleton className="h-64 rounded-lg" /> : unavailable ? (
          <Empty className="min-h-48 rounded-lg border">
            <EmptyHeader>
              <EmptyTitle>No deals computed yet</EmptyTitle>
              <EmptyDescription>The deals engine has not run for any day, so there is nothing to show and the deals mail would be skipped. Recompute to read today's supermarket prices from the warehouse.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{recompute}</EmptyContent>
          </Empty>
        ) : today.isError ? (
          <Alert variant="destructive"><AlertTitle>Today's deals unavailable</AlertTitle><AlertDescription>{message(today.error, "The deals route did not answer.")}</AlertDescription></Alert>
        ) : <DealsDayView day={today.data} />}
      </CardContent>
    </Card>
  );
}

function DealsDayView({ day }: { day: DealsDay }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{formatDay(day.day)}</span>
        <span>computed {date(day.computed_at)}</span>
        <span>· {day.stats.series} series, {day.stats.fresh} fresh, {day.stats.considered} considered</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {day.stores.map((store) => (
          <div className="rounded-lg border bg-background/40 px-3 py-2" key={store.market_id}>
            <p className="truncate text-sm font-medium">{store.label}</p>
            <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{store.series}</span> series · <span className="font-mono tabular-nums">{store.deals}</span> {store.deals === 1 ? "deal" : "deals"}</p>
          </div>
        ))}
        {day.stores.length ? null : <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">No store had a fresh series for the day.</p>}
      </div>

      <DealsTable deals={day.deals} empty="No deals qualified today: no drop of 10 % against yesterday, 15 % against the fortnight, or 15 % under the next store." title="Deals" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Essentials watch</h3>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Cheapest at</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">vs yesterday</TableHead>
                <TableHead className="w-28">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {day.essentials.length ? day.essentials.map((essential) => <EssentialRow essential={essential} key={essential.product_id} />) : <TableRow><TableCell className="py-6 text-center text-xs text-muted-foreground" colSpan={5}>No essential had a price today.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>

      <DealsTable deals={day.movers_up} empty="No essential or tracked product rose 15 % or more." title="Movers up" />
    </>
  );
}

function DealsTable({ deals, empty, title }: { deals: Deal[]; empty: string; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium">{title}</h3>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Store</TableHead>
              <TableHead className="text-right">Now</TableHead>
              <TableHead className="hidden text-right md:table-cell">Was</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="w-24">Kind</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.length ? deals.map((deal) => (
              <TableRow key={`${deal.product_id}:${deal.market_id}`}>
                <TableCell>
                  <Link className="block truncate text-sm font-medium hover:text-primary" to={`/explorer?product=${encodeURIComponent(deal.product_id)}`}>{deal.label}</Link>
                  <span className="block text-[11px] text-muted-foreground">per {deal.unit}</span>
                </TableCell>
                <TableCell className="text-xs">{deal.market}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{rupeesMinor(deal.now_minor)}</TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground line-through">{rupeesMinor(deal.was_minor)}</span>
                  <span className="block text-[11px] text-muted-foreground">{baselineCopy[deal.baseline]}{deal.baseline === "other_stores" ? "" : `, ${formatDay(deal.was_on)}`}</span>
                </TableCell>
                <TableCell className={cn("text-right font-mono text-xs tabular-nums", deal.pct < 0 ? "text-primary" : deal.pct > 0 ? "text-destructive" : "")}>{percent(deal.pct)}</TableCell>
                <TableCell><Badge variant={dealKindCopy[deal.kind].variant}>{dealKindCopy[deal.kind].label}</Badge></TableCell>
              </TableRow>
            )) : <TableRow><TableCell className="py-6 text-center text-xs text-muted-foreground" colSpan={6}>{empty}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function EssentialRow({ essential }: { essential: EssentialWatch }) {
  const trend: Record<EssentialWatch["trend"], { icon: ReactNode; label: string; className: string }> = {
    down: { icon: <RiArrowDownLine className="size-3.5" />, label: "Below the fortnight", className: "text-primary" },
    flat: { icon: <RiArrowRightLine className="size-3.5" />, label: "Steady", className: "text-muted-foreground" },
    up: { icon: <RiArrowUpLine className="size-3.5" />, label: "Above the fortnight", className: "text-destructive" },
  };
  const current = trend[essential.trend];
  return (
    <TableRow>
      <TableCell>
        <Link className="block truncate text-sm font-medium hover:text-primary" to={`/explorer?product=${encodeURIComponent(essential.product_id)}`}>{essential.label}</Link>
        <span className="block text-[11px] text-muted-foreground">per {essential.unit}</span>
      </TableCell>
      <TableCell className="text-xs">{essential.cheapest.market}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{rupeesMinor(essential.cheapest.price_minor)}</TableCell>
      <TableCell className={cn("text-right font-mono text-xs tabular-nums", essential.change_pct === null ? "text-muted-foreground" : essential.change_pct < 0 ? "text-primary" : essential.change_pct > 0 ? "text-destructive" : "")}>{essential.change_pct === null ? "—" : percent(essential.change_pct)}</TableCell>
      <TableCell><span className={cn("inline-flex items-center gap-1 text-[11px]", current.className)}>{current.icon}{current.label}</span></TableCell>
    </TableRow>
  );
}
