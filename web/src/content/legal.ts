/**
 * The site's small print: the privacy policy and the terms of use, as data so the pages stay
 * thin and a test can check every section has words. Everything here describes what the site
 * actually does; when behaviour changes, change the text and the date together.
 */

export type LegalSection = {
  heading: string;
  /** Short paragraphs; a string starting with "- " is a bullet in a list that follows the paragraphs. */
  body: string[];
};

export type LegalDocument = {
  path: "/privacy" | "/terms";
  title: string;
  /** The page title in the tab. */
  pageTitle: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};

export const contactAddress = "info.price@prabhavalabs.com";

export const privacyPolicy: LegalDocument = {
  path: "/privacy",
  title: "Privacy policy",
  pageTitle: "Privacy policy · PriceLens",
  updated: "2026-09-14",
  intro: "PriceLens is made by Prabhava Labs in Sri Lanka. This page says what the site keeps about you, why, who else sees it, and how to have it removed. Reading prices needs no account and asks nothing of you.",
  sections: [
    {
      heading: "Without an account",
      body: [
        "Our web server keeps ordinary access logs (network address, page requested, browser) for a short time, to keep the site running and to stop abuse.",
        "The footer shows how many people are on the site right now. Your open tab picks a random id and keeps it in the tab's own session storage; it is not a cookie, it says nothing about who you are, and it is gone when the tab closes.",
        "When analytics is switched on, Google Analytics reports which pages are viewed, with network addresses anonymised. Google sets its own cookies for this and handles that data under its own privacy policy; a content blocker stops it entirely.",
        "Your basket, theme, language, and the number of people you cook for stay in your browser's local storage. They never reach our servers.",
        "The feedback form sends us what you wrote, which page you were on, your browser's description, and an email address only if you choose to leave one. Each message goes to the site owner's inbox and to a private staff channel on the community Discord server, and is kept until it has been dealt with.",
      ],
    },
    {
      heading: "With an account",
      body: [
        "An account keeps your email address, your name, a link to your picture if you signed in with Google, your language, your notification choices, the menus and recipes you create, and when the account was made. Menus and recipes are private to you.",
        "A sign-in is a random token in an HttpOnly cookie: it lasts thirty days if you ask to stay signed in, otherwise a day. For each sign-in we record the browser's description and network address, so the account page can show where you are signed in and let you sign out everywhere else.",
        "Passwords are stored only as salted scrypt hashes; we cannot read them. Verification and password-reset links are single-use tokens, also stored hashed, and they expire.",
        "With Google sign-in we receive the email address, name, and picture of the Google account you choose, and nothing else. A short-lived cookie protects the handshake.",
        "Mail about the account (verification, password and email changes, deletion) is sent through Resend from info.price@prabhavalabs.com. Digests and price alerts are sent only if you switch them on. Every mail says why you received it.",
      ],
    },
    {
      heading: "Who else sees data",
      body: [
        "- Google: sign-in, and analytics when it is on.",
        "- Resend: delivers our mail; it sees the address and the message.",
        "- Discord: receives a copy of feedback messages, and nothing from accounts.",
        "- The hosting provider whose servers we rent, which keeps the data at rest.",
        "We do not sell personal data, share it for advertising, or use it for anything beyond running PriceLens.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "Account data stays until you delete the account. Deleting it removes the account, its menus, recipes, preferences, and sign-ins at once; the deletion notice is the last mail you get. Expired sign-ins are cleared by themselves.",
        "Feedback is kept until it has been handled. Access logs are kept for a short time and then discarded.",
      ],
    },
    {
      heading: "Your choices",
      body: [
        "On the account page you can change your name, language, email address, and password, choose which mail you want, sign out of every other device, and delete the account.",
        `For a copy of what we hold about you, a correction, or any question, write to ${contactAddress}.`,
      ],
    },
    {
      heading: "Children",
      body: ["PriceLens is for households doing their shopping. Anyone under thirteen should not create an account."],
    },
    {
      heading: "Law and changes",
      body: [
        "Prabhava Labs handles personal data from Sri Lanka and keeps to the Personal Data Protection Act, No. 9 of 2022.",
        "When this page changes, the date at the top changes with it. Changes that matter are announced on the site and in the community server.",
      ],
    },
  ],
};

export const termsOfUse: LegalDocument = {
  path: "/terms",
  title: "Terms of use",
  pageTitle: "Terms of use · PriceLens",
  updated: "2026-09-14",
  intro: "PriceLens is a free reference of food prices in Sri Lanka, with recipes, costs, and menus built on them, made by Prabhava Labs. Using the site means agreeing to these terms; they are short, so please read them.",
  sections: [
    {
      heading: "Prices are observations",
      body: [
        "Every price is shown with the date it was observed. Open-market prices come from surveys of selected markets and may differ at another stall on the same day; supermarket prices are the retailers' online prices, which can differ from a branch. Prices are given in rupees, per the unit stated.",
        "A price on PriceLens is not an offer, a quotation, or advice. Check with the seller before you rely on it for a purchase or for any decision with money at stake.",
      ],
    },
    {
      heading: "Recipes, servings, and nutrition",
      body: [
        "Quantities, costs, calories, and nutrients are estimates worked out from typical ingredients and reference tables, scaled to the number of people you choose. They are there to help you plan and shop, not to replace medical or dietary advice.",
      ],
    },
    {
      heading: "Your account",
      body: [
        "Reading prices never needs an account. One keeps your menus and your own recipes. Give a real email address, keep your password to yourself, and tell us if you think someone else has used the account. You are responsible for what is done with it.",
        "One account per person. We may suspend or close an account that is used to attack the site, to copy it in bulk, to impersonate someone, or to break the law.",
      ],
    },
    {
      heading: "Your content",
      body: [
        "The menus and recipes you write are yours and stay private to your account. By saving them you let us store them, show them back to you, and work out their servings and costs. Do not save anything unlawful, or someone else's personal information.",
      ],
    },
    {
      heading: "Data and attribution",
      body: [
        "Open-market prices come from the Central Bank of Sri Lanka, the Department of Census and Statistics, and the Hector Kobbekaduwa Agrarian Research and Training Institute, each with recorded permission for this use and their attribution alongside their data. Supermarket prices come from the retailers' online stores. Their names and marks remain theirs.",
        "You may quote prices from PriceLens with a link back to the page. Copying the database in bulk, or presenting it as your own, is not allowed.",
      ],
    },
    {
      heading: "Availability and changes",
      body: [
        "We may change, pause, or stop any part of PriceLens at any time. We work to keep it accurate and running, but the site is provided as it is, without warranty of any kind, and to the extent Sri Lankan law allows we are not liable for loss arising from its use or from its being unavailable.",
      ],
    },
    {
      heading: "Ending things",
      body: ["You can delete your account at any time from the account page. We may close accounts that break these terms, and will say why unless the law prevents it."],
    },
    {
      heading: "Law and contact",
      body: [
        "These terms are governed by the law of Sri Lanka, and any dispute belongs to its courts.",
        `Questions about these terms go to ${contactAddress}.`,
      ],
    },
  ],
};

export const legalDocuments = [privacyPolicy, termsOfUse] as const;
