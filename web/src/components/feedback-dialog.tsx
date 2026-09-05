import { RiBugLine, RiChat3Line, RiFeedbackLine } from "@remixicon/react";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { trackEvent } from "@/lib/analytics";
import { postFeedback, type FeedbackKind } from "@/lib/api";

/** Feedback or a bug report in two taps: what kind, what happened, an optional address for a reply. The page you were on comes along. */
export function FeedbackDialog({ trigger }: { trigger?: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("feedback");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const send = useMutation({
    mutationFn: () => postFeedback({ kind, message: message.trim(), email: email.trim() || undefined, page: `${window.location.origin}${location.pathname}${location.search}`, website: website || undefined }),
    onSuccess: () => trackEvent("feedback_sent", { kind }),
  });
  const reset = () => {
    setMessage("");
    setEmail("");
    setWebsite("");
    setKind("feedback");
    send.reset();
  };
  return (
    <Dialog onOpenChange={(next) => { setOpen(next); if (!next) reset(); }} open={open}>
      <DialogTrigger asChild>
        {trigger ?? <Button className="gap-1.5" size="sm" variant="ghost"><RiFeedbackLine className="size-4" /><span className="hidden sm:inline">Feedback</span></Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {send.isSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle>Thank you</DialogTitle>
              <DialogDescription>{kind === "bug" ? "The report is in; it will be looked at." : "Your note is in; it shapes what gets built next."}</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button onClick={() => setOpen(false)}>Close</Button></DialogFooter>
          </>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); send.mutate(); }}>
            <DialogHeader>
              <DialogTitle>Tell us what you think</DialogTitle>
              <DialogDescription>A wrong price, a missing product, something broken, or an idea. The page you are on is included.</DialogDescription>
            </DialogHeader>
            <ToggleGroup aria-label="Kind" className="grid w-full grid-cols-2" onValueChange={(value) => { if (value === "feedback" || value === "bug") setKind(value); }} type="single" value={kind} variant="outline">
              <ToggleGroupItem className="gap-2" value="feedback"><RiChat3Line className="size-4" />Feedback</ToggleGroupItem>
              <ToggleGroupItem className="gap-2" value="bug"><RiBugLine className="size-4" />Report a bug</ToggleGroupItem>
            </ToggleGroup>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-message">{kind === "bug" ? "What went wrong?" : "Your message"}</Label>
              <Textarea id="feedback-message" maxLength={4000} minLength={10} onChange={(event) => setMessage(event.target.value)} placeholder={kind === "bug" ? "What you did, what you expected, what happened instead…" : "What would make this more useful for you?"} required rows={5} value={message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-email">Email <span className="text-muted-foreground">(optional, for a reply)</span></Label>
              <Input id="feedback-email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
            </div>
            <div aria-hidden className="hidden">
              <label htmlFor="feedback-website">Website</label>
              <input autoComplete="off" id="feedback-website" onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} value={website} />
            </div>
            {send.isError ? <p className="text-sm text-destructive">{send.error.message}</p> : null}
            <DialogFooter>
              <Button onClick={() => setOpen(false)} type="button" variant="ghost">Cancel</Button>
              <Button disabled={send.isPending || message.trim().length < 10} type="submit">{send.isPending ? "Sending…" : "Send"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
