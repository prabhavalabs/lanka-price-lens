import { useState } from "react";
import { RiFacebookCircleLine, RiInstagramLine, RiMailLine, RiSendPlaneLine, RiTimeLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { date, PageFrame } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, distributionSettingsApi, type ChannelSetting, type SettingChannel } from "@/lib/api";

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const wording: Record<SettingChannel, { title: string; icon: typeof RiMailLine; body: string }> = {
  email: { title: "Email", icon: RiMailLine, body: "The daily mails to everyone subscribed: the deals, the recipes, and the price alerts." },
  facebook: { title: "Facebook", icon: RiFacebookCircleLine, body: "The day's deals as one post on the Page, after the deals run." },
  instagram: { title: "Instagram", icon: RiInstagramLine, body: "The same post on the Instagram account, which takes nothing without a picture." },
  telegram: { title: "Telegram", icon: RiSendPlaneLine, body: "The deals digest to the channel and to everyone who linked their chat." },
};

/** The clock in Colombo as it reads right now, so the owner can see what "07:30" will mean. */
function colomboNow(zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return "—";
  }
}

/** When each channel sends, and whether it sends at all. */
export function DistributionSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["distribution", "settings"], queryFn: ({ signal }) => distributionSettingsApi.read({ signal }) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const zone = settings.data?.zone ?? "Asia/Colombo";

  const save = useMutation({
    mutationFn: ({ channel, patch }: { channel: SettingChannel; patch: { enabled?: boolean; send_at?: string } }) => distributionSettingsApi.save(channel, patch),
    onSuccess: (data) => queryClient.setQueryData(["distribution", "settings"], { zone: data.zone, channels: data.settings.map((row) => row.channel), settings: data.settings }),
  });

  const row = (setting: ChannelSetting) => {
    const words = wording[setting.channel];
    const Icon = words.icon;
    const pending = draft[setting.channel] ?? setting.send_at;
    return (
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={setting.channel}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium"><Icon className="size-4" />{words.title}{setting.enabled ? null : <Badge variant="secondary">Off</Badge>}</p>
          <p className="mt-1 text-xs text-muted-foreground">{words.body}</p>
          {setting.updated_at ? <p className="mt-1 text-xs text-muted-foreground">Last changed {date(setting.updated_at)}{setting.updated_by ? ` by ${setting.updated_by}` : ""}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor={`time-${setting.channel}`}>Sends at</Label>
            <Input
              className="w-32"
              disabled={save.isPending}
              id={`time-${setting.channel}`}
              onBlur={() => { if (pending !== setting.send_at) save.mutate({ channel: setting.channel, patch: { send_at: pending } }); }}
              onChange={(event) => setDraft({ ...draft, [setting.channel]: event.target.value })}
              type="time"
              value={pending}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={setting.enabled} disabled={save.isPending} id={`on-${setting.channel}`} onCheckedChange={(on) => save.mutate({ channel: setting.channel, patch: { enabled: on } })} />
            <Label className="text-xs text-muted-foreground" htmlFor={`on-${setting.channel}`}>{setting.enabled ? "Sending" : "Paused"}</Label>
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageFrame
      description="When each channel sends, and whether it sends at all. Every time here is Sri Lanka time, and takes effect on the next minute: nothing needs a restart."
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
      {save.isError ? <Alert variant="destructive"><AlertTitle>That did not save</AlertTitle><AlertDescription>{message(save.error, "The server refused the change.")}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader><CardTitle>Channels</CardTitle><CardDescription>A change takes effect on the next tick, about a minute away. Everything sends daily.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">{(settings.data?.settings ?? []).map(row)}</CardContent>
      </Card>
    </PageFrame>
  );
}
