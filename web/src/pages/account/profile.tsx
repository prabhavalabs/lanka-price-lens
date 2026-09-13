import { RiAlertLine, RiCheckLine, RiGoogleFill } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountLocales, changeEmailSchema, changePasswordSchema, deleteAccountSchema, profilePatchSchema, type AccountLocale, type AccountPreferences, type AccountProfile } from "@lanka-pricelens/shared";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { FormError, FormNote, SubmitButton, TextField } from "@/components/account-forms";
import { RequireAccount } from "@/components/require-account";
import { ResendVerificationButton } from "@/components/resend-verification";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { accountApi } from "@/lib/account-api";
import { confirmError, describeUserAgent, validate, type FieldErrors } from "@/lib/account-forms";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { setAccountProfile, useAccount } from "@/store/account";
import { languageNames, languageStore } from "@/store/language";

/**
 * The account page: who you are, how you sign in, what mail you want, where you are signed in,
 * and the way out. Each section is its own small form that saves on its own, so a typo in one
 * never blocks another.
 */
export function ProfilePage() {
  usePageTitle("Your account · PriceLens");
  return (
    <RequireAccount description="Your name, email, password, and what mail you want live here." title="Sign in to see your account">
      <ProfileSections />
    </RequireAccount>
  );
}

const whenFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

function formatWhen(iso: string, format = whenFormat): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format.format(date);
}

const isLocale = (value: string): value is AccountLocale => (accountLocales as readonly string[]).includes(value);

function ProfileSections() {
  const [params] = useSearchParams();
  const account = useAccount();
  if (account.status !== "signed_in") return null;
  const person = account.account;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header>
        <h1 className="text-balance font-heading text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-pretty text-muted-foreground">With PriceLens since {formatWhen(person.created_at, dayFormat)}.</p>
      </header>
      {params.get("linked") === "google" ? (
        <Alert>
          <RiGoogleFill />
          <AlertTitle>Google is linked</AlertTitle>
          <AlertDescription>You can sign in with Google from now on, as well as with your password if you have one.</AlertDescription>
        </Alert>
      ) : null}
      <AboutSection account={person} />
      <EmailSection account={person} />
      <PasswordSection account={person} />
      <NotificationsSection account={person} />
      <SessionsSection />
      <DangerSection account={person} />
    </div>
  );
}

function Section({ title, description, children, destructive = false }: { title: string; description?: string; children: ReactNode; destructive?: boolean }) {
  return (
    <Card className={cn(destructive && "border-destructive/40")}>
      <CardHeader>
        <h2 className={cn("font-heading text-base font-semibold leading-5 tracking-tight", destructive && "text-destructive")}>{title}</h2>
        {description ? <CardDescription className="text-pretty text-sm">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function AboutSection({ account }: { account: AccountProfile }) {
  const client = useQueryClient();
  const [name, setName] = useState(account.display_name);
  const [locale, setLocale] = useState<AccountLocale>(account.locale);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (input: { display_name: string; locale: AccountLocale }) => accountApi.updateProfile(input),
    onSuccess: (profile) => {
      setAccountProfile(client, profile);
      languageStore.set(profile.locale);
    },
  });
  const dirty = name.trim() !== account.display_name || locale !== account.locale;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(profilePatchSchema, { display_name: name, locale });
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) save.mutate({ display_name: result.data.display_name ?? account.display_name, locale: result.data.locale ?? account.locale });
  };
  return (
    <Section description="How the site addresses you, and the language for recipes and mail." title="About you">
      <form className="space-y-4" noValidate onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField autoComplete="name" error={errors.display_name} id="profile-name" label="Name" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
          <div className="space-y-1.5">
            <Label htmlFor="profile-language">Language</Label>
            <Select onValueChange={(value) => { if (isLocale(value)) setLocale(value); }} value={locale}>
              <SelectTrigger className="w-full data-[size=default]:h-10" id="profile-language"><SelectValue /></SelectTrigger>
              <SelectContent>
                {accountLocales.map((code) => <SelectItem key={code} value={code}>{languageNames[code]}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.locale ? <p className="text-xs text-destructive">{errors.locale}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={!dirty} pending={save.isPending} pendingLabel="Saving">Save</SubmitButton>
          <FormError error={save.error} />
          {save.isSuccess && !dirty ? <FormNote>Saved.</FormNote> : null}
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ account }: { account: AccountProfile }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const change = useMutation({ mutationFn: (input: { new_email: string; password: string }) => accountApi.changeEmail(input) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const extra: FieldErrors = newEmail.trim().toLowerCase() === account.email ? { new_email: "That is already your address" } : {};
    const result = validate(changeEmailSchema, { new_email: newEmail, password }, extra);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) change.mutate(result.data);
  };
  const cancel = () => {
    setOpen(false);
    setNewEmail("");
    setPassword("");
    setErrors({});
    change.reset();
  };
  return (
    <Section description="Where sign-in links and resets go, and digests and alerts if you want them." title="Email">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{account.email}</p>
        {account.email_verified ? <Badge variant="secondary"><RiCheckLine />Verified</Badge> : <Badge variant="outline">Not verified</Badge>}
        {account.identities.includes("google") ? <Badge variant="outline"><RiGoogleFill />Google linked</Badge> : null}
      </div>
      {!account.email_verified ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Open the link we sent to verify it.</span>
          <ResendVerificationButton size="xs" />
        </div>
      ) : null}
      <Separator className="my-4" />
      {change.isSuccess ? (
        <div className="space-y-2">
          <FormNote>We sent a link to {change.variables.new_email}. The change happens when you open it; until then the old address stays.</FormNote>
          <Button onClick={cancel} size="sm" type="button" variant="ghost">Done</Button>
        </div>
      ) : !account.has_password ? (
        <p className="text-pretty text-sm text-muted-foreground">Set a password below before changing the address; it protects the account while the switch happens.</p>
      ) : !open ? (
        <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">Change email address</Button>
      ) : (
        <form className="space-y-4" noValidate onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField autoComplete="email" autoFocus error={errors.new_email} hint="A confirmation link goes there; the old address is told afterwards." id="email-new" inputMode="email" label="New email" onChange={(event) => setNewEmail(event.target.value)} type="email" value={newEmail} />
            <TextField autoComplete="current-password" error={errors.password} id="email-password" label="Your password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pending={change.isPending} pendingLabel="Sending">Send the confirmation link</SubmitButton>
            <Button onClick={cancel} type="button" variant="ghost">Cancel</Button>
            <FormError error={change.error} />
          </div>
        </form>
      )}
    </Section>
  );
}

