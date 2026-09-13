# Accounts

Visitors can read everything without signing in. An account is needed to keep menus and to
write recipes, and later to receive notifications. This document is the contract the accounts
system is built to: the data, the routes, the mail, the sign-in methods, and what the owner
sets up outside the repository.

## Principles

- **Passwords** are hashed with scrypt and a random salt, the same `scrypt$<salt>$<hex>` form the
  owner's admin login uses (`api/src/auth.ts`). Ten characters or more, no composition rules.
  Five failed sign-ins lock the account for fifteen minutes; the answer to a wrong password and
  an unknown address is the same.
- **Sessions** are opaque random tokens stored hashed, carried in an HttpOnly, Secure, SameSite=Lax
  cookie (`lpl_session`), thirty days with sliding renewal ("remember me"), one day otherwise.
  State-changing routes refuse cross-origin requests (`sameOrigin` in `api/src/http.ts`).
- **Tokens** for verification, password reset, and email change are random, stored hashed, single
  use, and short-lived (verification a day, reset an hour); making a new one voids the old.
- **Mail** goes through Resend from a verified domain, branded, with a plain-text part,
  and links back to the site. Account mail (verification, resets, changes) is always sent;
  everything else honours the person's preferences.
- **Google** sign-in is OAuth 2.0 authorization code with PKCE, server side; the ID token is
  verified against Google's published keys. A Google account whose address Google has verified
  links to the existing account with that address, or creates one, already verified.
- **Rate limits** per address on register, sign in, forgot-password, and resend-verification
  (`RateLimiter` in `api/src/feedback.ts`).
- **Data stays on the operational SQLite database** (`foundry/src/db.ts`), like the admin tables.
  Nothing personal reaches the warehouse.

## Data

Tables created by `migrate` in `foundry/src/db.ts` (STRICT, ids `account_<uuid>` and so on):

```sql
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified_at TEXT,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'si', 'ta')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS account_identity (
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
) STRICT;
CREATE INDEX IF NOT EXISTS account_identity_account_idx ON account_identity(account_id);
CREATE TABLE IF NOT EXISTS account_session (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  address TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS account_session_account_idx ON account_session(account_id, expires_at DESC);
CREATE TABLE IF NOT EXISTS account_token (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password', 'change_email')),
  payload TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS account_token_account_kind_idx ON account_token(account_id, kind);
CREATE TABLE IF NOT EXISTS account_menu (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  occasion TEXT,
  people INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS account_menu_account_idx ON account_menu(account_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS account_recipe (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  recipe_json TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS account_recipe_account_idx ON account_recipe(account_id, updated_at DESC);
```

Types and the store interface: `api/src/account/types.ts`. Request and content schemas:
`shared/src/accounts.ts`.

## Routes

All under the same origin; bodies are JSON validated with the shared schemas; answers use the
usual envelope (`envelope` in `api/src/http.ts`), with `code` added on failures
(`AccountErrorCode`). `requireAccount` reads the session cookie and puts the account on the
context; `requireVerified` additionally needs a verified address.

| Route | Auth | Body | Answer |
| --- | --- | --- | --- |
| `POST /v1/account/register` | none, rate limited | `registerSchema` | profile; sets the session cookie; sends the verification mail |
| `POST /v1/account/login` | none, rate limited | `loginSchema` | profile; sets the cookie; 401 `INVALID_CREDENTIALS`, 423 `ACCOUNT_LOCKED` (+ `retry_after_seconds`), 403 `ACCOUNT_DISABLED` |
| `POST /v1/account/logout` | session | | null; clears the cookie, revokes the session |
| `GET /v1/account/me` | session | | profile |
| `PATCH /v1/account/me` | session | `profilePatchSchema` | profile |
| `DELETE /v1/account/me` | session | `deleteAccountSchema` | null; password required when the account has one |
| `POST /v1/account/verify-email` | none | `verifyEmailSchema` | profile of the verified account (signs the browser in if it was not) |
| `POST /v1/account/resend-verification` | session, rate limited | | null |
| `POST /v1/account/forgot-password` | none, rate limited | `forgotPasswordSchema` | null, always (never reveals whether the address exists) |
| `POST /v1/account/reset-password` | none | `resetPasswordSchema` | profile; signs in; revokes other sessions; mails "password changed" |
| `POST /v1/account/change-password` | session | `changePasswordSchema` | null; revokes other sessions; mails "password changed" |
| `POST /v1/account/change-email` | session | `changeEmailSchema` | null; mails the new address a confirmation link |
| `POST /v1/account/confirm-email` | none | `verifyEmailSchema` | profile; switches the address; mails the old address a notice |
| `GET /v1/account/sessions` | session | | the account's live sessions (for the profile page) |
| `POST /v1/account/sessions/revoke-others` | session | | count |
| `GET /v1/auth/google/start?return_to=` | none | | 302 to Google (PKCE + signed state cookie) |
| `GET /v1/auth/google/callback` | none | | 302 to the site: `return_to` on success, `/account/login?error=google` otherwise |
| `GET/POST /v1/account/menus`, `GET/PUT/DELETE /v1/account/menus/:id` | verified | `accountMenuInputSchema` | menus of the account |
| `GET/POST /v1/account/recipes`, `GET/PUT/DELETE /v1/account/recipes/:id` | verified | `userRecipeInputSchema` | recipes of the account; `GET :id?servings=` adds the computed `view` (scaled lines, nutrition, cost) as the corpus recipe endpoint does |
| `GET /v1/admin/accounts`, `PATCH /v1/admin/accounts/:id` | owner | `{status}` | list with search and paging; disable or enable |

