import { useRef, useState } from "react";
import { RiAddLine, RiCalendarScheduleLine, RiDeleteBinLine, RiFacebookCircleLine, RiImageAddLine, RiInstagramLine, RiSendPlaneLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { date, PageFrame } from "@/components/data-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, distributionApi, type ContentItem, type Platform } from "@/lib/api";

const message = (error: unknown, fallback: string): string => (error instanceof ApiError ? error.message : fallback);

const scheduleBadge: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  published: "default",
  scheduled: "secondary",
  queued: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const emptyDraft = { title: "", caption: "", link: "", tags: "" };

/** The moment a date input gives, read in the browser's own zone, as the instant the server wants. */
function localToIso(value: string): string | null {
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/** An instant as a `datetime-local` input wants it, in the browser's own zone. */
function isoToLocal(iso: string): string {
  const when = new Date(iso);
  const shifted = new Date(when.getTime() - when.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The posts written for the channels: their words, their pictures, and when each one goes out. */
export function LibraryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [shelf, setShelf] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [when, setWhen] = useState("");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const picker = useRef<HTMLInputElement>(null);

  const library = useQuery({
    queryKey: ["library", shelf, search],
    queryFn: ({ signal }) => distributionApi.library({ ...(shelf === "all" ? {} : { status: shelf }), ...(search ? { search } : {}), limit: 100 }, { signal }),
  });
  const open = useQuery({ queryKey: ["library", "item", openId], queryFn: ({ signal }) => distributionApi.item(openId as string, { signal }), enabled: openId !== null });
  const preview = useQuery({ queryKey: ["library", "preview", openId], queryFn: ({ signal }) => distributionApi.preview(openId as string, { signal }), enabled: openId !== null });

  const refresh = (item?: ContentItem) => {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    if (item) queryClient.setQueryData(["library", "item", item.id], item);
  };
  const asDraft = (item: ContentItem) => ({ title: item.title, caption: item.caption, link: item.link ?? "", tags: item.tags.join(", ") });
  const body = () => ({ title: draft.title, caption: draft.caption, link: draft.link.trim() || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) });

  const save = useMutation({
    mutationFn: () => (creating ? distributionApi.createItem(body()) : distributionApi.saveItem(openId as string, body())),
    onSuccess: (item) => {
      refresh(item);
      setCreating(false);
      setOpenId(item.id);
      setDraft(asDraft(item));
    },
  });
  const picture = useMutation({
    mutationFn: (file: File) => distributionApi.addPicture(openId as string, file),
    onSuccess: (item) => refresh(item),
  });
  const dropPicture = useMutation({ mutationFn: (assetId: string) => distributionApi.removePicture(openId as string, assetId), onSuccess: (item) => refresh(item) });
  const remove = useMutation({ mutationFn: (id: string) => distributionApi.deleteItem(id), onSuccess: () => { refresh(); setOpenId(null); } });
  const plan = useMutation({
    mutationFn: () => distributionApi.schedule(openId as string, platform, localToIso(when) as string),
    onSuccess: (item) => { refresh(item); setWhen(""); },
  });
  const callOff = useMutation({ mutationFn: (scheduleId: string) => distributionApi.cancelSchedule(scheduleId), onSuccess: () => { refresh(); void queryClient.invalidateQueries({ queryKey: ["library", "item", openId] }); } });
  const sendNow = useMutation({ mutationFn: (scheduleId: string) => distributionApi.postSchedule(scheduleId), onSuccess: (item) => refresh(item) });

  const item = open.data;
  const blockers = preview.data;

  return (
    <PageFrame
      description="The posts written for Facebook and Instagram: their words, their pictures, and when each one goes out. A picture is turned into a JPEG the platforms accept when it is added, so a PNG from a design tool is fine."
      eyebrow="Distribution channels"
      title="Library"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search posts, captions, tags…" value={search} />
        <Select onValueChange={setShelf} value={shelf}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">In use</SelectItem>
            <SelectItem value="draft">Drafts</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => { save.reset(); setCreating(true); setOpenId(null); setDraft(emptyDraft); }}><RiAddLine className="size-4" />New post</Button>
      </div>

      {library.isError ? <Alert variant="destructive"><AlertTitle>The library did not load</AlertTitle><AlertDescription>{message(library.error, "The server did not answer.")}</AlertDescription></Alert> : null}
      {library.data && !library.data.rows.length ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{search ? "Nothing here matches that." : "No posts yet. Write one, add its pictures, and plan when it goes out."}</CardContent></Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(library.data?.rows ?? []).map((row) => {
          const planned = row.schedules.filter((entry) => entry.status === "scheduled").length;
          const out = row.schedules.filter((entry) => entry.status === "published").length;
          return (
            <button className="grid gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40" key={row.id} onClick={() => { save.reset(); setCreating(false); setOpenId(row.id); setDraft(asDraft(row)); }} type="button">
              {row.assets[0] ? (
                <img alt="" className="aspect-[4/5] w-full rounded-lg border object-cover" loading="lazy" src={row.assets[0].path} />
              ) : (
                <div className="grid aspect-[4/5] w-full place-items-center rounded-lg border bg-muted/30 text-xs text-muted-foreground">Words only</div>
              )}
              <div className="grid gap-1.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="truncate">{row.title}</span>{row.status === "draft" ? <Badge variant="outline">Draft</Badge> : null}{row.status === "archived" ? <Badge variant="secondary">Archived</Badge> : null}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{row.caption}</p>
                <p className="text-xs text-muted-foreground">
                  {row.kind === "carousel" ? `${row.assets.length} pictures` : row.kind === "image" ? "1 picture" : "No picture"}
                  {planned ? ` · ${planned} planned` : ""}
                  {out ? ` · ${out} posted` : ""}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog onOpenChange={(isOpen) => { if (!isOpen) { setOpenId(null); setCreating(false); } }} open={creating || openId !== null}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{creating ? "New post" : item?.title || "Post"}</DialogTitle>
            <DialogDescription>{creating ? "Write it first; pictures and a plan come after it is saved." : "What goes out, and when."}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="content-title">Name</Label>
              <Input id="content-title" onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What this post is, for your own list" value={draft.title} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="content-caption">Caption</Label>
              <Textarea className="min-h-32" id="content-caption" onChange={(event) => setDraft({ ...draft, caption: event.target.value })} placeholder="Exactly what the platforms will show." value={draft.caption} />
              <p className="text-xs text-muted-foreground">{draft.caption.length} characters. Instagram takes 2,200, Facebook far more.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="content-link">Link (optional)</Label>
                <Input id="content-link" onChange={(event) => setDraft({ ...draft, link: event.target.value })} placeholder="https://badumila.com/deals" value={draft.link} />
                <p className="text-xs text-muted-foreground">Facebook previews it. Instagram cannot make it tappable, so it is named in words.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content-tags">Hashtags</Label>
                <Input id="content-tags" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="badumila, SriLanka" value={draft.tags} />
                <p className="text-xs text-muted-foreground">Separated by commas; the hash is added for you.</p>
              </div>
            </div>
            {save.isError ? <p className="text-sm text-destructive" role="alert">{message(save.error, "That did not save.")}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={save.isPending || !draft.title.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : creating ? "Create" : "Save"}</Button>
              {!creating && item ? <Button className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} variant="ghost"><RiDeleteBinLine className="size-4" />Delete post</Button> : null}
            </div>
          </div>

          {!creating && item ? (
            <>
              <div className="grid gap-2 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Pictures</h3>
                  <Button disabled={picture.isPending || item.assets.length >= 10} onClick={() => picker.current?.click()} size="sm" variant="outline"><RiImageAddLine className="size-4" />{picture.isPending ? "Adding…" : "Add picture"}</Button>
                </div>
                <input
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) picture.mutate(file);
                    event.target.value = "";
                  }}
                  ref={picker}
                  type="file"
                />
                <p className="text-xs text-muted-foreground">In the order Instagram will show them, up to ten. The first one is what Facebook previews.</p>
                {picture.isError ? <p className="text-sm text-destructive" role="alert">{message(picture.error, "That picture was not added.")}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {item.assets.map((asset) => (
                    <figure className="relative" key={asset.id}>
                      <img alt="" className="h-32 w-auto rounded-lg border" src={asset.path} />
                      <Button className="absolute right-1 top-1 size-6 rounded-full p-0" disabled={dropPicture.isPending} onClick={() => dropPicture.mutate(asset.id)} size="sm" variant="destructive">×</Button>
                      <figcaption className="mt-1 text-center font-mono text-[10px] text-muted-foreground">{asset.width}×{asset.height}</figcaption>
                    </figure>
                  ))}
                  {!item.assets.length ? <p className="text-sm text-muted-foreground">None yet. Instagram takes no post without one.</p> : null}
                </div>
              </div>

              <div className="grid gap-3 border-t pt-4">
                <h3 className="text-sm font-medium">As each platform will show it</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["facebook", "instagram"] as const).map((name) => (
                    <div className="grid gap-1.5" key={name}>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{name === "facebook" ? <RiFacebookCircleLine className="size-3.5" /> : <RiInstagramLine className="size-3.5" />}{name === "facebook" ? "Facebook" : "Instagram"}</p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border bg-background/40 p-2.5 text-xs leading-relaxed">{blockers?.[name].caption ?? "…"}</pre>
                      {blockers?.[name].blocker ? <p className="text-xs text-destructive">{blockers[name].blocker}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 border-t pt-4">
                <h3 className="text-sm font-medium">When it goes out</h3>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="content-platform">Where</Label>
                    <Select onValueChange={(value) => setPlatform(value as Platform)} value={platform}>
                      <SelectTrigger className="w-40" id="content-platform"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="facebook">Facebook</SelectItem><SelectItem value="instagram">Instagram</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="content-when">When</Label>
                    <Input className="w-56" id="content-when" min={isoToLocal(new Date().toISOString())} onChange={(event) => setWhen(event.target.value)} type="datetime-local" value={when} />
                  </div>
                  <Button disabled={plan.isPending || !when} onClick={() => plan.mutate()}><RiCalendarScheduleLine className="size-4" />{plan.isPending ? "Planning…" : "Plan it"}</Button>
                </div>
                <p className="text-xs text-muted-foreground">Your own clock. The server checks every minute and posts what is due.</p>
                {plan.isError ? <p className="text-sm text-destructive" role="alert">{message(plan.error, "That was not planned.")}</p> : null}
                {sendNow.isError ? <p className="text-sm text-destructive" role="alert">{message(sendNow.error, "The platform did not take the post.")}</p> : null}
                <div className="grid gap-2">
                  {item.schedules.map((entry) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5" key={entry.id}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          {entry.platform === "facebook" ? <RiFacebookCircleLine className="size-3.5" /> : <RiInstagramLine className="size-3.5" />}
                          {date(entry.scheduled_for)}
                          <Badge variant={scheduleBadge[entry.status] ?? "secondary"}>{entry.status}</Badge>
                        </p>
                        {entry.error ? <p className="mt-0.5 break-words text-xs text-destructive">{entry.error}</p> : null}
                        {entry.post_url ? <a className="text-xs text-muted-foreground hover:text-primary" href={entry.post_url} rel="noreferrer" target="_blank">Open the post</a> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.status === "scheduled" || entry.status === "failed" ? (
                          <>
                            <Button disabled={sendNow.isPending} onClick={() => sendNow.mutate(entry.id)} size="sm" variant="outline"><RiSendPlaneLine className="size-3.5" />Post now</Button>
                            <Button disabled={callOff.isPending} onClick={() => callOff.mutate(entry.id)} size="sm" variant="ghost">Call off</Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!item.schedules.length ? <p className="text-sm text-muted-foreground">Not planned yet.</p> : null}
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter />
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
