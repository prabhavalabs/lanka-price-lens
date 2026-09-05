/**
 * How many people are on the site right now, without cookies or accounts: the page sends a
 * random id it keeps for the tab every minute, and a visitor counts while their last beat is
 * within the window. Held in memory; a restart simply starts the count again.
 */
export class Presence {
  private readonly seen = new Map<string, number>();
  private readonly windowMs: number;
  private readonly capacity: number;

  constructor(windowMs = 3 * 60_000, capacity = 50_000) {
    this.windowMs = windowMs;
    this.capacity = capacity;
  }

  /** Records a beat and returns how many are online, the caller included. */
  beat(id: string, now = Date.now()): number {
    this.prune(now);
    if (this.seen.size >= this.capacity && !this.seen.has(id)) return this.count(now);
    this.seen.set(id, now);
    return this.seen.size;
  }

  count(now = Date.now()): number {
    this.prune(now);
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [id, stamp] of this.seen) if (now - stamp > this.windowMs) this.seen.delete(id);
  }
}

export const presenceIdPattern = /^[a-z0-9-]{8,64}$/u;
