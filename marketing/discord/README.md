# Prabhava Labs Discord

The community server for all Prabhava Labs projects, built and kept in shape from code rather than
clicked together. Both scripts need the bot token and the server id:

```sh
export DISCORD_BOT_TOKEN="$(sed -n 's/^DISCORD_BOT_TOKEN=//p' ~/.config/prabhavalabs/discord.env)"
export DISCORD_GUILD_ID=1546573655063138385
```

- `setup.mjs` is the layout: roles, categories, channels, forum tags, welcome screen, pinned
  texts, AutoMod. Edit it and run `node marketing/discord/setup.mjs`; it only creates or changes
  what differs, and keeps the pinned texts current.
  The `projects` list at the top drives the project parts. The first entry (PriceLens) is the
  focus and gets its own section with updates, a feedback forum, the daily digest, and chat. The
  others share OTHER PROJECTS: one updates feed, one feedback forum tagged by project, and a
  chat channel each. Every project has a role people can pick. To add a project, add one entry.
- `admin.mjs` does the small things: `check`, `invite`, `founder <userId>`,
  `webhook <channel> <name>`, `post <channel> <text>`, `messages <channel> [n]`.

## Feeds

- GitHub → `#pricelens-updates` (lanka-price-lens) and `#projects-updates` (lanka-news-paper,
  lanka-data-layer, agentmeter): a Discord webhook named "GitHub" on each channel, registered on
  the repositories with the `/github` suffix (releases, pull requests, issues). New project:
  `node marketing/discord/admin.mjs webhook projects-updates GitHub` prints the URL to register.
- Website feedback → `#feedback-inbox`: the API posts every feedback message through
  `LPL_FEEDBACK_DISCORD_WEBHOOK` (see `docs/public-site.md`).

Invite: https://discord.gg/6wxwKjFkbv
