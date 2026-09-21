import { useEffect, useState } from "react";
import { RiExternalLinkLine, RiFacebookCircleLine, RiInstagramLine, RiLinkUnlinkM, RiRefreshLine, RiSendPlaneLine, RiShieldCheckLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { date, EmptyTableRow, PageFrame } from "@/components/data-display";
import { ImageLightbox } from "@/components/image-lightbox";
import { PostPreviewFrame, type DeviceKind } from "@/components/post-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, distributionApi, distributionConnectPath, type ChannelPost, type ConnectedAccount, type DistributionStatus, type Platform } from "@/lib/api";

/** What Facebook's redirect left in the address, in the owner's words. */
const outcomes: Record<string, { title: string; body: string; bad?: boolean }> = {
  connected: { title: "Connected", body: "The Page and the Instagram account behind it are both in. The day's deals go to the Page after the morning run; anything in the library goes out when you plan it." },
  connected_no_instagram: {
    title: "The Page is connected, Instagram is not",
    body: "No Instagram account is linked to that Page. On Instagram, make the account professional (Settings, Account type), then link it to the Page under the Page's Linked accounts. Connect again afterwards.",
  },
  cancelled: { title: "Nothing was connected", body: "Facebook's consent screen was closed before it finished.", bad: true },
  expired: { title: "That took too long", body: "The connection has to be finished within ten minutes of starting it, in the same browser. Start again.", bad: true },
  failed: { title: "Facebook refused the connection", body: "The server log has Facebook's reason. The usual causes are a redirect address that is not listed in the Meta app, or a wrong app secret.", bad: true },
  no_pages: { title: "No Page was shared", body: "On Facebook's consent screen, choose the Page under \"Which Pages do you want to use\". Start again and tick it.", bad: true },
  no_rights: { title: "Connected, but this account cannot post", body: "The Facebook account needs full control of the Page, or at least the task to create content.", bad: true },
  not_configured: { title: "The Meta app is not set yet", body: "Set LPL_FACEBOOK_APP_ID and LPL_FACEBOOK_APP_SECRET on the server and recreate the API container.", bad: true },
};

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const postBadge: Record<ChannelPost["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Posted", variant: "default" },
  queued: { label: "Waiting", variant: "secondary" },
  sending: { label: "Posting", variant: "secondary" },
  dead: { label: "Failed", variant: "destructive" },
};

const wording = {
  facebook: {
    title: "Facebook",
    icon: RiFacebookCircleLine,
    noun: "Page",
    plural: "Pages",
    description: "The Page PriceLens posts to: the day's supermarket deals every morning after the deals run, and anything you plan in the library. The picture is drawn by PriceLens in Sinhala, and beside each row it shows the store's own picture of the pack, our own photograph when the store has none.",
    connect: "Connect a Facebook Page",
  },
  instagram: {
    title: "Instagram",
    icon: RiInstagramLine,
    noun: "account",
    plural: "accounts",
    description: "The Instagram account PriceLens posts to. It is reached through the Facebook Page it is linked to, so connecting happens on the Facebook side and the account has to be a professional one. Instagram takes no post without a picture, and a caption there carries no tappable link.",
    connect: "Connect through Facebook",
  },
} as const;

