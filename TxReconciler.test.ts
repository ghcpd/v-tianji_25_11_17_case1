import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TxReconciler, Tx } from './TxReconciler.fixed';

const createTx = (id: string, ts: number, amount = 10): Tx => ({ id, amount, currency: 'USD', timestamp: ts });

describe('TxReconciler (fixed)', () => {
  let remoteCalls = 0;
  let fetchRemote: (userId: string) => Promise<Tx[]>;

  beforeEach(() => {
    remoteCalls = 0;
    fetchRemote = vi.fn().mockImplementation(async (userId: string) => {
      remoteCalls++;
      if (userId === 'u1') {
        return [createTx('r1', 1000), createTx('r2', 3000)];
      }
      return [];
    });
  });

  it('should add remote txs that are not duplicates using exact id match', async () => {
    const reconciler = new TxReconciler(fetchRemote);
    // add a local tx with id that is substring of remote
    reconciler.addLocalTx('u1', createTx('r', 2000));

    const result = await reconciler.reconcile('u1');

    // 'r1' and 'r2' should be present even though there is local id 'r' (substring)
    expect(result.merged.some(t => t.id === 'r1')).toBe(true);
    expect(result.merged.some(t => t.id === 'r2')).toBe(true);
  });

  it('should count updated/skipped based on duplicates in remote merge', async () => {
    const reconciler = new TxReconciler(fetchRemote);
    reconciler.addLocalTx('u1', createTx('r1', 1000));

    const result = await reconciler.reconcile('u1');

    expect(result.skipped).toBe(1); // r1 existed locally
    expect(result.updated).toBe(1); // r2 added
  });

  it('should sort merged transactions by timestamp', async () => {
    const local: Tx[] = [createTx('a', 5000), createTx('b', 2000)];
    const remote: Tx[] = [createTx('c', 3000)];

    const fetch = vi.fn().mockResolvedValue(remote);
    const reconciler = new TxReconciler(fetch);
    reconciler.addLocalTx('u2', local[0]);
    reconciler.addLocalTx('u2', local[1]);

    const res = await reconciler.reconcile('u2');

    // merged should be sorted by timestamp ascending
    const ids = res.merged.map(t => t.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('should refresh cache when stale and update lastSync', async () => {
    const fetch = vi.fn().mockResolvedValue([createTx('remote', 9000)]);
    const reconciler = new TxReconciler(fetch);

    // Force lastSync to far in the past to ensure stale
    (reconciler as any).lastSync = 0;

    await reconciler.reconcile('uX');

    // fetch should have been called at least once
    expect(fetch).toHaveBeenCalled();
    // lastSync should be updated
    expect((reconciler as any).lastSync).toBeGreaterThan(0);
  });

  it('should not conflate ids using substring inclusion', async () => {
    const fetch = vi.fn().mockResolvedValue([createTx('123', 1), createTx('23', 2)]);
    const reconciler = new TxReconciler(fetch);

    reconciler.addLocalTx('u3', createTx('123', 1));

    const res = await reconciler.reconcile('u3');

    // both remote txs: 123 is duplicate, 23 is distinct
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.merged.some(t => t.id === '23')).toBe(true);
  });
});
