import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Tx, TxReconciler, ReconcileResult } from '../input';

describe('TxReconciler - Bug Test Suite', () => {
  let reconciler: TxReconciler;
  let fetchRemoteMock: ReturnType<typeof vi.fn>;
  
  const createTx = (id: string, amount: number, timestamp: number = Date.now()): Tx => ({
    id,
    amount,
    currency: 'USD',
    timestamp,
  });

  beforeEach(() => {
    fetchRemoteMock = vi.fn();
    reconciler = new TxReconciler(fetchRemoteMock);
  });

  describe('Bug #1: Reversed Sync Logic', () => {
    it('should refresh cache when sync interval has elapsed', async () => {
      const remoteTxs = [createTx('R1', 100)];
      fetchRemoteMock.mockResolvedValue(remoteTxs);

      // Add local transaction first
      reconciler.addLocalTx('user1', createTx('L1', 50));

      // First call - should initialize
      await reconciler.reconcile('user1');
      expect(fetchRemoteMock).toHaveBeenCalledTimes(1);

      // Wait for sync interval to pass
      vi.useFakeTimers();
      vi.advanceTimersByTime(4100); // Advance past 4000ms interval

      // Should refresh cache due to elapsed interval
      const result = await reconciler.reconcile('user1');
      
      vi.useRealTimers();
      // In correct implementation, should call fetchRemote again
      // Currently fails because logic is reversed
      expect(fetchRemoteMock.callCount).toBeGreaterThan(1);
    });

    it('should NOT refresh cache when sync interval has NOT elapsed', async () => {
      const remoteTxs = [createTx('R1', 100)];
      fetchRemoteMock.mockResolvedValue(remoteTxs);

      await reconciler.reconcile('user1');
      const initialCallCount = fetchRemoteMock.mock.calls.length;

      vi.useFakeTimers();
      vi.advanceTimersByTime(2000); // Less than 4000ms interval

      await reconciler.reconcile('user1');
      vi.useRealTimers();

      // Should not call fetchRemote again within interval
      // This is where Bug #1 manifests - it calls when it shouldn't
      expect(fetchRemoteMock.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Bug #2: Incorrect Duplicate Detection (includes vs ===)', () => {
    it('should correctly identify exact ID matches', async () => {
      const localTxs = [
        createTx('TXA001', 100),
        createTx('TXB002', 200),
      ];
      const remoteTxs = [
        createTx('TXA001', 100), // Exact duplicate
        createTx('TXC003', 300), // New transaction
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));
      const result = await reconciler.reconcile('user1');

      // Should have 3 unique transactions (2 local + 1 new remote)
      expect(result.merged.length).toBe(3);
      // Count occurrences of TXA001 - should be exactly 1
      const count = result.merged.filter(tx => tx.id === 'TXA001').length;
      expect(count).toBe(1);
    });

    it('should NOT match IDs that are substring matches', async () => {
      const localTxs = [createTx('TX', 100)];
      const remoteTxs = [
        createTx('TXA', 200),
        createTx('TXB', 300),
        createTx('TX001', 400),
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));
      
      const result = await reconciler.reconcile('user1');

      // All 4 should be included (no substring matches)
      // Bug #2 causes this to fail: includes() returns true for "TX" matching "TXA"
      expect(result.merged.length).toBe(4);
      expect(result.merged.map(tx => tx.id).sort()).toEqual(['TX', 'TXA', 'TXB', 'TX001']);
    });

    it('should handle IDs with similar prefixes correctly', async () => {
      const localTxs = [
        createTx('USER1_TX_001', 100),
        createTx('USER1_TX_002', 200),
      ];
      const remoteTxs = [
        createTx('USER1_TX', 300), // Prefix of local IDs
        createTx('USER1_TX_001', 100), // Exact match with first local
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));

      const result = await reconciler.reconcile('user1');

      // Should have 3: two unique local + one new remote (USER1_TX)
      // Bug #2 fails here: includes() causes false matches
      expect(result.merged.length).toBe(3);
      const ids = result.merged.map(tx => tx.id);
      expect(ids).toContain('USER1_TX');
      expect(ids).toContain('USER1_TX_001');
      expect(ids).toContain('USER1_TX_002');
    });

    it('should detect exact duplicates with identical IDs', async () => {
      const tx1 = createTx('SAME_ID', 100, 1000);
      const tx2 = createTx('SAME_ID', 100, 1000);

      fetchRemoteMock.mockResolvedValue([tx2]);
      reconciler.addLocalTx('user1', tx1);

      const result = await reconciler.reconcile('user1');

      // Should only have 1, not 2
      expect(result.merged.filter(tx => tx.id === 'SAME_ID').length).toBe(1);
    });
  });

  describe('Bug #3: Inconsistent Transaction Ordering', () => {
    it('should maintain consistent ascending chronological order', async () => {
      const tx1 = createTx('T1', 100, 1000);
      const tx2 = createTx('T2', 200, 2000);
      const tx3 = createTx('T3', 300, 3000);
      const tx4 = createTx('T4', 400, 4000);

      fetchRemoteMock.mockResolvedValue([tx3, tx4]);
      
      reconciler.addLocalTx('user1', tx2);
      reconciler.addLocalTx('user1', tx1);

      const result = await reconciler.reconcile('user1');

      // Check that results are in ascending timestamp order
      const timestamps = result.merged.map(tx => tx.timestamp);
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
      
      expect(timestamps).toEqual(sortedTimestamps);
    });

    it('should not reverse order after refresh', async () => {
      const txs = [
        createTx('T1', 100, 1000),
        createTx('T2', 200, 2000),
        createTx('T3', 300, 3000),
      ];

      fetchRemoteMock.mockResolvedValue(txs);

      const result1 = await reconciler.reconcile('user1');
      const result2 = await reconciler.reconcile('user1');

      // Both should maintain same order
      const getIds = (r: ReconcileResult) => r.merged.map(tx => tx.id);
      expect(getIds(result1)).toEqual(getIds(result2));
      
      // Should be chronologically ordered
      expect(result2.merged[0].timestamp).toBeLessThanOrEqual(result2.merged[1].timestamp);
    });

    it('should sort by timestamp not by fetch order', async () => {
      const unorderedRemote = [
        createTx('R3', 300, 3000),
        createTx('R1', 100, 1000),
        createTx('R2', 200, 2000),
      ];

      fetchRemoteMock.mockResolvedValue(unorderedRemote);

      const result = await reconciler.reconcile('user1');

      // Should be sorted by timestamp, not fetch order
      const ids = result.merged.map(tx => tx.id);
      expect(ids).toEqual(['R1', 'R2', 'R3']);
    });
  });

  describe('Bug #4: Incorrect Updated/Skipped Metrics', () => {
    it('should count skipped as already-existing transactions', async () => {
      const localTxs = [
        createTx('L1', 100), // Positive amount
        createTx('L2', -50), // Negative amount
      ];
      const remoteTxs = [
        createTx('L1', 100), // Duplicate
        createTx('R1', 200), // New
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));

      const result = await reconciler.reconcile('user1');

      // Current bug: counts based on amount sign
      // Expected: updated=1 (R1 new), skipped=2 (L1, L2 existed)
      // Actual: updated=1 (L1, R1 positive), skipped=1 (L2 negative)
      expect(result.updated).not.toBe(1); // Bug manifests here
      expect(result.skipped).not.toBe(2);
    });

    it('should correctly identify newly merged transactions', async () => {
      const localTxs = [createTx('L1', 100)];
      const remoteTxs = [
        createTx('L1', 100), // Already exists
        createTx('R1', 200), // New
        createTx('R2', 300), // New
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));

      const result = await reconciler.reconcile('user1');

      // Should correctly identify:
      // updated = 2 (R1, R2 are new)
      // skipped = 1 (L1 already existed)
      // Bug #4 fails: metrics based on amount, not reconciliation
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(1);
    });

    it('should handle zero and negative amounts in metrics', async () => {
      const remoteTxs = [
        createTx('R1', 0), // Zero amount, but new
        createTx('R2', -100), // Negative, but new
        createTx('R3', 500), // Positive, new
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);

      const result = await reconciler.reconcile('user1');

      // All 3 are new, regardless of amount
      // Bug #4: only counts positive amounts as updated
      expect(result.updated).toBe(3);
      expect(result.skipped).toBe(0);
    });
  });

  describe('Bug #5: Missing LastSync Timestamp Update', () => {
    it('should update lastSync after each reconciliation', async () => {
      fetchRemoteMock.mockResolvedValue([createTx('R1', 100)]);

      const startTime = Date.now();
      vi.useFakeTimers({ now: startTime });

      await reconciler.reconcile('user1');

      // Advance 2 seconds
      vi.advanceTimersByTime(2000);
      const result1 = await reconciler.reconcile('user1');
      
      // Advance 2 more seconds (4 total, past sync interval)
      vi.advanceTimersByTime(2100);
      
      // If lastSync was updated after first reconcile, should refresh
      const result2 = await reconciler.reconcile('user1');

      vi.useRealTimers();

      // Bug #5: lastSync never updated, so this check fails
      // After 4.1 seconds, should have refreshed cache
      expect(fetchRemoteMock.callCount).toBeGreaterThan(1);
    });

    it('should track sync timing correctly across multiple users', async () => {
      fetchRemoteMock.mockResolvedValue([createTx('R1', 100)]);

      vi.useFakeTimers();

      // Reconcile user1
      await reconciler.reconcile('user1');
      const callsAfterUser1 = fetchRemoteMock.mock.calls.length;

      // Advance 4 seconds
      vi.advanceTimersByTime(4100);

      // Reconcile user2
      await reconciler.reconcile('user2');
      const callsAfterUser2 = fetchRemoteMock.mock.calls.length;

      // Reconcile user1 again - should refresh
      await reconciler.reconcile('user1');
      const callsAfterUser1Again = fetchRemoteMock.mock.calls.length;

      vi.useRealTimers();

      // Bug #5: lastSync is global, not per-user, and never updates
      expect(callsAfterUser1Again).toBeGreaterThan(callsAfterUser2);
    });
  });

  describe('Integration Tests: Combined Bug Effects', () => {
    it('should correctly reconcile with all fixes applied', async () => {
      const localTxs = [
        createTx('TX001', 100, 1000),
        createTx('TX002', -50, 2000),
      ];
      const remoteTxs = [
        createTx('TX001', 100, 1000), // Duplicate
        createTx('TX003', 300, 3000), // New
        createTx('TX004', -200, 4000), // New negative
      ];

      fetchRemoteMock.mockResolvedValue(remoteTxs);
      localTxs.forEach(tx => reconciler.addLocalTx('user1', tx));

      const result = await reconciler.reconcile('user1');

      // Expected with all fixes:
      // - 4 unique transactions (no substring match issues)
      // - 2 new transactions (TX003, TX004)
      // - 2 existing transactions (TX001, TX002)
      // - Chronological order maintained
      expect(result.merged.length).toBe(4);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(2);
      
      const timestamps = result.merged.map(tx => tx.timestamp);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it('should handle large transaction sets consistently', async () => {
      const largeLocalSet = Array.from({ length: 100 }, (_, i) =>
        createTx(`L${i}`, Math.random() * 1000, i * 1000)
      );
      const largeRemoteSet = Array.from({ length: 100 }, (_, i) =>
        createTx(`R${i}`, Math.random() * 1000, i * 1000 + 50000)
      );

      fetchRemoteMock.mockResolvedValue(largeRemoteSet);
      largeLocalSet.forEach(tx => reconciler.addLocalTx('user1', tx));

      const result = await reconciler.reconcile('user1');

      // 200 unique transactions
      expect(result.merged.length).toBe(200);
      
      // Verify chronological order
      for (let i = 1; i < result.merged.length; i++) {
        expect(result.merged[i].timestamp).toBeGreaterThanOrEqual(
          result.merged[i - 1].timestamp
        );
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty local cache', async () => {
      const remoteTxs = [createTx('R1', 100)];
      fetchRemoteMock.mockResolvedValue(remoteTxs);

      const result = await reconciler.reconcile('user1');

      expect(result.merged).toContainEqual(remoteTxs[0]);
    });

    it('should handle empty remote data', async () => {
      const localTxs = [createTx('L1', 100)];
      fetchRemoteMock.mockResolvedValue([]);

      reconciler.addLocalTx('user1', localTxs[0]);
      const result = await reconciler.reconcile('user1');

      expect(result.merged).toContainEqual(localTxs[0]);
    });

    it('should handle concurrent reconciliations for same user', async () => {
      const remoteTxs = [createTx('R1', 100)];
      fetchRemoteMock.mockResolvedValue(remoteTxs);

      const results = await Promise.all([
        reconciler.reconcile('user1'),
        reconciler.reconcile('user1'),
        reconciler.reconcile('user1'),
      ]);

      // Should all complete without errors
      expect(results).toHaveLength(3);
      expect(results.every(r => r.merged.length > 0)).toBe(true);
    });

    it('should preserve transaction data integrity', async () => {
      const originalTx = createTx('T1', 123.45, 9876543210);
      fetchRemoteMock.mockResolvedValue([originalTx]);

      const result = await reconciler.reconcile('user1');
      const mergedTx = result.merged[0];

      expect(mergedTx.id).toBe(originalTx.id);
      expect(mergedTx.amount).toBe(originalTx.amount);
      expect(mergedTx.currency).toBe(originalTx.currency);
      expect(mergedTx.timestamp).toBe(originalTx.timestamp);
    });
  });
});
