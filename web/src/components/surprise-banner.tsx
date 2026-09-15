import { RiDiceLine } from "@remixicon/react";
import { Link } from "react-router-dom";

import { signInPath } from "@/components/account-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { surpriseEmptyMessage, useSurprise } from "@/hooks/use-surprise";
import { pickedLabel } from "@/lib/surprise";
import { useAccount } from "@/store/account";

/** Where the preferences live on the account page; the sign-in page brings a guest back here. */
export const preferencesPath = "/account#preferences";

/**
 * The slim card above a recipe that Surprise me opened: why it was picked, a way to draw again
 * (the address is replaced, so the back button leaves the run in one step), and the door to the
 * preferences that shape the draw.
 */
export function SurpriseBanner({ reasons }: { reasons: string[] }) {
  const account = useAccount();
  const surprise = useSurprise();
  return (
    <Card className="border-primary/30 bg-primary/5" size="sm">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <RiDiceLine aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="text-pretty">{pickedLabel(reasons)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={surprise.pending} onClick={() => void surprise.pick({ replace: true })} size="sm" type="button">{surprise.pending ? "Picking" : "Another one"}</Button>
          {account.status === "signed_in" ? (
            <Button asChild size="sm" variant="ghost"><Link to={preferencesPath}>Change preferences</Link></Button>
          ) : account.status === "signed_out" ? (
            <Button asChild size="sm" variant="ghost"><Link to={signInPath(preferencesPath)}>Set your preferences</Link></Button>
          ) : null}
        </div>
        {surprise.outcome ? (
          <p className="basis-full text-xs text-muted-foreground" role="status">
            {surprise.outcome.kind === "empty" ? surpriseEmptyMessage : surprise.outcome.message || "Could not pick another. Try again in a moment."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
