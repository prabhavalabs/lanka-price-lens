import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";

import { ResendVerificationButton } from "@/components/resend-verification";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { locationPath, safeReturnTo, withReturnTo } from "@/lib/account-forms";
import { useAccount } from "@/store/account";

/** Where the account pages send someone afterwards: the `return_to` query parameter when it is a path on this site, else home. */
export function useReturnTo(fallback = "/"): string {
  const [params] = useSearchParams();
  return safeReturnTo(params.get("return_to"), fallback);
}

type Props = {
  children: ReactNode;
  /** Also needs a verified address; an unverified account sees a prompt to verify instead of the children. */
  verified?: boolean | undefined;
};

/**
 * Renders its children for a signed-in person. Signed out, it sends them to the sign-in page
 * with this page as the way back, so signing in lands them where they were going; while the
 * session is still being checked it shows a skeleton so nobody signed in is bounced by mistake.
 */
export function RequireAccount({ children, verified = false }: Props) {
  const account = useAccount();
  const location = useLocation();
  if (account.status === "loading") return <RequireAccountSkeleton />;
  if (account.status === "signed_out") return <Navigate replace to={withReturnTo("/account/login", locationPath(location))} />;
  if (verified && !account.account.email_verified) return <VerifyPrompt email={account.account.email} />;
  return <>{children}</>;
}

export function RequireAccountSkeleton() {
  return (
    <div aria-busy className="space-y-4" role="status">
      <span className="sr-only">Checking who is signed in</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function VerifyPrompt({ email }: { email: string }) {
  return (
    <div className="mx-auto w-full max-w-sm py-4 sm:py-8">
      <Card>
        <CardHeader className="place-items-center text-center">
          <CardTitle className="text-balance text-xl">Verify your email first</CardTitle>
          <CardDescription className="text-pretty text-sm">Menus and recipes wait until the address is confirmed. Open the link we sent to <span className="font-medium text-foreground">{email}</span>, or ask for a new one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <ResendVerificationButton label="Send a new link" />
          <Button asChild size="sm" variant="link"><Link to="/account">Change the address</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
