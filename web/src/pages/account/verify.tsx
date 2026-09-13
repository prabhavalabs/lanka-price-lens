import { RiMailCheckLine } from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { AuthCard, FormError } from "@/components/account-forms";
import { ResendVerificationButton } from "@/components/resend-verification";
import { useReturnTo } from "@/components/require-account";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { accountApi } from "@/lib/account-api";
import { usePageTitle } from "@/lib/page-title";
import { setAccountProfile, useAccount } from "@/store/account";

/**
 * The page a verification link opens. It posts the token as soon as it loads (as a query, so a
 * re-render never spends the single-use token twice), then offers the way onwards. A link that
 * has expired or was already used can be replaced from here when the person is signed in.
 */
export function VerifyEmailPage() {
  usePageTitle("Verify your email · PriceLens");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const returnTo = useReturnTo();
  const client = useQueryClient();
  const account = useAccount();
  const verification = useQuery({
    queryKey: ["account", "verify-email", token],
    queryFn: async () => {
      const profile = await accountApi.verifyEmail(token);
      setAccountProfile(client, profile);
      return profile;
    },
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const signedInUnverified = account.status === "signed_in" && !account.account.email_verified;
  if (!token) {
    return (
      <AuthCard description="This page needs the link from the mail we sent. Open it again from your inbox." title="The link is incomplete">
        {signedInUnverified ? <ResendVerificationButton className="w-full [&>button]:w-full" label="Send a new link" /> : <Button asChild className="w-full" variant="outline"><Link to="/">Back to the prices</Link></Button>}
      </AuthCard>
    );
  }
  if (verification.isPending) {
    return (
      <AuthCard title="Verifying your email">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />One moment.</p>
      </AuthCard>
    );
  }
  if (verification.isError) {
    return (
      <AuthCard description="Verification links work once and for a day." title="This link no longer works">
        <FormError error={verification.error} />
        {signedInUnverified ? (
          <ResendVerificationButton className="w-full [&>button]:w-full" label="Send a new link" />
        ) : account.status === "signed_in" ? (
          <Button asChild className="w-full"><Link to="/account">Your address is already verified</Link></Button>
        ) : (
          <>
            <p className="text-pretty text-sm text-muted-foreground">Sign in and we can send a fresh one.</p>
            <Button asChild className="w-full"><Link to="/account/login?return_to=%2Faccount">Sign in</Link></Button>
          </>
        )}
      </AuthCard>
    );
  }
  return (
    <AuthCard description={<>Thank you, {verification.data.display_name}. You can now keep menus and write recipes.</>} title="Your email is verified">
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><RiMailCheckLine className="size-5" /></span>
      <Button asChild className="w-full"><Link to={returnTo}>Continue</Link></Button>
    </AuthCard>
  );
}
