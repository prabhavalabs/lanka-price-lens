// Small operations on the Prabhava Labs server, after setup.mjs has built it:
//   node admin.mjs check                      list categories, channels, roles
//   node admin.mjs founder <userId>           give a member the Founder role
//   node admin.mjs invite                     print (or create) the permanent invite to #welcome
//   node admin.mjs webhook <channel> <name>   print (or create) a webhook for a channel, URL only
//   node admin.mjs post <channel> <text>      post a message as the bot
//   node admin.mjs messages <channel> [n]     print the last n messages of a channel (default 5)
// Needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) throw new Error("DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required");
const base = "https://discord.com/api/v10";
async function api(method, path, body, attempt = 0) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bot ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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
const [command, ...args] = process.argv.slice(2);
const channels = await api("GET", `/guilds/${guildId}/channels`);
const byName = (name) => { const channel = channels.find((c) => c.name === name); if (!channel) throw new Error(`no channel named ${name}`); return channel; };
const typeName = { 0: "text", 2: "voice", 4: "category", 5: "announcement", 15: "forum" };

if (command === "check") {
  const guild = await api("GET", `/guilds/${guildId}?with_counts=true`);
  console.log(`${guild.name}: ${guild.approximate_member_count} members, features ${guild.features.join(", ") || "none"}`);
  for (const category of channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position)) {
    console.log(`${category.name}`);
    for (const channel of channels.filter((c) => c.parent_id === category.id).sort((a, b) => a.position - b.position)) console.log(`  #${channel.name} (${typeName[channel.type]}${channel.available_tags ? `, tags: ${channel.available_tags.map((t) => t.name).join("/")}` : ""})`);
  }
  const roles = await api("GET", `/guilds/${guildId}/roles`);
  console.log("roles: " + roles.filter((r) => r.name !== "@everyone").sort((a, b) => b.position - a.position).map((r) => r.name).join(", "));
} else if (command === "founder") {
  const roles = await api("GET", `/guilds/${guildId}/roles`);
  const founder = roles.find((r) => r.name === "Founder");
  await api("PUT", `/guilds/${guildId}/members/${args[0]}/roles/${founder.id}`);
  console.log(`Founder given to ${args[0]}`);
} else if (command === "invite") {
  const welcome = byName("welcome");
  const invites = await api("GET", `/channels/${welcome.id}/invites`);
  const permanent = invites.find((invite) => invite.max_age === 0 && invite.max_uses === 0) ?? (await api("POST", `/channels/${welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false }));
  console.log(`https://discord.gg/${permanent.code}`);
} else if (command === "webhook") {
  const channel = byName(args[0]);
  const hooks = await api("GET", `/channels/${channel.id}/webhooks`);
  const hook = hooks.find((h) => h.name === args[1]) ?? (await api("POST", `/channels/${channel.id}/webhooks`, { name: args[1] }));
  console.log(hook.url ?? `https://discord.com/api/webhooks/${hook.id}/${hook.token}`);
} else if (command === "post") {
  const channel = byName(args[0]);
  await api("POST", `/channels/${channel.id}/messages`, { content: args.slice(1).join(" ") });
  console.log(`posted in #${args[0]}`);
} else if (command === "messages") {
  const channel = byName(args[0]);
  const list = await api("GET", `/channels/${channel.id}/messages?limit=${Number(args[1] ?? 5)}`);
  for (const message of list.reverse()) {
    const embeds = (message.embeds ?? []).map((embed) => `[embed] ${embed.title ?? ""} ${embed.description ? "· " + embed.description.slice(0, 120) : ""}`);
    console.log(`${message.timestamp.slice(0, 16)} ${message.author.username}: ${message.content.slice(0, 160) || embeds.join(" | ")}`);
  }
} else {
  throw new Error(`unknown command ${command}`);
}