Links in mail point at the site: `/account/verify?token=`, `/account/reset?token=`,
`/account/confirm-email?token=`. The pages post the token to the matching route.

## Site

- `/account/login`, `/account/register` (with "Continue with Google"), `/account/forgot`,
  `/account/reset`, `/account/verify`, `/account/confirm-email`, `/account` (profile: name,
  language, email, password, notifications, sessions, delete), `/account/recipes` (own recipes,
  editor), and the header's account menu.
- `useAccount()` in `web/src/store/account.ts` is the one source of who is signed in; the API
  client is `web/src/lib/account-api.ts`.
- Menus live on the account. Signed out, the menus page asks to sign in; menus kept in the
  browser before accounts existed are offered for import on the first signed-in visit, then
  cleared. "Add to a menu" on a recipe asks to sign in when there is no session.
- An unverified account can sign in and see everything, and is asked to verify before it can
  create menus or recipes.

## Mail

Templates in `api/src/account/mail.ts`: verification, welcome (after verification), password
reset, password changed, email change confirmation (to the new address), email changed notice
(to the old address), account deleted. One layout: the PriceLens mark, a headline, one clear
button, the same link in plain text under it, and a footer saying why the mail was sent. Text
alternative for every message. Sent through the notify package's Resend channel
(`notify/src/channels/email.ts`), `LPL_RESEND_API_KEY` and `LPL_MAIL_FROM`
("PriceLens <hello@prabhavalabs.com>").

### Resend and the domain (owner steps)

prabhavalabs.com is already verified in Resend (DKIM `resend._domainkey`, and the SPF MX and
TXT records on `send.prabhavalabs.com`), and `_dmarc.prabhavalabs.com` publishes
`v=DMARC1; p=none; rua=mailto:marc-reports@prabhavalabs.com`. Production sends as
`LPL_MAIL_FROM=PriceLens <info.price@prabhavalabs.com>` with the key already in app.env, so
account mail works without further setup. Two optional improvements:

1. Once the DMARC reports show only Resend and Cloudflare sending for the domain, move the
   policy to `p=quarantine` (later `p=reject`) so spoofed mail is dropped; nothing on our side
   changes.
2. Keep click and open tracking off for the domain in Resend (Domains → prabhavalabs.com →
   tracking): rewritten links are what spam filters and people distrust in a password reset.

SendGrid remains a fallback in the code (`notify/src/channels/sendgrid.ts`, used when only
`LPL_SENDGRID_API_KEY` is set) but is not configured anywhere.

### Google sign-in (owner steps)

1. Google Cloud Console → APIs & Services → OAuth consent screen: external, app name PriceLens,
   support and developer email, the site's home page, privacy policy `/about`; scopes `openid`,
   `email`, `profile`. Publish it.
2. Credentials → Create OAuth client ID → Web application. Authorised JavaScript origin
   `https://price.prabhavalabs.com`; authorised redirect URI
   `https://price.prabhavalabs.com/v1/auth/google/callback` (and
   `http://localhost:3000/v1/auth/google/callback` for local work).
3. Put the client id and secret in app.env as `LPL_GOOGLE_CLIENT_ID` and
   `LPL_GOOGLE_CLIENT_SECRET`, and `LPL_SITE_ORIGIN=https://price.prabhavalabs.com`.

