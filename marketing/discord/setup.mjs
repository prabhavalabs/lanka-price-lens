// Builds and maintains the Prabhava Labs Discord server from the layout below. Safe to run again:
// roles and channels are matched by name and only created or changed when they differ.
//
//   DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… node marketing/discord/setup.mjs
//
// Needs the bot in the server with Administrator. No dependencies.

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) throw new Error("DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required");

// Permission bits (https://discord.com/developers/docs/topics/permissions).
const P = {
  CREATE_INSTANT_INVITE: 1n << 0n, KICK_MEMBERS: 1n << 1n, BAN_MEMBERS: 1n << 2n, ADMINISTRATOR: 1n << 3n, MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n, ADD_REACTIONS: 1n << 6n, VIEW_AUDIT_LOG: 1n << 7n, VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n, EMBED_LINKS: 1n << 14n, ATTACH_FILES: 1n << 15n, READ_MESSAGE_HISTORY: 1n << 16n, MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, MUTE_MEMBERS: 1n << 22n, DEAFEN_MEMBERS: 1n << 23n, MOVE_MEMBERS: 1n << 24n,
  CHANGE_NICKNAME: 1n << 26n, MANAGE_NICKNAMES: 1n << 27n, MANAGE_ROLES: 1n << 28n, MANAGE_WEBHOOKS: 1n << 29n, USE_APPLICATION_COMMANDS: 1n << 31n,
  MANAGE_THREADS: 1n << 34n, CREATE_PUBLIC_THREADS: 1n << 35n, CREATE_PRIVATE_THREADS: 1n << 36n, USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n, MODERATE_MEMBERS: 1n << 40n,
};
const sum = (...bits) => bits.reduce((total, bit) => total | bit, 0n).toString();

const everyone = sum(P.VIEW_CHANNEL, P.SEND_MESSAGES, P.READ_MESSAGE_HISTORY, P.ADD_REACTIONS, P.EMBED_LINKS, P.ATTACH_FILES, P.USE_EXTERNAL_EMOJIS, P.USE_EXTERNAL_STICKERS,
  P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS, P.CONNECT, P.SPEAK, P.CHANGE_NICKNAME, P.USE_APPLICATION_COMMANDS, P.CREATE_INSTANT_INVITE);
const teamPermissions = sum(P.KICK_MEMBERS, P.MODERATE_MEMBERS, P.MANAGE_MESSAGES, P.MANAGE_THREADS, P.MANAGE_NICKNAMES, P.MUTE_MEMBERS, P.MOVE_MEMBERS, P.VIEW_AUDIT_LOG, P.MENTION_EVERYONE, P.MANAGE_WEBHOOKS);

// The projects with a home here. The first is the focus and gets its own section with the full set of
// channels; the rest share one section with a chat channel each plus a common updates feed and feedback
// forum. Each project has a role people can pick to be pinged about it.
const projects = [
  { key: "pricelens", name: "PriceLens", role: "PriceLens", color: 0x3ddc97, repo: "lanka-price-lens", url: "https://price.prabhavalabs.com", blurb: "Sri Lanka's food prices every day: open markets, supermarkets, and wholesale side by side, with history, a basket that finds the cheapest store, and recipes." },
  { key: "lanka-newspaper", name: "Lanka Newspaper", role: "Lanka Newspaper", color: 0xf28c38, repo: "lanka-news-paper", url: "https://github.com/prabhavalabs/lanka-news-paper", blurb: "Sri Lankan news aggregation, intelligence, and editorial control." },
  { key: "lanka-data-layer", name: "Lanka Data Layer", role: "Lanka Data Layer", color: 0x5fb3f2, repo: "lanka-data-layer", url: "https://github.com/prabhavalabs/lanka-data-layer", blurb: "Open geo-data infrastructure for Sri Lanka: the API and the visualisation platform." },
  { key: "agentmeter", name: "AgentMeter", role: "AgentMeter", color: 0xe5c07b, repo: "agentmeter", url: "https://github.com/prabhavalabs/agentmeter", blurb: "An ESP32 desk display for live coding-agent usage windows, reset countdowns, and alerts." },
];
const [focus, ...others] = projects;

