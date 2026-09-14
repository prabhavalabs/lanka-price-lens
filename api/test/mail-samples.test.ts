import assert from "node:assert/strict";
import { test } from "node:test";

import { mailCommand, parseMailArguments } from "../src/mail/cli.ts";
import { mailKinds } from "../src/mail/defaults.ts";
import { sampleOwnerNotices } from "../src/mail/samples.ts";

test("the owner's sample notices are a bug report and a translation verdict, both linking the admin", () => {
  const samples = sampleOwnerNotices({ siteOrigin: "https://price.example" });
  assert.deepEqual(samples.map((sample) => sample.name), ["feedback_bug", "community_translation"]);
  assert.ok(samples[0]!.mail.html.includes(">Bug report</h1>") && samples[0]!.mail.html.includes("mailto:amal@example.com"));
  assert.ok(samples[1]!.mail.html.includes("Review in the admin") && samples[1]!.mail.html.includes("https://price.example/admin/community"));
});

test("mail samples: the arguments name the address and the kinds; the command sends each kind once and reports", async () => {
  assert.deepEqual(parseMailArguments(["samples", "--to", "owner@example.com", "--kind", "welcome,notices", "--origin", "https://price.example"]), { to: "owner@example.com", kinds: ["welcome", "notices"] });
  assert.equal(parseMailArguments(["samples", "--to", "owner@example.com"]).kinds.length, mailKinds.length + 1);
  assert.throws(() => parseMailArguments(["samples"]), /recipient/u);
  assert.throws(() => parseMailArguments(["samples", "--to", "owner@example.com", "--kind", "nope"]), /Unknown kind/u);
  assert.throws(() => parseMailArguments(["send", "--to", "owner@example.com"]), /Usage/u);

  const sent: Array<{ to: string; subject: string }> = [];
  const lines: string[] = [];
  const services = {
    sample: (kind: string) => ({ subject: `Sample ${kind}`, html: "<p>x</p>", text: "x" }),
    notices: () => [{ name: "feedback_bug", mail: { subject: "[PriceLens] Bug report", html: "<p>y</p>", text: "y" } }],
    send: async (to: string, mail: { subject: string }) => {
      sent.push({ to, subject: mail.subject });
      return mail.subject.includes("welcome") ? { ok: false as const, error: "MAIL_SEND: boom" } : { ok: true as const, reference: `ref_${sent.length}` };
    },
  };
  const outcome = await mailCommand(["samples", "--to", "owner@example.com", "--kind", "verify_email,welcome,notices"], services as never, { out: (line) => lines.push(line), spacing: 0 });
  assert.deepEqual(outcome, { sent: 2, failed: 1 });
  assert.deepEqual(sent.map((entry) => entry.subject), ["Sample verify_email", "Sample welcome", "[PriceLens] Bug report"]);
  assert.ok(lines[1]!.startsWith('welcome: failed "Sample welcome": MAIL_SEND: boom'));
  assert.equal(lines.at(-1), "2 sent, 1 failed, to owner@example.com");
  await assert.rejects(mailCommand(["samples", "--to", "owner@example.com"], { ...services, send: null } as never, { spacing: 0 }), /not configured/u);
});
