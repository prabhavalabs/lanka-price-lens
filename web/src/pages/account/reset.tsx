import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetPasswordSchema } from "@lanka-pricelens/shared";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AuthCard, FormError, SubmitButton, TextField } from "@/components/account-forms";
import { Button } from "@/components/ui/button";
import { accountApi } from "@/lib/account-api";
import { confirmError, validate, type FieldErrors } from "@/lib/account-forms";
import { usePageTitle } from "@/lib/page-title";
import { setAccountProfile } from "@/store/account";

/** The page a reset link opens: a new password, twice. Signs the browser in and signs every other device out. */
export function ResetPasswordPage() {
  usePageTitle("Choose a new password · PriceLens");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const reset = useMutation({
    mutationFn: (input: { token: string; password: string }) => accountApi.resetPassword(input),
    onSuccess: (profile) => setAccountProfile(client, profile),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(resetPasswordSchema, { token, password }, confirmError(password, confirm));
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) reset.mutate(result.data);
  };
  if (!token) {
    return (
      <AuthCard description="This page needs the link from the mail we sent. Open it again from your inbox, or ask for a new one." title="The link is incomplete">
        <Button asChild className="w-full"><Link to="/account/forgot">Ask for a new link</Link></Button>
      </AuthCard>
    );
  }
  if (reset.isSuccess) {
    return (
      <AuthCard description="You are signed in on this device, and every other device has been signed out." title="Your password is changed">
        <Button asChild className="w-full"><Link to="/">Continue</Link></Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard description="Ten characters or more, anything goes." title="Choose a new password">
      <form className="space-y-4" noValidate onSubmit={submit}>
        <TextField autoComplete="new-password" autoFocus error={errors.password ?? errors.token} id="reset-password" label="New password" maxLength={200} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        <TextField autoComplete="new-password" error={errors.confirm} id="reset-confirm" label="New password, again" maxLength={200} onChange={(event) => setConfirm(event.target.value)} type="password" value={confirm} />
        <div className="space-y-2">
          <FormError error={reset.error} />
          {reset.isError ? <p className="text-sm"><Link to="/account/forgot">Ask for a new link</Link></p> : null}
          <SubmitButton className="w-full" pending={reset.isPending} pendingLabel="Saving">Save the new password</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
