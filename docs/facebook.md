# The Facebook Page

The owner connects a Facebook Page from the admin, and every morning the deals run posts the
day's supermarket deals to it: one picture and a short caption. Everything goes through
Facebook's own Graph API with the owner's consent; nothing logs in as a person, scrapes
Facebook, or posts to a profile or a group.

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
- Store logos and store photographs are the stores' property. On Facebook a rights complaint
  removes the post, and repeated complaints unpublish the Page. The post's picture is therefore
  drawn by PriceLens from corner to corner: the stores appear as words, the prices are the ones
  they list, and the caption says the site is independent and not affiliated with any store.

## Setting it up

1. At developers.facebook.com create an app with the use case **Manage everything on your
   Page**. Add the permissions `pages_manage_posts` and `pages_read_engagement`
   (`pages_show_list` and `business_management` come with the use case).
2. Under the use case's Facebook Login settings, list the redirect address the admin shows
   on its Facebook page: `https://<admin host>/v1/admin/facebook/callback`.
3. Under App settings, Basic: the app domains, a privacy policy address, a data deletion
   address, an icon, a category. Then switch the app to Live.
4. On the server set `LPL_FACEBOOK_APP_ID` and `LPL_FACEBOOK_APP_SECRET` and recreate the API
   container (a restart does not read a changed env file). `LPL_ACCOUNT_STATE_SECRET` must be
   set as well: the Page's token is sealed under it.
5. In the admin open **Facebook Page**, press **Connect a Facebook Page**, choose the Page on
   Facebook's screen, and come back. **Post now** publishes the day's post straight away.

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
