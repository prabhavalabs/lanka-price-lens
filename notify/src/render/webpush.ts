import type { Message } from "../message.ts";
import { shortText } from "./text.ts";

/**
 * What the service worker receives: enough to call showNotification and to open the right
 * page on click. Kept small; a push payload is limited to about 4 KB after encryption.
 */
export type PushPayload = {
  title: string;
  body: string;
  url: string | null;
  image?: string;
  tag?: string;
  severity: Message["severity"];
  actions: Array<{ label: string; url: string }>;
};

export function pushPayload(message: Message): PushPayload {
  const payload: PushPayload = {
    title: message.title.slice(0, 120),
    body: shortText(message, 240),
    url: message.actions[0]?.url ?? null,
    severity: message.severity,
    actions: message.actions.slice(0, 2),
  };
  if (message.image) payload.image = message.image.url;
  if (message.dedupe_key) payload.tag = message.dedupe_key.slice(0, 64);
  return payload;
}
