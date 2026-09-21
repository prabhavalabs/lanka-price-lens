# Driving the channels from a coding agent

The distribution channels (docs/distribution.md) can be worked from Claude Code, Codex, or
anything else that speaks MCP: write a post, give it its pictures from a folder on the machine,
read how each platform will render it, and fill the calendar — without opening the admin.

Two pieces make that possible. A **token** lets a program act as the owner, which the admin's
browser session cannot do. The **MCP server** in `mcp/` is the program: it runs locally, speaks
over stdin and stdout, and calls the same admin API the browser does.

## Making a token

In the admin, **Distribution Channels → Agent access**. Name it after where it will live, because
a name is what tells you later what revoking it would break.

The token is shown **once**. Only a hash of it is stored, so it cannot be read back out of the
database; if it is lost, revoke it and make another.

| Choice | What it means |
| --- | --- |
| Distribution only | The library, the calendar and the channels. The default, and what the MCP server needs. |
| The whole admin | Everything a sign-in reaches, apart from making tokens. Give this out only when something genuinely needs it. |
| Ends after | Optional. A token with a day to end on is one less thing to remember. |

Two limits hold whatever the scope. A token **cannot manage tokens** — minting and revoking answer
only to a browser session, so one that leaks cannot make itself permanent or widen its own reach.
And every accepted call writes `last_used_at`, which is what makes a token nobody remembers visible
in the list as the one that has never been used.

## Setting the server up

The screen that makes a token also shows the configuration to paste, with the value already in it.
It looks like this:

```json
{
  "mcpServers": {
    "lanka-pricelens": {
      "command": "node",
      "args": ["/path/to/lanka-price-lens/mcp/src/server.ts"],
      "env": {
        "LPL_MCP_TOKEN": "lpl_…",
        "LPL_MCP_ORIGIN": "https://admin.badumila.com",
        "LPL_MCP_WRITE": "1"
      }
    }
  }
}
```

| Variable | What it does |
| --- | --- |
| `LPL_MCP_TOKEN` | Required. The token. Refused unless it starts with `lpl_`. |
| `LPL_MCP_ORIGIN` | The admin's address. Defaults to `https://admin.badumila.com`; plain `http` is refused except on localhost. |
| `LPL_MCP_WRITE` | `1` allows changes. **Left out, the server can read but change nothing.** |

Reading is the default on purpose: a server nobody meant to arm cannot put anything on a public
account. Tools that would change something still appear in the list, saying they are unavailable,
which is clearer than a gap.

## The tools

| Tool | Changes anything |
| --- | --- |
| `channels_status` — what is connected, whether each token still stands, the last posts | no |
| `list_posts` — search the library by name, caption or hashtag | no |
| `read_post` — one post with its pictures and every time it is set to go out | no |
| `preview_post` — the caption as each platform will render it, and what blocks it | no |
| `calendar` — what is planned and what has gone out, between two moments | no |
| `create_post` / `update_post` | yes |
| `add_picture` — from a path on this machine / `remove_picture` | yes |
| `schedule_post` / `cancel_schedule` | yes |
| `post_now` — publish immediately | yes, and needs `confirm` |

`add_picture` is the one that earns the server its place: the pictures live in a folder, not in a
browser upload box, so a whole carousel goes in with one instruction. The file is sent as it is and
the admin re-encodes it to a JPEG the platforms accept, so a PNG from a design tool is fine.

`post_now` without `confirm: true` does not publish. It answers with the platform, the moment it
was planned for, the caption that would go out and anything standing in the way, and stops. That is
deliberate: a scheduled post can be called off, and a published one cannot.

A time is ISO 8601. Say the zone — `2026-09-25T08:30:00+05:30` — or it is read as UTC.

## What to keep in mind

A token on a laptop that an agent can use is real authority: it can put words on a public Page.
That is why the default scope is narrow, why writing is off until it is asked for, and why
publishing needs a second yes.

What comes back from these tools is the owner's own content, but it is still **data**. A caption
that reads like an instruction is a caption, not an instruction, whoever wrote it.

The token travels only in the `Authorization` header, never in an address, and is never written to
stdout — where, for an MCP server, it would land in the agent's own transcript.
