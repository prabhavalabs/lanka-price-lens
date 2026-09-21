import { useState } from "react";
import { RiExternalLinkLine, RiFacebookCircleLine, RiLinkUnlinkM, RiRefreshLine, RiSendPlaneLine, RiShieldCheckLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { date, EmptyTableRow, PageFrame } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, facebookApi, facebookConnectPath, type FacebookPageRow, type FacebookPost, type FacebookStatus } from "@/lib/api";

/** What Facebook's redirect left in the address, in the owner's words. */
const outcomes: Record<string, { title: string; body: string; bad?: boolean }> = {
  connected: { title: "Page connected", body: "The day's deals go to the Page after the morning run. Use Post now to try it straight away." },
  cancelled: { title: "Nothing was connected", body: "Facebook's consent screen was closed before it finished.", bad: true },
  expired: { title: "That took too long", body: "The connection has to be finished within ten minutes of starting it, in the same browser. Start again.", bad: true },
  failed: { title: "Facebook refused the connection", body: "The server log has Facebook's reason. The usual causes are a redirect address that is not listed in the Meta app, or a wrong app secret.", bad: true },
  no_pages: { title: "No Page was shared", body: "On Facebook's consent screen, choose the Page under \"Which Pages do you want to use\". Start again and tick it.", bad: true },
  no_rights: { title: "Connected, but this account cannot post", body: "The Facebook account needs full control of the Page, or at least the task to create content.", bad: true },
  not_configured: { title: "The Meta app is not set yet", body: "Set LPL_FACEBOOK_APP_ID and LPL_FACEBOOK_APP_SECRET on the server and recreate the API container.", bad: true },
};

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const postBadge: Record<FacebookPost["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Posted", variant: "default" },
  queued: { label: "Waiting", variant: "secondary" },
  sending: { label: "Posting", variant: "secondary" },
  dead: { label: "Failed", variant: "destructive" },
};