/** One distribution channel: what is connected, what has gone out, and the day's post. */
export function ChannelPage({ platform }: { platform: Platform }) {
  const words = wording[platform];
  const Icon = words.icon;
  const [params, setParams] = useSearchParams();
  const outcome = outcomes[params.get("facebook") ?? ""];
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["distribution"], queryFn: ({ signal }) => distributionApi.status({ signal }) });
  const accounts = (status.data?.accounts ?? []).filter((entry) => entry.platform === platform);
  const active = accounts.find((entry) => entry.active);
  const posts = (status.data?.posts ?? []).filter((entry) => entry.platform === platform);
  const preview = useQuery({ queryKey: ["distribution", "deals", platform], queryFn: ({ signal }) => distributionApi.dealsPreview(platform, { signal }), retry: false });
  const [confirm, setConfirm] = useState<{ kind: "post" } | { kind: "disconnect"; account: ConnectedAccount } | null>(null);
  // The posts table: ten to a page, and one opened in the platform's own frame.
  const [page, setPage] = useState(0);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKind>("desktop");
  const [pictureFailed, setPictureFailed] = useState(false);
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(posts.length / pageSize));
  const first = Math.min(page, pages - 1) * pageSize;
  const shown = posts.slice(first, first + pageSize);
  const opened = useQuery({ queryKey: ["distribution", "post", openPost], queryFn: ({ signal }) => distributionApi.post(openPost as string, { signal }), enabled: openPost !== null });
  useEffect(() => setPictureFailed(false), [openPost]);
  useEffect(() => setPage(0), [platform]);

  const refresh = (data?: DistributionStatus) => {
    if (data) queryClient.setQueryData(["distribution"], { configured: data.configured, app_id: data.app_id, redirect_uri: data.redirect_uri, accounts: data.accounts, posts: data.posts });
    else void queryClient.invalidateQueries({ queryKey: ["distribution"], exact: true });
  };
  const change = useMutation({
    mutationFn: (action: { kind: "activate" | "disconnect"; accountId: string } | { kind: "pause"; accountId: string; paused: boolean } | { kind: "check" }) =>
      action.kind === "activate"
        ? distributionApi.activate(platform, action.accountId)
        : action.kind === "pause"
          ? distributionApi.pause(platform, action.accountId, action.paused)
          : action.kind === "disconnect"
            ? distributionApi.disconnect(platform, action.accountId)
            : distributionApi.check(platform),
    onSuccess: (data) => {
      refresh(data);
      setConfirm(null);
    },
  });
  const post = useMutation({ mutationFn: () => distributionApi.postDeals(platform), onSuccess: (data) => { refresh(data); setConfirm(null); }, onError: () => refresh() });
  const blocked = !active || active.token_status !== "ok" || !active.can_post || (platform === "instagram" && !preview.data?.image_url);

  return (
    <PageFrame description={words.description} eyebrow="Distribution channels" title={words.title}>
      {outcome && platform === "facebook" ? (
        <Alert variant={outcome.bad ? "destructive" : "default"}>
          <AlertTitle>{outcome.title}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{outcome.body}</span>
            <Button onClick={() => setParams({}, { replace: true })} size="sm" variant="ghost">Dismiss</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {status.isError ? <Alert variant="destructive"><AlertTitle>The channel settings did not load</AlertTitle><AlertDescription>{message(status.error, "The server did not answer.")}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Icon className="size-4" />Connection</CardTitle>
          <CardDescription>
            {status.data && !status.data.configured
              ? "The Meta app's id and secret are not on the server yet."
              : platform === "instagram"
                ? "Instagram is granted with the Page it is linked to. Connecting opens Facebook; PriceLens keeps the access token encrypted and never shows it."
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
          {status.data?.configured && !accounts.length ? (
            <p className="text-sm text-muted-foreground">
              {platform === "instagram"
                ? "No Instagram account is connected. It has to be a professional account linked to a Facebook Page; connect from here and tick that Page on Facebook's screen."
                : "No Page is connected yet."}
            </p>
          ) : null}
          {accounts.map((account) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={account.account_id}>
              <div className="flex min-w-0 items-center gap-3">
                {account.picture ? <img alt="" className="size-10 shrink-0 rounded-full border" src={account.picture} /> : null}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {account.link ? <a className="inline-flex items-center gap-1 hover:text-primary" href={account.link} rel="noreferrer" target="_blank">{account.name}<RiExternalLinkLine className="size-3" /></a> : account.name}
                    {account.username ? <span className="font-mono text-xs text-muted-foreground">@{account.username}</span> : null}
                    {account.active ? <Badge>Posting here</Badge> : null}
                    {account.token_status === "invalid" ? <Badge variant="destructive">Needs connecting again</Badge> : null}
                    {!account.can_post ? <Badge variant="outline">No right to post</Badge> : null}
                    {account.paused ? <Badge variant="secondary">Paused</Badge> : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connected {date(account.connected_at)}{account.connected_by ? ` by ${account.connected_by}` : ""}
                    {account.token_checked_at ? ` · token checked ${date(account.token_checked_at)}` : ""}
                    {account.token_expires_at ? ` · token ends ${date(account.token_expires_at)}` : ""}
                  </p>
                  {account.token_error ? <p className="mt-1 break-words text-xs text-destructive">{account.token_error}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={!account.paused} disabled={change.isPending} id={`daily-${account.account_id}`} onCheckedChange={(on) => change.mutate({ kind: "pause", accountId: account.account_id, paused: !on })} />
                  <Label className="text-xs text-muted-foreground" htmlFor={`daily-${account.account_id}`}>Daily post</Label>
                </div>
                {account.active ? (
                  <Button disabled={change.isPending} onClick={() => change.mutate({ kind: "check" })} size="sm" variant="outline"><RiShieldCheckLine className="size-3.5" />Check token</Button>
                ) : (
                  <Button disabled={change.isPending || !account.can_post} onClick={() => change.mutate({ kind: "activate", accountId: account.account_id })} size="sm" variant="outline">Post here</Button>
                )}
                <Button onClick={() => { change.reset(); setConfirm({ kind: "disconnect", account }); }} size="sm" variant="ghost"><RiLinkUnlinkM className="size-3.5" />Disconnect</Button>
              </div>
            </div>
          ))}
          {status.data?.publishing_limit ? (
            <p className="text-xs text-muted-foreground">Instagram counts {status.data.publishing_limit.used} of {status.data.publishing_limit.cap} posts used in the last day.</p>
          ) : null}
          {change.isError ? <p className="text-sm text-destructive" role="alert">{message(change.error, "That did not save. Try again.")}</p> : null}
          {status.data?.configured ? (
            <div>
              <Button asChild variant={accounts.length ? "outline" : "default"}>
                <a href={distributionConnectPath}>{accounts.length ? <RiRefreshLine className="size-4" /> : <Icon className="size-4" />}{accounts.length ? `Connect again or add ${words.noun === "Page" ? "a Page" : "an account"}` : words.connect}</a>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today's deals post</CardTitle>
          <CardDescription>
            {preview.data ? (preview.data.day === preview.data.requested_day ? `What goes out for ${preview.data.day}.` : `Today's deals are not computed yet; this is ${preview.data.day}.`) : `The picture and the caption, as ${words.title} will get them.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          {preview.isError ? <Alert className="lg:col-span-2" variant="destructive"><AlertTitle>No preview</AlertTitle><AlertDescription>{message(preview.error, "The preview route did not answer.")}</AlertDescription></Alert> : null}
          {preview.data?.ready ? (
            <>
              <ImageLightbox
                alt={`The post's picture for ${preview.data.day}`}
                caption={`The card as it goes out: 1080 × 1350, for ${preview.data.day}.`}
                className="self-start"
                src={`/og/deals/${preview.data.day}.png`}
              >
                <img alt={`The post's picture for ${preview.data.day}`} className="w-full" height={1350} loading="lazy" src={`/og/deals/${preview.data.day}.png`} width={1080} />
              </ImageLightbox>
              <div className="grid content-start gap-3">
                <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-background/40 p-3 text-xs leading-relaxed">{preview.data.caption}</pre>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={blocked} onClick={() => { post.reset(); setConfirm({ kind: "post" }); }}><RiSendPlaneLine className="size-4" />Post now</Button>
                  {!active ? <span className="text-xs text-muted-foreground">Connect {words.noun === "Page" ? "a Page" : "an account"} first.</span> : null}
                </div>
              </div>
            </>
          ) : preview.data ? <p className="text-sm text-muted-foreground lg:col-span-2">The day has too few deals for a post; nothing is sent on such a day.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Posts</CardTitle><CardDescription>The last thirty on this channel, newest first. Open one to see it as {words.title} shows it. A post the platform could not take yet is tried again, five times at most.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader><TableRow><TableHead className="w-44">Queued</TableHead><TableHead>Post</TableHead><TableHead className="w-28">Status</TableHead><TableHead className="w-20 text-right">Tries</TableHead></TableRow></TableHeader>
            <TableBody>
              {status.data && !posts.length ? <EmptyTableRow columns={4} /> : null}
              {shown.map((entry) => (
                <TableRow className="cursor-pointer" key={entry.id} onClick={() => setOpenPost(entry.id)}>
                  <TableCell className="text-xs text-muted-foreground">{date(entry.created_at)}</TableCell>
                  <TableCell className="max-w-0">
                    {/* One line, whatever the post's length: the rest is read on hover or in the
                        preview, and the columns after this one stay where the eye expects them. */}
                    <Tooltip>
                      <TooltipTrigger asChild><p className="truncate text-sm">{entry.title}</p></TooltipTrigger>
                      <TooltipContent className="max-h-72 max-w-sm overflow-auto whitespace-pre-wrap text-left" side="bottom">{entry.title}</TooltipContent>
                    </Tooltip>
                    {entry.error ? <p className="mt-0.5 truncate text-xs text-destructive">{entry.error}</p> : null}
                    {entry.next_attempt_at ? <p className="mt-0.5 text-xs text-muted-foreground">Next try {date(entry.next_attempt_at)}</p> : null}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Badge variant={postBadge[entry.status].variant}>{postBadge[entry.status].label}</Badge>
                      {entry.url ? <a aria-label="Open on the platform" className="text-muted-foreground hover:text-primary" href={entry.url} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><RiExternalLinkLine className="size-3.5" /></a> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{entry.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t p-3">
              <p className="text-xs text-muted-foreground">{first + 1}–{Math.min(first + pageSize, posts.length)} of {posts.length}</p>
              <div className="flex items-center gap-2">
                <Button disabled={page === 0} onClick={() => setPage((current) => current - 1)} size="sm" variant="outline">Newer</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1} of {pages}</span>
                <Button disabled={page >= pages - 1} onClick={() => setPage((current) => current + 1)} size="sm" variant="outline">Older</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog onOpenChange={(isOpen) => { if (!isOpen) setOpenPost(null); }} open={openPost !== null}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>On {words.title}</DialogTitle>
            <DialogDescription>
              {opened.data ? `${postBadge[opened.data.post.status].label} · ${date(opened.data.post.created_at)}` : "The post as the platform shows it."}
            </DialogDescription>
          </DialogHeader>
          {opened.isPending ? <p className="py-8 text-center text-sm text-muted-foreground">Opening the post…</p> : null}
          {opened.isError ? <Alert variant="destructive"><AlertTitle>The post did not open</AlertTitle><AlertDescription>{message(opened.error, "The server did not answer.")}</AlertDescription></Alert> : null}
          {opened.data ? (
            <>
              <PostPreviewFrame
                device={device}
                onDevice={setDevice}
                post={{
                  platform: opened.data.post.platform,
                  text: opened.data.text,
                  // The picture is taken from this server first, so what is checked is the card this
                  // code draws; a post whose picture this machine does not hold falls back to the live one.
                  image: pictureFailed ? opened.data.image_url : (opened.data.preview_image_path ?? opened.data.image_url),
                  imageAlt: opened.data.image_alt,
                  account: opened.data.account,
                  createdAt: opened.data.post.created_at,
                }}
              />
              {opened.data.post.error ? <p className="break-words text-sm text-destructive">{opened.data.post.error}</p> : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{opened.data.text.length} characters</span>
                {opened.data.post.sent_at ? <span>Posted {date(opened.data.post.sent_at)}</span> : null}
                {opened.data.post.url ? <a className="inline-flex items-center gap-1 hover:text-primary" href={opened.data.post.url} rel="noreferrer" target="_blank">Open on {words.title}<RiExternalLinkLine className="size-3" /></a> : null}
              </div>
              {/* Loaded out of sight, only to learn whether this server holds the picture. */}
              {opened.data.preview_image_path && !pictureFailed ? <img alt="" className="hidden" onError={() => setPictureFailed(true)} src={opened.data.preview_image_path} /> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={(open) => { if (!open) setConfirm(null); }} open={confirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "disconnect" ? `Disconnect ${confirm.account.name}?` : `Post to ${active?.name ?? words.title} now?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "disconnect"
                ? "PriceLens forgets the account and its access token, and the daily post stops. Posts already on the platform stay there. To take the permission back on Facebook's side as well, remove the app under Settings, Business integrations."
                : `This publishes the picture and the caption above on your public ${words.title} straight away, in addition to the morning's own post.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {post.isError && confirm?.kind === "post" ? <p className="break-words text-sm text-destructive" role="alert">{message(post.error, "The platform did not take the post.")}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              disabled={post.isPending || change.isPending}
              onClick={(event) => {
                // Stays open until the server has answered, so the platform's refusal shows here.
                event.preventDefault();
                if (confirm?.kind === "disconnect") change.mutate({ kind: "disconnect", accountId: confirm.account.account_id });
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
