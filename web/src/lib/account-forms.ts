import { AccountApiError } from "./account-api.ts";

/**
 * Pure helpers behind the account forms: where to go after signing in, how a schema's issues
 * land under fields, and what to tell the person when the API says no. Nothing here touches
 * React or the DOM, so the tests run under plain node.
 */

export type FieldErrors = Record<string, string>;

type Issue = { path: PropertyKey[]; message: string };

/** The part of a zod schema the forms use; structural, so the site does not depend on zod itself. */
export type Validator<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } } };

export type Validation<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Zod's default wording is for developers; the shared schemas carry their own message where it matters, the rest is rewritten here. */
export function plainMessage(message: string): string {
  if (/^Too small/u.test(message)) return "Fill this in";
  if (/^Too big/u.test(message)) return "That is too long";
  if (/^Invalid (?:input|literal|value)/u.test(message)) return "That is not right";
  return message;
}

/** The first issue per field, keyed by the field's name; issues without a path land under "form". */
export function fieldErrors(issues: Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in errors)) errors[key] = plainMessage(issue.message);
  }
  return errors;
}

/** Runs a schema over a form's values; `extra` carries checks the schema does not know about (a repeated password). */
export function validate<T>(schema: Validator<T>, values: unknown, extra: FieldErrors = {}): Validation<T> {
  const result = schema.safeParse(values);
  const errors: FieldErrors = { ...(result.success ? {} : fieldErrors(result.error.issues)), ...extra };
  if (!result.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: result.data };
}

/** The error to show under a "type it again" field, or none when the two match. */
export function confirmError(password: string, confirm: string, field = "confirm"): FieldErrors {
  if (!password) return {};
  if (!confirm) return { [field]: "Type the new password again" };
  return password === confirm ? {} : { [field]: "The two passwords do not match" };
}

/** What to tell the person when a request failed: the API's code first, then its message, then a plain fallback. */
export function describeAccountError(error: unknown): string {
  if (error instanceof AccountApiError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "That email and password do not match.";
      case "ACCOUNT_LOCKED":
        return "Too many failed attempts. Wait fifteen minutes, then try again.";
      case "ACCOUNT_DISABLED":
        return "This account has been disabled. Send feedback if that seems wrong.";
      case "EMAIL_TAKEN":
        return "An account with that email already exists. Sign in instead, or reset its password.";
      case "TOKEN_INVALID":
        return "This link is no longer valid. It may have expired or already been used.";
      case "PASSWORD_WRONG":
        return "That password is not right.";
      case "PASSWORD_REQUIRED":
        return "Your password is needed for this.";
      case "EMAIL_NOT_VERIFIED":
        return "Verify your email address first.";
      case "RATE_LIMITED":
        return "Too many tries in a short time. Wait a few minutes and try again.";
      default:
        break;
    }
    if (error.status === 401) return "Your session has ended. Sign in again.";
    if (error.status === 429) return "Too many tries in a short time. Wait a few minutes and try again.";
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again in a moment.";
}

const authPages = /^\/account\/(?:login|register|forgot|reset)(?:[/?#]|$)/u;

/**
 * Where to send someone after they sign in: a path on this site, or the fallback. Anything that
 * could leave the origin (a scheme, a protocol-relative `//host`, a backslash trick) or loop back
 * into the sign-in pages is refused.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  const path = value.trim();
  if (!path || path.length > 2000) return fallback;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (/[\s\u0000-\u001f]/u.test(path)) return fallback;
  if (authPages.test(path)) return fallback;
  return path;
}

/** The page a person is on, as a `return_to` value. */
export function locationPath(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search}`;
}

/** A link to one of the account pages that brings the person back afterwards, when there is somewhere to bring them. */
export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  const target = safeReturnTo(returnTo);
  return target === "/" ? path : `${path}?return_to=${encodeURIComponent(target)}`;
}

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The first letter as it is written: a Sinhala or Tamil consonant keeps its vowel sign, a flag keeps both halves. */
function firstGrapheme(word: string): string {
  if (graphemes) {
    const first = graphemes.segment(word)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return [...word][0] ?? "";
}

/** Up to two letters for an avatar without a picture: the first letters of the first two words. */
export function initials(name: string, fallback = "?"): string {
  const letters = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(firstGrapheme)
    .join("")
    .toUpperCase();
  return letters || fallback;
}

/** "Chrome on Mac", "Safari on iPhone": enough to recognise a session, from its user agent string. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg(?:e|A|iOS)?\//u.test(userAgent) ? "Edge"
    : /OPR\//u.test(userAgent) ? "Opera"
      : /SamsungBrowser/u.test(userAgent) ? "Samsung Internet"
        : /(?:Firefox|FxiOS)\//u.test(userAgent) ? "Firefox"
          : /(?:Chrome|CriOS)\//u.test(userAgent) ? "Chrome"
            : /Safari\//u.test(userAgent) ? "Safari"
              : "A browser";
  const device = /iPhone/u.test(userAgent) ? "iPhone"
    : /iPad/u.test(userAgent) ? "iPad"
      : /Android/u.test(userAgent) ? "Android"
        : /Windows/u.test(userAgent) ? "Windows"
          : /Mac OS X|Macintosh/u.test(userAgent) ? "Mac"
            : /CrOS/u.test(userAgent) ? "Chromebook"
              : /Linux/u.test(userAgent) ? "Linux"
                : null;
  return device ? `${browser} on ${device}` : browser;
}
