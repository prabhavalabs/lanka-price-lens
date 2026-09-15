import type { MailSender } from "../account/mail.ts";
import { communityNotice } from "../community/routes.ts";
import { feedbackMessage, renderOwnerNotice, type OwnerNoticeOptions } from "../notify.ts";
import type { MailKind } from "./defaults.ts";
import type { RenderedMail } from "./layout.ts";

/**
 * Every mail the site can send, rendered with sample data so the owner can look at each one:
 * the ten template kinds through the admin's preview, and the notices the owner gets about
 * feedback and community contributions. `mailServices` in app.ts hands these to the CLI.
 */

export type MailServices = {
  /** One template kind with its sample data and the stored wording. */
  sample: (kind: MailKind) => RenderedMail;
  /** The owner's own notices, each named. */
  notices: () => Array<{ name: string; mail: RenderedMail }>;
  /** Sends through the account mailer's channel; null when mail is not configured. */
  send: MailSender | null;
};

/** The owner's notices with made-up but plausible content: a bug report from the site and a translation verdict from the community. */
export function sampleOwnerNotices(options: OwnerNoticeOptions & { siteOrigin: string | null }): Array<{ name: string; mail: RenderedMail }> {
  const origin = (options.siteOrigin ?? "https://price.prabhavalabs.com").replace(/\/+$/u, "");
  const now = new Date().toISOString();
  const bug = feedbackMessage({
    id: "fb_sample",
    kind: "bug",
    message: "The Keells price for big onion shows Rs 0 on the product page since this morning; yesterday it was Rs 380.",
    email: "amal@example.com",
    page: `${origin}/p/product_big_onion`,
    user_agent: "Safari on iPhone",
    status: "new",
    created_at: now,
    updated_at: now,
  });
  const translation = communityNotice(
    "translation",
    { email: "amal@example.com", display_name: "Amal" },
    {
      title: "Beetroot curry (Sinhala) incorrect",
      lines: [
        { text: "Recipe", value: "Beetroot curry" },
        { text: "Language", value: "si" },
        { text: "Verdict", value: "incorrect" },
        { text: "Note", value: "The method says to fry the beetroot; the Sinhala text says to boil it." },
      ],
      body: "Suggested text:\nබීට්රූට් කෑලි තෙල් ස්වල්පයක බැද ගන්න.",
    },
    options.siteOrigin,
  );
  return [
    { name: "feedback_bug", mail: renderOwnerNotice(bug, { ...options, replyTo: "amal@example.com" }) },
    { name: "community_translation", mail: renderOwnerNotice(translation, options) },
  ];
}
