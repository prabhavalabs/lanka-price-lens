import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

import { cronFromForm, describeCron, isCron, nextRun } from "./recurrence.ts";

/**
 * What each channel does and when (docs/distribution.md).
 *
 * These live in the database, not the environment, so the owner changes a send time in the admin
 * and the next tick obeys it — no editing a file on the server, no recreating a container. The
 * environment is read once, to seed the table the first time, so the day this ships nothing about
 * the schedule changes.
 *
 * `send_at` is a clock on the wall in Colombo. Everything else in the database is UTC; this one is
 * not, because it is the time the owner sets and the readers experience, and converting it at rest
 * would make it drift with the offset rather than stay at "half past seven in the morning".
 */

export const settingChannels = ["email", "facebook", "instagram", "telegram"] as const;
export type SettingChannel = (typeof settingChannels)[number];

export function isSettingChannel(value: unknown): value is SettingChannel {
  return typeof value === "string" && (settingChannels as readonly string[]).includes(value);
}

/** The zone every time in the distribution screens is written and read in. */
export const postingZone = "Asia/Colombo";
export const defaultSendAt = "07:30";

export type ChannelSetting = { channel: SettingChannel; enabled: boolean; send_at: string; updated_by: string | null; updated_at: string };

/**
 * What a channel actually sends. A channel is not one thing on a timer: the mail channel carries
 * the deals mail, the recipes mail and the price alerts, each of which can run on its own clock,
 * and a platform carries the day's post. The channel's switch is the master one; a job runs when
 * both it and the job are on.
 */
export const channelJobs = [
  { channel: "email", job: "deals_daily", label: "Daily deals mail", description: "Today's supermarket deals and the essentials watch, to everyone subscribed to it." },
  { channel: "email", job: "recipes_daily", label: "Daily recipes mail", description: "Three dishes for today, priced at today's rates, to everyone subscribed to it." },
  { channel: "email", job: "price_alerts", label: "Price alerts", description: "One mail per person whose wishlist moved past the mark they set." },
  { channel: "telegram", job: "deals_digest", label: "Deals digest", description: "The day's deals as one message on the public channel, and to everyone who linked their chat." },
  { channel: "facebook", job: "deals_post", label: "The day's deals post", description: "The drawn card and its Sinhala caption, as one post on the Page." },
  { channel: "instagram", job: "deals_post", label: "The day's deals post", description: "The same card and caption on the Instagram account, which takes no post without a picture." },
] as const;

export type ChannelJobName = (typeof channelJobs)[number]["job"];
export type ChannelJobKey = { channel: SettingChannel; job: string };

export function jobDefinition(channel: string, job: string): (typeof channelJobs)[number] | undefined {
  return channelJobs.find((entry) => entry.channel === channel && entry.job === job);
}

/** A job as the admin reads it: what it is, when it runs, and how the last run went. */
export type ChannelJobSchedule = {
  channel: SettingChannel;
  job: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Five fields, Colombo time; see recurrence.ts. */
  cron: string;
  /** The expression in words, so nobody has to read cron to check it. */
  recurrence: string;
  /** When it next fires, or null when the expression never does. */
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: "ran" | "failed" | "skipped" | null;
  last_error: string | null;
  updated_by: string | null;
  updated_at: string;
};

