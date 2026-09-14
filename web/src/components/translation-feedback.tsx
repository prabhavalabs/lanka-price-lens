import { RiTranslate2 } from "@remixicon/react";
import type { TranslationFeedbackInput, TranslationLanguage, TranslationVerdict } from "@lanka-pricelens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { signInPath } from "@/components/account-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accountApi } from "@/lib/account-api";
import { locationPath } from "@/lib/account-forms";
import { describeContributionError } from "@/lib/contributions";
import { useAccount } from "@/store/account";
import { rememberTranslation } from "@/store/community";
import { languageNames } from "@/store/language";

const lineClass = "flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground";

/**
 * One line under a Sinhala or Tamil method: is the translation right? Correct goes at once;
 * Needs work opens a small form for the corrected text and a note. A thank-you takes the
 * line's place once sent. Signed out, the line offers the sign-in page instead, and comes back
 * here afterwards.
 */
export function TranslationFeedbackLine({ dishId, dishName, language }: { dishId: string; dishName: string; language: TranslationLanguage }) {
  const account = useAccount();
  const client = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  const [note, setNote] = useState("");
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const send = useMutation({
    mutationFn: (input: TranslationFeedbackInput) => accountApi.community.translations.send(input),
    onSuccess: (feedback) => {
      rememberTranslation(client, accountId, feedback, dishName);
      setOpen(false);
    },
  });
  if (account.status === "loading") return null;
  if (account.status === "signed_out") {
    return (
      <p className={lineClass}>
        <RiTranslate2 aria-hidden className="size-3.5 shrink-0" />
        <span>Is this translation right?</span>
        <Link className="underline underline-offset-4 hover:text-primary" to={signInPath(locationPath(location))}>Sign in to help with translations</Link>
      </p>
    );
  }
  if (send.isSuccess) {
    return (
      <p className={lineClass} role="status">
        <RiTranslate2 aria-hidden className="size-3.5 shrink-0 text-primary" />
        <span>Thanks, the translation team will look at it.</span>
      </p>
    );
  }
  const verdict = (value: TranslationVerdict) => send.mutate({ dish_id: dishId, language, verdict: value, correction: value === "incorrect" ? correction.trim() || null : null, note: value === "incorrect" ? note.trim() || null : null });
  return (
    <div className={lineClass}>
      <RiTranslate2 aria-hidden className="size-3.5 shrink-0" />
      <span>Is this translation right?</span>
      <Button disabled={send.isPending} onClick={() => verdict("correct")} size="xs" type="button" variant="outline">Correct</Button>
      <Button disabled={send.isPending} onClick={() => { send.reset(); setOpen(true); }} size="xs" type="button" variant="outline">Needs work</Button>
      {send.isError && !open ? <span className="text-destructive" role="alert">{describeContributionError(send.error)}</span> : null}
      <Dialog onOpenChange={(next) => { setOpen(next); if (!next) send.reset(); }} open={open}>
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); verdict("incorrect"); }}>
            <DialogHeader>
              <DialogTitle>What should the {languageNames[language]} say?</DialogTitle>
              <DialogDescription>Paste the corrected text if you have it, or say what is wrong. The translation team reads every note; the recipe changes once a person has checked it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="translation-correction">Corrected text <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="translation-correction" lang={language} maxLength={4000} onChange={(event) => setCorrection(event.target.value)} placeholder="The method as it should read, or only the steps that are wrong." rows={6} value={correction} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="translation-note">What is wrong <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="translation-note" maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Step 3 says fry where it should say boil." rows={3} value={note} />
            </div>
            {send.isError ? <p className="text-sm text-destructive" role="alert">{describeContributionError(send.error)}</p> : null}
            <DialogFooter>
              <Button onClick={() => setOpen(false)} type="button" variant="ghost">Cancel</Button>
              <Button disabled={send.isPending} type="submit">{send.isPending ? "Sending…" : "Send"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
