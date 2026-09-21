import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { ApiError, type Client, type ContentItem, type Platform } from "./client.ts";

/**
 * Tool inputs are plain JSON Schema rather than a validation library's objects, which is what the
 * protocol carries anyway and keeps this free of a schema library's own version drift.
 */
export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
const object = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

/**
 * The tools the server offers (docs/mcp.md). They are shaped around what the owner actually does —
 * write a post, give it its pictures, put it in the calendar — rather than mirroring the REST
 * routes one for one.
 *
 * Two rules run through all of them. Anything that writes is refused unless the server was started
 * in writing mode, and publishing straight to a public account needs `confirm` on top of that,
 * because a scheduled post can be called off and a published one cannot.
 *
 * What comes back from the admin is the owner's own content, but it is still data: a caption that
 * reads like an instruction is a caption.
 */

export type ToolContext = { client: Client; canWrite: boolean; now?: () => Date };

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const problem = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Pictures only, and not so large that the admin will refuse them anyway. */
const pictureTypes: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff" };
export const pictureMaxBytes = 25 * 1024 * 1024;

/** A post as an agent needs to see it: enough to act on, without the noise. */
export function summarise(item: ContentItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    caption: item.caption,
    link: item.link,
    status: item.status,
    tags: item.tags,
    kind: item.kind,
    pictures: item.assets.map((asset) => ({ id: asset.id, position: asset.position, size: `${asset.width}x${asset.height}`, url: asset.url })),
    scheduled: item.schedules.map((entry) => ({ id: entry.id, platform: entry.platform, at: entry.scheduled_for, status: entry.status, ...(entry.post_url ? { url: entry.post_url } : {}), ...(entry.error ? { error: entry.error } : {}) })),
    updated_at: item.updated_at,
  };
}

