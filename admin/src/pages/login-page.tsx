import { zodResolver } from "@hookform/resolvers/zod";
import { RiLock2Line, RiPriceTag3Line } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, type AdminUser } from "@/lib/api";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(1_024),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const login = useMutation({
    mutationFn: (values: LoginValues) => api<AdminUser>("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      navigate("/", { replace: true });
    },
  });

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
                <Field data-invalid={Boolean(form.formState.errors.password)}><FieldLabel htmlFor="password">Password</FieldLabel><Input aria-invalid={Boolean(form.formState.errors.password)} autoComplete="current-password" id="password" type="password" {...form.register("password")} /><FieldError errors={[form.formState.errors.password]} /></Field>
              </FieldGroup>
              {login.isError ? <Alert variant="destructive">{login.error.message}</Alert> : null}
              <Button className="w-full" disabled={login.isPending} size="lg" type="submit">{login.isPending ? "Signing in…" : "Sign in"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
