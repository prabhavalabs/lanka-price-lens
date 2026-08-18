import { zodResolver } from "@hookform/resolvers/zod";
import { RiLock2Line, RiPriceTag3Line } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <main className="grid min-h-screen bg-neutral-950 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(16,185,129,0.28),transparent_36%),radial-gradient(circle_at_80%_80%,rgba(245,158,11,0.16),transparent_32%)]" />
        <div className="relative flex items-center gap-3"><img alt="" className="size-12" src="/admin/app-icon.svg" /><div><p className="font-heading text-xl font-semibold">Lanka PriceLens</p><p className="text-sm text-neutral-400">Open price intelligence infrastructure</p></div></div>
        <div className="relative max-w-xl"><RiPriceTag3Line className="mb-6 size-10 text-emerald-400" /><h1 className="font-heading text-5xl font-semibold leading-tight">Reliable source data starts with a visible pipeline.</h1><p className="mt-5 text-lg leading-8 text-neutral-400">Discover, inspect, parse, and monitor Sri Lanka’s public food-price bulletins from one accountable workspace.</p></div>
        <p className="relative text-xs text-neutral-500">Non-commercial data preparation · Source-attributed · Self-hosted</p>
      </section>
      <section className="grid place-items-center bg-background p-6">
        <Card className="w-full max-w-md border-0 shadow-none sm:border sm:shadow-xl">
          <CardHeader className="space-y-3"><div className="grid size-11 place-items-center bg-primary text-primary-foreground"><RiLock2Line className="size-5" /></div><div><CardTitle className="font-heading text-2xl">Administrator sign in</CardTitle><CardDescription className="mt-1">Use your seeded owner account to continue.</CardDescription></div></CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
              <div className="space-y-2"><Label htmlFor="email">Email</Label><Input autoComplete="username" id="email" type="email" {...form.register("email")} />{form.formState.errors.email ? <p className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}</div>
              <div className="space-y-2"><Label htmlFor="password">Password</Label><Input autoComplete="current-password" id="password" type="password" {...form.register("password")} />{form.formState.errors.password ? <p className="text-xs text-destructive">{form.formState.errors.password.message}</p> : null}</div>
              {login.isError ? <Alert variant="destructive">{login.error.message}</Alert> : null}
              <Button className="w-full" disabled={login.isPending} type="submit">{login.isPending ? "Signing in…" : "Sign in"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
