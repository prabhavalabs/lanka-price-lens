import { RiSendPlaneLine } from "@remixicon/react";
import type { RecipeSubmission } from "@lanka-pricelens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { accountApi } from "@/lib/account-api";
import { describeContributionError, reviewStatusWords } from "@/lib/contributions";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { rememberSubmission } from "@/store/community";

/**
 * Offering one of your own recipes for the catalogue: the button with its confirmation, the
 * "Submitted" badge the list and the page show, and the owner's note once there is a decision.
 */

const toneClass: Record<RecipeSubmission["status"], string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "border-primary/40 bg-primary/10 text-primary",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** "Submitted · pending" beside a recipe that was sent; nothing for one that was not. */
export function SubmissionBadge({ submission, className }: { submission: RecipeSubmission | null; className?: string | undefined }) {
  if (!submission) return null;
  return (
    <Badge className={cn("gap-1 text-[10px]", toneClass[submission.status], className)} variant="outline">
      <RiSendPlaneLine aria-hidden className="size-3" />
      Submitted · {reviewStatusWords[submission.status]}
    </Badge>
  );
}

/** The owner's decision on the newest submission, with the note when there is one. Nothing while it is still pending. */
export function SubmissionNote({ submission }: { submission: RecipeSubmission | null }) {
  if (!submission || submission.status === "pending") return null;
  if (submission.status === "approved") {
    return (
      <Alert>
        <RiSendPlaneLine />
        <AlertTitle>Approved for the catalogue</AlertTitle>
        <AlertDescription>{submission.review_note ? <p>{submission.review_note}</p> : null}<p>The owner is merging it into the public recipes. Your own copy here stays as it is.</p></AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <RiSendPlaneLine />
      <AlertTitle>Not taken into the catalogue this time</AlertTitle>
      <AlertDescription>{submission.review_note ? <p>{submission.review_note}</p> : <p>The owner left no note.</p>}<p>You can change the recipe and submit it again.</p></AlertDescription>
    </Alert>
  );
}

/** "Submit to PriceLens" with a confirmation; hidden while a submission is pending or approved, "Submit again" after a rejection. */
export function SubmitRecipe({ recipe, submission }: { recipe: { id: string; name: string }; submission: RecipeSubmission | null }) {
  const client = useQueryClient();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const accountId = account.status === "signed_in" ? account.account.id : "";
  const send = useMutation({
    mutationFn: () => accountApi.community.submissions.send({ kind: "recipe", source_recipe_id: recipe.id, notes: null }),
    onSuccess: (sent) => {
      rememberSubmission(client, accountId, sent);
      setOpen(false);
    },
  });
  if (submission && submission.status !== "rejected") return null;
  return (
    <AlertDialog onOpenChange={(next) => { setOpen(next); if (!next) send.reset(); }} open={open}>
      <AlertDialogTrigger asChild>
        <Button size="sm" type="button" variant="outline"><RiSendPlaneLine className="size-4" />{submission ? "Submit again" : "Submit to PriceLens"}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><RiSendPlaneLine /></AlertDialogMedia>
          <AlertDialogTitle>Send “{recipe.name}” for the catalogue?</AlertDialogTitle>
          <AlertDialogDescription>The owner reads it and may merge it into the public recipes, edited to the house style and scaled, counted, and priced like the rest. Your own copy stays yours and stays private. The outcome shows here and under Contributions on your account page.</AlertDialogDescription>
        </AlertDialogHeader>
        {send.isError ? <p className="text-sm text-destructive" role="alert">{describeContributionError(send.error)}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Not now</AlertDialogCancel>
          <AlertDialogAction disabled={send.isPending} onClick={(event) => { event.preventDefault(); send.mutate(); }}>{send.isPending ? "Sending…" : "Send for review"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
