import { RiMailSendLine } from "@remixicon/react";
import { useLocation } from "react-router-dom";

import { ResendVerificationButton } from "@/components/resend-verification";
import { useAccount } from "@/store/account";

/** A thin bar under the header while the signed-in account's address is not verified yet. */
export function VerifyBanner() {
  const account = useAccount();
  const location = useLocation();
  if (account.status !== "signed_in" || account.account.email_verified) return null;
  if (location.pathname === "/account/verify") return null;
  return (
    <div className="border-b border-border/70 bg-primary/5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-xs sm:text-sm">
        <RiMailSendLine aria-hidden className="size-4 shrink-0 text-primary" />
        <p className="text-pretty">
          Verify your email to create menus and recipes. The link went to <span className="font-medium">{account.account.email}</span>.
        </p>
        <ResendVerificationButton className="ml-auto" size="xs" variant="ghost" />
      </div>
    </div>
  );
}
