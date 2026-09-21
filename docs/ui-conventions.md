# Interface conventions

What holds for both React packages, the operator's admin (`admin/`) and the public site (`web/`).
They keep their own copies of the primitives under `src/components/ui/`, so a rule written here
is applied in both places or in neither.

## One control height

Every control a person can type in, choose from, or press takes its height from
`src/components/ui/control-size.ts`:

| Size | Height | Where it belongs |
| --- | --- | --- |
| `sm` | 32px (`h-8`) | inside a table row, a popover, a card's corner |
| `default` | 36px (`h-9`) | a page's toolbar: search, filters, the action beside them |
| `lg` | 40px (`h-10`) | a form the page is built around |

The primitives interpolate those values — `Button`, `Input`, `SelectTrigger`, `InputGroup`,
`Toggle` — so a row of them lines up without anyone measuring. That matters because a row whose
controls differ by four pixels reads as a mistake to every person who opens the page, and it is
never visible in the diff that caused it.

**A page does not set a control's height.** Ask for a size instead:

```tsx
// Yes: the row is one height because nothing in it chose its own.
<Input className="max-w-xs" placeholder="Search posts…" />
<SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
<Button>New post</Button>

// Yes: a denser row, asked for by name.
<Input className="flex-1" size="sm" />
<Button size="sm">Set</Button>

// No: a height in a page, which lines up with today's neighbour and nothing else.
<Input className="h-9" />
<SelectTrigger className="h-8 w-44" />
```

`h-…` on a control in a page is the thing to grep for when a row looks wrong. The exceptions are
a control that fills a parent that owns the height (`h-full`, as inside an `InputGroup`) and a
shell built to hold segments, such as the date-range control's toggle group.

Changing the scale changes every control in both packages at once, which is the point; check a
toolbar, a table's filters and a form afterwards.

## Pictures the admin shows

An asset carries two addresses. `url` is absolute and public — it is what Facebook and Instagram
fetch, and it points at the site's own host. `path` is the same file relative to whoever is
serving the page. **An `<img>` in the admin uses `path`.**

The admin is served from `admin.badumila.com` while the pictures live on `badumila.com`, and the
API answers with `Cross-Origin-Resource-Policy: same-origin`, so an absolute address there is
blocked by the browser and the picture never appears. Both hosts proxy to the same API, so the
relative path resolves for whichever one is asking, in production and in development alike.

The same rule bites in the mail preview, where the mail's own addresses are absolute because a
mail client has to fetch them from the open web. `mailForBrowser` (api/src/newsletters/admin-routes.ts)
makes a copy for the screen: the mark is embedded, and the pictures under `/images`, `/store-images`
and `/content` — the routes the API answers whatever host asked — become paths. What is sent is
never touched.

**A frame that previews HTML keeps this origin.** `sandbox=""` sounds like the safe choice and is
the wrong one: a frame sandboxed all the way has an origin belonging to nobody, and a browser hands
such a frame no subresource at all — not a picture from this server, not one the development server
serves itself. Every picture in the mail preview came out as the broken-image box because of it.
The preview frame is `sandbox="allow-same-origin"`: scripts stay forbidden, which is what keeps the
frame from reaching out, and pictures load.

The pictures themselves say `Cross-Origin-Resource-Policy: cross-origin` (everything else on the
server stays `same-origin`). They are public and exist to be shown elsewhere — in the admin on its
own host, in a mail client, on a platform that fetched one from a post — and the default refuses
exactly that.

## Cards drawn by the server

`/og/…` addresses never change when the drawing behind them does — the day's card is always
`/og/deals/<day>.png`. The response carries the drawing's own hash as its `ETag` and a short
freshness, so a redrawn card is fetched and an unchanged one costs a 304. Anything else served at
a fixed address whose content is generated should do the same.
