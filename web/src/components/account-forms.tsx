import { RiGoogleFill } from "@remixicon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AccountProfile } from "@lanka-pricelens/shared";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { accountApi } from "@/lib/account-api";
import { describeAccountError } from "@/lib/account-forms";
import { cn } from "@/lib/utils";
import { setAccountProfile } from "@/store/account";

/**
 * The pieces every account form is built from: a labelled input with its error under it, the
 * request's error next to the button, the Google button, and the narrow card the sign-in pages
 * sit in. Errors are shown where the action happens, never in a toast.
 */

type TextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  id: string;
  label: ReactNode;
  /** Something to the right of the label: "Forgot password?". */
  aside?: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
};

export function TextField({ id, label, aside, error, hint, className, ...input }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      <Input aria-describedby={describedBy || undefined} aria-invalid={error ? true : undefined} id={id} {...input} />
      {hint ? <p className="text-pretty text-xs text-muted-foreground" id={hintId}>{hint}</p> : null}
      {error ? <p className="text-xs text-destructive" id={errorId}>{error}</p> : null}
    </div>
  );
}

/** A failed request, in words, placed next to the button that sent it. */
export function FormError({ error, className }: { error: unknown; className?: string | undefined }) {
  if (!error) return null;
  return <p className={cn("text-pretty text-sm text-destructive", className)} role="alert">{describeAccountError(error)}</p>;
}

/** A note that something worked, in the same place an error would sit. */
export function FormNote({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <p className={cn("text-pretty text-sm text-primary", className)} role="status">{children}</p>;
}

export function SubmitButton({ pending, pendingLabel, children, className, ...props }: ComponentProps<typeof Button> & { pending: boolean; pendingLabel: string }) {
  return (
    <Button className={className} disabled={pending || props.disabled} type="submit" {...props}>
      {pending ? <Spinner className="size-4" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Sends the browser to the API's Google flow; Google brings it back to `returnTo`. */
export function GoogleButton({ returnTo, className, children = "Continue with Google" }: { returnTo: string; className?: string | undefined; children?: ReactNode }) {
  return (
    <Button asChild className={cn("w-full", className)} variant="outline">
      <a href={accountApi.googleStartUrl(returnTo)}><RiGoogleFill className="size-4" />{children}</a>
    </Button>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div aria-hidden className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The narrow card the sign-in, register, and recovery pages share. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-sm space-y-4 py-4 sm:py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-balance text-xl">{title}</CardTitle>
          {description ? <CardDescription className="text-pretty text-sm">{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
      {footer ? <p className="text-pretty text-center text-sm text-muted-foreground [&_a]:font-medium [&_a]:text-foreground">{footer}</p> : null}
    </div>
  );
}

/** What the sign-in and register pages show someone who is already signed in. */
export function SignedInAlready({ account, returnTo }: { account: AccountProfile; returnTo: string }) {
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => accountApi.logout(),
    onSettled: () => setAccountProfile(client, null),
  });
  return (
    <AuthCard description={<>You are signed in as <span className="font-medium text-foreground">{account.display_name}</span> ({account.email}).</>} title="Already signed in">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="flex-1"><Link to={returnTo}>Continue</Link></Button>
        <Button className="flex-1" disabled={signOut.isPending} onClick={() => signOut.mutate()} type="button" variant="outline">{signOut.isPending ? "Signing out" : "Not you? Sign out"}</Button>
      </div>
      <FormError error={signOut.error} />
    </AuthCard>
  );
}
