import { useMutation } from "@tanstack/react-query";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { accountApi } from "@/lib/account-api";
import { describeAccountError } from "@/lib/account-forms";
import { cn } from "@/lib/utils";

/**
 * Asks the API for a fresh verification link for the signed-in account and says what happened
 * right next to the button. Rate limited server side; the wording covers that.
 */
export function ResendVerificationButton({ className, size = "sm", variant = "outline", label = "Resend the link", ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "type" | "children"> & { label?: string }) {
  const resend = useMutation({ mutationFn: () => accountApi.resendVerification() });
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <Button disabled={resend.isPending || resend.isSuccess} onClick={() => resend.mutate()} size={size} type="button" variant={variant} {...props}>
        {resend.isPending ? "Sending" : resend.isSuccess ? "Sent" : label}
      </Button>
      {resend.isSuccess ? <span className="text-xs text-muted-foreground" role="status">Check your inbox.</span> : null}
      {resend.isError ? <span className="text-xs text-destructive" role="alert">{describeAccountError(resend.error)}</span> : null}
    </span>
  );
}
