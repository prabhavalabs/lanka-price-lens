import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerSchema } from "@lanka-pricelens/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthCard, FormError, GoogleButton, OrDivider, SignedInAlready, SubmitButton, TextField } from "@/components/account-forms";
import { useReturnTo } from "@/components/require-account";
import { accountApi } from "@/lib/account-api";
import { validate, withReturnTo, type FieldErrors } from "@/lib/account-forms";
import { usePageTitle } from "@/lib/page-title";
import { trackPixelEvent } from "@/lib/meta-pixel";
import { setAccountProfile, useAccount } from "@/store/account";

export function RegisterPage() {
  usePageTitle("Create an account · PriceLens");
  const returnTo = useReturnTo();
  const navigate = useNavigate();
  const client = useQueryClient();
  const account = useAccount();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const register = useMutation({
    mutationFn: (input: { email: string; password: string; display_name: string }) => accountApi.register(input),
    onSuccess: (profile) => {
      setAccountProfile(client, profile);
      trackPixelEvent("CompleteRegistration");
      navigate(returnTo, { replace: true });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(registerSchema, { display_name: name, email, password });
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) register.mutate(result.data);
  };
  if (account.status === "signed_in") return <SignedInAlready account={account.account} returnTo={returnTo} />;
  return (
    <AuthCard description="Reading prices never needs an account. One keeps your menus and your own recipes, on any device." footer={<>Already have one? <Link to={withReturnTo("/account/login", returnTo)}>Sign in</Link></>} title="Create an account">
      <GoogleButton returnTo={returnTo} />
      <OrDivider />
      <form className="space-y-4" noValidate onSubmit={submit}>
        <TextField autoComplete="name" autoFocus error={errors.display_name} id="register-name" label="Your name" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" value={name} />
        <TextField autoComplete="email" error={errors.email} hint="We will send a link there to confirm it is yours." id="register-email" inputMode="email" label="Email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        <TextField autoComplete="new-password" error={errors.password} hint="Ten characters or more, anything goes. A few words you will remember beat a short jumble." id="register-password" label="Password" maxLength={200} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        <div className="space-y-2">
          <FormError error={register.error} />
          <SubmitButton className="w-full" pending={register.isPending} pendingLabel="Creating your account">Create account</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