// Roles, top to bottom. Colours follow the server icon (purple) and each project's own.
const roles = [
  { name: "Founder", color: 0xf5b301, hoist: true, mentionable: false, permissions: sum(P.ADMINISTRATOR) },
  { name: "Team", color: 0x8b7bd8, hoist: true, mentionable: true, permissions: teamPermissions },
  { name: "Contributor", color: 0x5fb3f2, hoist: true, mentionable: false, permissions: "0" },
  ...projects.map((project) => ({ name: project.role, color: project.color, hoist: false, mentionable: true, permissions: "0" })),
];

// What "read only" and "staff only" mean as channel overwrites; roles are resolved to ids at run time.
const readOnly = [
  { role: "@everyone", deny: sum(P.SEND_MESSAGES, P.CREATE_PUBLIC_THREADS, P.CREATE_PRIVATE_THREADS, P.SEND_MESSAGES_IN_THREADS) },
  { role: "Team", allow: sum(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS) },
];
const staffOnly = [
  { role: "@everyone", deny: sum(P.VIEW_CHANNEL) },
  { role: "Founder", allow: sum(P.VIEW_CHANNEL) },
  { role: "Team", allow: sum(P.VIEW_CHANNEL) },
];

const T = { text: 0, voice: 2, category: 4, announcement: 5, forum: 15 };

const feedbackTags = (extra = []) => [...extra, { name: "Bug", emoji: "🐛" }, { name: "Idea", emoji: "💡" }, { name: "Data issue", emoji: "📊" }, { name: "Question", emoji: "❓" }, { name: "Answered", emoji: "✅", moderated: true }, { name: "Shipped", emoji: "🚀", moderated: true }];

const layout = [
  { category: "START HERE", channels: [
    { name: "welcome", type: T.text, topic: "What Prabhava Labs is and how to get around this server.", overwrites: readOnly },
    { name: "rules", type: T.text, topic: "The few rules that keep this place useful.", overwrites: readOnly },
    { name: "announcements", type: T.announcement, topic: "News from Prabhava Labs: new projects, big releases, events.", overwrites: readOnly },
    { name: "introductions", type: T.text, topic: "Say hello: who you are, what you build, what brought you here.", slowmode: 30 },
  ] },
  { category: focus.name.toUpperCase(), channels: [
    { name: `${focus.key}-updates`, type: T.announcement, topic: `Releases and merged changes from github.com/prabhavalabs/${focus.repo}, posted automatically.`, overwrites: readOnly, feed: [focus.repo] },
    { name: `${focus.key}-feedback`, type: T.forum, topic: `One post per bug, idea, data problem, or question about ${focus.url.replace("https://", "")}. Say which page and what you expected; a screenshot helps. Tag it so it gets to the right place.`, tags: feedbackTags(), reaction: "👍" },
    { name: `${focus.key}-daily`, type: T.text, topic: "Every morning: the day's biggest price movers across Sri Lanka's markets and supermarkets.", overwrites: readOnly },
    { name: `${focus.key}-chat`, type: T.text, topic: `Talk about food prices, sources, and the site. Bugs and ideas belong in #${focus.key}-feedback so they are not lost.` },
  ] },
  { category: "COMMUNITY", channels: [
    { name: "general", type: T.text, topic: "Talk about anything Prabhava Labs. Project questions go in the project channels." },
    { name: "show-and-tell", type: T.text, topic: "Share what you built, found, or wrote. Data, tools, dashboards, all welcome." },
    { name: "off-topic", type: T.text, topic: "Everything else." },
    { name: "Lounge", type: T.voice },
  ] },
  { category: "OTHER PROJECTS", channels: [
    { name: "projects-updates", type: T.announcement, topic: `Releases, pull requests, and issues from ${others.map((project) => project.repo).join(", ")}, posted automatically.`, overwrites: readOnly, feed: others.map((project) => project.repo) },
    { name: "projects-feedback", type: T.forum, topic: "Bugs, ideas, and questions for every project other than PriceLens. One post per thing; tag the project and the kind.", tags: feedbackTags(others.map((project) => ({ name: project.name, emoji: "📁" }))), reaction: "👍" },
    ...others.map((project) => ({ name: project.key, type: T.text, topic: `${project.blurb} ${project.url}` })),
  ] },
  { category: "STAFF", overwrites: staffOnly, channels: [
    { name: "staff", type: T.text, topic: "Team coordination. Also where Discord sends community notices." },
    { name: "deploys", type: T.text, topic: "Deploy results and site health, posted automatically." },
    { name: "feedback-inbox", type: T.text, topic: "Every message sent through the website's feedback form lands here." },
    { name: "bot-logs", type: T.text, topic: "What the bots did." },
  ] },
];

