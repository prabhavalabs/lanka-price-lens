import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import sharp from "sharp";

import { isPlatform, type Platform } from "./accounts.ts";

/**
 * The content library (docs/distribution.md): the posts the owner wrote, their pictures, and when
 * each one goes where.
 *
 * Every picture is stored as a JPEG, whatever was uploaded, because Instagram takes nothing else,
 * and is capped at a size the platforms accept. The file is named with a random id: both platforms
 * fetch the picture themselves over the open internet, so the address is public, and an
 * unguessable name is what keeps the library from being read by anyone who finds one of them.
 */

export const contentKinds = ["image", "carousel", "text"] as const;
export type ContentKind = (typeof contentKinds)[number];
export const contentStatuses = ["draft", "ready", "archived"] as const;
export type ContentStatus = (typeof contentStatuses)[number];
export const scheduleStatuses = ["scheduled", "queued", "published", "failed", "cancelled"] as const;
export type ScheduleStatus = (typeof scheduleStatuses)[number];

/** Instagram refuses a picture over 8 MB, and reads nothing wider than 1440 px; both platforms are happy inside this. */
export const pictureMaxWidth = 1440;
export const pictureMaxBytes = 8 * 1024 * 1024;
/** What an upload may weigh before it is re-encoded; a 4000 px PNG from a design tool fits. */
export const uploadMaxBytes = 25 * 1024 * 1024;
export const carouselMax = 10;

