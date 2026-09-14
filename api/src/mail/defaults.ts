/**
 * Every mail the site sends is a kind with editable fields. The wording here is the default;
 * an edited row in `mail_template` overrides it field by field (a blank field means "use the
 * default"). Fields are plain text with `{{placeholders}}`; each kind lists its own. The
 * layout stays in code (api/src/mail/layout.ts); only the words live here.
 */

export const mailKinds = ["verify_email", "welcome", "reset_password", "password_changed", "change_email", "email_changed", "account_deleted", "recipes_daily", "deals_daily", "price_alerts"] as const;
export type MailKind = (typeof mailKinds)[number];

export function isMailKind(value: unknown): value is MailKind {
  return typeof value === "string" && (mailKinds as readonly string[]).includes(value);
}

export type MailFields = {
  subject: string;
  /** The preview line mail clients show beside the subject; the first intro paragraph when blank. */
  preheader: string;
  heading: string;
  /** Before the content blocks. A blank line starts a new paragraph. */
  intro: string;
  /** After the content blocks, before the button. */
  outro: string;
  /** Blank hides the button. */
  button_label: string;
  /** The footer line saying why the mail came. */
  reason: string;
};

export const mailFieldNames = ["subject", "preheader", "heading", "intro", "outro", "button_label", "reason"] as const satisfies ReadonlyArray<keyof MailFields>;

export type MailPlaceholder = { name: string; description: string };

