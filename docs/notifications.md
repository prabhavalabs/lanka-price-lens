# Notifications

The `notify/` package delivers one message shape through several channels. Anything in the
monorepo (and, later, other applications) composes a `Message`; the package renders it for
each channel and delivers it through an outbox that retries and reports dead addresses.
Nothing in the package knows about prices: it is the plumbing under price alerts, daily
digests, feedback forwards, and whatever else needs to reach a person or a channel.

## The message

A message has a title, an optional summary, sections of lines, up to five link actions, an
optional image, a footer, a severity (`info`, `good`, `warn`, `alert`), a dedupe key, and
tags. A line carries structured parts rather than pre-rendered text: what it is about, a
formatted value, a signed percentage change, a note, and a link. Each channel formats those
in its own idiom, so a "Big onion: Rs 370 / kg (-12.3%)" line is bold-valued HTML in
Telegram, an embed field in Discord, mrkdwn in Slack, an HTML list item in mail, and part of
a short body in a push notification.

`message(input)` validates and normalises (zod schema in `notify/src/message.ts`);
`parseMessage(unknown)` does the same for input that arrived over the network and returns
the first problem by field name instead of throwing.

## Channels

| Kind | Address | Configuration | Notes |
| --- | --- | --- | --- |
| `telegram` | chat id (`123456`, `-100…` for channels, `@handle`) | bot token | A message that fits a caption (1,024 chars) goes as a photo; longer ones go as text with the image as a large link preview. `parseTelegramUpdate` reads `/start <payload>` from webhook updates, `telegramDeepLink` builds the `t.me/<bot>?start=` link, `setTelegramWebhook` points the bot at a URL. |
| `discord` | webhook URL | none | One embed; a headed section becomes one field, a bare section becomes one inline field per line. Mentions are never parsed. |
| `slack` | incoming webhook URL | none | Block Kit: header, sections, image, link buttons, context footer, plus a plain-text fallback. |
| `email` | recipient address | Resend API key and a from address | Text and HTML parts; `meta.reply_to` sets the reply address, `meta.subject` overrides the title. |
| `webpush` | subscription endpoint, keys in `meta` | VAPID key pair and a subject | RFC 8291 `aes128gcm` encryption and RFC 8292 VAPID on `node:crypto` alone, no dependency. `generateVapidKeys()` makes the pair once; the public key is what the page passes to `pushManager.subscribe`. |

`createChannels(config)` builds the registry: Discord and Slack are always present (the
webhook is the address), the others only when configured, so a message for an unconfigured
channel dies in the outbox with `CHANNEL_UNAVAILABLE` rather than failing silently.

Every send returns a `Delivery`: `{ ok: true, reference }` or `{ ok: false, error,
retryable, gone, retryAfterMs }`. `retryable` covers rate limits and outages; `gone` means the
address is dead (blocked bot, deleted webhook, expired push subscription) and the application
should disable it. Channels never throw for a provider's answer, only for programming errors.

## The outbox

Composing and sending are separate. A composer enqueues `{ targetId, target, message }`
entries; `dispatchOutbox(store, channels, options)` claims what is due, sends, and either
marks the entry sent, reschedules it with a growing wait (1 min, 5 min, 30 min, 2 h, 12 h, or
the provider's own `retry-after`), or marks it dead after the last attempt (five by default).
A dead target is reported through `onGone` before the entry dies. Entries stuck in `sending`
(a crash mid-run) are claimed again after ten minutes. Sends on the same channel are paced.

A dedupe key (the message's own or one given at enqueue) makes a repeat for the same target
a no-op while an earlier copy is queued or sent, so a tick that runs twice sends once.

Two stores implement the same interface: `createMemoryOutbox()` for tests and ephemeral use,
and `createSqliteOutbox(database)` on any handle with better-sqlite3's synchronous shape. The
application runs `outboxSchema` in its own migrations; the store never creates tables itself.

## In the API today

Feedback and bug reports from the site are forwarded to the owner through this package
(`api/src/notify.ts`): the Discord webhook in `LPL_FEEDBACK_DISCORD_WEBHOOK` and, when
`LPL_RESEND_API_KEY` is set, mail to `LPL_FEEDBACK_EMAIL_TO` from `LPL_MAIL_FROM`. Sends are
direct (no outbox) and never block the request; failures are logged as `Feedback forward
failed` with the masked target.

## What comes next

1. Subscriptions: subscriber, target, and watchlist tables in the operational store, the
   Telegram webhook and Web Push subscribe routes, an ingress route for other applications,
   and an admin page over the outbox.
2. Composers for prices: drops and offers per watched product, the daily best-picks digest,
   basket digests, triggered when a warehouse sync lands new observations.
3. The site: a bell, the subscribe popover (browser push, Telegram, email), the service worker,
   and a guide section.
