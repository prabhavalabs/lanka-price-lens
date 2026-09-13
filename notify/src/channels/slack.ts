import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { slackPayload } from "../render/slack.ts";

/** Slack incoming webhooks (hooks.slack.com/services/…): the address is the webhook URL, one per channel. */

export type SlackConfig = { fetch?: FetchLike | undefined };

export const slackWebhookPattern = /^https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[\w/-]+$/u;

export function isSlackWebhook(url: string): boolean {
  return slackWebhookPattern.test(url);
}

export function createSlackChannel(config: SlackConfig = {}): Channel {
  const request = config.fetch ?? fetch;
  return {
    kind: "slack",
    describe: (target) => `slack:webhook ${mask(target.address.split("/").at(-1) ?? "", 3)}`,
    send: async (target: Target, message: Message) => {
      if (!isSlackWebhook(target.address)) return failure("SLACK_ADDRESS_INVALID: not a Slack webhook URL", { gone: true });
      let response: Response;
      try {
        response = await request(target.address, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slackPayload(message)), signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        return failure(`SLACK_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
      }
      if (response.ok) return { ok: true, reference: null };
      const detail = await bodyExcerpt(response);
      const classified = classifyStatus(response.status, response.headers);
      // Slack answers 403 "invalid_token" or 404 "no_service" once a webhook is removed.
      const gone = classified.gone || (response.status === 403 && /invalid_token|no_service|channel_not_found|channel_is_archived/u.test(detail));
      return failure(`SLACK_HTTP_${response.status}: ${detail}`, { ...classified, gone });
    },
  };
}
