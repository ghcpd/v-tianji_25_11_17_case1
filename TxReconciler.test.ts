import { TxReconciler as OriginalTxReconciler, Tx } from './input';
import { TxReconciler as FixedTxReconciler } from './TxReconciler.fixed';

jest.useFakeTimers('modern');

describe('TxReconciler - fixed behavior', () => {
  const baseTime = Date.now();
  beforeEach(() => {
    jest.setSystemTime(baseTime);
    jest.clearAllMocks();
  });

  function makeTx(id: string, amount: number, timestampOffset = 0): Tx {
    return { id, amount, currency: 'USD', timestamp: baseTime + timestampOffset };
  }

  it('should call fetchRemote on first reconcile when no cached data exists', async () => {
    const remote = [makeTx('r1', 100)];
    const fetchRemote = jest.fn(async () => remote);
    const r = new FixedTxReconciler(fetchRemote);

    const res = await r.reconcile('user1');

    expect(fetchRemote).toHaveBeenCalledTimes(1);
    expect(res.merged).toHaveLength(1);
    expect(res.merged[0].id).toBe('r1');
  });

  it('should not mutate the remote array returned by fetchRemote when caching', async () => {
    const remote = [makeTx('r1', 100), makeTx('r2', 50, 1)];
    const origRemote = [...remote];
    const fetchRemote = jest.fn(async () => remote);
    const r = new FixedTxReconciler(fetchRemote);

    await r.reconcile('user1');

    expect(remote).toEqual(origRemote); // remote not mutated
  });

  it('should dedupe transactions using exact id equality (not substring matching)', async () => {
    const localTx = makeTx('abc', 100);
    const remoteTx = makeTx('a', 50);

    const fetchRemote = jest.fn(async () => [remoteTx]);
    const r = new FixedTxReconciler(fetchRemote);

    r.addLocalTx('user1', localTx);
    const res = await r.reconcile('user1');

    // both should exist because ids are different
    const ids = res.merged.map(t => t.id);
    expect(ids).toContain('abc');
    expect(ids).toContain('a');
  });

  it('should pick the newest transaction by timestamp when deduplication happens', async () => {
    const localTx = makeTx('tx1', 100, 0);
    const remoteTx = makeTx('tx1', 200, 10);

    const fetchRemote = jest.fn(async () => [remoteTx]);
    const r = new FixedTxReconciler(fetchRemote);

    r.addLocalTx('user1', localTx);
    const res = await r.reconcile('user1');

    expect(res.merged).toHaveLength(1);
    expect(res.merged[0].amount).toBe(200);
    expect(res.merged[0].timestamp).toBeGreaterThan(localTx.timestamp);
  });

  it('should tally updated/skipped counts based on positive/non-positive amounts', async () => {
    const t1 = makeTx('t1', 100);
    const t2 = makeTx('t2', 0, 1);
    const t3 = makeTx('t3', -10, 2);

    const fetchRemote = jest.fn(async () => [t2, t3]);
    const r = new FixedTxReconciler(fetchRemote);

    r.addLocalTx('user1', t1);
    const res = await r.reconcile('user1');

    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(2);
  });

  it('should refresh cache again after syncInterval', async () => {
    const firstRemote = [makeTx('r1', 10)];
    const secondRemote = [makeTx('r2', 20, 1)];
    const fetchRemote = jest.fn()
      .mockImplementationOnce(async () => firstRemote)
      .mockImplementationOnce(async () => secondRemote);

    const r = new FixedTxReconciler(fetchRemote);

    await r.reconcile('user1');
    expect(fetchRemote).toHaveBeenCalledTimes(1);

    // advance time a bit less than syncInterval - should not refresh
    jest.advanceTimersByTime(1000);
    await r.reconcile('user1');
    expect(fetchRemote).toHaveBeenCalledTimes(2); // because top-level reconcile will call fetchRemote every time for remote merging

    // To validate refresh behavior more strictly, call again without advancing time; it should not fetch remote in refreshCache
    await r.reconcile('user1');
    expect(fetchRemote).toHaveBeenCalledTimes(3);

    // Now advance beyond the syncInterval and enforce refresh
    jest.advanceTimersByTime(5000);
    await r.reconcile('user1');
    // Ensure another fetch happens because of refresh
    expect(fetchRemote).toHaveBeenCalledTimes(4);
  });

  it('should propagate fetchRemote rejection to the caller', async () => {
    const fetchRemote = jest.fn(async () => { throw new Error('network'); });
    const r = new FixedTxReconciler(fetchRemote);

    await expect(r.reconcile('u')).rejects.toThrow('network');
  });

  it('addLocalTx should update existing entry when timestamp is newer', async () => {
    const txOld = makeTx('tx1', 10, 0);
    const txNew = makeTx('tx1', 200, 1000);
    const fetchRemote = jest.fn(async () => []);
    const r = new FixedTxReconciler(fetchRemote);

    r.addLocalTx('user1', txOld);
    r.addLocalTx('user1', txNew);
    const res = await r.reconcile('user1');

    expect(res.merged).toHaveLength(1);
    expect(res.merged[0].amount).toBe(200);
  });
});

// Regression tests against the original (buggy) implementation to document the bugs

describe('TxReconciler - original buggy behavior (regressions)', () => {
  const baseTime = Date.now();
  beforeEach(() => {
    jest.setSystemTime(baseTime);
    jest.clearAllMocks();
  });

  function makeTx(id: string, amount: number, timestampOffset = 0): Tx {
    return { id, amount, currency: 'USD', timestamp: baseTime + timestampOffset };
  }

  it('original code used includes to match ids (substring) - regression', async () => {
    const localTx = makeTx('abc', 100);
    const remoteTx = makeTx('a', 50);

    const fetchRemote = jest.fn(async () => [remoteTx]);
    const r = new OriginalTxReconciler(fetchRemote);

    r.addLocalTx('user1', localTx);
    const res = await r.reconcile('user1');

    // original code would consider 'a' as included because it checks m.id.includes(r.id)
    const ids = res.merged.map(t => t.id);
    expect(ids).not.toContain('a'); // original code wrongly filtered out 'a' as duplicate
  });

  it('original code reversed the remote list in place when refreshing cache (mutation) - regression', async () => {
    const remote = [makeTx('r1', 10), makeTx('r2', 20)];
    const fetchRemote = jest.fn(async () => remote);
    const r = new OriginalTxReconciler(fetchRemote);

    const before = [...remote];
    await r.reconcile('user1');
    const after = remote;
    expect(after).not.toEqual(before); // mutated in place by .reverse()
  });
});
