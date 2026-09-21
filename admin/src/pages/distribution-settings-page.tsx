import { useState } from "react";
import { RiArrowRightSLine, RiFacebookCircleLine, RiInstagramLine, RiMailLine, RiPlayLine, RiSendPlaneLine, RiTimeLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { date, PageFrame } from "@/components/data-display";
import { RecurrenceEditor } from "@/components/recurrence-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, distributionSettingsApi, type ChannelJobSchedule, type ChannelSetting, type DistributionSettings, type SettingChannel } from "@/lib/api";

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const wording: Record<SettingChannel, { title: string; icon: typeof RiMailLine; body: string }> = {
  email: { title: "Email", icon: RiMailLine, body: "The daily mails to everyone subscribed: the deals, the recipes, and the price alerts." },
  facebook: { title: "Facebook", icon: RiFacebookCircleLine, body: "The day's deals as one post on the Page." },
  instagram: { title: "Instagram", icon: RiInstagramLine, body: "The same post on the Instagram account, which takes nothing without a picture." },
  telegram: { title: "Telegram", icon: RiSendPlaneLine, body: "The deals digest to the channel and to everyone who linked their chat." },
};

const runBadge: Record<"ran" | "failed" | "skipped", { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ran: { label: "Ran", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Nothing to do", variant: "secondary" },
};

/** A moment as Colombo reads it, because every time on this page is that zone's, not the reader's. */
function inZone(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** The clock in Colombo as it reads right now, so the owner can see what "07:30" will mean. */
function colomboNow(zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return "—";
  }
}

/** What a channel sends, and whether it sends at all. Each channel holds its own schedules. */
export function DistributionSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["distribution", "settings"], queryFn: ({ signal }) => distributionSettingsApi.read({ signal }) });
  const [open, setOpen] = useState<SettingChannel | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Running a job sends the mail or puts the post out for real, so it is asked about first.
  const [confirm, setConfirm] = useState<ChannelJobSchedule | null>(null);
  const zone = settings.data?.zone ?? "Asia/Colombo";
  const jobs = settings.data?.jobs ?? [];
  const jobsOf = (channel: SettingChannel): ChannelJobSchedule[] => jobs.filter((job) => job.channel === channel);
  const keep = (data: DistributionSettings) => queryClient.setQueryData(["distribution", "settings"], { zone: data.zone, channels: data.settings.map((row) => row.channel), settings: data.settings, jobs: data.jobs });

  const saveChannel = useMutation({
    mutationFn: ({ channel, enabled }: { channel: SettingChannel; enabled: boolean }) => distributionSettingsApi.save(channel, { enabled }),
    onSuccess: keep,
  });
  const saveJob = useMutation({
    mutationFn: ({ channel, job, patch }: { channel: SettingChannel; job: string; patch: { enabled?: boolean; cron?: string } }) => distributionSettingsApi.saveJob(channel, job, patch),
    onSuccess: (data) => { keep(data); setEditing(null); },
  });
  const runJob = useMutation({
    mutationFn: ({ channel, job }: { channel: SettingChannel; job: string }) => distributionSettingsApi.runJob(channel, job),
    onSuccess: (data) => { keep(data); setConfirm(null); },
  });

  const channelRow = (setting: ChannelSetting) => {
    const words = wording[setting.channel];
    const Icon = words.icon;
    const own = jobsOf(setting.channel);
    const running = own.filter((job) => job.enabled).length;
    return (
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={setting.channel}>
        <button className="min-w-0 text-left" onClick={() => setOpen(setting.channel)} type="button">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Icon className="size-4" />{words.title}
            {setting.enabled ? null : <Badge variant="secondary">Off</Badge>}
            <span className="text-xs font-normal text-muted-foreground">{own.length === 1 ? "1 schedule" : `${own.length} schedules`}{own.length ? `, ${running} on` : ""}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{words.body}</p>
          {/* The times themselves live inside; a channel is not one thing on one clock. */}
          <p className="mt-1 truncate text-xs text-muted-foreground">{own.length ? own.map((job) => `${job.label}: ${job.enabled ? job.recurrence : "off"}`).join(" · ") : "Nothing scheduled here yet."}</p>
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setOpen(setting.channel)} size="sm" variant="outline">Schedules<RiArrowRightSLine className="size-4" /></Button>
          <div className="flex items-center gap-2">
            <Switch checked={setting.enabled} disabled={saveChannel.isPending} id={`on-${setting.channel}`} onCheckedChange={(on) => saveChannel.mutate({ channel: setting.channel, enabled: on })} />
            <Label className="text-xs text-muted-foreground" htmlFor={`on-${setting.channel}`}>{setting.enabled ? "Active" : "Inactive"}</Label>
          </div>
        </div>
      </div>
    );
  };

  const channel = open ? settings.data?.settings.find((setting) => setting.channel === open) : undefined;
  const openWords = open ? wording[open] : null;

  const jobRow = (job: ChannelJobSchedule) => {
    const key = `${job.channel}/${job.job}`;
    const busy = (saveJob.isPending || runJob.isPending) && (saveJob.variables?.job === job.job || runJob.variables?.job === job.job);
    return (
      <div className="grid gap-2 rounded-lg border p-3" key={key}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{job.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{job.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={job.enabled} disabled={busy} id={`job-${key}`} onCheckedChange={(on) => saveJob.mutate({ channel: job.channel, job: job.job, patch: { enabled: on } })} />
            <Label className="text-xs text-muted-foreground" htmlFor={`job-${key}`}>{job.enabled ? "On" : "Off"}</Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground">{job.recurrence}</span>
          <span className="font-mono">{job.cron}</span>
          {job.enabled && job.next_run_at ? <span>Next {inZone(job.next_run_at, zone)}</span> : null}
          {job.last_run_at ? (
            <span className="flex items-center gap-1.5">
              Last {inZone(job.last_run_at, zone)}
              {job.last_status ? <Badge variant={runBadge[job.last_status].variant}>{runBadge[job.last_status].label}</Badge> : null}
            </span>
          ) : <span>Not run yet</span>}
        </div>
        {job.last_error ? <p className="break-words text-xs text-destructive">{job.last_error}</p> : null}
        {editing === key ? (
          <RecurrenceEditor
            busy={saveJob.isPending}
            onCancel={() => setEditing(null)}
            onSave={(cron) => saveJob.mutate({ channel: job.channel, job: job.job, patch: { cron } })}
            value={job.cron}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setEditing(key)} size="sm" variant="outline"><RiTimeLine className="size-3.5" />Change when</Button>
            <Button disabled={busy} onClick={() => { runJob.reset(); setConfirm(job); }} size="sm" variant="ghost"><RiPlayLine className="size-3.5" />Run now</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <PageFrame
      description="What each channel sends, and whether it sends at all. A channel holds a schedule per thing it sends; open one to set them. Every time here is Sri Lanka time and takes effect on the next minute: nothing needs a restart."
      eyebrow="Distribution channels"
      title="Settings"
    >
      <Alert>
        <AlertTitle className="flex items-center gap-2"><RiTimeLine className="size-4" />{zone}</AlertTitle>
        <AlertDescription>
          It is <span className="font-mono text-foreground">{colomboNow(zone)}</span> in Colombo now. Every time on this page is written and read in that zone, whatever your own computer is set to.
        </AlertDescription>
      </Alert>

      {settings.isError ? <Alert variant="destructive"><AlertTitle>The settings did not load</AlertTitle><AlertDescription>{message(settings.error, "The server did not answer.")}</AlertDescription></Alert> : null}
      {saveChannel.isError || saveJob.isError ? <Alert variant="destructive"><AlertTitle>That did not save</AlertTitle><AlertDescription>{message(saveChannel.error ?? saveJob.error, "The server refused the change.")}</AlertDescription></Alert> : null}
      {runJob.isError ? <Alert variant="destructive"><AlertTitle>The run did not finish</AlertTitle><AlertDescription>{message(runJob.error, "The server did not answer.")}</AlertDescription></Alert> : null}
      {runJob.data ? <Alert><AlertTitle>{runJob.data.outcome.status === "ran" ? "Ran" : "Nothing to do"}</AlertTitle><AlertDescription>{runJob.data.outcome.detail}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader><CardTitle>Channels</CardTitle><CardDescription>A change takes effect on the next tick, about a minute away. A channel switched off holds all of its schedules, whatever each one says.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">{(settings.data?.settings ?? []).map(channelRow)}</CardContent>
      </Card>

      <AlertDialog onOpenChange={(isOpen) => { if (!isOpen) setConfirm(null); }} open={confirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {confirm?.label.toLowerCase()} now?</AlertDialogTitle>
            <AlertDialogDescription>
              This does the job straight away, in addition to its schedule: {confirm?.description.toLowerCase()} A second run on the same day sends nothing again — the day's own record and the outbox both hold it — so it is safe to press once and wait.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {runJob.isError ? <p className="break-words text-sm text-destructive" role="alert">{message(runJob.error, "The run did not finish.")}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={runJob.isPending}
              onClick={(event) => {
                // Held open until the server answers, so a refusal is read here rather than guessed at.
                event.preventDefault();
                if (confirm) runJob.mutate({ channel: confirm.channel, job: confirm.job });
              }}
            >
              {runJob.isPending ? "Running…" : "Run now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog onOpenChange={(isOpen) => { if (!isOpen) { setOpen(null); setEditing(null); runJob.reset(); } }} open={open !== null}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{openWords ? <openWords.icon className="size-4" /> : null}{openWords?.title} schedules</DialogTitle>
            <DialogDescription>
              {channel?.enabled === false
                ? "This channel is switched off, so none of these run until it is switched back on."
                : "Each one runs on its own clock. A run that fails is tried again half an hour later, whatever its recurrence says."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {open ? jobsOf(open).map(jobRow) : null}
            {open && !jobsOf(open).length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing is scheduled on this channel.</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