/** The Facebook Page the day's deals are posted to: connect it, watch it, post by hand. */
export function FacebookPage() {
  const [params, setParams] = useSearchParams();
  const outcome = outcomes[params.get("facebook") ?? ""];
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["facebook"], queryFn: ({ signal }) => facebookApi.status({ signal }) });
  const active = status.data?.pages.find((page) => page.active);
  const preview = useQuery({ queryKey: ["facebook", "preview"], queryFn: ({ signal }) => facebookApi.preview({ signal }), retry: false });
  const [confirm, setConfirm] = useState<{ kind: "post" } | { kind: "disconnect"; page: FacebookPageRow } | null>(null);
  const refresh = (data?: FacebookStatus) => {
    if (data) queryClient.setQueryData(["facebook"], { configured: data.configured, app_id: data.app_id, redirect_uri: data.redirect_uri, pages: data.pages, posts: data.posts });
    else void queryClient.invalidateQueries({ queryKey: ["facebook"], exact: true });
  };
  const change = useMutation({
    mutationFn: (action: { kind: "activate" | "disconnect" | "check"; pageId: string } | { kind: "pause"; pageId: string; paused: boolean }) =>
      action.kind === "activate" ? facebookApi.activate(action.pageId) : action.kind === "pause" ? facebookApi.pause(action.pageId, action.paused) : action.kind === "disconnect" ? facebookApi.disconnect(action.pageId) : facebookApi.check(),
    onSuccess: (data) => { refresh(data); setConfirm(null); },
  });
  const post = useMutation({ mutationFn: () => facebookApi.postNow(), onSuccess: (data) => { refresh(data); setConfirm(null); }, onError: () => refresh() });

  return (
    <PageFrame eyebrow="Public site" title="Facebook Page" description="The day's supermarket deals as one post on your Page, every morning after the deals run. The picture is drawn by PriceLens and names the stores in words; no store logo or photograph is sent to Facebook.">
      {outcome ? (
        <Alert variant={outcome.bad ? "destructive" : "default"}>
          <AlertTitle>{outcome.title}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{outcome.body}</span>
            <Button onClick={() => setParams({}, { replace: true })} size="sm" variant="ghost">Dismiss</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {status.isError ? <Alert variant="destructive"><AlertTitle>The Facebook settings did not load</AlertTitle><AlertDescription>{message(status.error, "The server did not answer.")}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RiFacebookCircleLine className="size-4" />Connection</CardTitle>
          <CardDescription>
            {status.data && !status.data.configured
              ? "The Meta app's id and secret are not on the server yet."
              : "Connecting opens Facebook, where you choose the Page. PriceLens keeps the Page's access token encrypted and never shows it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {status.data && !status.data.configured ? (
            <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground">
              <li>In the Meta app, under Facebook Login settings, list this redirect address: <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{status.data.redirect_uri}</code></li>
              <li>On the server, set <code className="font-mono text-[11px] text-foreground">LPL_FACEBOOK_APP_ID</code> and <code className="font-mono text-[11px] text-foreground">LPL_FACEBOOK_APP_SECRET</code>, then recreate the API container.</li>
              <li>Switch the Meta app to Live, or only people with a role on the app will see its posts.</li>
            </ol>
          ) : null}
          {(status.data?.pages ?? []).map((page) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={page.page_id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {page.link ? <a className="inline-flex items-center gap-1 hover:text-primary" href={page.link} rel="noreferrer" target="_blank">{page.name}<RiExternalLinkLine className="size-3" /></a> : page.name}
                  {page.active ? <Badge>Posting here</Badge> : null}
                  {page.token_status === "invalid" ? <Badge variant="destructive">Needs connecting again</Badge> : null}
                  {!page.can_post ? <Badge variant="outline">No right to post</Badge> : null}
                  {page.paused ? <Badge variant="secondary">Paused</Badge> : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connected {date(page.connected_at)}{page.connected_by ? ` by ${page.connected_by}` : ""}
                  {page.token_checked_at ? ` · token checked ${date(page.token_checked_at)}` : ""}
                  {page.token_expires_at ? ` · token ends ${date(page.token_expires_at)}` : ""}
                </p>
                {page.token_error ? <p className="mt-1 break-words text-xs text-destructive">{page.token_error}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={!page.paused} disabled={change.isPending} id={`facebook-daily-${page.page_id}`} onCheckedChange={(on) => change.mutate({ kind: "pause", pageId: page.page_id, paused: !on })} />
                  <Label className="text-xs text-muted-foreground" htmlFor={`facebook-daily-${page.page_id}`}>Daily post</Label>
                </div>
                {page.active ? (
                  <Button disabled={change.isPending} onClick={() => change.mutate({ kind: "check", pageId: page.page_id })} size="sm" variant="outline"><RiShieldCheckLine className="size-3.5" />Check token</Button>
                ) : (
                  <Button disabled={change.isPending || !page.can_post} onClick={() => change.mutate({ kind: "activate", pageId: page.page_id })} size="sm" variant="outline">Post here</Button>
                )}
                <Button onClick={() => { change.reset(); setConfirm({ kind: "disconnect", page }); }} size="sm" variant="ghost"><RiLinkUnlinkM className="size-3.5" />Disconnect</Button>
              </div>
            </div>
          ))}
          {change.isError ? <p className="text-sm text-destructive" role="alert">{message(change.error, "That did not save. Try again.")}</p> : null}
          {status.data?.configured ? (
            <div>
              <Button asChild variant={status.data.pages.length ? "outline" : "default"}>
                <a href={facebookConnectPath}>{status.data.pages.length ? <RiRefreshLine className="size-4" /> : <RiFacebookCircleLine className="size-4" />}{status.data.pages.length ? "Connect again or add a Page" : "Connect a Facebook Page"}</a>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today's post</CardTitle>
          <CardDescription>
            {preview.data ? (preview.data.day === preview.data.requested_day ? `What goes out for ${preview.data.day}.` : `Today's deals are not computed yet; this is ${preview.data.day}.`) : "The picture and the caption, as Facebook will get them."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          {preview.isError ? <Alert className="lg:col-span-2" variant="destructive"><AlertTitle>No preview</AlertTitle><AlertDescription>{message(preview.error, "The preview route did not answer.")}</AlertDescription></Alert> : null}
          {preview.data?.ready ? (
            <>
              <img alt={`The post's picture for ${preview.data.day}`} className="w-full rounded-lg border" height={1350} loading="lazy" src={`/og/deals/${preview.data.day}.png`} width={1080} />
              <div className="grid content-start gap-3">
                <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-background/40 p-3 text-xs leading-relaxed">{preview.data.caption}</pre>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={!active || active.token_status !== "ok" || !active.can_post} onClick={() => { post.reset(); setConfirm({ kind: "post" }); }}><RiSendPlaneLine className="size-4" />Post now</Button>
                  {!active ? <span className="text-xs text-muted-foreground">Connect a Page first.</span> : null}
                </div>
              </div>
            </>
          ) : preview.data ? <p className="text-sm text-muted-foreground lg:col-span-2">The day has too few deals for a post; nothing is sent on such a day.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Posts</CardTitle><CardDescription>The last thirty, newest first. A post Facebook could not take yet is tried again, five times at most.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-44">Queued</TableHead><TableHead>Post</TableHead><TableHead className="w-28">Status</TableHead><TableHead className="w-20 text-right">Tries</TableHead></TableRow></TableHeader>
            <TableBody>
              {status.data && !status.data.posts.length ? <EmptyTableRow columns={4} /> : null}
              {(status.data?.posts ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs text-muted-foreground">{date(entry.created_at)}</TableCell>
                  <TableCell>
                    {entry.url ? <a className="inline-flex items-center gap-1 text-sm hover:text-primary" href={entry.url} rel="noreferrer" target="_blank">{entry.title}<RiExternalLinkLine className="size-3" /></a> : <span className="text-sm">{entry.title}</span>}
                    {entry.error ? <p className="mt-0.5 break-words text-xs text-destructive">{entry.error}</p> : null}
                    {entry.next_attempt_at ? <p className="mt-0.5 text-xs text-muted-foreground">Next try {date(entry.next_attempt_at)}</p> : null}
                  </TableCell>
                  <TableCell><Badge variant={postBadge[entry.status].variant}>{postBadge[entry.status].label}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-xs">{entry.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog onOpenChange={(open) => { if (!open) setConfirm(null); }} open={confirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "disconnect" ? `Disconnect ${confirm.page.name}?` : `Post to ${active?.name ?? "the Page"} now?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "disconnect"
                ? "PriceLens forgets the Page and its access token, and the daily post stops. Posts already on Facebook stay there. To take the permission back on Facebook's side as well, remove the app under Settings, Business integrations."
                : "This publishes the picture and the caption above on your public Page straight away, in addition to the morning's own post."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {post.isError && confirm?.kind === "post" ? <p className="break-words text-sm text-destructive" role="alert">{message(post.error, "Facebook did not take the post.")}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={post.isPending || change.isPending}
              onClick={(event) => {
                // Stays open until the server has answered, so Facebook's refusal shows here.
                event.preventDefault();
                if (confirm?.kind === "disconnect") change.mutate({ kind: "disconnect", pageId: confirm.page.page_id });
                else if (confirm?.kind === "post") post.mutate();
              }}
            >
              {post.isPending ? "Posting…" : change.isPending ? "Disconnecting…" : confirm?.kind === "disconnect" ? "Disconnect" : "Post now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
