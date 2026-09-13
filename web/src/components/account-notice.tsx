import { RiCloseLine, RiErrorWarningLine, RiLoginBoxLine, RiMailCheckLine } from "@remixicon/react";
import { Link, useLocation } from "react-router-dom";

import { ResendVerificationButton } from "@/components/resend-verification";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AccountApiError } from "@/lib/account-api";
import { describeAccountError, locationPath, withReturnTo } from "@/lib/account-forms";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";

/** The sign-in page, coming back to `returnTo` afterwards. */
export function signInPath(returnTo: string): string {
  return withReturnTo("/account/login", returnTo);
}

export function isEmailNotVerified(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 403 && error.code === "EMAIL_NOT_VERIFIED";
}

/**
 * The answer to a refused content action, next to where it happened: the verification prompt
 * with a way to get the link again, a sign-in link after a session ended, or what the server
 * said. Nothing is rendered while there is no error.
 */
export function AccountActionError({ error, onDismiss, className }: { error: unknown; onDismiss?: (() => void) | undefined; className?: string | undefined }) {
  const account = useAccount();
  const location = useLocation();
  if (!error) return null;
  const dismiss = onDismiss ? <Button aria-label="Dismiss" className="absolute right-1 top-1" onClick={onDismiss} size="icon-xs" type="button" variant="ghost"><RiCloseLine /></Button> : null;
  if (isEmailNotVerified(error)) {
    const email = account.status === "signed_in" ? account.account.email : "your address";
    return (
      <Alert className={cn("relative", className)}>
        <RiMailCheckLine />
        <AlertTitle>Verify your email address first</AlertTitle>
        <AlertDescription>
          <p>We sent a link to {email}. Follow it, then try again.</p>
          <ResendVerificationButton className="mt-1.5" label="Send the link again" size="xs" variant="outline" />
        </AlertDescription>
        {dismiss}
      </Alert>
    );
  }
  if (error instanceof AccountApiError && error.status === 401) {
    return (
      <Alert className={cn("relative", className)}>
        <RiLoginBoxLine />
        <AlertTitle>Your session ended</AlertTitle>
        <AlertDescription><Link className="underline" to={signInPath(locationPath(location))}>Sign in again</Link> to carry on where you were.</AlertDescription>
        {dismiss}
      </Alert>
    );
  }
  return (
    <Alert className={cn("relative", className)} variant="destructive">
      <RiErrorWarningLine />
      <AlertTitle>That did not save</AlertTitle>
      <AlertDescription>{describeAccountError(error)}</AlertDescription>
      {dismiss}
    </Alert>
  );
}
