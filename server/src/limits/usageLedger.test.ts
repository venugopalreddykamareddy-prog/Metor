import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageLedger, type QuotaLimits } from './usageLedger.ts';

const LIMITS: QuotaLimits = {
  perMinute: { requests: 3, audioSeconds: 1000 },
  perHour: { requests: 5, audioSeconds: 40 },
  perDay: { requests: 8, audioSeconds: 1000 },
};
const MINUTE = 60_000;

let dir: string;
let clock: number;
let ledgers: UsageLedger[] = [];
const now = () => clock;
const makeLedger = (path: string) => {
  const ledger = new UsageLedger(path, LIMITS, { now });
  ledgers.push(ledger);
  return ledger;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'metor-ledger-'));
  clock = Date.UTC(2026, 10, 24, 12, 0, 0);
});
afterEach(async () => {
  await Promise.all(ledgers.map((l) => l.flush()));
  ledgers = [];
  await rm(dir, { recursive: true, force: true });
});

const tenSeconds = { requests: 1, audioSeconds: 10 };

describe('UsageLedger', () => {
  it('enforces per-minute, per-hour, and per-day windows', () => {
    const ledger = makeLedger(join(dir, 'l.json'));
    expect([1, 2, 3].map(() => ledger.reserve({ requests: 1, audioSeconds: 1 }))).toEqual([true, true, true]);
    expect(ledger.reserve({ requests: 1, audioSeconds: 1 })).toBe(false); // 4th in the same minute
    clock += MINUTE;
    expect(ledger.reserve({ requests: 1, audioSeconds: 1 })).toBe(true);
    expect(ledger.reserve({ requests: 1, audioSeconds: 1 })).toBe(true);
    expect(ledger.reserve({ requests: 1, audioSeconds: 1 })).toBe(false); // 6th in the hour
    clock += 60 * MINUTE;
    expect(ledger.usedInLast(60)).toEqual({ requests: 0, audioSeconds: 0 });
    expect(ledger.usedInLast(24 * 60)).toEqual({ requests: 5, audioSeconds: 5 });
  });

  it('refuses a request that would exceed audio seconds, and records nothing', () => {
    const ledger = makeLedger(join(dir, 'l.json'));
    expect(ledger.reserve(tenSeconds)).toBe(true);
    clock += MINUTE;
    expect(ledger.reserve({ requests: 1, audioSeconds: 31 })).toBe(false); // 41 > 40 per hour
    expect(ledger.usedInLast(60)).toEqual(tenSeconds);
  });

  it('survives a restart and forgets usage older than 24 h', async () => {
    const path = join(dir, 'nested', 'ledger.json');
    const first = makeLedger(path);
    first.reserve(tenSeconds);
    clock += MINUTE;
    first.reserve(tenSeconds);
    await first.flush();
    expect(JSON.parse(await readFile(path, 'utf8'))).toBeTypeOf('object');

    const second = makeLedger(path);
    await second.load();
    expect(second.usedInLast(60)).toEqual({ requests: 2, audioSeconds: 20 });
    clock += (24 * 60 - 1) * MINUTE; // the first bucket is now 24 h old, the second just inside
    expect(second.usedInLast(24 * 60)).toEqual({ requests: 1, audioSeconds: 10 });
  });

  it('starts empty when there is no file yet', async () => {
    const ledger = makeLedger(join(dir, 'missing.json'));
    await ledger.load();
    expect(ledger.usedInLast(24 * 60)).toEqual({ requests: 0, audioSeconds: 0 });
  });
});
