/**
 * The newsletters run on Colombo days. Sri Lanka keeps UTC+5:30 the year round, so the day and
 * the clock come from a shifted UTC reading rather than a time zone database.
 */

const colomboOffsetMs = 330 * 60_000;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

function shifted(date: Date): Date {
  return new Date(date.getTime() + colomboOffsetMs);
}

/** YYYY-MM-DD in Asia/Colombo. */
export function colomboDay(date: Date): string {
  return shifted(date).toISOString().slice(0, 10);
}

/** Minutes since Colombo midnight. */
export function colomboMinutes(date: Date): number {
  const local = shifted(date);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** "07:30" as minutes since midnight; anything else reads as the fallback. */
export function parseClock(value: string | null | undefined, fallback = "07:30"): number {
  const match = /^(\d{1,2}):(\d{2})$/u.exec((value ?? "").trim());
  const hours = match ? Number(match[1]) : Number.NaN;
  const minutes = match ? Number(match[2]) : Number.NaN;
  if (Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) return hours * 60 + minutes;
  return value === fallback ? 7 * 60 + 30 : parseClock(fallback, fallback);
}

/** True for a real calendar day written YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !dayPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** The day `delta` days after (or before) the given one. */
export function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Monday 14 September": the day as the mail words it. */
export function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return day;
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

const smallNumbers = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "three" for 3; larger counts stay as digits. */
export function countWords(count: number): string {
  return smallNumbers[count] ?? String(count);
}

/** "Keells, Cargills and Glomark": a list as a sentence names it. */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
