import type { Channel, ChannelKind, FetchLike } from "./channel.ts";
import { createDiscordChannel, type DiscordConfig } from "./channels/discord.ts";
import { createEmailChannel, type EmailConfig } from "./channels/email.ts";
import { createSendGridChannel } from "./channels/sendgrid.ts";
import { createSlackChannel, type SlackConfig } from "./channels/slack.ts";
import { createTelegramChannel, type TelegramConfig } from "./channels/telegram.ts";
import { createWebPushChannel, type WebPushConfig } from "./channels/webpush.ts";
import type { ChannelRegistry } from "./outbox.ts";

/**
 * Builds the channels an application has credentials for. Discord and Slack need none (the
 * webhook URL is the address) and are always present; Telegram, email, and Web Push appear
 * only when configured, so a message for an unconfigured channel dies in the outbox with a
 * clear error instead of failing silently. Email goes through Resend, or SendGrid when the
 * config names it as the provider.
 */
export type ChannelsConfig = {
  telegram?: Omit<TelegramConfig, "fetch"> | null | undefined;
  discord?: Omit<DiscordConfig, "fetch"> | undefined;
  slack?: Omit<SlackConfig, "fetch"> | undefined;
  email?: Omit<EmailConfig, "fetch"> | null | undefined;
  webpush?: Omit<WebPushConfig, "fetch"> | null | undefined;
  fetch?: FetchLike | undefined;
};

export function createChannels(config: ChannelsConfig = {}): ChannelRegistry {
  const channels = new Map<ChannelKind, Channel>();
  const request = config.fetch;
  channels.set("discord", createDiscordChannel({ ...config.discord, fetch: request }));
  channels.set("slack", createSlackChannel({ ...config.slack, fetch: request }));
  if (config.telegram?.token) channels.set("telegram", createTelegramChannel({ ...config.telegram, fetch: request }));
  if (config.email?.apiKey && config.email.from) {
    const { provider, ...email } = config.email;
    channels.set("email", provider === "sendgrid" ? createSendGridChannel({ ...email, fetch: request }) : createEmailChannel({ ...email, fetch: request }));
  }
  if (config.webpush?.vapid.publicKey && config.webpush.vapid.privateKey && config.webpush.subject) channels.set("webpush", createWebPushChannel({ ...config.webpush, fetch: request }));
  return channels;
}

/** Sends one message straight through a channel, outside the outbox: for a test post from the admin or a synchronous forward. */
export async function sendDirect(channels: ChannelRegistry, target: Parameters<Channel["send"]>[0], message: Parameters<Channel["send"]>[1]): Promise<ReturnType<Channel["send"]>> {
  const channel = channels.get(target.kind);
  if (!channel) return { ok: false, error: `CHANNEL_UNAVAILABLE: ${target.kind} is not configured`, retryable: false, gone: false };
  return channel.send(target, message);
}