export type ContentAsset = {
  id: string; position: number; file: string; media_type: string; width: number; height: number; bytes: number;
  /** The public address the platforms fetch the picture from, which is the site's. */
  url: string;
  /** The same picture under whichever host is asking for it, so the admin shows it from its own origin. */
  path: string;
};
export type ContentItem = {
  id: string;
  kind: ContentKind;
  title: string;
  caption: string;
  link: string | null;
  status: ContentStatus;
  tags: string[];
  assets: ContentAsset[];
  schedules: ScheduleRow[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type ScheduleRow = {
  id: string;
  item_id: string;
  platform: Platform;
  scheduled_for: string;
  status: ScheduleStatus;
  outbox_id: string | null;
  post_url: string | null;
  error: string | null;
  published_at: string | null;
  created_at: string;
};
/** A schedule with enough of its post to show in the calendar without reading every item. */
export type CalendarEntry = ScheduleRow & { title: string; kind: ContentKind; /** The picture's path, read from whichever host is serving the admin. */ thumbnail: string | null };

export type ContentInput = { kind?: ContentKind; title: string; caption: string; link?: string | null; status?: ContentStatus; tags?: string[] };

export type LibraryStore = {
  list: (query: { status?: ContentStatus; search?: string; limit: number; offset: number }) => { rows: ContentItem[]; total: number };
  read: (id: string) => ContentItem | undefined;
  create: (input: ContentInput, person: string | null, now: Date) => ContentItem;
  update: (id: string, input: ContentInput, now: Date) => ContentItem | undefined;
  remove: (id: string) => Promise<boolean>;
  /** Stores one picture with a post, re-encoded to a JPEG the platforms accept. */
  addAsset: (id: string, bytes: Uint8Array, now: Date) => Promise<ContentAsset | { error: string }>;
  removeAsset: (id: string, assetId: string) => Promise<boolean>;
  schedule: (id: string, platform: Platform, when: Date, person: string | null, now: Date) => ScheduleRow | undefined;
  cancelSchedule: (scheduleId: string, now: Date) => boolean;
  /** Everything planned or already gone out between two moments, for the calendar. */
  calendar: (from: string, to: string) => CalendarEntry[];
  /** The schedules whose moment has come and which nothing has picked up yet. */
  due: (now: Date, limit: number) => Array<ScheduleRow & { item: ContentItem }>;
  markSchedule: (scheduleId: string, patch: { status: ScheduleStatus; outboxId?: string | null; postUrl?: string | null; error?: string | null; publishedAt?: string | null }, now: Date) => void;
};

type ItemRow = { id: string; kind: ContentKind; title: string; caption: string; link: string | null; status: ContentStatus; tags: string; created_by: string | null; created_at: string; updated_at: string };
type AssetRow = { id: string; item_id: string; position: number; file: string; media_type: string; width: number; height: number; bytes: number };

const tagList = (tags: string): string[] => tags.split(",").map((tag) => tag.trim()).filter(Boolean);
const tagText = (tags: string[] | undefined): string => (tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 20).join(",");

/** Where a picture is served from. Public on purpose: Facebook and Instagram fetch it themselves. */
export const assetPath = (file: string): string => `/content/${file}`;

export function createLibraryStore(database: OperationalDatabase, directory: string, origin: string): LibraryStore {
  const url = (file: string): string => `${origin.replace(/\/+$/u, "")}${assetPath(file)}`;
  const toAsset = (row: AssetRow): ContentAsset => ({ id: row.id, position: row.position, file: row.file, media_type: row.media_type, width: row.width, height: row.height, bytes: row.bytes, url: url(row.file), path: assetPath(row.file) });

  const assetsOf = (itemId: string): ContentAsset[] =>
    (database.prepare("SELECT id, item_id, position, file, media_type, width, height, bytes FROM content_asset WHERE item_id = ? ORDER BY position").all(itemId) as AssetRow[]).map(toAsset);
  const schedulesOf = (itemId: string): ScheduleRow[] =>
    database.prepare("SELECT id, item_id, platform, scheduled_for, status, outbox_id, post_url, error, published_at, created_at FROM content_schedule WHERE item_id = ? ORDER BY scheduled_for").all(itemId) as ScheduleRow[];
  const toItem = (row: ItemRow): ContentItem => ({ ...row, tags: tagList(row.tags), assets: assetsOf(row.id), schedules: schedulesOf(row.id) });

  const read = (id: string): ContentItem | undefined => {
    const row = database.prepare("SELECT id, kind, title, caption, link, status, tags, created_by, created_at, updated_at FROM content_item WHERE id = ?").get(id) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  };

  /** A post's kind follows its pictures: none is words only, one is a picture, more is a carousel. */
  const settleKind = (itemId: string, now: Date): void => {
    const count = (database.prepare("SELECT COUNT(*) AS n FROM content_asset WHERE item_id = ?").get(itemId) as { n: number }).n;
    database.prepare("UPDATE content_item SET kind = ?, updated_at = ? WHERE id = ?").run(count === 0 ? "text" : count === 1 ? "image" : "carousel", now.toISOString(), itemId);
  };

  return {
    list: ({ status, search, limit, offset }) => {
      const where: string[] = [];
      const values: unknown[] = [];
      if (status) {
        where.push("status = ?");
        values.push(status);
      } else {
        where.push("status <> 'archived'");
      }
      if (search) {
        where.push("(title LIKE ? OR caption LIKE ? OR tags LIKE ?)");
        values.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const total = (database.prepare(`SELECT COUNT(*) AS n FROM content_item ${clause}`).get(...values) as { n: number }).n;
      const rows = database
        .prepare(`SELECT id, kind, title, caption, link, status, tags, created_by, created_at, updated_at FROM content_item ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(...values, Math.max(1, Math.min(limit, 100)), Math.max(0, offset)) as ItemRow[];
      return { rows: rows.map(toItem), total };
    },
    read,
    create: (input, person, now) => {
      const id = randomUUID();
      const stamp = now.toISOString();
      database
        .prepare("INSERT INTO content_item (id, kind, title, caption, link, status, tags, created_by, created_at, updated_at) VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.title.slice(0, 200), input.caption.slice(0, 4000), input.link ?? null, input.status ?? "draft", tagText(input.tags), person?.slice(0, 200) ?? null, stamp, stamp);
      return read(id) as ContentItem;
    },
    update: (id, input, now) => {
      const changed = database
        .prepare("UPDATE content_item SET title = ?, caption = ?, link = ?, status = COALESCE(?, status), tags = ?, updated_at = ? WHERE id = ?")
        .run(input.title.slice(0, 200), input.caption.slice(0, 4000), input.link ?? null, input.status ?? null, tagText(input.tags), now.toISOString(), id).changes;
      return changed ? read(id) : undefined;
    },
    remove: async (id) => {
      const assets = assetsOf(id);
      const gone = database.prepare("DELETE FROM content_item WHERE id = ?").run(id).changes > 0;
      // The rows go with the post through the foreign key; the files have to be removed by hand.
      if (gone) await Promise.all(assets.map((asset) => rm(join(directory, asset.file), { force: true })));
      return gone;
    },
    addAsset: async (id, bytes, now) => {
      if (!read(id)) return { error: "No such post" };
      const held = (database.prepare("SELECT COUNT(*) AS n FROM content_asset WHERE item_id = ?").get(id) as { n: number }).n;
      if (held >= carouselMax) return { error: `A post carries at most ${carouselMax} pictures` };
      let jpeg: Buffer;
      let width: number;
      let height: number;
      try {
        // Whatever came in becomes a JPEG inside the platforms' limits: Instagram takes no other format.
        const image = sharp(bytes, { limitInputPixels: 100_000_000 }).rotate();
        const meta = await image.metadata();
        if (!meta.width || !meta.height) return { error: "That file is not a picture" };
        jpeg = await image.resize({ width: Math.min(meta.width, pictureMaxWidth), withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        const settled = await sharp(jpeg).metadata();
        width = settled.width ?? 0;
        height = settled.height ?? 0;
      } catch {
        return { error: "That file could not be read as a picture" };
      }
      if (jpeg.byteLength > pictureMaxBytes) return { error: "That picture is too large even once re-encoded" };
      const assetId = randomUUID();
      const file = `${assetId.replaceAll("-", "")}.jpg`;
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, file), jpeg);
      const stamp = now.toISOString();
      database
        .prepare("INSERT INTO content_asset (id, item_id, position, file, media_type, width, height, bytes, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?)")
        .run(assetId, id, held, file, width, height, jpeg.byteLength, stamp);
      settleKind(id, now);
      return { id: assetId, position: held, file, media_type: "image/jpeg", width, height, bytes: jpeg.byteLength, url: url(file), path: assetPath(file) };
    },
    removeAsset: async (id, assetId) => {
      const row = database.prepare("SELECT file FROM content_asset WHERE id = ? AND item_id = ?").get(assetId, id) as { file: string } | undefined;
      if (!row) return false;
      database.transaction(() => {
        database.prepare("DELETE FROM content_asset WHERE id = ?").run(assetId);
        // The rest close the gap, so the order the owner sees is the order Instagram gets.
        const left = database.prepare("SELECT id FROM content_asset WHERE item_id = ? ORDER BY position").all(id) as Array<{ id: string }>;
        left.forEach((asset, index) => database.prepare("UPDATE content_asset SET position = ? WHERE id = ?").run(index, asset.id));
      })();
      settleKind(id, new Date());
      await rm(join(directory, row.file), { force: true });
      return true;
    },
    schedule: (id, platform, when, person, now) => {
      if (!read(id)) return undefined;
      const scheduleId = randomUUID();
      const stamp = now.toISOString();
      database
        .prepare("INSERT INTO content_schedule (id, item_id, platform, scheduled_for, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)")
        .run(scheduleId, id, platform, when.toISOString(), person?.slice(0, 200) ?? null, stamp, stamp);
      return database.prepare("SELECT id, item_id, platform, scheduled_for, status, outbox_id, post_url, error, published_at, created_at FROM content_schedule WHERE id = ?").get(scheduleId) as ScheduleRow;
    },
    // Only something not yet sent can be called off; a post already on the platform is not ours to unmake.
    cancelSchedule: (scheduleId, now) =>
      database.prepare("UPDATE content_schedule SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('scheduled', 'failed')").run(now.toISOString(), scheduleId).changes > 0,
    calendar: (from, to) => {
      const rows = database
        .prepare(
          `SELECT s.id, s.item_id, s.platform, s.scheduled_for, s.status, s.outbox_id, s.post_url, s.error, s.published_at, s.created_at, i.title, i.kind,
                  (SELECT file FROM content_asset a WHERE a.item_id = i.id ORDER BY a.position LIMIT 1) AS thumbnail
             FROM content_schedule s JOIN content_item i ON i.id = s.item_id
            WHERE s.scheduled_for >= ? AND s.scheduled_for < ? ORDER BY s.scheduled_for`,
        )
        .all(from, to) as Array<CalendarEntry & { thumbnail: string | null }>;
      return rows.map((row) => ({ ...row, thumbnail: row.thumbnail ? assetPath(row.thumbnail) : null }));
    },
    due: (now, limit) => {
      const rows = database
        .prepare("SELECT id, item_id, platform, scheduled_for, status, outbox_id, post_url, error, published_at, created_at FROM content_schedule WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for LIMIT ?")
        .all(now.toISOString(), Math.max(1, Math.min(limit, 50))) as ScheduleRow[];
      return rows.flatMap((row) => {
        const item = read(row.item_id);
        return item && isPlatform(row.platform) ? [{ ...row, item }] : [];
      });
    },
    markSchedule: (scheduleId, patch, now) => {
      database
        .prepare("UPDATE content_schedule SET status = ?, outbox_id = COALESCE(?, outbox_id), post_url = COALESCE(?, post_url), error = ?, published_at = COALESCE(?, published_at), updated_at = ? WHERE id = ?")
        .run(patch.status, patch.outboxId ?? null, patch.postUrl ?? null, patch.error?.slice(0, 500) ?? null, patch.publishedAt ?? null, now.toISOString(), scheduleId);
    },
  };
}
