import { RiAlertLine, RiCheckLine, RiGoogleFill, RiHandHeartLine, RiStarFill, RiStarLine } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountLocales, avoidChoices, changeEmailSchema, changePasswordSchema, deleteAccountSchema, dietChoices, dishCategories, goalChoices, profilePatchSchema, type AccountLocale, type AccountPreferences, type AccountProfile, type AvoidChoice, type DietChoice, type GoalChoice, type WatchAlert, type WatchEntry } from "@lanka-pricelens/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { FormError, FormNote, SubmitButton, TextField } from "@/components/account-forms";
import { ProductImage } from "@/components/product-image";
import { RequireAccount } from "@/components/require-account";
import { ResendVerificationButton } from "@/components/resend-verification";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { accountApi } from "@/lib/account-api";
import { confirmError, describeUserAgent, validate, type FieldErrors } from "@/lib/account-forms";
import { contributionRows, type ContributionRow } from "@/lib/contributions";
import { changeLabel, dishCategoryLabel, rupees, unitLabel } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { setAccountProfile, useAccount } from "@/store/account";
import { useProposals, useSentTranslations, useSubmissions } from "@/store/community";
import { useWatchActions, useWatchlist } from "@/store/watchlist";
import { languageNames, languageStore } from "@/store/language";

/**
 * The account page: who you are, what you eat, how you sign in, what mail you want, where you
 * are signed in, and the way out. Each section is its own small form that saves on its own, so
 * a typo in one never blocks another.
 */
export function ProfilePage() {
  usePageTitle("Your account · PriceLens");
  return (
    <RequireAccount>
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
  const location = useLocation();
  const account = useAccount();
  const ready = account.status === "signed_in";
  // A link to a section (the banner's "Change preferences") has to scroll once the sections exist.
  useEffect(() => {
    const id = location.hash.replace(/^#/u, "");
    if (ready && id) document.getElementById(id)?.scrollIntoView();
  }, [location.hash, ready]);
  if (account.status !== "signed_in") return null;
  const person = account.account;
  return (
    <div className="space-y-6">
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
      <FoodPreferencesSection account={person} />
      <WishlistSection />
      <ContributionsSection />
      <EmailSection account={person} />
      <PasswordSection account={person} />
      <NotificationsSection account={person} />
      <SessionsSection />
      <DangerSection account={person} />
    </div>
  );
}

function Section({ id, title, description, children, destructive = false }: { id?: string; title: string; description?: string; children: ReactNode; destructive?: boolean }) {
  return (
    <Card className={cn("scroll-mt-20", destructive && "border-destructive/40")} {...(id ? { id } : {})}>
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

/**
 * Saves part of the preferences the moment it changes: the profile in the cache takes the new
 * value at once, the server merges the patch with the rest, and a refusal puts the old profile
 * back. Shared by the food preferences and the notification switches.
 */
function usePreferencesMutation(account: AccountProfile) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AccountPreferences>) => accountApi.updateProfile({ preferences: patch }),
    onMutate: (patch) => {
      setAccountProfile(client, { ...account, preferences: { ...account.preferences, ...patch } });
      return { previous: account };
    },
    onSuccess: (profile) => setAccountProfile(client, profile),
    onError: (_error, _patch, context) => {
      if (context) setAccountProfile(client, context.previous);
    },
  });
}