export type MailTemplate = {
  kind: MailKind;
  /** The effective wording: the edited row where it says something, the default elsewhere. */
  fields: MailFields;
  defaults: MailFields;
  placeholders: MailPlaceholder[];
  edited: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

const name: MailPlaceholder = { name: "name", description: "The person's display name" };
const link: MailPlaceholder = { name: "link", description: "Where the button goes; also written out under it" };
const date: MailPlaceholder = { name: "date", description: "The day the mail is for, as words (Monday 14 September)" };

export const mailPlaceholders: Record<MailKind, MailPlaceholder[]> = {
  verify_email: [name, link],
  welcome: [name, link],
  reset_password: [name, link, { name: "minutes", description: "How long the reset link works, in minutes" }],
  password_changed: [name, link, { name: "when", description: "When the password changed" }],
  change_email: [name, link, { name: "new_email", description: "The address the account is moving to" }],
  email_changed: [name, link, { name: "new_email", description: "The address the account moved to" }],
  account_deleted: [name],
  recipes_daily: [name, date, link, { name: "count", description: "How many recipes the mail carries" }],
  deals_daily: [name, date, link, { name: "count", description: "How many deals the mail carries" }, { name: "stores", description: "The stores with prices today, as a list" }],
  price_alerts: [name, date, link, { name: "count", description: "How many wishlist products moved" }],
};

export const mailDefaults: Record<MailKind, MailFields> = {
  verify_email: {
    subject: "Confirm your email address",
    preheader: "",
    heading: "Confirm your email address",
    intro: "Hi {{name}}, thanks for joining PriceLens. Press the button to confirm that this address is yours. The link works for a day.",
    outro: "",
    button_label: "Confirm my email",
    reason: "You're getting this email because this address was used to create a PriceLens account. If that wasn't you, ignore this email and nothing happens.",
  },
  welcome: {
    subject: "Your PriceLens account is ready",
    preheader: "",
    heading: "Welcome to PriceLens, {{name}}",
    intro: "Your email is confirmed and your account is ready. Keep menus, write down your own recipes, and see what dinner costs today.",
    outro: "",
    button_label: "Open PriceLens",
    reason: "You're getting this email because you confirmed this address on PriceLens.",
  },
  reset_password: {
    subject: "Reset your PriceLens password",
    preheader: "",
    heading: "Reset your password",
    intro: "Hi {{name}}, someone asked to reset the password for this PriceLens account. If that was you, press the button and choose a new one. The link works for {{minutes}} minutes.",
    outro: "",
    button_label: "Choose a new password",
    reason: "You're getting this email because a password reset was requested for this address. If that wasn't you, ignore this email; your password stays as it is.",
  },
  password_changed: {
    subject: "Your PriceLens password was changed",
    preheader: "",
    heading: "Your password was changed",
    intro: "Hi {{name}}, the password for your PriceLens account was changed on {{when}}, and every other device was signed out.",
    outro: "If that was you, there is nothing more to do. If it wasn't, reset your password straight away and reply to this email.",
    button_label: "Reset my password",
    reason: "You're getting this email because the password on your PriceLens account changed.",
  },
  change_email: {
    subject: "Confirm your new email address",
    preheader: "",
    heading: "Confirm your new email address",
    intro: "Hi {{name}}, you asked to move your PriceLens account to {{new_email}}. Press the button to confirm the change. Until then your account keeps its current address.",
    outro: "",
    button_label: "Confirm this address",
    reason: "You're getting this email because someone entered this address on a PriceLens account. If that wasn't you, ignore this email and nothing changes.",
  },
  email_changed: {
    subject: "The email address on your PriceLens account was changed",
    preheader: "",
    heading: "Your email address was changed",
    intro: "Hi {{name}}, the email address on your PriceLens account is now {{new_email}}. Mail about your account goes there from now on.",
    outro: "If you didn't make this change, secure your account straight away and reply to this email so we can help.",
    button_label: "Secure my account",
    reason: "You're getting this email at your previous address because the address on your PriceLens account changed.",
  },
  account_deleted: {
    subject: "Your PriceLens account was deleted",
    preheader: "",
    heading: "Your account was deleted",
    intro: "Hi {{name}}, your PriceLens account and everything kept on it, menus, recipes and settings included, have been deleted.",
    outro: "Prices stay free to read without an account, and you're welcome back any time.",
    button_label: "",
    reason: "You're getting this email because the account with this address was deleted. If you didn't do this, reply to this email straight away.",
  },
  recipes_daily: {
    subject: "Three recipes for today",
    preheader: "Picked for you from the PriceLens kitchen, with what a serving costs today.",
    heading: "Three recipes for today",
    intro: "Hi {{name}}, here are {{count}} dishes picked for {{date}} from your food preferences. Each one shows the calories, the time it takes, and what a serving costs at today's supermarket prices.",
    outro: "Cooked one? Keep it in a menu on your account and the shopping list and its cost come with it.",
    button_label: "Browse all recipes",
    reason: "You're getting this email because you switched on daily recipe ideas on your PriceLens account. Unsubscribe with one click below, or change it any time under Notifications in your account.",
  },
  deals_daily: {
    subject: "Today's supermarket deals",
    preheader: "{{count}} price drops today, and where the household essentials are cheapest.",
    heading: "Today's supermarket deals",
    intro: "Hi {{name}}, here is what moved on the supermarket shelves for {{date}}: the biggest drops, where each household essential is cheapest today, and what went up.",
    outro: "Prices are what {{stores}} publish online each morning; a deal can be gone by the evening.",
    button_label: "See today's prices",
    reason: "You're getting this email because you switched on the daily deals mail on your PriceLens account. Unsubscribe with one click below, or change it any time under Notifications in your account.",
  },
  price_alerts: {
    subject: "Price alert: {{count}} moved on your wishlist",
    preheader: "The products you star, at today's cheapest seller.",
    heading: "Your wishlist moved",
    intro: "Hi {{name}}, {{count}} on your wishlist met the rule you set, as of {{date}}. Here is where each is cheapest today and what it was before.",
    outro: "Each product keeps its own rule: any drop, or a price of your own. Change them under Notifications in your account.",
    button_label: "Open my wishlist",
    reason: "You're getting this email because you switched on price alerts on your PriceLens account. Unsubscribe with one click below, or change it any time under Notifications in your account.",
  },
};