function PasswordSection({ account }: { account: AccountProfile }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const change = useMutation({
    mutationFn: (input: { current_password: string; new_password: string }) => accountApi.changePassword(input),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });
  const setLink = useMutation({ mutationFn: () => accountApi.forgotPassword(account.email) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(changePasswordSchema, { current_password: current, new_password: next }, confirmError(next, confirm));
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) change.mutate(result.data);
  };
  if (!account.has_password) {
    return (
      <Section description="You sign in with Google and have no password. One lets you sign in with your email as well, and is needed to change the address." title="Password">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={setLink.isPending || setLink.isSuccess} onClick={() => setLink.mutate()} type="button" variant="outline">{setLink.isPending ? "Sending" : setLink.isSuccess ? "Sent" : "Email me a link to set one"}</Button>
          {setLink.isSuccess ? <FormNote>Check your inbox; the link works for an hour.</FormNote> : null}
          <FormError error={setLink.error} />
        </div>
      </Section>
    );
  }
  return (
    <Section description="Changing it signs every other device out and sends you a note." title="Password">
      <form className="space-y-4" noValidate onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField autoComplete="current-password" error={errors.current_password} id="password-current" label="Current password" maxLength={200} onChange={(event) => setCurrent(event.target.value)} type="password" value={current} />
          <TextField autoComplete="new-password" error={errors.new_password} hint="Ten characters or more." id="password-new" label="New password" maxLength={200} onChange={(event) => setNext(event.target.value)} type="password" value={next} />
          <TextField autoComplete="new-password" error={errors.confirm} id="password-confirm" label="New password, again" maxLength={200} onChange={(event) => setConfirm(event.target.value)} type="password" value={confirm} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending={change.isPending} pendingLabel="Changing">Change password</SubmitButton>
          <FormError error={change.error} />
          {change.isSuccess && !next ? <FormNote>Password changed. Other devices have been signed out.</FormNote> : null}
        </div>
      </form>
    </Section>
  );
}

const notificationRows: Array<{ key: keyof AccountPreferences; label: string; description: string }> = [
  { key: "notify_email", label: "Email from PriceLens", description: "News about the site and what is new. Mail about the account itself (verification, password changes) always comes." },
  { key: "notify_digest", label: "Daily price digest", description: "The morning's movers in one mail, once digests start." },
  { key: "notify_alerts", label: "Price alerts", description: "When a product or menu you watch moves, once alerts start." },
];

