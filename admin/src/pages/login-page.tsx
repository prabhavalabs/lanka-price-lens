import { zodResolver } from "@hookform/resolvers/zod";
import { RiErrorWarningLine, RiLock2Line, RiPriceTag3Line } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiError, type AdminUser, type LoginFailure } from "@/lib/api";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(1_024),
});
type LoginValues = z.infer<typeof loginSchema>;
type LoginFeedback =
  | { kind: "invalid_credentials"; attemptsRemaining: number | null }
  | { kind: "locked"; lockedUntil: string }
  | { kind: "error"; message: string };
const lockoutTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function loginFeedback(error: Error): LoginFeedback {
  if (!(error instanceof ApiError)) return { kind: "error", message: error.message };
  if (!isLoginFailure(error.payload)) {
    return error.status === 401
      ? { kind: "invalid_credentials", attemptsRemaining: null }
      : { kind: "error", message: error.message };
  }
  if (error.payload.reason === "account_locked") return { kind: "locked", lockedUntil: error.payload.locked_until };
  return { kind: "invalid_credentials", attemptsRemaining: error.payload.attempts_remaining };
}

function isLoginFailure(value: unknown): value is LoginFailure {
  if (!value || typeof value !== "object" || !("reason" in value)) return false;
  const failure = value as Partial<LoginFailure>;
  if (failure.reason === "invalid_credentials") return typeof failure.attempts_remaining === "number";
  return failure.reason === "account_locked" && typeof failure.locked_until === "string";
}

function LockoutCountdown({ lockedUntil }: { lockedUntil: string }) {
  const endTime = new Date(lockedUntil).getTime();
  const [secondsRemaining, setSecondsRemaining] = useState(() => remainingSeconds(endTime));

  useEffect(() => {
    const update = () => setSecondsRemaining(remainingSeconds(endTime));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [endTime]);

  if (secondsRemaining === 0) return <>You can try signing in again now.</>;
  return <>
    Too many unsuccessful attempts. Try again in <strong>{shortDuration(secondsRemaining)}</strong>
    {" "}(at <time dateTime={lockedUntil}>{lockoutTimeFormatter.format(endTime)}</time>).
  </>;
}

function remainingSeconds(endTime: number): number {
  return Math.max(0, Math.ceil((endTime - Date.now()) / 1_000));
}

function shortDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<LoginFeedback | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const login = useMutation({
    mutationFn: (values: LoginValues) => api<AdminUser>("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }),
    onMutate: () => setFeedback(null),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      navigate("/", { replace: true });
    },
    onError: (error) => {
      const nextFeedback = loginFeedback(error);
      setFeedback(nextFeedback);
      if (nextFeedback.kind === "locked") setLockedUntil(nextFeedback.lockedUntil);
      form.resetField("password");
      form.setFocus("password");
    },
  });

  useEffect(() => {
    if (!lockedUntil) return;
    const timeout = window.setTimeout(() => {
      setLockedUntil(null);
      setFeedback(null);
      form.setFocus("password");
    }, Math.max(0, new Date(lockedUntil).getTime() - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [form, lockedUntil]);

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden border-r border-white/10 bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="flex items-center gap-3"><img alt="" className="size-11" src="/admin/app-icon.svg" /><div><p className="text-lg font-semibold tracking-tight">Lanka PriceLens</p><p className="font-mono text-[11px] text-neutral-500">Open price intelligence infrastructure</p></div></div>
        <div className="max-w-xl"><div className="mb-7 grid size-12 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><RiPriceTag3Line className="size-6" /></div><h1 className="font-heading text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">Reliable source data starts with a visible pipeline.</h1><p className="mt-5 max-w-lg text-base leading-7 text-neutral-400">Discover, inspect, parse, and monitor Sri Lanka’s public food-price bulletins from one accountable workspace.</p></div>
        <p className="font-mono text-[10px] text-neutral-600">Non-commercial data preparation · Source-attributed · Self-hosted</p>
      </section>
      <section className="grid place-items-center p-5 sm:p-8">
        <Card className="w-full max-w-md bg-card/80">
          <CardHeader className="space-y-5"><div className="flex items-center gap-3 lg:hidden"><img alt="" className="size-9" src="/admin/app-icon.svg" /><div><p className="text-sm font-semibold">Lanka PriceLens</p><p className="font-mono text-[10px] text-muted-foreground">Foundry operations</p></div></div><div className="grid size-11 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><RiLock2Line className="size-5" /></div><div><CardTitle className="text-2xl">Administrator sign in</CardTitle><CardDescription className="mt-1.5">Use your seeded owner account to continue.</CardDescription></div></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
              <FieldGroup>
                <Field data-invalid={Boolean(form.formState.errors.email)}><FieldLabel htmlFor="email">Email</FieldLabel><Input aria-invalid={Boolean(form.formState.errors.email)} autoComplete="username" id="email" type="email" {...form.register("email")} /><FieldError errors={[form.formState.errors.email]} /></Field>
                <Field data-invalid={Boolean(form.formState.errors.password)}><FieldLabel htmlFor="password">Password</FieldLabel><Input aria-describedby={feedback ? "login-feedback" : undefined} aria-invalid={Boolean(form.formState.errors.password)} autoComplete="current-password" disabled={Boolean(lockedUntil)} id="password" type="password" {...form.register("password")} /><FieldError errors={[form.formState.errors.password]} /></Field>
              </FieldGroup>
              {feedback ? <Alert id="login-feedback" variant="destructive"><RiErrorWarningLine /><AlertTitle>{feedback.kind === "locked" ? "Sign-in temporarily locked" : "Sign-in failed"}</AlertTitle><AlertDescription>{feedback.kind === "locked" ? <LockoutCountdown lockedUntil={feedback.lockedUntil} /> : feedback.kind === "invalid_credentials" ? <>The email or password is incorrect. {feedback.attemptsRemaining === null ? <>Check your details and try again.</> : <>You have <strong>{feedback.attemptsRemaining} {feedback.attemptsRemaining === 1 ? "attempt" : "attempts"}</strong> remaining before sign-in is locked for 15 minutes. Check your details and try again.</>}</> : <>We couldn’t sign you in. {feedback.message} Try again.</>}</AlertDescription></Alert> : null}
              <Button className="w-full" disabled={login.isPending || Boolean(lockedUntil)} size="lg" type="submit">{lockedUntil ? "Sign-in temporarily locked" : login.isPending ? "Signing in…" : "Sign in"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