## Settings

`LPL_SITE_ORIGIN`, `LPL_RESEND_API_KEY`, `LPL_MAIL_FROM`, `LPL_GOOGLE_CLIENT_ID`,
`LPL_GOOGLE_CLIENT_SECRET`, `LPL_ACCOUNT_STATE_SECRET` (random, signs the OAuth state cookie).
All in `.env.example`, compose, and the VPS app.env.

## Build plan

Five workstreams, each on its own files, against these contracts; the integration (mounting
in `app.ts`, settings, end-to-end checks) follows.

1. **Data and core auth (API)**: tables, the store, the service (register, sign in, sessions,
   tokens, password and email changes, deletion), the account routes, middleware, tests.
2. **Mail and Google (API + notify)**: the email channels, the branded templates, the mailer,
   the Google sign-in flow with ID token verification, tests with a stubbed network.
3. **Content (API)**: menus and own recipes on the account, computed views, admin accounts list,
   tests.
4. **Site: accounts UI**: sign in, register, Google button, verify, forgot and reset, profile
   (name, language, email, password, notifications, sessions, delete), header account menu,
   guards, guide section.
5. **Site: content UI**: menus on the account with local import, gating, own recipes (list,
   editor with registry search, view), admin Accounts page.

## State

Shipped on `feat/accounts`: all five workstreams, mounted in `api/src/app.ts` (`/v1/account`,
`/v1/auth/google`, `/v1/admin/accounts`, `GET /v1/public/ingredients?q=` for the recipe
editor). Decisions taken at integration:

- Sign-in throttling counts failures only (five wrong passwords per address per fifteen
  minutes), because many connections share one address; the account itself locks after five
  wrong passwords regardless of address. A password reset marks the address verified, since
  the person just proved they read mail there.
- The recipe list route answers summaries with `base_servings`, `summary`, `ingredient_count`
  and `minutes` (prep plus cook) so the cards need no second request; admin rows carry
  `identities` (the linked providers) beside `has_password`.
- Own recipes cannot yet be placed in a menu: their ids (`dish_user_…`) are unknown to the
  public compute route, so the recipe page hides "Add to a menu" for them. A menu that mixes
  corpus and own recipes needs the compute route to read the account's recipes; that is the
  next step, together with alerts on the account.
- A new own recipe starts at 150 g per serving and 600 g for the pot (four servings), so a
  first draft saves without a scale; both are plain fields to correct.

## Local testing

- **Mail through Resend.** Set `LPL_RESEND_API_KEY` (the same key as production, or a free one):
  `createAccountMailer` in `api/src/account/mail.ts` sends the templates through Resend.
  `LPL_MAIL_FROM` must be a sender Resend accepts: an address on a domain verified there, or its shared `PriceLens <onboarding@resend.dev>`, which only delivers
  to the address the Resend account was opened with. With no key set the API logs
  "Account mail is not configured" once and every send answers `MAIL_NOT_CONFIGURED`;
  registering still works, but no verification or reset mail arrives, and since tokens are
  stored hashed there is no way to read a link back out of the database. To try a template
  without sending, `renderAccountMail(kind, input)` returns the subject, html, and text.
- **A Google client for localhost.** In the same Cloud project, create a second OAuth client
  (Web application, "PriceLens local"). The redirect URI has to be the origin the browser is
  on: when the API serves the built site itself, `http://localhost:3000` and
  `http://localhost:3000/v1/auth/google/callback`; with the Vite dev server (port 5174, which
  proxies `/v1` to the API), `http://localhost:5174` and
  `http://localhost:5174/v1/auth/google/callback`, plus `LPL_SITE_ORIGIN=http://localhost:5174`
  so the API builds the redirect URI from that origin rather than from the proxied request.
  Put the client's id and secret in `.env` as `LPL_GOOGLE_CLIENT_ID` and
  `LPL_GOOGLE_CLIENT_SECRET`; the consent screen can stay in testing mode with your address
  as a test user. The session cookie is not marked Secure outside production, so plain http
  works.
- **`LPL_ACCOUNT_STATE_SECRET`** signs the cookie that carries the OAuth state and PKCE verifier
  between `/v1/auth/google/start` and the callback (HMAC-SHA256, ten minutes). Unset, the API
  uses a random value per process, which is fine locally; in production set a long random value
  (`openssl rand -base64 32`) so a sign-in that spans a restart or lands on another process
  still completes instead of ending at `/account/login?error=google`.
