# Distribution channels

The owner connects a Facebook Page and the Instagram account linked to it from the admin, under
**Distribution Channels**. Two things go out: the day's supermarket deals, which the morning run
posts on its own, and anything written in the **Library** and given a time in the **Calendar**.

Everything goes through Meta's own Graph API with the owner's consent; nothing logs in as a
person, scrapes either site, or posts to a profile or a group.

| Screen | What it is for |
| --- | --- |
| Facebook | The Page: connect it, check its token, see what has gone out, post the day's deals now |
| Instagram | The same for the Instagram account, which is reached through its Page |
| Library | The posts written for the channels: words, pictures, and when each goes out |
| Calendar | A month at a time, everything planned and everything already posted |

## What Facebook allows, and what this does

- Publishing to a Page you manage through the Pages API is what the API is for; scheduling
  tools do the same. It needs the `pages_manage_posts` permission from a person who can create
  content on the Page.
- An app used only by people with a role on it (here: the owner, who is the app's
  administrator) works on standard access. No App Review and no business verification.
- The app must be **Live**. A post published by an app in development mode is visible only to
  people with a role on the app.
- Facebook's spam rules still apply to a Page: the same text every day, many posts a day,
  engagement bait, or misleading links reduce reach and can restrict the Page. The post goes
  out once a day, its opening line turns with the day, and it carries one link.
- The post's picture is drawn by PriceLens: its layout, its colours, its words. Beside each row
  it shows the store's own picture of the pack on offer, the one the reader will recognise on the
  shelf, taken from the capture (`store_offer.image_path`); a product with no store picture falls
  to our own photograph, and a product with neither gets a lettered tile. Those pictures are the
  stores' property. They are shown unaltered, beside the store's name, with the prices the store
  itself lists, and the caption says the site is independent and not affiliated with any store.
  A store that objects is added to `LPL_STORE_IMAGES_DISABLED`, which stops its pictures being
  taken at all; the cards then fall back on their own. No store logo is ever drawn.
- The words on the card are Sinhala, like the caption. The renderer cannot shape Sinhala on its
  own — it draws the vowel signs in the wrong place — so every string is shaped with HarfBuzz and
  drawn as outlines (`api/src/shape.ts`). A product keeps the store's own spelling of the pack.

## What Instagram allows

- Publishing needs an Instagram **professional** account (Business or Creator) **linked to a
  Facebook Page**. A personal account cannot be posted to by any API.
- The permissions are `instagram_basic` and `instagram_content_publish`, asked for in the same
  consent screen as the Page's. The token that publishes is the Page's own.
- Those permissions need App Review before anyone else could use them. The owner does not: a
  person with a role on the app may use them without review, which is the case here.
- Instagram takes **JPEG only**, at most 8 MB, between 4:5 and 1.91:1. Every picture added to
  the library is re-encoded to a JPEG no wider than 1440 px for exactly this reason; what was
  uploaded does not matter.
- There is no text-only post: Instagram will not take one without a picture.
- At most 100 API posts in 24 hours per account. A carousel counts as one. The **Check token**
  button reads how much of that has been used.
- A caption cannot carry a tappable link. A post's link is therefore named in words, the way
  "link in bio" is meant.

## Setting it up

1. At developers.facebook.com create an app with the use case **Manage everything on your
   Page**. Add the permissions `pages_manage_posts` and `pages_read_engagement`
   (`pages_show_list` and `business_management` come with the use case). For Instagram add
   `instagram_basic` and `instagram_content_publish`.
2. Under the use case's Facebook Login settings, list the redirect address the admin shows
   on its Facebook page: `https://<admin host>/v1/admin/facebook/callback`.
3. Under App settings, Basic: the app domains, a privacy policy address, a data deletion
   address, an icon, a category. Then switch the app to Live.
4. On the server set `LPL_FACEBOOK_APP_ID` and `LPL_FACEBOOK_APP_SECRET` and recreate the API
   container (a restart does not read a changed env file). `LPL_ACCOUNT_STATE_SECRET` must be
   set as well: the Page's token is sealed under it.