const messages = {
  welcome: `# Welcome to Prabhava Labs

Prabhava Labs builds open tools around public data in Sri Lanka. This server is where the people who use them meet the people who make them.

**The projects**
- **${focus.name}** (<${focus.url}>): ${focus.blurb} Its own section: <#${focus.key}-updates>, <#${focus.key}-feedback>, <#${focus.key}-daily>, <#${focus.key}-chat>.
${others.map((project) => `- **${project.name}** (<${project.url}>): ${project.blurb} Talk in <#${project.key}>.`).join("\n")}

**How this server works**
- <#announcements> carries news across all projects. Read only.
- Found a bug or have an idea? Open a post in the feedback forum (<#${focus.key}-feedback> for ${focus.name}, <#projects-feedback> for the rest), one post per thing, tagged. That is the list we work from.
- Pick the projects you care about in Channels & Roles to get their pings.
- Everything is open source: <https://github.com/prabhavalabs>. Pull requests welcome.

Read <#rules> once. Then say hello in <#introductions>.`,
  rules: `# Rules

1. **Be decent.** No harassment, hate, or personal attacks. Disagree with ideas, not people.
2. **Stay on topic per channel.** Project talk in project channels, everything else in <#off-topic>.
3. **No spam or unsolicited promotion.** Sharing your own relevant work in <#show-and-tell> is fine.
4. **Feedback goes in the feedback forums.** One post per bug or idea, tagged. Chat messages get lost; posts get tracked.
5. **Prices are observations, not offers.** Data here comes from official bulletins and store listings and can differ from a stall or a branch on the day.
6. **English, Sinhala, and Tamil are all welcome.**
7. **Follow Discord's Terms and Community Guidelines.**

Moderators may remove content or members that break these. Questions about a decision go to the Team by DM.`,
  [`${focus.key}-chat`]: `Welcome to the ${focus.name} corner. The site is <${focus.url}>, the guide is <${focus.url}/guide>, and the code is <https://github.com/prabhavalabs/${focus.repo}>.

Bugs, ideas, and data problems go in <#${focus.key}-feedback> as posts, so they do not scroll away. Everything else about food prices, sources, and the site goes here.`,
  ...Object.fromEntries(others.map((project) => [project.key, `**${project.name}**: ${project.blurb}\nCode: <https://github.com/prabhavalabs/${project.repo}>\n\nBugs and ideas go in <#projects-feedback> tagged **${project.name}**; chat about it here.`])),
};

// ---------------------------------------------------------------------------------------------
const base = "https://discord.com/api/v10";
async function api(method, path, body, attempt = 0) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bot ${token}`, "content-type": "application/json", "x-audit-log-reason": "Prabhava Labs server setup" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 429 && attempt < 6) {
    const wait = Number((await response.json()).retry_after ?? 1) * 1000 + 100;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return api(method, path, body, attempt + 1);
  }
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`);
  return json;
}
const log = (line) => console.log(line);

