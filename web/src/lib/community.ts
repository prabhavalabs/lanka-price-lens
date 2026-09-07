/**
 * When to invite a visitor to the community. The invite is one small card, shown once the visitor
 * has looked around (a few pages, or a little while on the site), never in the first moments, and
 * not again for a month after "not now". Someone who clicked through never sees it again.
 */

export type InviteMemory = { dismissedAt?: number; joinedAt?: number };
export type Visit = { pageViews: number; startedAt: number };

export const inviteAfterPageViews = 3;
export const inviteAfterMs = 45_000;
export const inviteQuietMs = 10_000;
export const inviteCooldownMs = 30 * 24 * 60 * 60 * 1000;

export function shouldInvite(memory: InviteMemory, visit: Visit, now: number): boolean {
  if (memory.joinedAt) return false;
  if (memory.dismissedAt && now - memory.dismissedAt < inviteCooldownMs) return false;
  const elapsed = now - visit.startedAt;
  if (elapsed < inviteQuietMs) return false;
  return visit.pageViews >= inviteAfterPageViews || elapsed >= inviteAfterMs;
}

export const inviteMemoryKey = "pricelens.community.v1";

export function readInviteMemory(storage: Pick<Storage, "getItem"> | undefined): InviteMemory {
  try {
    const raw = storage?.getItem(inviteMemoryKey);
    const parsed = raw ? (JSON.parse(raw) as InviteMemory) : {};
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function writeInviteMemory(storage: Pick<Storage, "setItem"> | undefined, memory: InviteMemory): void {
  try {
    storage?.setItem(inviteMemoryKey, JSON.stringify(memory));
  } catch {
    // Private mode or a full store: the invite may show again; nothing else depends on it.
  }
}
