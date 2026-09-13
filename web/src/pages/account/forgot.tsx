import { useMutation } from "@tanstack/react-query";
import { forgotPasswordSchema } from "@lanka-pricelens/shared";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { AuthCard, FormError, SubmitButton, TextField } from "@/components/account-forms";
import { Button } from "@/components/ui/button";
import { accountApi } from "@/lib/account-api";
import { validate, type FieldErrors } from "@/lib/account-forms";
import { usePageTitle } from "@/lib/page-title";

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export function ForgotPasswordPage() {
  usePageTitle("Forgot your password · PriceLens");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const request = useMutation({ mutationFn: (address: string) => accountApi.forgotPassword(address) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(forgotPasswordSchema, { email });
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) request.mutate(result.data.email);
  };
  if (request.isSuccess) {
    return (
      <AuthCard description={<>If that address has an account, mail is on its way. Open the link in it to choose a new password; it works for an hour.</>} title="Check your inbox">
        <p className="text-pretty text-sm text-muted-foreground">Nothing after a few minutes? Look in spam, check the spelling of the address, or ask again.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => request.reset()} type="button" variant="outline">Ask again</Button>
          <Button asChild className="flex-1"><Link to="/account/login">Back to sign in</Link></Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard description="Tell us the address on the account and we will mail a link to choose a new password." footer={<>Remembered it? <Link to="/account/login">Sign in</Link></>} title="Forgot your password?">
      <form className="space-y-4" noValidate onSubmit={submit}>
        <TextField autoComplete="email" autoFocus error={errors.email} id="forgot-email" inputMode="email" label="Email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        <div className="space-y-2">
          <FormError error={request.error} />
          <SubmitButton className="w-full" pending={request.isPending} pendingLabel="Sending">Send the link</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
