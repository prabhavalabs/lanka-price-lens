import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

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

/** "07:30" and nothing else; a clock that cannot be read is not a clock. */
export function isClock(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export type SettingsStore = {
  all: () => ChannelSetting[];
  of: (channel: SettingChannel) => ChannelSetting;
  save: (channel: SettingChannel, patch: { enabled?: boolean; send_at?: string }, person: string | null, now: Date) => ChannelSetting;
};

type Row = Omit<ChannelSetting, "enabled"> & { enabled: number };
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

  const of = (channel: SettingChannel): ChannelSetting => {
    const row = database.prepare("SELECT channel, enabled, send_at, updated_by, updated_at FROM channel_setting WHERE channel = ?").get(channel) as Row | undefined;
    // A row the table somehow lacks still answers, so a missing setting cannot stop a send.
    return row ? toSetting(row) : { channel, enabled: seed.enabled, send_at: isClock(seed.sendAt) ? seed.sendAt : defaultSendAt, updated_by: null, updated_at: stamp };
  };

  return {
    all: () => settingChannels.map(of),
    of,
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