// Roles.
const existingRoles = await api("GET", `/guilds/${guildId}/roles`);
const roleId = new Map(existingRoles.map((role) => [role.name, role.id]));
roleId.set("@everyone", guildId);
for (const role of roles) {
  const current = existingRoles.find((candidate) => candidate.name === role.name && !candidate.managed);
  if (!current) {
    const created = await api("POST", `/guilds/${guildId}/roles`, role);
    roleId.set(role.name, created.id);
    log(`role created: ${role.name}`);
  } else if (current.color !== role.color || current.hoist !== role.hoist || current.mentionable !== role.mentionable || current.permissions !== role.permissions) {
    await api("PATCH", `/guilds/${guildId}/roles/${current.id}`, role);
    log(`role updated: ${role.name}`);
  }
}
const everyoneRole = existingRoles.find((role) => role.id === guildId);
if (everyoneRole.permissions !== everyone) {
  await api("PATCH", `/guilds/${guildId}/roles/${guildId}`, { permissions: everyone });
  log("@everyone permissions set");
}
// Order: Founder above Team above Contributor above PriceLens; the bot's own role stays on top.
const botRole = existingRoles.find((role) => role.managed && role.tags?.bot_id);
const order = [botRole?.name, ...roles.map((role) => role.name)].filter(Boolean);
await api("PATCH", `/guilds/${guildId}/roles`, order.map((name, index) => ({ id: roleId.get(name), position: order.length - index })));

