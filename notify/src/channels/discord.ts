import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { discordEmbed } from "../render/discord.ts";

/**
 * Discord incoming webhooks: the address is the webhook URL itself, one per channel. Mentions
 * are never parsed, so a message can quote anything without pinging anyone.
 */

export type DiscordConfig = { username?: string | undefined; fetch?: FetchLike | undefined };

export const discordWebhookPattern = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/u;

export function isDiscordWebhook(url: string): boolean {
  return discordWebhookPattern.test(url);
}

export function createDiscordChannel(config: DiscordConfig = {}): Channel {
  const request = config.fetch ?? fetch;
  return {
    kind: "discord",
    describe: (target) => `discord:webhook ${mask(target.address.split("/").at(-1) ?? "", 3)}`,
    send: async (target: Target, message: Message) => {
      if (!isDiscordWebhook(target.address)) return failure("DISCORD_ADDRESS_INVALID: not a Discord webhook URL", { gone: true });
      let response: Response;
      try {
        response = await request(`${target.address}?wait=true`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: config.username ?? "PriceLens", embeds: [discordEmbed(message)], allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return failure(`DISCORD_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
      }
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, reference: payload?.id ?? null };
      }
      const classified = classifyStatus(response.status, response.headers);
      return failure(`DISCORD_HTTP_${response.status}: ${await bodyExcerpt(response)}`, classified);
    },
  };
}
