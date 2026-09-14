import { isMailKind, mailDefaults, mailFieldNames, mailKinds, mailPlaceholders, type MailFields, type MailKind, type MailTemplate } from "./defaults.ts";
import { defaultMarkUrl, renderLayout, type ContentBlock, type RenderedMail } from "./layout.ts";

/**
 * Templates are the defaults in code with an optional edited row per kind in `mail_template`
 * (created by foundry's migrations). The store keeps the rows in memory and forgets them on
 * every write; `renderMail` fills a kind's fields with the caller's values, escapes them
 * through the layout, and answers subject, html, and text. Unknown placeholders render empty
 * and a blank field falls back to its default, so an edit can never leave a mail without a
 * subject or a reason line.
 */

/** The part of better-sqlite3 the store uses, so any handle with that shape will do. */
export type TemplateDatabase = {
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
};

export type TemplateStore = {
  list: () => MailTemplate[];
  get: (kind: MailKind) => MailTemplate;
  /** Saves the given fields over the current ones; a field equal to its default is stored blank, and a row with nothing left is removed. */
  put: (kind: MailKind, fields: Partial<MailFields>, by: string | null) => MailTemplate;
  reset: (kind: MailKind) => MailTemplate;
};

export const templateSchema = `
  CREATE TABLE IF NOT EXISTS mail_template (
    kind TEXT PRIMARY KEY,
    fields_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  ) STRICT;
`;

type Row = { kind: string; fields_json: string; updated_at: string; updated_by: string | null };

/** The blank fields: nothing overridden. */
export function blankFields(): MailFields {
  return { subject: "", preheader: "", heading: "", intro: "", outro: "", button_label: "", reason: "" };
}

/** Reads a stored or posted object into fields; unknown keys are dropped and anything that is not a string counts as blank. */
export function readFields(input: unknown): Partial<MailFields> {
  const fields: Partial<MailFields> = {};
  if (typeof input !== "object" || input === null) return fields;
  for (const field of mailFieldNames) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string") fields[field] = value;
  }
  return fields;
}

/** The effective fields: overrides where they say something, defaults elsewhere. */
export function resolveFields(kind: MailKind, overrides: Partial<MailFields> | undefined): MailFields {
  const defaults = mailDefaults[kind];
  const fields = { ...defaults };
  if (overrides) for (const field of mailFieldNames) {
    const value = overrides[field];
    if (typeof value === "string" && value.trim()) fields[field] = value;
  }
  return fields;
}

/** Trims every override and blanks those that repeat the default, so `edited` means the words differ. */
function normaliseOverrides(kind: MailKind, overrides: Partial<MailFields>): MailFields {
  const defaults = mailDefaults[kind];
  const stored = blankFields();
  for (const field of mailFieldNames) {
    const value = (overrides[field] ?? "").trim();
    stored[field] = value && value !== defaults[field] ? value : "";
  }
  return stored;
}

function isEmpty(fields: MailFields): boolean {
  return mailFieldNames.every((field) => !fields[field]);
}

export function createTemplateStore(database: TemplateDatabase): TemplateStore {
  let cache: Map<MailKind, Row> | null = null;
  const rows = (): Map<MailKind, Row> => {
    if (!cache) {
      cache = new Map();
      for (const row of database.prepare("SELECT kind, fields_json, updated_at, updated_by FROM mail_template").all() as Row[]) {
        if (isMailKind(row.kind)) cache.set(row.kind, row);
      }
    }
    return cache;
  };
  const templateOf = (kind: MailKind): MailTemplate => {
    const row = rows().get(kind);
    let overrides: Partial<MailFields> = {};
    if (row) {
      try {
        overrides = readFields(JSON.parse(row.fields_json));
      } catch {
        overrides = {};
      }
    }
    return { kind, fields: resolveFields(kind, overrides), defaults: mailDefaults[kind], placeholders: mailPlaceholders[kind], edited: row !== undefined, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null };
  };
  const store: TemplateStore = {
    list: () => mailKinds.map(templateOf),
    get: templateOf,
    put: (kind, fields, by) => {
      const current = rows().get(kind);
      let currentOverrides: Partial<MailFields> = {};
      if (current) {
        try {
          currentOverrides = readFields(JSON.parse(current.fields_json));
        } catch {
          currentOverrides = {};
        }
      }
      const stored = normaliseOverrides(kind, { ...currentOverrides, ...fields });
      if (isEmpty(stored)) {
        database.prepare("DELETE FROM mail_template WHERE kind = ?").run(kind);
      } else {
        database
          .prepare("INSERT INTO mail_template (kind, fields_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET fields_json = excluded.fields_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
          .run(kind, JSON.stringify(stored), new Date().toISOString(), by);
      }
      cache = null;
      return templateOf(kind);
    },
    reset: (kind) => {
      database.prepare("DELETE FROM mail_template WHERE kind = ?").run(kind);
      cache = null;
      return templateOf(kind);
    },
  };
  return store;
}

/** What fills a kind's placeholders and blocks. */
export type MailData = {
  /** Placeholder values by name; `link` is also where the button goes. Numbers are written as they are. */
  values: Record<string, string | number | null | undefined>;
  /** Recipe cards or deal rows between the intro and the outro. */
  blocks?: ContentBlock[] | undefined;
  /** A one-click unsubscribe link for the footer; newsletters only. */
  unsubscribeUrl?: string | null | undefined;
};

export type RenderMailOptions = {
  /** Overrides from the template store or a preview; blank fields fall back to the defaults. */
  fields?: Partial<MailFields> | undefined;
  markUrl?: string | undefined;
  replyTo?: string | undefined;
  /** The site's origin; when it is an https address and no mark URL is given, the mark is fetched from it. */
  siteOrigin?: string | null | undefined;
};

const placeholderPattern = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/giu;

/** Writes the values into a field's text; an unknown placeholder renders empty. */
export function fillPlaceholders(text: string, values: MailData["values"]): string {
  return text.replace(placeholderPattern, (_match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === null || value === undefined ? "" : String(value);
  });
}

/** Paragraphs from a field: split on blank lines, trimmed, empties dropped. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/gu, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** The mark's address for a site: the site's own when it is served over https, the production one otherwise. */
export function markUrlFor(siteOrigin: string | null | undefined): string {
  const origin = siteOrigin?.trim().replace(/\/+$/u, "");
  return origin?.startsWith("https://") ? `${origin}/mark.png` : defaultMarkUrl;
}

export function renderMail(kind: MailKind, data: MailData, options: RenderMailOptions = {}): RenderedMail {
  const fields = resolveFields(kind, options.fields);
  const fill = (field: keyof MailFields) => fillPlaceholders(fields[field], data.values);
  const link = data.values.link;
  const label = fill("button_label").trim();
  const button = label && typeof link === "string" && link.trim() ? { label, url: link.trim() } : null;
  return renderLayout(
    {
      subject: fill("subject").replace(/\s+/gu, " ").trim(),
      preheader: fill("preheader").replace(/\s+/gu, " ").trim(),
      headline: fill("heading").replace(/\s+/gu, " ").trim(),
      intro: paragraphsOf(fill("intro")),
      blocks: data.blocks ?? [],
      outro: paragraphsOf(fill("outro")),
      button,
      reason: fill("reason").replace(/\s+/gu, " ").trim(),
      unsubscribeUrl: data.unsubscribeUrl ?? null,
    },
    { markUrl: options.markUrl ?? markUrlFor(options.siteOrigin), ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}) },
  );
}