5. In the admin open **Distribution Channels, Facebook**, press **Connect a Facebook Page**,
   choose the Page on Facebook's screen, and come back. **Post now** publishes the day's post
   straight away.
6. For Instagram, make the account professional (Instagram, Settings, Account type) and link it
   to the Page (the Page's Linked accounts). Then connect again from the admin: the accounts
   behind the shared Pages are read on the way back, and the Instagram screen shows the handle.

The redirect address keeps the path `/v1/admin/facebook/callback` even though the screens moved
under `/distribution`, so the Meta app does not have to be edited again.

## How a Page is connected

`GET /v1/admin/facebook/connect` (admin session) sets a signed cookie holding a random state
(HMAC-SHA256 under a key derived from the state secret, ten minutes, HttpOnly, SameSite=Lax)
and sends the browser to Facebook's consent screen. Facebook returns to
`GET /v1/admin/facebook/callback`.

The admin session cookie is `SameSite=Strict`, so it does not come back with a redirect from
another site. The callback is therefore registered ahead of the admin session check and
answers to the state cookie alone: no cookie, an expired one, or a `state` that does not match
gets nothing. Only `/connect`, which does require the admin session, can mint that cookie.

The callback trades the code for the person's token, extends it to a long-lived one, and reads
`/me/accounts`: every Page the person granted, each with its own access token. Read from a
long-lived token, a Page token does not expire; it dies when the person changes their
password, loses their role on the Page, or removes the app. The person's own token is dropped
as soon as the Pages are read.

## Where the token lives

`facebook_page` (operational SQLite) keeps a Page's id, name, link, switches, and
`token_sealed`: the token under AES-256-GCM with a key derived by HKDF from
`LPL_ACCOUNT_STATE_SECRET`. The secret is in the environment, never in the database, so a copy
of the database cannot post. The token leaves the store through `tokenFor(pageId)` only, which
the notify channel calls at the moment it posts; no route returns it, the outbox never holds
it, and it travels to Facebook in the request body, not the address. A token sealed under
another secret does not open, and the Page then reads as needing a reconnect. When the app
secret is set, every call carries an `appsecret_proof`.

At most one Page is active (`facebook_page_active_idx`): the one the daily post and "Post now"
go to. The first Page that can be posted to becomes active on connecting.

## The post

`api/src/facebook/post.ts`:

- `postDeals(day)` picks up to six rows from the deals day, one per product: the stores' own
  offers on food the site tracks first (docs/retail-capture.md), then the biggest drops, then
  the cheapest-store picks.
- `dealsCardSvg` and `renderDealsCard` draw the 1080 by 1350 picture with resvg and the site's
  font, the same way as the social preview cards (docs/public-site.md). It is served at
  `/og/deals/<day>.png`, and Facebook fetches it from there when the post is published.
- `facebookDealsPost(day, siteOrigin)` is the notify `Message`: the day as the title, one of a
  few opening lines chosen by the day, the offers and movers as lines, one link to `/deals`,
  and a footer that dates the prices, names the stores, and states the independence. A day
  with fewer than three rows has no post.

The deals run (docs/newsletters.md) queues the post in the notify outbox for the active Page
when it is not paused, can be posted to, and its token stands. The dedupe key
`facebook:deals_daily:<day>` keeps a day to one post, also when a run is forced. The outbox
retries what Facebook may still take (an outage, a rate limit: an hour's wait) up to five
times. A token Facebook refuses (`gone`) marks the Page `invalid`, which stops further posts
until the Page is connected again.

## The admin

| Route | What it does |
| --- | --- |
| `GET /v1/admin/facebook` | Whether the Meta app is configured, the redirect address to list there, the Pages, and the last thirty posts (read from the outbox, with the link to each post on Facebook) |
| `GET /v1/admin/facebook/connect` | Opens Facebook's consent screen |
| `GET /v1/admin/facebook/callback` | Facebook's redirect; answers to the state cookie, then returns to the admin page with `?facebook=connected`, `cancelled`, `expired`, `failed`, `no_pages`, `no_rights`, or `not_configured` |
| `GET /v1/admin/facebook/preview?day=` | The caption and the picture's address for a day (today by default, else the latest saved day) |
| `POST /v1/admin/facebook/post` | Posts the day now, in addition to the morning's post. Delivers the Facebook entry only and leaves queued mails alone. A post that did not go is given up rather than tried again later, and the answer carries Facebook's reason |
| `POST /v1/admin/facebook/check` | Asks Facebook's `debug_token` whether the active Page's token stands and records the answer |
| `POST /v1/admin/facebook/pages/:id/activate` | Makes the Page the one posted to |
| `POST /v1/admin/facebook/pages/:id/pause` | `{ "paused": true }` stops the daily post, `false` resumes it |
| `DELETE /v1/admin/facebook/pages/:id` | Forgets the Page and its token. Posts already on Facebook stay; the permission itself is taken back on Facebook under Settings, Business integrations |

## Taking it down

Pause the Page in the admin to stop posting at once. Disconnect to forget the token; a post
still queued for a forgotten Page dies in the outbox, because there is no token to send it
with. Unsetting `LPL_FACEBOOK_APP_ID` only stops new connections and token checks: a Page that
is already connected keeps being posted to until it is paused or disconnected.


## The library

A post is a name (for the owner's own list), a caption (exactly what the platforms show), an
optional link, hashtags, and up to ten pictures in the order Instagram will show them.

Pictures are the reason the library exists rather than a folder somewhere. Each one is uploaded
as the file itself, re-encoded to a JPEG no wider than 1440 px, flattened onto white if it had
transparency, and written to the data volume under a random 32-character name. They are served
at `https://<site>/content/<name>.jpg` **without a session**, because Facebook and Instagram
fetch a picture themselves from the address a post names; they never see an admin cookie. The
random name is what keeps the library from being read by anyone who has seen one picture, and
the route refuses any path that is not exactly that shape.

Opening a post shows its caption as each platform will render it, and what stands in the way of
sending it there: no account connected, a token that needs renewing, or, for Instagram, no
picture.

## The calendar

A schedule is one post, one platform, one time. The same post can therefore go to the Page in
the morning and to Instagram in the evening, and both show on the calendar.

A timer in the API checks every minute and publishes what is due. Each one is enqueued with a
key built from its own schedule id, so a tick that overlaps another cannot send the post twice.
What became of it is read from the dispatch itself, and the row records where the post landed or
why it did not go.

A post the owner asked for by hand — **Post now**, on a channel or on a planned row — is never
retried quietly an hour later. It went now or it did not, and the row says which, with the
platform's own words. A failed row can be called off, or planned again for another time.

The day's deals post is not in the library: it is drawn and composed by its own job when that job
runs, so it always carries that day's prices.

## What a channel sends, and when

A channel is not one thing on one clock. Each one holds a **job** per thing it sends, and each job
keeps its own recurrence:

| Channel | Jobs |
| --- | --- |
| Email | the daily deals mail, the daily recipes mail, the price alerts |
| Telegram | the deals digest to the public channel |
| Facebook | the day's deals post on the Page |
| Instagram | the same post on the account |

A recurrence is five cron fields read in Colombo time (`api/src/social/recurrence.ts`), so a job can
run every day at half past seven, every Monday and Thursday at nine, every six hours, or on the
first and the fifteenth. The admin offers those shapes as fields and shows the expression it
compiled, under **Settings**; the expression itself is there for anything the fields do not cover.

The channel's own switch is the master one: a channel switched off holds all of its jobs, whatever
each one says. A job switched off stops only itself.

The timer in the API wakes once a minute, dispatches the outbox, and runs whatever is due. A job
never runs twice inside one minute, and one that failed is tried again half an hour later whatever
its recurrence says. Every job is idempotent within its day — a mail run is guarded by the
newsletter's own record and a post by the outbox's dedupe key — which is what makes that retry
safe and **Run now** safe to press.

Each job owns exactly one thing. The deals mail run used to also put the Telegram digest and the
Page's post out; they are jobs of their own now, because two owners for one post is how a day ends
up posted twice.

Instagram's post has never gone out automatically, so its job arrives switched off: a deploy is no
moment to start writing to a live account. Switch it on under Settings when you want it.
