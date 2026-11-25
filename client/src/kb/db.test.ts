import { afterEach, describe, expect, it } from 'vitest';
import { deleteDatabase } from './db.ts';

// IndexedDB isn't in Node: a stub request lets the test fire success, error or blocked.
type Req = { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; error: Error | null };
function stubIndexedDb() {
  const reqs: Req[] = [];
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    deleteDatabase: () => {
      const r: Req = { error: null };
      reqs.push(r);
      return r;
    },
  };
  return reqs;
}
afterEach(() => delete (globalThis as { indexedDB?: unknown }).indexedDB);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('deleteDatabase', () => {
  it('resolves only when the database is really deleted', async () => {
    const reqs = stubIndexedDb();
    const p = deleteDatabase(50);
    await tick();
    reqs[0]?.onsuccess?.();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects when another tab keeps it blocked', async () => {
    const reqs = stubIndexedDb();
    const p = deleteDatabase(20);
    await tick();
    reqs[0]?.onblocked?.();
    await expect(p).rejects.toThrow(/Close other Metor tabs/);
  });

  it('still succeeds when the other tab lets go in time', async () => {
    const reqs = stubIndexedDb();
    const p = deleteDatabase(200);
    await tick();
    reqs[0]?.onblocked?.();
    reqs[0]?.onsuccess?.();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects when deletion fails', async () => {
    const reqs = stubIndexedDb();
    const p = deleteDatabase(50);
    await tick();
    const r = reqs[0];
    if (r) r.error = new Error('QuotaExceeded');
    r?.onerror?.();
    await expect(p).rejects.toThrow('QuotaExceeded');
  });
});
