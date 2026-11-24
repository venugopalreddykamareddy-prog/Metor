import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** `units` is whatever the provider meters besides requests: audio seconds for Whisper, tokens for chat. */
export interface Usage {
  requests: number;
  units: number;
}

export interface QuotaLimits {
  perMinute: Usage;
  perHour: Usage;
  perDay: Usage;
}

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/**
 * Free-tier usage for one metered resource, in one-minute buckets for the last 24 h, saved to a JSON file so
 * limits survive restarts (ARCHITECTURE §11.1). Rolling windows are conservative whatever time
 * the provider resets its counters. One server process only.
 */
export class UsageLedger {
  private buckets = new Map<number, Usage>();
  private writing: Promise<void> = Promise.resolve();
  private readonly path: string;
  private readonly limits: QuotaLimits;
  private readonly now: () => number;
  private readonly onWriteError: (err: unknown) => void;

  constructor(
    path: string,
    limits: QuotaLimits,
    opts: { now?: () => number; onWriteError?: (err: unknown) => void } = {},
  ) {
    this.path = path;
    this.limits = limits;
    this.now = opts.now ?? Date.now;
    this.onWriteError = opts.onWriteError ?? (() => {});
  }

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, Usage>;
      this.buckets = new Map(Object.entries(data).map(([minute, usage]) => [Number(minute), usage]));
      this.prune();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /**
   * Records the usage up front if it fits every window; returns false (and records nothing) if not.
   * Usage is charged before the request so a crash or timeout can never undercount.
   */
  reserve(usage: Usage): boolean {
    return this.reserveTicket(usage) !== null;
  }

  /** Like reserve(), but returns the bucket it was charged to so settle() can correct it later. */
  reserveTicket(usage: Usage): number | null {
    this.prune();
    const minute = Math.floor(this.now() / MINUTE);
    const windows: [number, Usage][] = [
      [1, this.limits.perMinute],
      [60, this.limits.perHour],
      [DAY_MINUTES, this.limits.perDay],
    ];
    for (const [minutes, limit] of windows) {
      const used = this.sum(minute - minutes + 1);
      if (used.requests + usage.requests > limit.requests) return null;
      if (used.units + usage.units > limit.units) return null;
    }
    const bucket = this.buckets.get(minute) ?? { requests: 0, units: 0 };
    bucket.requests += usage.requests;
    bucket.units += usage.units;
    this.buckets.set(minute, bucket);
    this.save();
    return minute;
  }

  /**
   * Replaces a reservation's estimate with the provider's reported usage. Only call this when the
   * provider actually reported usage; otherwise the conservative reservation stands.
   */
  settle(ticket: number, reservedUnits: number, actualUnits: number): void {
    const bucket = this.buckets.get(ticket);
    if (!bucket) return; // older than 24 h already
    bucket.units = Math.max(0, bucket.units + actualUnits - reservedUnits);
    this.save();
  }

  /** Usage in the last `minutes` minutes. */
  usedInLast(minutes: number): Usage {
    return this.sum(Math.floor(this.now() / MINUTE) - minutes + 1);
  }

  /** Resolves once pending writes are on disk. */
  flush(): Promise<void> {
    return this.writing;
  }

  private sum(fromMinute: number): Usage {
    const total = { requests: 0, units: 0 };
    for (const [minute, usage] of this.buckets) {
      if (minute >= fromMinute) {
        total.requests += usage.requests;
        total.units += usage.units;
      }
    }
    return total;
  }

  private prune(): void {
    const oldest = Math.floor(this.now() / MINUTE) - DAY_MINUTES;
    for (const minute of this.buckets.keys()) if (minute <= oldest) this.buckets.delete(minute);
  }

  /** Writes are queued so they never interleave; temp file + rename keeps the file whole. */
  private save(): void {
    const json = JSON.stringify(Object.fromEntries(this.buckets));
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, json);
      await rename(tmp, this.path);
    }).catch(this.onWriteError);
  }
}
