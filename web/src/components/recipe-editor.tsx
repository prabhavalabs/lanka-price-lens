import { RiAddLine, RiArrowDownLine, RiArrowUpLine, RiCloseLine, RiDeleteBinLine, RiSearchLine } from "@remixicon/react";
import { ingredientParts, recipeTags, servingRoles, userRecipeCategories, type UserRecipe, type UserRecipeInput } from "@lanka-pricelens/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AccountActionError } from "@/components/account-notice";
import { IngredientImage } from "@/components/ingredient-image";
import { PeopleInput } from "@/components/people-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { accountApi } from "@/lib/account-api";
import { dishCategoryLabel } from "@/lib/format";
import { fetchIngredients, type IngredientSummary } from "@/lib/ingredients";
import { emptyIngredient, emptyStep, hasErrorUnder, validateDraft, type IngredientDraft, type RecipeDraft, type StepDraft, type Text3 } from "@/lib/own-recipes";
import { partLabel, tagLabel } from "@/lib/recipe-format";
import { cn } from "@/lib/utils";
import { languageNames, type Lang } from "@/store/language";

/**
 * The form behind a person's own recipe. Ingredients come from the registry, so the nutrition
 * and today's cost can be worked out; anything the registry does not carry can still be added
 * by name and simply goes uncounted. English is the recipe's language; Sinhala and Tamil
 * versions of the method are welcome but optional. The shared schema does the checking, and
 * every complaint shows beside the field it is about.
 */

const roleLabels: Record<string, string> = { with_rice: "Eaten with rice", main: "Main dish", side: "Side dish", staple: "Staple", snack: "Snack", sweet: "Sweet", drink: "Drink", condiment: "Condiment", breakfast: "Breakfast" };
const unitLabels = { g: "grams", ml: "millilitres", piece: "pieces" } as const;
const scalingLabels = { linear: "Scales with servings", sublinear: "Scales gently (salt, spice)", fixed: "Fixed amount" } as const;
const languageTabs: Lang[] = ["en", "si", "ta"];

type Errors = Record<string, string>;

