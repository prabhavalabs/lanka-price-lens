import { RiUserLine } from "@remixicon/react";
import type { ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { GoogleButton, OrDivider } from "@/components/account-forms";
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
  /** The prompt's heading when nobody is signed in. */
  title?: string | undefined;
  /** What the person gains by signing in, under the heading. */
  description?: string | undefined;
  /** Also needs a verified address; an unverified account sees a prompt to verify instead of the children. */
  verified?: boolean | undefined;
};

/**
 * Renders its children for a signed-in person. Signed out, it asks them to sign in and brings
 * them back here afterwards; while the session is still being checked it shows a skeleton so
 * the page does not flash the prompt at someone who is signed in.
 */
export function RequireAccount({ children, title = "Sign in to continue", description = "An account keeps your menus and your own recipes, on any device.", verified = false }: Props) {
  const account = useAccount();
  const location = useLocation();
  if (account.status === "loading") return <RequireAccountSkeleton />;
  if (account.status === "signed_out") return <SignInPrompt description={description} returnTo={locationPath(location)} title={title} />;
  if (verified && !account.account.email_verified) return <VerifyPrompt email={account.account.email} />;
  return <>{children}</>;
}

export function RequireAccountSkeleton() {
  return (
    <div aria-busy className="mx-auto w-full max-w-3xl space-y-4" role="status">
      <span className="sr-only">Checking who is signed in</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function SignInPrompt({ title, description, returnTo }: { title: string; description: string; returnTo: string }) {
  return (
    <div className="mx-auto w-full max-w-sm py-4 sm:py-8">
      <Card>
        <CardHeader className="place-items-center text-center">
          <span className="mb-1 grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><RiUserLine className="size-5" /></span>
          <CardTitle className="text-balance text-xl">{title}</CardTitle>
          <CardDescription className="text-pretty text-sm">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full"><Link to={withReturnTo("/account/login", returnTo)}>Sign in</Link></Button>
          <Button asChild className="w-full" variant="secondary"><Link to={withReturnTo("/account/register", returnTo)}>Create an account</Link></Button>
          <OrDivider />
          <GoogleButton returnTo={safeReturnTo(returnTo)} />
        </CardContent>
      </Card>
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