function NotificationsSection({ account }: { account: AccountProfile }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (preferences: AccountPreferences) => accountApi.updateProfile({ preferences }),
    onMutate: (preferences) => {
      setAccountProfile(client, { ...account, preferences });
      return { previous: account };
    },
    onSuccess: (profile) => setAccountProfile(client, profile),
    onError: (_error, _preferences, context) => {
      if (context) setAccountProfile(client, context.previous);
    },
  });
  return (
    <Section description="Saved as you switch them. Nothing is sent until each kind of mail exists." title="Notifications">
      <ul className="divide-y">
        {notificationRows.map((row) => (
          <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0" key={row.key}>
            <div className="space-y-0.5">
              <Label className="text-sm" htmlFor={`pref-${row.key}`}>{row.label}</Label>
              <p className="text-pretty text-xs text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              checked={account.preferences[row.key]}
              disabled={save.isPending}
              id={`pref-${row.key}`}
              onCheckedChange={(checked) => {
                const preferences = { ...account.preferences };
                preferences[row.key] = checked;
                save.mutate(preferences);
              }}
            />
          </li>
        ))}
      </ul>
      <FormError className="mt-3" error={save.error} />
    </Section>
  );
}

function SessionsSection() {
  const sessions = useQuery({ queryKey: ["account", "sessions"], queryFn: ({ signal }) => accountApi.sessions.list(signal), staleTime: 30_000 });
  const revoke = useMutation({
    mutationFn: async () => (await accountApi.sessions.revokeOthers()).revoked,
    onSuccess: () => void sessions.refetch(),
  });
  const others = (sessions.data ?? []).filter((session) => !session.current).length;
  return (
    <Section description="Every browser and phone this account is signed in on." title="Where you are signed in">
      {sessions.isPending ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : sessions.isError ? (
        <FormError error={sessions.error} />
      ) : (
        <ul className="divide-y">
          {sessions.data.map((session) => (
            <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0" key={session.id}>
              <p className="flex items-center gap-2 font-medium">
                {describeUserAgent(session.user_agent)}
                {session.current ? <Badge variant="secondary">This device</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Signed in {formatWhen(session.created_at)}{session.address ? ` from ${session.address}` : ""} · until {formatWhen(session.expires_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={revoke.isPending || others === 0} onClick={() => revoke.mutate()} type="button" variant="outline">{revoke.isPending ? "Signing out" : "Sign out everywhere else"}</Button>
        {revoke.isSuccess ? <FormNote>{revoke.data === 1 ? "One other session signed out." : `${revoke.data} other sessions signed out.`}</FormNote> : null}
        <FormError error={revoke.error} />
      </div>
    </Section>
  );
}

function DangerSection({ account }: { account: AccountProfile }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const remove = useMutation({
    mutationFn: (input: { password?: string; confirm: "DELETE" }) => accountApi.deleteAccount(input),
    onSuccess: () => {
      setAccountProfile(client, null);
      client.removeQueries({ queryKey: ["account"], predicate: (query) => query.queryKey[1] !== "me" });
      navigate("/", { replace: true });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const extra: FieldErrors = {};
    if (confirm.trim() !== "DELETE") extra.confirm = "Type DELETE, in capitals, to confirm";
    if (account.has_password && !password) extra.password = "Your password is needed";
    const result = validate(deleteAccountSchema, { confirm: confirm.trim(), ...(account.has_password ? { password } : {}) }, extra);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) remove.mutate({ confirm: "DELETE", ...(result.data.password !== undefined ? { password: result.data.password } : {}) });
  };
  return (
    <Section description="Deleting the account removes your menus and recipes with it. The basket in this browser stays." destructive title="Delete account">
      <AlertDialog
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirm("");
            setPassword("");
            setErrors({});
            remove.reset();
          }
        }}
        open={open}
      >
        <AlertDialogTrigger asChild><Button type="button" variant="destructive">Delete my account</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <form className="grid gap-3" noValidate onSubmit={submit}>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive"><RiAlertLine /></AlertDialogMedia>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>Your menus and your recipes go with it, and a last mail confirms it. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <TextField autoComplete="off" autoFocus error={errors.confirm} id="delete-confirm" label={<>Type <span className="font-mono">DELETE</span> to confirm</>} onChange={(event) => setConfirm(event.target.value)} value={confirm} />
              {account.has_password ? <TextField autoComplete="current-password" error={errors.password} id="delete-password" label="Your password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /> : null}
              <FormError error={remove.error} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Keep my account</AlertDialogCancel>
              <SubmitButton pending={remove.isPending} pendingLabel="Deleting" variant="destructive">Delete everything</SubmitButton>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