/** "07:30" and nothing else; a clock that cannot be read is not a clock. */
export function isClock(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export type SettingsStore = {
  all: () => ChannelSetting[];
  of: (channel: SettingChannel) => ChannelSetting;
  save: (channel: SettingChannel, patch: { enabled?: boolean; send_at?: string }, person: string | null, now: Date) => ChannelSetting;
  /** Every job of every channel, in the order the catalogue lists them. */
  jobs: (channel?: SettingChannel) => ChannelJobSchedule[];
  job: (channel: SettingChannel, job: string) => ChannelJobSchedule | undefined;
  saveJob: (channel: SettingChannel, job: string, patch: { enabled?: boolean; cron?: string }, person: string | null, now: Date) => ChannelJobSchedule | undefined;
  /** Records what a run did, so the admin can see it and the scheduler can hold off a retry. */
  markJobRun: (channel: SettingChannel, job: string, outcome: { status: "ran" | "failed" | "skipped"; error?: string | null | undefined }, now: Date) => void;
};

type Row = Omit<ChannelSetting, "enabled"> & { enabled: number };
const jobColumns = "channel, job, enabled, cron, last_run_at, last_status, last_error, updated_by, updated_at";
type JobRow = { channel: SettingChannel; job: string; enabled: number; cron: string; last_run_at: string | null; last_status: ChannelJobSchedule["last_status"]; last_error: string | null; updated_by: string | null; updated_at: string };
const toSetting = (row: Row): ChannelSetting => ({ ...row, enabled: row.enabled === 1 });

/**
 * Builds the store, seeding any channel the table does not yet carry. `seed` is what the
 * environment said, which is what the schedule has been doing until now.
 */
export function createSettingsStore(database: OperationalDatabase, seed: { enabled: boolean; sendAt: string }): SettingsStore {
  const stamp = new Date().toISOString();
  const insert = database.prepare("INSERT OR IGNORE INTO channel_setting (channel, enabled, send_at, updated_by, updated_at) VALUES (?, ?, ?, NULL, ?)");
  database.transaction(() => {
    for (const channel of settingChannels) insert.run(channel, seed.enabled ? 1 : 0, isClock(seed.sendAt) ? seed.sendAt : defaultSendAt, stamp);
  })();

  const ofRow = (channel: SettingChannel): ChannelSetting => {
    const row = database.prepare("SELECT channel, enabled, send_at, updated_by, updated_at FROM channel_setting WHERE channel = ?").get(channel) as Row | undefined;
    // A row the table somehow lacks still answers, so a missing setting cannot stop a send.
    return row ? toSetting(row) : { channel, enabled: seed.enabled, send_at: isClock(seed.sendAt) ? seed.sendAt : defaultSendAt, updated_by: null, updated_at: stamp };
  };
  const of = ofRow;

  // Every job the catalogue names gets a row the first time it is seen, on the clock the channel
  // was already keeping, so the day this ships nothing changes about when anything goes out. The
  // Instagram post is the exception: nothing has ever posted it, and a deploy is no moment to
  // start writing to a live account, so it arrives switched off.
  const seedJobs = database.prepare("INSERT OR IGNORE INTO channel_job (channel, job, enabled, cron, updated_by, updated_at) VALUES (?, ?, ?, ?, NULL, ?)");
  database.transaction(() => {
    for (const entry of channelJobs) {
      const channel = ofRow(entry.channel);
      const daily = cronFromForm({ kind: "daily", at: isClock(channel.send_at) ? channel.send_at : defaultSendAt });
      const on = entry.channel === "instagram" ? false : channel.enabled;
      seedJobs.run(entry.channel, entry.job, on ? 1 : 0, daily, stamp);
    }
  })();

  const toSchedule = (row: JobRow): ChannelJobSchedule | undefined => {
    const definition = jobDefinition(row.channel, row.job);
    if (!definition) return undefined;
    const next = nextRun(row.cron, new Date());
    return {
      channel: row.channel,
      job: row.job,
      label: definition.label,
      description: definition.description,
      enabled: row.enabled === 1,
      cron: row.cron,
      recurrence: describeCron(row.cron),
      next_run_at: next ? next.toISOString() : null,
      last_run_at: row.last_run_at,
      last_status: row.last_status,
      last_error: row.last_error,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  };

  const readJob = (channel: SettingChannel, job: string): ChannelJobSchedule | undefined => {
    const row = database.prepare(`SELECT ${jobColumns} FROM channel_job WHERE channel = ? AND job = ?`).get(channel, job) as JobRow | undefined;
    return row ? toSchedule(row) : undefined;
  };

  return {
    all: () => settingChannels.map(of),
    of,
    jobs: (channel) => {
      const rows = (channel
        ? database.prepare(`SELECT ${jobColumns} FROM channel_job WHERE channel = ?`).all(channel)
        : database.prepare(`SELECT ${jobColumns} FROM channel_job`).all()) as JobRow[];
      const found = new Map(rows.map((row) => [`${row.channel}:${row.job}`, row]));
      // The catalogue decides the order and what exists; a row for a job nobody defines any more is ignored.
      return channelJobs
        .filter((entry) => !channel || entry.channel === channel)
        .flatMap((entry) => {
          const row = found.get(`${entry.channel}:${entry.job}`);
          const schedule = row ? toSchedule(row) : undefined;
          return schedule ? [schedule] : [];
        });
    },
    job: readJob,
    saveJob: (channel, job, patch, person, now) => {
      const current = readJob(channel, job);
      if (!current) return undefined;
      const cron = patch.cron !== undefined && isCron(patch.cron) ? patch.cron.trim() : current.cron;
      const enabled = patch.enabled ?? current.enabled;
      database
        .prepare("UPDATE channel_job SET enabled = ?, cron = ?, updated_by = ?, updated_at = ? WHERE channel = ? AND job = ?")
        .run(enabled ? 1 : 0, cron, person?.slice(0, 200) ?? null, now.toISOString(), channel, job);
      return readJob(channel, job);
    },
    markJobRun: (channel, job, outcome, now) => {
      database
        .prepare("UPDATE channel_job SET last_run_at = ?, last_status = ?, last_error = ? WHERE channel = ? AND job = ?")
        .run(now.toISOString(), outcome.status, outcome.error?.slice(0, 500) ?? null, channel, job);
    },
    save: (channel, patch, person, now) => {
      const current = of(channel);
      const enabled = patch.enabled ?? current.enabled;
      const sendAt = patch.send_at && isClock(patch.send_at) ? patch.send_at : current.send_at;
      database
        .prepare("INSERT INTO channel_setting (channel, enabled, send_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET enabled = excluded.enabled, send_at = excluded.send_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .run(channel, enabled ? 1 : 0, sendAt, person?.slice(0, 200) ?? null, now.toISOString());
      return of(channel);
    },
  };
}
