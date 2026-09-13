import { RiErrorWarningLine } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginSchema } from "@lanka-pricelens/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthCard, FormError, GoogleButton, OrDivider, SignedInAlready, SubmitButton, TextField } from "@/components/account-forms";
import { useReturnTo } from "@/components/require-account";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { accountApi } from "@/lib/account-api";
import { validate, withReturnTo, type FieldErrors } from "@/lib/account-forms";
import { usePageTitle } from "@/lib/page-title";
import { setAccountProfile, useAccount } from "@/store/account";

export function LoginPage() {
  usePageTitle("Sign in · PriceLens");
  const [params] = useSearchParams();
  const returnTo = useReturnTo();
  const navigate = useNavigate();
  const client = useQueryClient();
  const account = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const signIn = useMutation({
    mutationFn: (input: { email: string; password: string; remember: boolean }) => accountApi.login(input),
    onSuccess: (profile) => {
      setAccountProfile(client, profile);
      navigate(returnTo, { replace: true });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(loginSchema, { email, password, remember });
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) signIn.mutate(result.data);
  };
  if (account.status === "signed_in") return <SignedInAlready account={account.account} returnTo={returnTo} />;
  return (
    <AuthCard description="Your menus and recipes, on any device." footer={<>New to PriceLens? <Link to={withReturnTo("/account/register", returnTo)}>Create an account</Link></>} title="Sign in">
      {params.get("error") === "google" ? (
        <Alert variant="destructive">
          <RiErrorWarningLine />
          <AlertTitle>Google sign-in did not finish</AlertTitle>
          <AlertDescription>Try again, or sign in with your email and password.</AlertDescription>
        </Alert>
      ) : null}
      <GoogleButton returnTo={returnTo} />
      <OrDivider />
      <form className="space-y-4" noValidate onSubmit={submit}>
        <TextField autoComplete="email" autoFocus error={errors.email} id="login-email" inputMode="email" label="Email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        <TextField aside={<Link className="text-xs text-muted-foreground" to="/account/forgot">Forgot password?</Link>} autoComplete="current-password" error={errors.password} id="login-password" label="Password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        <div className="flex items-center gap-2">
          <Checkbox checked={remember} id="login-remember" onCheckedChange={(checked) => setRemember(checked === true)} />
          <Label className="font-normal" htmlFor="login-remember">Keep me signed in for 30 days</Label>
        </div>
        <div className="space-y-2">
          <FormError error={signIn.error} />
          <SubmitButton className="w-full" pending={signIn.isPending} pendingLabel="Signing in">Sign in</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
