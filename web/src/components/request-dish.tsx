import type { SubmissionInput } from "@lanka-pricelens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { signInPath } from "@/components/account-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accountApi } from "@/lib/account-api";
import { locationPath } from "@/lib/account-forms";
import { describeContributionError } from "@/lib/contributions";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { rememberSubmission } from "@/store/community";

const label = "Can't find a dish? Request it";

/**
 * "Can't find a dish? Request it": a small form for the dish's name and a note, sent to the
 * owner as a request. The search text, when there is one, is the first guess at the name.
 * Signed out, the link goes to the sign-in page and comes back here.
 */
export function RequestDish({ query, className }: { query?: string | undefined; className?: string | undefined }) {
  const account = useAccount();
  const client = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const send = useMutation({
    mutationFn: (input: SubmissionInput) => accountApi.community.submissions.send(input),
    onSuccess: (submission) => rememberSubmission(client, accountId, submission),
  });
  const linkClass = cn("text-sm underline underline-offset-4 hover:text-primary disabled:opacity-50", className);
  if (account.status === "signed_out") return <Link className={linkClass} to={signInPath(locationPath(location))}>{label}</Link>;
  const start = () => {
    setName(query?.trim() ?? "");
    setNotes("");
    send.reset();
    setOpen(true);
  };
  const ready = name.trim().length >= 2;
  return (
    <>
      <button className={linkClass} disabled={account.status === "loading"} onClick={start} type="button">{label}</button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md">
          {send.isSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle>Request sent</DialogTitle>
                <DialogDescription>Thanks. The owner reads every request; you can follow it under Contributions on your account page.</DialogDescription>
              </DialogHeader>
              <DialogFooter><Button onClick={() => setOpen(false)} type="button">Close</Button></DialogFooter>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!ready) return;
                send.mutate({ kind: "request", name: name.trim(), notes: notes.trim() || null });
              }}
            >
              <DialogHeader>
                <DialogTitle>Request a dish</DialogTitle>
                <DialogDescription>Name the dish that is missing. The owner reads every request and adds what fits the catalogue, written and priced like the rest.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="request-name">Dish</Label>
                <Input autoFocus id="request-name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Kiri hodi, mutton rolls, watalappan…" required value={name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="request-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id="request-notes" maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Where it is from, another name for it, what goes in it." rows={4} value={notes} />
              </div>
              {send.isError ? <p className="text-sm text-destructive" role="alert">{describeContributionError(send.error)}</p> : null}
              <DialogFooter>
                <Button onClick={() => setOpen(false)} type="button" variant="ghost">Cancel</Button>
                <Button disabled={send.isPending || !ready} type="submit">{send.isPending ? "Sending…" : "Send request"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