const platform = { type: "string", enum: ["facebook", "instagram"], description: "Which platform this is for" };
const postFields = {
  title: str("A short name for your own list; not shown on either platform", { minLength: 1, maxLength: 200 }),
  caption: str("Exactly what the platforms will show, newlines and all", { maxLength: 4000 }),
  link: { type: ["string", "null"], description: "Facebook previews it; Instagram can only name it in words" },
  tags: { type: "array", items: { type: "string" }, maxItems: 20, description: "Hashtags without the #, which is added for you" },
  status: { type: "string", enum: ["draft", "ready", "archived"] },
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  writes: boolean;
  run: (context: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>;
};

export function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "channels_status",
      description: "What is connected on Facebook and Instagram, whether each token still stands, and the last posts that went out. Start here when something will not publish.",
      inputSchema: object({}),
      writes: false,
      run: async ({ client }) => {
        const status = await client.status();
        return text({
          meta_app_configured: status.configured,
          accounts: status.accounts.map((account) => ({
            platform: account.platform,
            name: account.name,
            handle: account.username,
            active: account.active,
            paused: account.paused,
            can_post: account.can_post,
            token: account.token_status,
            ...(account.token_error ? { token_error: account.token_error } : {}),
          })),
          recent_posts: status.posts.slice(0, 10).map((post) => ({ platform: post.platform, title: post.title.slice(0, 80), status: post.status, at: post.sent_at ?? post.created_at, ...(post.error ? { error: post.error } : {}), ...(post.url ? { url: post.url } : {}) })),
        });
      },
    },
    {
      name: "list_posts",
      description: "The posts in the library, newest first. Search covers the name, the caption and the hashtags. Archived posts are left out unless asked for by status.",
      inputSchema: object({ search: str("Matches the name, the caption or the hashtags", { maxLength: 100 }), status: { type: "string", enum: ["draft", "ready", "archived"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }),
      writes: false,
      run: async ({ client }, input) => {
        const found = await client.listPosts(input as { search?: string; status?: string; limit?: number });
        return text({ total: found.total, posts: found.rows.map(summarise) });
      },
    },
    {
      name: "read_post",
      description: "One post in full: its words, its pictures in order, and every time it is set to go out.",
      inputSchema: object({ id: str("The post's id, from list_posts") }, ["id"]),
      writes: false,
      run: async ({ client }, input) => text(summarise(await client.readPost(String(input.id)))),
    },
    {
      name: "preview_post",
      description: "The caption as Facebook and as Instagram will each render it, and what stands in the way of sending it to either. Read this before scheduling, especially for Instagram, which takes no post without a picture.",
      inputSchema: object({ id: str("The post's id") }, ["id"]),
      writes: false,
      run: async ({ client }, input) => text(await client.previewPost(String(input.id))),
    },
    {
      name: "calendar",
      description: "What is planned and what has already gone out between two moments. Both are ISO timestamps; leaving them out looks a month back and two months forward.",
      inputSchema: object({ from: str("ISO 8601; defaults to a month ago"), to: str("ISO 8601; defaults to two months ahead") }),
      writes: false,
      run: async ({ client, now }, input) => {
        const clock = (now ?? (() => new Date()))();
        const from = typeof input.from === "string" && input.from ? input.from : new Date(clock.getTime() - 30 * 86_400_000).toISOString();
        const to = typeof input.to === "string" && input.to ? input.to : new Date(clock.getTime() + 60 * 86_400_000).toISOString();
        const found = await client.calendar(from, to);
        return text({
          from: found.from,
          to: found.to,
          entries: found.entries.map((entry) => ({ schedule_id: entry.id, post_id: entry.item_id, title: entry.title, platform: entry.platform, at: entry.scheduled_for, status: entry.status, ...(entry.error ? { error: entry.error } : {}), ...(entry.post_url ? { url: entry.post_url } : {}) })),
        });
      },
    },
    {
      name: "create_post",
      description: "Writes a new post into the library. It carries no pictures yet: add them with add_picture, then schedule it.",
      inputSchema: object(postFields, ["title", "caption"]),
      writes: true,
      run: async ({ client }, input) => text(summarise(await client.createPost(input as never))),
    },
    {
      name: "update_post",
      description: "Rewrites a post's words. Send every field, not only the changed one: what is sent replaces what is there.",
      inputSchema: object({ id: str("The post's id"), ...postFields }, ["id", "title", "caption"]),
      writes: true,
      run: async ({ client }, input) => {
        const { id, ...rest } = input as { id: string };
        return text(summarise(await client.updatePost(id, rest as never)));
      },
    },
    {
      name: "add_picture",
      description:
        "Adds one picture to a post from a file on this machine, in the order Instagram will show them. Any common picture format is fine: the admin re-encodes it to a JPEG the platforms accept. Up to ten per post, and the first is the one Facebook previews.",
      inputSchema: object({ id: str("The post's id"), path: str("An absolute path to a picture file on this machine") }, ["id", "path"]),
      writes: true,
      run: async ({ client }, input) => {
        const path = resolve(String(input.path));
        const extension = extname(path).toLowerCase();
        const mediaType = pictureTypes[extension];
        if (!mediaType) return problem(`${path} is not a picture this can send (${Object.keys(pictureTypes).join(", ")}).`);
        let bytes: Buffer;
        try {
          const details = await stat(path);
          if (!details.isFile()) return problem(`${path} is not a file.`);
          if (details.size > pictureMaxBytes) return problem(`${path} is ${(details.size / 1048576).toFixed(1)} MB; the limit is ${pictureMaxBytes / 1048576} MB.`);
          bytes = await readFile(path);
        } catch (error) {
          return problem(`${path} could not be read: ${error instanceof Error ? error.message : "no such file"}`);
        }
        return text(summarise(await client.addPicture(String(input.id), bytes, mediaType)));
      },
    },
    {
      name: "remove_picture",
      description: "Takes one picture off a post. The rest close the gap, so the order stays the order Instagram will use.",
      inputSchema: object({ id: str("The post's id"), picture_id: str("From read_post") }, ["id", "picture_id"]),
      writes: true,
      run: async ({ client }, input) => text(summarise(await client.removePicture(String(input.id), String(input.picture_id)))),
    },
    {
      name: "schedule_post",
      description:
        "Puts a post in the calendar for one platform at one moment. The same post can be scheduled more than once, to both platforms or at different times. `at` is an ISO timestamp; say the zone, or it is read as UTC.",
      inputSchema: object({ id: str("The post's id"), platform, at: str("ISO 8601, for example 2026-09-25T08:30:00+05:30") }, ["id", "platform", "at"]),
      writes: true,
      run: async ({ client }, input) => {
        const when = new Date(String(input.at));
        if (Number.isNaN(when.getTime())) return problem(`"${String(input.at)}" is not a moment in time. Use ISO 8601, for example 2026-09-25T08:30:00+05:30.`);
        return text(summarise(await client.schedulePost(String(input.id), input.platform as Platform, when.toISOString())));
      },
    },
    {
      name: "cancel_schedule",
      description: "Calls off a planned post. Only one that has not gone out yet; a post already on the platform is not ours to unmake.",
      inputSchema: object({ schedule_id: str("From calendar or read_post, not the post's own id") }, ["schedule_id"]),
      writes: true,
      run: async ({ client }, input) => {
        await client.cancelSchedule(String(input.schedule_id));
        return text("Called off.");
      },
    },
    {
      name: "post_now",
      description:
        "Publishes a planned post immediately, whenever it was set for. This puts it on a public account and cannot be undone, so it refuses unless `confirm` is true. Without `confirm` it says what would go out and stops.",
      inputSchema: object({ schedule_id: str("From calendar or read_post"), confirm: { type: "boolean", description: "Must be true to actually publish" } }, ["schedule_id"]),
      writes: true,
      run: async ({ client }, input) => {
        const scheduleId = String(input.schedule_id);
        if (input.confirm !== true) {
          const clock = new Date();
          const entry = (await client.calendar(new Date(0).toISOString(), new Date(clock.getTime() + 10 * 365 * 86_400_000).toISOString())).entries.find((row) => row.id === scheduleId);
          if (!entry) return problem(`No planned post with id ${scheduleId}.`);
          const post = await client.readPost(entry.item_id);
          const preview = await client.previewPost(entry.item_id);
          const side = preview[entry.platform];
          return text({
            not_posted: "Call again with confirm: true to publish this on the public account.",
            platform: entry.platform,
            planned_for: entry.scheduled_for,
            title: post.title,
            caption: side.caption,
            pictures: post.assets.length,
            ...(side.blocker ? { blocker: side.blocker } : {}),
          });
        }
        return text(summarise(await client.postSchedule(scheduleId)));
      },
    },
  ];
}

/** Runs a tool with the guards around it: writing mode, then whatever the tool itself checks. */
export async function runTool(definition: ToolDefinition, context: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const missing = (definition.inputSchema.required ?? []).filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length) return problem(`${definition.name} needs ${missing.join(" and ")}.`);
  if (definition.writes && !context.canWrite) {
    return problem(`This server is in reading mode, so ${definition.name} is not available. Start it with LPL_MCP_WRITE=1 to allow changes.`);
  }
  try {
    return await definition.run(context, input);
  } catch (error) {
    if (error instanceof ApiError) return problem(error.message);
    return problem(error instanceof Error ? error.message : "That did not work.");
  }
}
