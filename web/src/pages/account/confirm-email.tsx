import { RiMailCheckLine } from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { AuthCard, FormError } from "@/components/account-forms";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { accountApi } from "@/lib/account-api";
import { usePageTitle } from "@/lib/page-title";
import { setAccountProfile, useAccount } from "@/store/account";

/** The page the "confirm your new address" link opens: posts the token once and reports the switch. */
export function ConfirmEmailPage() {
  usePageTitle("Confirm your new email · PriceLens");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const client = useQueryClient();
  const account = useAccount();
  const confirmation = useQuery({
    queryKey: ["account", "confirm-email", token],
    queryFn: async () => {
      const profile = await accountApi.confirmEmail(token);
      setAccountProfile(client, profile);
      return profile;
    },
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  if (!token) {
    return (
      <AuthCard description="This page needs the link from the mail we sent to your new address. Open it again from that inbox." title="The link is incomplete">
        <Button asChild className="w-full" variant="outline"><Link to="/account">Back to your account</Link></Button>
      </AuthCard>
    );
  }
  if (confirmation.isPending) {
    return (
      <AuthCard title="Confirming your new address">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />One moment.</p>
      </AuthCard>
    );
  }
  if (confirmation.isError) {
    return (
      <AuthCard description="Confirmation links work once and for a day. Start the change again from your account page and a fresh link will follow." title="This link no longer works">
        <FormError error={confirmation.error} />
        <Button asChild className="w-full"><Link to={account.status === "signed_in" ? "/account" : "/account/login?return_to=%2Faccount"}>{account.status === "signed_in" ? "Your account" : "Sign in"}</Link></Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard description={<>Your address is now <span className="font-medium text-foreground">{confirmation.data.email}</span>. A note has gone to the old one.</>} title="Email changed">
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><RiMailCheckLine className="size-5" /></span>
      <Button asChild className="w-full"><Link to="/account">Back to your account</Link></Button>
    </AuthCard>
  );
}