const dietLabels: Record<DietChoice, string> = { everything: "Everything", vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian" };
const avoidLabels: Record<AvoidChoice, string> = { egg: "Egg", dairy: "Dairy", fish: "Fish", meat: "Meat", gluten: "Gluten" };
const goalLabels: Record<GoalChoice, string> = { weight_loss: "Weight loss", high_protein: "High protein", diabetic_friendly: "Diabetic friendly", heart_healthy: "Heart healthy", budget: "Budget", quick: "Quick", kid_friendly: "Kid friendly", comfort: "Comfort food" };

const isDietChoice = (value: string): value is DietChoice => (dietChoices as readonly string[]).includes(value);

/** A row of chips that toggle: the label above, the choices wrapping below, the chosen ones filled. */
function ChipField<T extends string>({ label, hint, choices, labels, value, onChange, disabled }: { label: string; hint?: string; choices: readonly T[]; labels: (choice: T) => string; value: readonly T[]; onChange: (next: T[]) => void; disabled: boolean }) {
  const chosen = new Set(value);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium" id={`pref-${label.toLowerCase().replace(/\W+/gu, "-")}`}>{label}</p>
      <ToggleGroup
        aria-labelledby={`pref-${label.toLowerCase().replace(/\W+/gu, "-")}`}
        className="flex-wrap"
        disabled={disabled}
        onValueChange={(next) => onChange(choices.filter((choice) => next.includes(choice)))}
        type="multiple"
        value={choices.filter((choice) => chosen.has(choice))}
        variant="outline"
      >
        {choices.map((choice) => (
          <ToggleGroupItem className="h-8 rounded-full px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" key={choice} value={choice}>
            {labels(choice)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FoodPreferencesSection({ account }: { account: AccountProfile }) {
  const save = usePreferencesMutation(account);
  const preferences = account.preferences;
  return (
    <Section description="What you eat and what you are after. Surprise me and the daily recipe ideas follow these; each choice saves as you make it." id="preferences" title="Food preferences">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id="pref-diet">Diet</p>
          <ToggleGroup
            aria-labelledby="pref-diet"
            className="flex-wrap"
            disabled={save.isPending}
            onValueChange={(value) => { if (isDietChoice(value) && value !== preferences.diet) save.mutate({ diet: value }); }}
            type="single"
            value={preferences.diet}
            variant="outline"
          >
            {dietChoices.map((choice) => (
              <ToggleGroupItem className="h-8 rounded-full px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" key={choice} value={choice}>
                {dietLabels[choice]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ChipField choices={avoidChoices} disabled={save.isPending} hint="Dishes with these are left out of the picks." label="I avoid" labels={(choice) => avoidLabels[choice]} onChange={(avoid) => save.mutate({ avoid })} value={preferences.avoid} />
        <ChipField choices={goalChoices} disabled={save.isPending} hint="Dishes that fit these come up more often." label="Goals" labels={(choice) => goalLabels[choice]} onChange={(goals) => save.mutate({ goals })} value={preferences.goals} />
        <ChipField choices={dishCategories} disabled={save.isPending} label="Favourite kinds" labels={dishCategoryLabel} onChange={(likes) => save.mutate({ likes })} value={preferences.likes} />
      </div>
      <FormError className="mt-3" error={save.error} />
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
    <Section description="Where sign-in links and resets go, and the daily mails and alerts if you want them." title="Email">
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

type NotificationKey = "notify_email" | "notify_digest" | "notify_recipes" | "notify_alerts";
const notificationRows: Array<{ key: NotificationKey; label: string; description: string }> = [
  { key: "notify_email", label: "Email from PriceLens", description: "News about the site and what is new. Mail about the account itself (verification, password changes) always comes." },
  { key: "notify_digest", label: "Daily price digest", description: "The day's supermarket deals, the cheapest store for the essentials, and the movers, every morning." },
  { key: "notify_recipes", label: "Daily recipe ideas", description: "Three recipes picked for your preferences, every morning." },
  { key: "notify_alerts", label: "Price alerts", description: "A morning mail when a product on your wishlist meets its rule: any drop, or a price of your own." },
];

function NotificationsSection({ account }: { account: AccountProfile }) {
  const save = usePreferencesMutation(account);
  return (
    <Section description="Saved as you switch them. Each mail goes out once a morning, and every one carries a one-click unsubscribe." title="Notifications">
      <ul className="divide-y">
        {notificationRows.map((row) => (
          <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0" key={row.key}>
            <div className="space-y-0.5">
              <Label className="text-sm" htmlFor={`pref-${row.key}`}>{row.label}</Label>
              <p className="text-pretty text-xs text-muted-foreground">{row.description}</p>
            </div>
            <Switch checked={account.preferences[row.key]} disabled={save.isPending} id={`pref-${row.key}`} onCheckedChange={(checked) => save.mutate({ [row.key]: checked })} />
          </li>
        ))}
      </ul>
      <FormError className="mt-3" error={save.error} />
      {account.preferences.notify_alerts ? <AlertRules /> : null}
    </Section>
  );
}

const alertModeWords: Record<WatchAlert["mode"], string> = { any_drop: "Any drop", below: "Below a price", off: "No alert" };

/** The rule behind each starred product, shown under the price alert switch once it is on. */
function AlertRules() {
  const { items, status } = useWatchlist();
  const actions = useWatchActions();
  if (status === "loading") return <p className="mt-4 text-xs text-muted-foreground">Loading your wishlist rules.</p>;
  if (!items.length) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        Your wishlist is empty. Star a product on the board or its page and set a rule for it here.
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-medium">Rules for your wishlist</p>
      <p className="text-pretty text-xs text-muted-foreground">Any drop writes when the cheapest seller falls five percent or more against the day before. Below a price writes when the cheapest seller reaches your mark, and again a week later while it stays there.</p>
      <ul className="divide-y rounded-lg border">
        {items.map((entry) => <AlertRuleRow actions={actions} entry={entry} key={entry.product_id} />)}
      </ul>
      <FormError error={actions.error} />
    </div>
  );
}

function AlertRuleRow({ entry, actions }: { entry: WatchEntry; actions: ReturnType<typeof useWatchActions> }) {
  const [mark, setMark] = useState(entry.alert.threshold_minor ? String(entry.alert.threshold_minor / 100) : "");
  const label = entry.price?.label ?? entry.product_id.replace(/^product_/u, "").replace(/_/gu, " ");
  const unit = entry.price?.unit ?? "kg";
  const saveMark = () => {
    const rupeesValue = Number(mark);
    if (!Number.isFinite(rupeesValue) || rupeesValue <= 0) return;
    const threshold = Math.round(rupeesValue * 100);
    if (threshold === entry.alert.threshold_minor) return;
    void actions.setAlert(entry.product_id, { mode: "below", threshold_minor: threshold });
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium"><Link className="no-underline hover:text-primary" to={`/p/${entry.product_id}`}>{label}</Link></p>
        <p className="text-[11px] text-muted-foreground">{entry.price?.cheapest ? `${rupees(entry.price.cheapest.price)} ${unitLabel(unit)} at ${entry.price.cheapest.market_label} today` : "No published price today"}</p>
      </div>
      <Select onValueChange={(mode) => { if (mode === "any_drop" || mode === "below" || mode === "off") void actions.setAlert(entry.product_id, { mode, threshold_minor: mode === "below" ? entry.alert.threshold_minor : null }); }} value={entry.alert.mode}>
        <SelectTrigger aria-label={`Alert rule for ${label}`} className="w-36" size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(alertModeWords) as Array<WatchAlert["mode"]>).map((mode) => <SelectItem key={mode} value={mode}>{alertModeWords[mode]}</SelectItem>)}
        </SelectContent>
      </Select>
      {entry.alert.mode === "below" ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Rs</span>
          <Input aria-label={`Price mark for ${label}, rupees per ${unitLabel(unit).replace(/^per /u, "")}`} className="h-8 w-24 tabular-nums" inputMode="decimal" onBlur={saveMark} onChange={(event) => setMark(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveMark(); } }} placeholder="e.g. 350" value={mark} />
          <span>{unitLabel(unit)}</span>
        </div>
      ) : null}
    </li>
  );
}

/** The starred products with today's cheapest seller; the rules live under Notifications. */
function WishlistSection() {
  const { items, status, priced, error, refetch } = useWatchlist();
  const actions = useWatchActions();
  return (
    <Section description="Products you star, with today's cheapest published seller. Switch on price alerts under Notifications to hear when one moves." id="wishlist" title="Wishlist">
      {status === "loading" ? <p className="text-sm text-muted-foreground">Loading your wishlist.</p> : null}
      {status === "error" ? <p className="text-sm text-destructive">Your wishlist could not be loaded. <button className="underline" onClick={refetch} type="button">Try again</button></p> : null}
      {status === "ready" && !items.length ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <RiStarLine aria-hidden className="size-5 shrink-0 text-amber-500" />
          <p className="text-pretty">Nothing starred yet. The star beside any product on the <Link to="/">board</Link> or its page puts it here.</p>
        </div>
      ) : null}
      {items.length ? (
        <ul className="divide-y">
          {items.map((entry) => {
            const label = entry.price?.label ?? entry.product_id.replace(/^product_/u, "").replace(/_/gu, " ");
            const change = entry.price ? changeLabel(entry.price.change_pct) : null;
            return (
              <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" key={entry.product_id}>
                <Link className="shrink-0" to={`/p/${entry.product_id}`}><ProductImage id={entry.product_id} label={label} size="sm" /></Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium"><Link className="no-underline hover:text-primary" to={`/p/${entry.product_id}`}>{label}</Link></p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    {entry.price?.cheapest ? <span className="tabular-nums"><span className="font-medium text-foreground">{rupees(entry.price.cheapest.price)}</span> {unitLabel(entry.price.unit)} at {entry.price.cheapest.market_label}</span> : <span>{priced ? "No published price today" : "Prices are not available right now"}</span>}
                    {change && change.direction !== "steady" ? <Badge className={cn("h-4 px-1 text-[10px]", change.direction === "rise" ? "bg-status-critical/10 text-status-critical" : "bg-status-good/10 text-status-good")} title="Against yesterday's cheapest" variant="outline">{change.text} vs yesterday</Badge> : null}
                    <span>· {alertModeWords[entry.alert.mode]}{entry.alert.mode === "below" && entry.alert.threshold_minor ? ` ${rupees(entry.alert.threshold_minor / 100)}` : ""}</span>
                  </p>
                </div>
                <Button aria-label={`Remove ${label} from your wishlist`} className="text-amber-500 hover:text-amber-600" disabled={actions.pending} onClick={() => void actions.remove(entry.product_id)} size="icon-sm" title="Remove from wishlist" type="button" variant="ghost"><RiStarFill className="size-4" /></Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <FormError className="mt-3" error={error} /> : null}
      <FormError className="mt-3" error={actions.error} />
    </Section>
  );
}

const contributionKindWords: Record<ContributionRow["kind"], string> = { recipe: "Recipe", request: "Request", ingredient: "Ingredient", translation: "Translation" };
const contributionToneClass: Record<ContributionRow["tone"], string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  good: "border-primary/40 bg-primary/10 text-primary",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Everything sent back on the recipes, newest first, with where the owner's review stands and any note left on it. */
function ContributionsSection() {
  const submissions = useSubmissions();
  const proposals = useProposals();
  const translations = useSentTranslations();
  const rows = contributionRows({ submissions: submissions.submissions, proposals: proposals.proposals, translations });
  const loading = submissions.status === "loading" || proposals.status === "loading";
  const error = submissions.error ?? proposals.error;
  return (
    <Section description="Recipes and requests for the catalogue, ingredients you proposed, and translation feedback from this visit, each with where the owner's review stands." id="contributions" title="Contributions">
      {loading ? <p className="text-sm text-muted-foreground">Loading your contributions.</p> : null}
      {error ? <p className="text-sm text-destructive">Your contributions could not be loaded. <button className="underline" onClick={() => { submissions.refetch(); proposals.refetch(); }} type="button">Try again</button></p> : null}
      {!loading && !error && !rows.length ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <RiHandHeartLine aria-hidden className="size-5 shrink-0 text-primary" />
          <p className="text-pretty">Nothing sent yet. In the <Link to="/recipes">recipes</Link> section you can give a dish a thumbs up, correct a Sinhala or Tamil translation, request a dish that is missing, or send <Link to="/account/recipes">a recipe of your own</Link> for the catalogue.</p>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((row) => (
            <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0" key={row.key}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium"><span className="text-muted-foreground">{contributionKindWords[row.kind]} · </span>{row.title}</p>
                {row.detail ? <p className="truncate text-xs text-muted-foreground">{row.detail}</p> : null}
                {row.note ? <p className="mt-1 text-pretty text-xs"><span className="font-medium">From the owner:</span> {row.note}</p> : null}
              </div>
              <Badge className={cn("text-[10px]", contributionToneClass[row.tone])} variant="outline">{row.status}</Badge>
              <span className="text-[11px] text-muted-foreground tabular-nums">{formatWhen(row.created_at, dayFormat)}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
