import { RiTelegram2Line } from "@remixicon/react";
import type { AccountProfile } from "@lanka-pricelens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FormError } from "@/components/account-forms";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { accountApi } from "@/lib/account-api";

/**
 * Telegram under Notifications: "Connect Telegram" opens the bot with a one-time code and the
 * page waits for the chat to be linked; once it is, the row names the chat, offers Disconnect,
 * and a switch says whether the daily mails and alerts go there as well. Hidden entirely when
 * the site has no bot.
 */
export function TelegramConnect({ account, onPreference, saving }: { account: AccountProfile; onPreference: (value: boolean) => void; saving: boolean }) {
  const client = useQueryClient();
  const [waiting, setWaiting] = useState<{ url: string; until: number } | null>(null);
  const status = useQuery({
    queryKey: ["account", "telegram", account.id],
    queryFn: ({ signal }) => accountApi.telegram.status(signal),
    staleTime: 30_000,
    // While a link is out, ask every few seconds until the chat shows up or the code's quarter hour is over.
    refetchInterval: (query) => (waiting && !query.state.data?.linked && Date.now() < waiting.until ? 3000 : false),
  });
  const link = useMutation({
    mutationFn: () => accountApi.telegram.link(),
    onSuccess: (start) => {
      setWaiting({ url: start.url, until: Date.parse(start.expires_at) });
      window.open(start.url, "_blank", "noopener");
    },
  });
  const unlink = useMutation({
    mutationFn: () => accountApi.telegram.unlink(),
    onSuccess: () => {
      setWaiting(null);
      void client.invalidateQueries({ queryKey: ["account", "telegram", account.id] });
    },
  });
  const linked = status.data?.linked ?? null;
  // The wait ends the moment the chat shows up.
  useEffect(() => {
    if (linked) setWaiting(null);
  }, [linked]);
  if (status.isPending || !status.data?.bot) return null;
  const who = linked ? (linked.username ? `@${linked.username}` : linked.first_name ?? "your chat") : null;
  return (
    <div className="mt-4 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#229ED9]/12 text-[#229ED9]"><RiTelegram2Line aria-hidden className="size-5" /></span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Telegram</p>
            {linked ? (
              <p className="text-pretty text-xs text-muted-foreground">Connected as {who}. Send /stop to the bot or disconnect here.</p>
            ) : waiting ? (
              <p className="text-pretty text-xs text-muted-foreground">Waiting for you to press Start in Telegram. If nothing opened, <a href={waiting.url} rel="noopener" target="_blank">open the bot</a>; the link works for 15 minutes.</p>
            ) : (
              <p className="text-pretty text-xs text-muted-foreground">Get the daily recipes, supermarket deals, and price alerts you switch on above in Telegram as well, from @{status.data.bot}.</p>
            )}
          </div>
        </div>
        {linked ? (
          <Button disabled={unlink.isPending} onClick={() => unlink.mutate()} size="sm" type="button" variant="outline">{unlink.isPending ? "Disconnecting" : "Disconnect"}</Button>
        ) : (
          <Button disabled={link.isPending} onClick={() => link.mutate()} size="sm" type="button">{link.isPending ? "Opening" : waiting ? "Open again" : "Connect Telegram"}</Button>
        )}
      </div>
      {linked ? (
        <div className="mt-3 flex items-start justify-between gap-4 border-t pt-3">
          <div className="space-y-0.5">
            <Label className="text-sm" htmlFor="pref-notify_telegram">Send them to Telegram too</Label>
            <p className="text-pretty text-xs text-muted-foreground">Each mail you have on above also arrives in the chat, as a message with the same picks and prices.</p>
          </div>
          <Switch checked={account.preferences.notify_telegram} disabled={saving} id="pref-notify_telegram" onCheckedChange={onPreference} />
        </div>
      ) : null}
      <FormError className="mt-3" error={link.error ?? unlink.error} />
    </div>
  );
}
