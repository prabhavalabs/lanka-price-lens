# Community: reactions, translation feedback, submissions, product proposals

What signed-in people can give back to the recipe section, and how the owner reviews it.
Nothing here changes the served catalogue on its own: the corpus stays the reviewed files in
`data/recipes/`, and every contribution lands in the admin for a decision.

1. **Reactions**: thumbs up or down on a recipe, one per account per dish, switchable. The
   public sees a single number, `score = max(0, likes − dislikes)`; the admin sees likes and
   dislikes and who gave them.
2. **Translation feedback**: on a Sinhala or Tamil recipe text, "correct" or "incorrect" with
   an optional corrected text and note. Never shown publicly; reviewed in the admin.
3. **Submissions**: a *request* for a recipe that is missing (a name and notes), or a
   *recipe* the person wrote in their own recipe editor, sent for the catalogue. Both wait
   for review; approving a recipe marks it and hands the owner its JSON to merge into the
   corpus.
4. **Product proposals**: while writing a recipe, an ingredient the registry does not carry
   can be proposed (label, kind, unit); the line keeps the typed label with no product
   reference until the owner approves and maps it.

The owner is mailed (and told on Discord) for every submission, request, translation
feedback, and product proposal through the owner notifier; reactions are quiet.

## Shared (`shared/src/community.ts`)

```ts
export const reactionValues = ["up", "down", "none"] as const;
export const reactionSchema = z.object({ value: z.enum(reactionValues) });
export type RecipeScore = { likes: number; dislikes: number; score: number };

export const translationLanguages = ["si", "ta"] as const;
export const translationVerdicts = ["correct", "incorrect"] as const;
export const translationFeedbackInputSchema = z.object({ dish_id, language, verdict, correction: text ≤ 4000 | null, note: text ≤ 1000 | null });
export type TranslationFeedback = input & { id, account_id, status: "new" | "reviewed" | "applied", created_at, reviewed_at, reviewed_by };

export const submissionInputSchema = discriminated on kind:
  { kind: "request", name: 2–120 chars, notes ≤ 2000 | null }
  { kind: "recipe", source_recipe_id: the account's own recipe id, notes ≤ 2000 | null }
export type RecipeSubmission = { id, account_id, kind, name, notes, source_recipe_id | null, recipe: UserRecipeInput | null, status: "pending" | "approved" | "rejected", review_note, created_at, updated_at, reviewed_at, reviewed_by };

export const productProposalInputSchema = z.object({ label: 2–120, category: ≤ 60 | null, unit_hint: "kg" | "g" | "l" | "ml" | "piece" | null, note: ≤ 1000 | null });
export type ProductProposal = input & { id, account_id, status: "pending" | "approved" | "rejected", review_note, created_at, reviewed_at, reviewed_by };
export const reviewStatuses = ["pending", "approved", "rejected"] as const;
```

Limits per account: 200 reactions a day is plenty (no limit), 20 open submissions, 50
pending product proposals, one translation feedback per dish and language a day.

## Tables (`foundry/src/db.ts`)

- `recipe_reaction(account_id, dish_id, value INTEGER CHECK (value IN (1, -1)), created_at, updated_at, PRIMARY KEY (account_id, dish_id))`
- `translation_feedback(id, account_id, dish_id, language, verdict, correction, note, status, created_at, reviewed_at, reviewed_by)`
- `recipe_submission(id, account_id, kind, name, notes, source_recipe_id, recipe_json, status, review_note, created_at, updated_at, reviewed_at, reviewed_by)`
- `product_proposal(id, account_id, label, category, unit_hint, note, status, review_note, created_at, reviewed_at, reviewed_by)`

## Routes

Account routes, mounted at `/v1/account/community` (session; everything but reactions also
needs a verified address, 403 `EMAIL_NOT_VERIFIED`), same-origin on writes:

| Route | Body | Answer |
| --- | --- | --- |
| `GET /reactions` | | `{ [dish_id]: "up" \| "down" }` for the account |
| `PUT /reactions/:dishId` | `reactionSchema` | `{ value, ...RecipeScore }`; `none` removes |
| `POST /translations` | `translationFeedbackInputSchema` | 201 `TranslationFeedback` |
| `GET /submissions` | | the account's `RecipeSubmission[]` (recipe JSON omitted) |
| `POST /submissions` | `submissionInputSchema` | 201 `RecipeSubmission`; 404 when the own recipe is not the account's; 413 at the open limit |
| `GET /products` | | the account's `ProductProposal[]` |
| `POST /products` | `productProposalInputSchema` | 201 `ProductProposal`; 413 at the limit |

Public: `GET /v1/public/recipes/scores?ids=dish_a,dish_b` → `{ [dish_id]: score }` (at most
100 ids); `GET /v1/public/recipes/:id` carries `reactions: RecipeScore`; every item of
`GET /v1/public/recipes/query` carries `score`.

Admin (owner), mounted at `/v1/admin/community`:

| Route | Answer |
| --- | --- |
| `GET /overview` | `{ pending_submissions, new_translations, pending_products, reactions: { likes, dislikes, dishes } }` |
| `GET /submissions?status=&kind=&page=&pageSize=` | paged `{ items: RecipeSubmission & { email, display_name }, page, pageSize, total, pages }` (recipe JSON omitted) |
| `GET /submissions/:id` | one, with `recipe` |
| `PATCH /submissions/:id` | body `{ status, review_note? }` → the submission |
| `GET /translations?status=&page=` | paged, with `email`, `display_name`, and the dish's English name |
| `PATCH /translations/:id` | `{ status }` |
| `GET /products?status=&page=` | paged, with `email`, `display_name` |
| `PATCH /products/:id` | `{ status, review_note? }` |
| `GET /reactions?page=&sort=score\|dislikes\|recent` | per dish: `{ dish_id, name, likes, dislikes, score, last_at }` |
| `GET /reactions/:dishId` | `{ dish_id, name, reactions: { email, display_name, value, updated_at }[] }`: who reacted |

## Site

- The recipe page shows thumbs up and thumbs down beside Share with the score between them;
  the pressed one is filled. Signed out, pressing goes to the sign-in page and back. Recipe
  cards show the score as a small thumbs-up badge when it is above zero.
- When the recipe is read in Sinhala or Tamil, a line under the method asks "Is this
  translation right?" with Correct and Needs work; Needs work opens a dialog for a corrected
  text and a note. A thank-you replaces the line once sent.
- The recipes page offers "Can't find a dish? Request it" (also in the empty result), a
  dialog with the name and notes.
- An own recipe's page has "Submit to PriceLens" with a confirmation; the own recipes list
  shows a Submitted badge with the status. A rejected one shows the owner's note.
- The recipe editor's ingredient picker offers "Add ‘<typed name>’ as a new ingredient" when
  the registry has no match: a small form (label, kind, unit) posts a proposal and inserts the
  line with the label and no reference. Pending proposals are marked in the picker.
- The account page gains a Contributions section: submissions, requests, proposals, and
  translation feedback with their status.

## Admin

A **Community** page (`/community`, nav under Community) with tabs Submissions, Translations,
Products, Reactions, each a filterable table with the row's account, and actions Approve /
Reject (with a note) or Mark reviewed / Applied. A submission's detail shows the recipe JSON
with a copy button; approving is the signal to merge it into `data/recipes/` by hand.