export function RecipeEditor({ initial, recipeId, onSaved, onCancel }: { initial: RecipeDraft; recipeId: string | null; onSaved: (recipe: UserRecipe) => void; onCancel: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  // Once a save has been tried, every change re-checks the draft, so a fixed field stops complaining as it is fixed.
  const errors: Errors = attempted ? validateDraft(draft).errors : {};
  const save = useMutation({
    mutationFn: (input: UserRecipeInput) => (recipeId ? accountApi.recipes.update(recipeId, input) : accountApi.recipes.create(input)),
    onSuccess: (recipe) => {
      void client.invalidateQueries({ queryKey: ["account", "recipes"] });
      onSaved(recipe);
    },
  });
  const patch = (change: (current: RecipeDraft) => RecipeDraft) => setDraft((current) => change(current));
  const errorCount = Object.keys(errors).length;
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        const checked = validateDraft(draft);
        if (!checked.ok) {
          document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
          return;
        }
        save.mutate(checked.value);
      }}
    >
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <SectionTitle title="About the dish" hint="The name people will find it by, where it files, and a line on what it is." />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field error={errors.name} id="recipe-name" label="Name">
              <Input aria-describedby={errors.name ? "recipe-name-error" : undefined} aria-invalid={errors.name ? true : undefined} autoFocus={!recipeId} id="recipe-name" maxLength={120} onChange={(event) => patch((current) => ({ ...current, name: event.target.value }))} placeholder="Ambul thiyal the way my mother makes it" value={draft.name} />
            </Field>
            <Field error={errors.category} id="recipe-category" label="Category">
              <Select onValueChange={(value) => patch((current) => ({ ...current, category: value }))} value={draft.category}>
                <SelectTrigger aria-invalid={errors.category ? true : undefined} className="h-10 w-full" id="recipe-category"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">{userRecipeCategories.map((category) => <SelectItem key={category} value={category}>{dishCategoryLabel(category)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field error={errors.summary} hint="optional" id="recipe-summary" label="In a sentence">
            <Textarea aria-invalid={errors.summary ? true : undefined} id="recipe-summary" maxLength={500} onChange={(event) => patch((current) => ({ ...current, summary: event.target.value }))} placeholder="A sour fish curry from the south, dry enough to keep for days." value={draft.summary} />
          </Field>
          <div className="space-y-1.5">
            <Label>Tags <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {recipeTags.map((tag) => {
                const on = draft.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    aria-pressed={on}
                    className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                    onClick={() => patch((current) => ({ ...current, tags: on ? current.tags.filter((entry) => entry !== tag) : [...current.tags, tag] }))}
                    type="button"
                  >
                    {tagLabel(tag)}
                  </button>
                );
              })}
            </div>
            {errors.tags ? <p className="text-xs text-destructive">{errors.tags}</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <SectionTitle title="Servings" hint="The amounts below are for this many; the page scales them to any headcount." />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Servings</Label>
              <PeopleInput label="Servings" max={100} onChange={(value) => patch((current) => ({ ...current, base_servings: value }))} value={draft.base_servings} />
              {errors.base_servings ? <p className="text-xs text-destructive">{errors.base_servings}</p> : null}
            </div>
            <Field error={errors["serving.role"]} id="recipe-role" label="Served as">
              <Select onValueChange={(value) => patch((current) => ({ ...current, serving: { ...current.serving, role: value } }))} value={draft.serving.role}>
                <SelectTrigger className="h-10 w-full" id="recipe-role"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">{servingRoles.map((role) => <SelectItem key={role} value={role}>{roleLabels[role] ?? role}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <NumberField error={errors["serving.portion_g"]} hint="cooked weight" id="recipe-portion" label="One serving, g" onChange={(value) => patch((current) => ({ ...current, serving: { ...current.serving, portion_g: value } }))} placeholder="150" value={draft.serving.portion_g} />
            <NumberField error={errors.yield_g} hint={`the whole pot, for ${draft.base_servings}`} id="recipe-yield" label="Total cooked, g" onChange={(value) => patch((current) => ({ ...current, yield_g: value }))} placeholder="600" value={draft.yield_g} />
          </div>
          <Field error={errors["serving.description.en"]} hint="optional" id="recipe-serving-description" label="What a serving looks like">
            <Input id="recipe-serving-description" maxLength={200} onChange={(event) => patch((current) => ({ ...current, serving: { ...current.serving, description: { ...current.serving.description, en: event.target.value } } }))} placeholder="A ladle over rice, with a sambol" value={draft.serving.description.en} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-5">
            <SectionTitle title={`Ingredients for ${draft.base_servings}`} hint="As bought, before trimming. Pick from the registry so calories and today's price can be counted; anything else can be added by name." />
            <IngredientPicker onPick={(line) => patch((current) => ({ ...current, ingredients: [...current.ingredients, line] }))} />
          </div>
          {errors.ingredients ? <p className="border-b px-4 py-2 text-xs text-destructive sm:px-5">{errors.ingredients}</p> : null}
          {draft.ingredients.length ? (
            <ul className="divide-y">
              {draft.ingredients.map((line, index) => (
                <IngredientRow
                  key={line.key}
                  errors={errors}
                  index={index}
                  last={index === draft.ingredients.length - 1}
                  line={line}
                  onChange={(next) => patch((current) => ({ ...current, ingredients: current.ingredients.map((entry) => (entry.key === line.key ? next : entry)) }))}
                  onMove={(delta) => patch((current) => ({ ...current, ingredients: moveItem(current.ingredients, index, delta) }))}
                  onRemove={() => patch((current) => ({ ...current, ingredients: current.ingredients.filter((entry) => entry.key !== line.key) }))}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">No ingredients yet. Search the registry above to add the first.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <SectionTitle title="Method" hint="English is needed; Sinhala and Tamil are welcome when you have them. Minutes are for the steps that wait or simmer." />
          <Tabs defaultValue="en">
            <TabsList>
              {languageTabs.map((lang) => (
                <TabsTrigger key={lang} className={cn(hasErrorUnder(errors, `steps.${lang}`) || errors[`tips.${lang}`] ? "text-destructive" : undefined)} value={lang}>
                  {languageNames[lang]}
                  {lang !== "en" && draft.steps[lang].some((step) => step.text.trim()) ? <span className="ml-1 size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                </TabsTrigger>
              ))}
            </TabsList>
            {languageTabs.map((lang) => (
              <TabsContent key={lang} className="space-y-3 pt-2" value={lang}>
                {lang !== "en" ? <p className="text-xs text-muted-foreground">Optional. Leave it empty and the recipe reads in English for everyone.{draft.steps.en.length > 1 ? ` The English method has ${draft.steps.en.length} steps; matching them one to one keeps the amounts pointing at the right step.` : ""}</p> : null}
                {errors[`steps.${lang}`] ? <p className="text-xs text-destructive">{errors[`steps.${lang}`]}</p> : null}
                <ol className="space-y-3">
                  {draft.steps[lang].map((step, index) => (
                    <StepRow
                      key={step.key}
                      error={errors[`steps.${lang}.${index}.text`]}
                      index={index}
                      lang={lang}
                      last={index === draft.steps[lang].length - 1}
                      minutesError={errors[`steps.${lang}.${index}.minutes`]}
                      onChange={(next) => patch((current) => ({ ...current, steps: { ...current.steps, [lang]: current.steps[lang].map((entry) => (entry.key === step.key ? next : entry)) } }))}
                      onMove={(delta) => patch((current) => ({ ...current, steps: { ...current.steps, [lang]: moveItem(current.steps[lang], index, delta) } }))}
                      onRemove={() => patch((current) => ({ ...current, steps: { ...current.steps, [lang]: current.steps[lang].filter((entry) => entry.key !== step.key) } }))}
                      step={step}
                    />
                  ))}
                </ol>
                <Button onClick={() => patch((current) => ({ ...current, steps: { ...current.steps, [lang]: [...current.steps[lang], emptyStep()] } }))} size="sm" type="button" variant="outline"><RiAddLine className="size-3.5" />Add a step</Button>
                <Field error={errors[`tips.${lang}`]} hint="optional" id={`recipe-tips-${lang}`} label={lang === "en" ? "Tips" : `Tips in ${languageNames[lang]}`}>
                  <Textarea id={`recipe-tips-${lang}`} maxLength={1000} onChange={(event) => patch((current) => ({ ...current, tips: { ...current.tips, [lang]: event.target.value } }))} placeholder={lang === "en" ? "Keeps for three days in the fridge; better the next day." : ""} value={draft.tips[lang]} />
                </Field>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <SectionTitle title="Time and equipment" hint="Times stay the same at any headcount." />
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField error={errors["times.prep_minutes"]} id="recipe-prep" label="Preparation, minutes" onChange={(value) => patch((current) => ({ ...current, times: { ...current.times, prep_minutes: value } }))} placeholder="15" value={draft.times.prep_minutes} />
            <NumberField error={errors["times.cook_minutes"]} id="recipe-cook" label="Cooking, minutes" onChange={(value) => patch((current) => ({ ...current, times: { ...current.times, cook_minutes: value } }))} placeholder="30" value={draft.times.cook_minutes} />
            <NumberField error={errors["times.passive_minutes"]} hint="soaking, marinating, resting" id="recipe-passive" label="Waiting, minutes" onChange={(value) => patch((current) => ({ ...current, times: { ...current.times, passive_minutes: value } }))} placeholder="0" value={draft.times.passive_minutes} />
          </div>
          <ChipsField error={errors.equipment} id="recipe-equipment" items={draft.equipment} label="You need" onChange={(items) => patch((current) => ({ ...current, equipment: items }))} placeholder="clay pot, grinding stone…" />
        </CardContent>
      </Card>

      <AccountActionError error={save.error} onDismiss={() => save.reset()} />
      {attempted && errorCount ? <p className="text-sm text-destructive" role="alert">{errorCount === 1 ? "One field needs attention." : `${errorCount} fields need attention.`} Each one says what is wrong.</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">Cancel</Button>
        <Button disabled={save.isPending} type="submit">{save.isPending ? "Saving…" : recipeId ? "Save changes" : "Save recipe"}</Button>
      </div>
    </form>
  );
}

function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-balance font-heading text-lg font-semibold">{title}</h2>
      <p className="text-pretty text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}{hint ? <span className="font-normal text-muted-foreground">({hint})</span> : null}</Label>
      {children}
      {error ? <p className="text-xs text-destructive" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

function NumberField({ id, label, hint, error, value, onChange, placeholder, className }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; value: string; onChange: (value: string) => void; placeholder?: string | undefined; className?: string | undefined }) {
  return (
    <Field className={className} error={error} hint={hint} id={id} label={label}>
      <Input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} className="tabular-nums" id={id} inputMode="decimal" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </Field>
  );
}

/** Short free-text items as chips: type, Enter or Add, and each can be taken off again. */
function ChipsField({ id, label, items, onChange, placeholder, error }: { id: string; label: string; items: string[]; onChange: (items: string[]) => void; placeholder: string; error?: string | undefined }) {
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim();
    if (!value || items.includes(value)) return;
    onChange([...items, value].slice(0, 20));
    setText("");
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="font-normal text-muted-foreground">(optional)</span></Label>
      <div className="flex gap-2">
        <Input id={id} maxLength={80} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder} value={text} />
        <Button onClick={add} type="button" variant="outline">Add</Button>
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} className="gap-1 pr-1 font-normal" variant="outline">
              {item}
              <button aria-label={`Remove ${item}`} className="rounded-full p-0.5 hover:bg-muted" onClick={() => onChange(items.filter((entry) => entry !== item))} type="button"><RiCloseLine className="size-3" /></button>
            </Badge>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function IngredientRow({ line, index, last, errors, onChange, onMove, onRemove }: { line: IngredientDraft; index: number; last: boolean; errors: Errors; onChange: (line: IngredientDraft) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const at = (field: string) => errors[`ingredients.${index}.${field}`];
  const set = <K extends keyof IngredientDraft>(field: K, value: IngredientDraft[K]) => onChange({ ...line, [field]: value });
  const setText = (field: "label" | "preparation", value: string) => onChange({ ...line, [field]: { ...line[field], en: value } satisfies Text3 });
  const name = line.label.en || "Ingredient";
  return (
    <li className="space-y-2 px-4 py-3 sm:px-5">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[2.75rem_minmax(0,1.4fr)_6rem_8rem_minmax(0,1fr)_auto]">
        <IngredientImage className="mt-0.5" id={line.ref} label={name} size="md" />
        <Field error={at("label.en")} id={`ingredient-${line.key}-name`} label="Ingredient">
          <Input aria-invalid={at("label.en") ? true : undefined} id={`ingredient-${line.key}-name`} maxLength={120} onChange={(event) => setText("label", event.target.value)} value={line.label.en} />
          <p className="text-[11px] text-muted-foreground">{line.ref ? (line.ref.startsWith("product_") ? "Priced product: counted in calories and cost." : "Pantry item: counted in calories, not priced yet.") : "Not in the registry: listed, but not counted in calories or cost."}</p>
        </Field>
        <div className="flex gap-0.5 sm:order-last">
          <Button aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)} size="icon-sm" type="button" variant="ghost"><RiArrowUpLine /></Button>
          <Button aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)} size="icon-sm" type="button" variant="ghost"><RiArrowDownLine /></Button>
          <Button aria-label={`Remove ${name}`} onClick={onRemove} size="icon-sm" type="button" variant="ghost"><RiDeleteBinLine /></Button>
        </div>
        <NumberField className="col-start-2 sm:col-start-auto" error={at("quantity")} id={`ingredient-${line.key}-quantity`} label="Amount" onChange={(value) => set("quantity", value)} placeholder="250" value={line.quantity} />
        <Field className="col-start-2 sm:col-start-auto" error={at("unit")} id={`ingredient-${line.key}-unit`} label="Unit">
          <Select onValueChange={(value) => { if (value === "g" || value === "ml" || value === "piece") set("unit", value); }} value={line.unit}>
            <SelectTrigger className="h-10 w-full" id={`ingredient-${line.key}-unit`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper">{(Object.keys(unitLabels) as Array<keyof typeof unitLabels>).map((unit) => <SelectItem key={unit} value={unit}>{unitLabels[unit]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field className="col-start-2 sm:col-start-auto" error={at("household")} hint="optional" id={`ingredient-${line.key}-household`} label="In the kitchen">
          <Input id={`ingredient-${line.key}-household`} maxLength={80} onChange={(event) => set("household", event.target.value)} placeholder="1 cup, 2 tbsp, a handful" value={line.household} />
        </Field>
      </div>
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end sm:pl-[3.5rem]">
        <Field error={at("preparation.en")} hint="optional" id={`ingredient-${line.key}-preparation`} label="Preparation">
          <Input id={`ingredient-${line.key}-preparation`} maxLength={200} onChange={(event) => setText("preparation", event.target.value)} placeholder="sliced thin, soaked overnight" value={line.preparation.en} />
        </Field>
        <Field error={at("scaling")} id={`ingredient-${line.key}-scaling`} label="With more servings">
          <Select onValueChange={(value) => { if (value === "linear" || value === "sublinear" || value === "fixed") set("scaling", value); }} value={line.scaling}>
            <SelectTrigger className="h-10 w-full" id={`ingredient-${line.key}-scaling`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper">{(Object.keys(scalingLabels) as Array<keyof typeof scalingLabels>).map((mode) => <SelectItem key={mode} value={mode}>{scalingLabels[mode]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field error={at("part")} id={`ingredient-${line.key}-part`} label="Part of the dish">
          <Select onValueChange={(value) => set("part", value)} value={line.part}>
            <SelectTrigger className="h-10 w-full" id={`ingredient-${line.key}-part`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper">{ingredientParts.map((part) => <SelectItem key={part} value={part}>{partLabel(part)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex h-10 items-center gap-2">
          <Checkbox checked={line.optional} id={`ingredient-${line.key}-optional`} onCheckedChange={(checked) => set("optional", checked === true)} />
          <Label className="font-normal" htmlFor={`ingredient-${line.key}-optional`}>Optional</Label>
        </div>
      </div>
    </li>
  );
}

function StepRow({ step, index, last, lang, error, minutesError, onChange, onMove, onRemove }: { step: StepDraft; index: number; last: boolean; lang: Lang; error: string | undefined; minutesError: string | undefined; onChange: (step: StepDraft) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const id = `step-${lang}-${step.key}`;
  return (
    <li className="flex gap-3">
      <span className="mt-2 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">{index + 1}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Textarea aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} aria-label={`Step ${index + 1}`} id={id} maxLength={1000} onChange={(event) => onChange({ ...step, text: event.target.value })} placeholder={lang === "en" ? "Heat the oil and temper the onions, curry leaves, and rampe until soft." : ""} value={step.text} />
        {error ? <p className="text-xs text-destructive" id={`${id}-error`}>{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-muted-foreground" htmlFor={`${id}-minutes`}>Minutes</Label>
          <Input aria-invalid={minutesError ? true : undefined} className="h-8 w-20 tabular-nums" id={`${id}-minutes`} inputMode="numeric" onChange={(event) => onChange({ ...step, minutes: event.target.value })} placeholder="—" value={step.minutes} />
          {minutesError ? <span className="text-xs text-destructive">{minutesError}</span> : null}
          <div className="ml-auto flex gap-0.5">
            <Button aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} size="icon-sm" type="button" variant="ghost"><RiArrowUpLine /></Button>
            <Button aria-label={`Move step ${index + 1} down`} disabled={last} onClick={() => onMove(1)} size="icon-sm" type="button" variant="ghost"><RiArrowDownLine /></Button>
            <Button aria-label={`Remove step ${index + 1}`} onClick={onRemove} size="icon-sm" type="button" variant="ghost"><RiDeleteBinLine /></Button>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Search the ingredient registry and add a line; what the registry does not carry can be added as written. */
function IngredientPicker({ onPick }: { onPick: (line: IngredientDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useQuery({ queryKey: ["ingredients", debounced], queryFn: ({ signal }) => fetchIngredients(debounced, signal), enabled: open, placeholderData: keepPreviousData, staleTime: 5 * 60_000, retry: false });
  const pick = (item: IngredientSummary | null) => {
    onPick(item ? emptyIngredient({ ref: item.id, name: item.names.en, names: item.names, unit: item.unit_hint }) : emptyIngredient({ ref: null, name: query.trim() }));
    setQuery("");
    setOpen(false);
  };
  const typed = query.trim();
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button size="sm" type="button"><RiSearchLine className="size-3.5" />Add ingredient</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput autoFocus onValueChange={setQuery} placeholder="Search: coconut, dhal, karapincha…" value={query} />
          <CommandList>
            {results.isPending ? <div className="p-3 text-xs text-muted-foreground">Looking…</div> : null}
            {results.isError ? <div className="p-3 text-xs text-muted-foreground">The registry search did not answer. You can still add the ingredient as written.</div> : null}
            {results.data && !results.data.length && typed ? <CommandEmpty>Nothing in the registry matches.</CommandEmpty> : null}
            {results.data?.length ? (
              <CommandGroup heading={results.isFetching ? "Registry · updating" : "Registry"}>
                {results.data.map((item) => (
                  <CommandItem key={item.id} onSelect={() => pick(item)} value={item.id}>
                    <IngredientImage id={item.id} label={item.names.en} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.names.en}{item.names.si ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.names.si}</span> : null}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{item.group.replaceAll("_", " ")}{item.priced ? " · priced" : ""}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {typed ? (
              <CommandGroup heading="Not in the registry">
                <CommandItem onSelect={() => pick(null)} value={`__typed__${typed}`}>
                  <RiAddLine className="size-3.5" />
                  <span className="truncate">Add “{typed}” as written</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