const overwritesFor = (list = []) => list.map((entry) => ({ id: roleId.get(entry.role), type: 0, allow: entry.allow ?? "0", deny: entry.deny ?? "0" }));
const sameOverwrites = (current = [], wanted = []) => {
  const key = (o) => `${o.id}:${o.allow}:${o.deny}`;
  const a = current.filter((o) => o.type === 0).map(key).sort();
  const b = wanted.map(key).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

// Channels: categories first, then their channels. Announcement and forum types need Community, which
// is switched on after the rules channel exists, so those are created as text and converted after.
let channels = await api("GET", `/guilds/${guildId}/channels`);
const find = (name, type, parentId) => channels.find((channel) => channel.name === name && (type === undefined || channel.type === type || (type !== T.category && type !== T.voice && [T.text, T.announcement, T.forum].includes(channel.type))) && (parentId === undefined || channel.parent_id === parentId));
let position = 0;
const created = [];
for (const section of layout) {
  let category = find(section.category, T.category);
  const overwrites = overwritesFor(section.overwrites);
  if (!category) {
    category = await api("POST", `/guilds/${guildId}/channels`, { name: section.category, type: T.category, position, permission_overwrites: overwrites });
    channels.push(category);
    log(`category created: ${section.category}`);
  } else if (!sameOverwrites(category.permission_overwrites, overwrites)) {
    await api("PATCH", `/channels/${category.id}`, { permission_overwrites: overwrites });
    log(`category updated: ${section.category}`);
  }
  position += 1;
  let inner = 0;
  for (const spec of section.channels) {
    const wantedType = spec.type === T.forum || spec.type === T.announcement ? T.text : spec.type;
    let channel = find(spec.name, spec.type, category.id) ?? find(spec.name, spec.type);
    const channelOverwrites = overwritesFor(spec.overwrites ?? section.overwrites);
    const body = { name: spec.name, type: wantedType, parent_id: category.id, position: inner, topic: spec.topic, rate_limit_per_user: spec.slowmode ?? 0, permission_overwrites: channelOverwrites };
    if (spec.type === T.voice) { delete body.topic; delete body.rate_limit_per_user; }
    if (!channel) {
      channel = await api("POST", `/guilds/${guildId}/channels`, body);
      channels.push(channel);
      created.push(channel.id);
      log(`channel created: #${spec.name}`);
    } else {
      const drift = channel.parent_id !== category.id || (spec.topic !== undefined && channel.topic !== spec.topic) || (channel.rate_limit_per_user ?? 0) !== (spec.slowmode ?? 0) || !sameOverwrites(channel.permission_overwrites, channelOverwrites);
      if (drift) {
        const patch = { parent_id: category.id, permission_overwrites: channelOverwrites };
        if (spec.type !== T.voice) { patch.topic = spec.topic; patch.rate_limit_per_user = spec.slowmode ?? 0; }
        Object.assign(channel, await api("PATCH", `/channels/${channel.id}`, patch));
        log(`channel updated: #${spec.name}`);
      }
    }
    spec.id = channel.id;
    inner += 1;
  }
}

// Community: rules channel and a channel for Discord's notices, verified email to talk, only mentions by default.
const guild = await api("GET", `/guilds/${guildId}`);
const allSpecsForWelcome = () => layout.flatMap((section) => section.channels);
const rulesId = allSpecsForWelcome().find((c) => c.name === "rules").id;
const staffId = allSpecsForWelcome().find((c) => c.name === "staff").id;
const introductionsId = allSpecsForWelcome().find((c) => c.name === "introductions").id;
if (!guild.features.includes("COMMUNITY") || guild.rules_channel_id !== rulesId || guild.system_channel_id !== introductionsId) {
  await api("PATCH", `/guilds/${guildId}`, {
    features: [...new Set([...guild.features, "COMMUNITY"])],
    rules_channel_id: rulesId,
    public_updates_channel_id: staffId,
    system_channel_id: introductionsId,
    system_channel_flags: 0,
    verification_level: 1,
    default_message_notifications: 1,
    explicit_content_filter: 2,
    description: `Open tools around public data in Sri Lanka: ${projects.map((project) => project.name).join(", ")}. Start with ${focus.name}: food prices, every day.`,
    preferred_locale: "en-US",
  });
  log("community enabled, rules and notices channels set");
}

// Now the announcement and forum channels can take their real types.
channels = await api("GET", `/guilds/${guildId}/channels`);
for (const section of layout) {
  for (const spec of section.channels) {
    const channel = channels.find((c) => c.id === spec.id);
    if (spec.type === T.announcement && channel.type !== T.announcement) {
      await api("PATCH", `/channels/${spec.id}`, { type: T.announcement });
      log(`#${spec.name} is now an announcement channel`);
    }
    if (spec.type === T.forum) {
      const tags = spec.tags.map((tag) => ({ name: tag.name, moderated: Boolean(tag.moderated), emoji_name: tag.emoji }));
      if (channel.type !== T.forum) {
        // A text channel cannot become a forum; make the forum and drop the placeholder.
        const forum = await api("POST", `/guilds/${guildId}/channels`, { name: spec.name, type: T.forum, parent_id: channel.parent_id, position: channel.position, topic: spec.topic, available_tags: tags, default_reaction_emoji: { emoji_name: spec.reaction }, permission_overwrites: channel.permission_overwrites, default_sort_order: 0 });
        await api("DELETE", `/channels/${spec.id}`);
        spec.id = forum.id;
        log(`#${spec.name} is now a forum with ${tags.length} tags`);
      } else {
        const have = (channel.available_tags ?? []).map((tag) => tag.name).sort().join(",");
        if (have !== tags.map((tag) => tag.name).sort().join(",") || channel.topic !== spec.topic) {
          await api("PATCH", `/channels/${spec.id}`, { available_tags: tags, topic: spec.topic, default_reaction_emoji: { emoji_name: spec.reaction } });
          log(`#${spec.name} tags updated`);
        }
      }
    }
  }
}

// Welcome screen: shown to people before they join.
const feedbackId = allSpecsForWelcome().find((c) => c.name === `${focus.key}-feedback`).id;
const generalId = allSpecsForWelcome().find((c) => c.name === "general").id;
const currentScreen = await api("GET", `/guilds/${guildId}/welcome-screen`).catch(() => null);
const wantedScreen = {
  enabled: true,
  description: `Open tools around public data in Sri Lanka. Start with ${focus.name}: food prices, every day.`,
  welcome_channels: [
    { channel_id: rulesId, description: "Read the rules first", emoji_name: "📜" },
    { channel_id: introductionsId, description: "Say hello", emoji_name: "👋" },
    { channel_id: feedbackId, description: "Report a bug or share an idea", emoji_name: "💡" },
    { channel_id: generalId, description: "Talk with the community", emoji_name: "💬" },
  ],
};
if (!currentScreen || currentScreen.description !== wantedScreen.description || JSON.stringify((currentScreen.welcome_channels ?? []).map((c) => c.channel_id)) !== JSON.stringify(wantedScreen.welcome_channels.map((c) => c.channel_id))) {
  await api("PATCH", `/guilds/${guildId}/welcome-screen`, wantedScreen);
  log("welcome screen set");
}

// The pinned texts: posted once, then kept current. Channel mentions are written as <#name> and resolved.
const me = await api("GET", "/users/@me");
const allSpecs = layout.flatMap((section) => section.channels);
const resolve = (text) => text.replace(/<#([\w-]+)>/gu, (whole, name) => { const spec = allSpecs.find((c) => c.name === name); return spec ? `<#${spec.id}>` : whole; });
for (const [name, raw] of Object.entries(messages)) {
  const spec = allSpecs.find((c) => c.name === name);
  const content = resolve(raw);
  const recent = await api("GET", `/channels/${spec.id}/messages?limit=20`);
  const mine = recent.filter((message) => message.author.id === me.id).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (mine) {
    if (mine.content !== content) { await api("PATCH", `/channels/${spec.id}/messages/${mine.id}`, { content }); log(`updated pinned text: #${name}`); }
    continue;
  }
  const posted = await api("POST", `/channels/${spec.id}/messages`, { content, flags: 1 << 2 });
  await api("PUT", `/channels/${spec.id}/pins/${posted.id}`).catch(() => api("PUT", `/channels/${spec.id}/messages/pins/${posted.id}`));
  log(`posted and pinned: #${name}`);
}

// Categories in the order of the layout, whatever order they were created in.
channels = await api("GET", `/guilds/${guildId}/channels`);
const wantedOrder = layout.map((section) => channels.find((c) => c.type === T.category && c.name === section.category)?.id).filter(Boolean);
const currentOrder = channels.filter((c) => c.type === T.category).sort((a, b) => a.position - b.position).map((c) => c.id);
if (wantedOrder.join() !== currentOrder.join()) {
  await api("PATCH", `/guilds/${guildId}/channels`, wantedOrder.map((id, index) => ({ id, position: index })));
  log("categories reordered");
}

// Leftovers from the default server: the empty starter channels and categories.
channels = await api("GET", `/guilds/${guildId}/channels`);
const keep = new Set(layout.flatMap((section) => [section.category, ...section.channels.map((c) => c.name)]));
for (const channel of channels) {
  const managed = layout.some((section) => section.channels.some((c) => c.id === channel.id)) || layout.some((section) => section.category === channel.name && channel.type === T.category);
  if (managed || keep.has(channel.name)) continue;
  if (channel.type === T.text) {
    const recent = await api("GET", `/channels/${channel.id}/messages?limit=5`);
    if (recent.length) { log(`kept #${channel.name}: it has messages`); continue; }
  }
  await api("DELETE", `/channels/${channel.id}`);
  log(`removed default ${channel.type === T.category ? "category" : "channel"}: ${channel.name}`);
}

// AutoMod: the built-in word lists and mention spam, blocked and reported to the staff channel.
const rules = await api("GET", `/guilds/${guildId}/auto-moderation/rules`);
const alerts = allSpecsForWelcome().find((c) => c.name === "bot-logs").id;
const wanted = [
  { name: "Block slurs, sexual content, and profanity", event_type: 1, trigger_type: 4, trigger_metadata: { presets: [1, 2, 3] }, actions: [{ type: 1 }, { type: 2, metadata: { channel_id: alerts } }], enabled: true, exempt_roles: [roleId.get("Founder"), roleId.get("Team")] },
  { name: "Block mention spam", event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 8, mention_raid_protection_enabled: true }, actions: [{ type: 1 }, { type: 2, metadata: { channel_id: alerts } }, { type: 3, metadata: { duration_seconds: 600 } }], enabled: true, exempt_roles: [roleId.get("Founder"), roleId.get("Team")] },
];
for (const rule of wanted) {
  if (rules.some((existing) => existing.name === rule.name)) continue;
  await api("POST", `/guilds/${guildId}/auto-moderation/rules`, rule);
  log(`automod rule created: ${rule.name}`);
}

log("done");
