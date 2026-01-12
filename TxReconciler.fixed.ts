/**
 * FIXED VERSION: TxReconciler
 * 
 * All bugs have been corrected:
 * Bug #1: Fixed reversed sync logic - now refreshes when interval ELAPSED
 * Bug #2: Fixed duplicate detection - uses exact ID equality instead of substring match
 * Bug #3: Fixed transaction ordering - consistent ascending chronological sort
 * Bug #4: Fixed metrics - tracks actual merged vs skipped transactions
 * Bug #5: Fixed lastSync tracking - updates after each reconciliation
 */

export interface Tx {
  id: string;
  amount: number;
  currency: string;
  timestamp: number;
}

export interface ReconcileResult {
  merged: Tx[];
  updated: number;
  skipped: number;
}

export class TxReconciler {
  private cache: Map<string, Tx[]> = new Map();
  private lastSync: number = Date.now();
  private readonly syncInterval = 4000;

  constructor(private fetchRemote: (userId: string) => Promise<Tx[]>) {}

  async reconcile(userId: string): Promise<ReconcileResult> {
    const now = Date.now();

    // FIX #1: Corrected logic - refresh when interval HAS elapsed (not reversed)
    if (this.lastSync + this.syncInterval < now) {
      await this.refreshCache(userId);
    }

    const local = this.cache.get(userId) || [];
    // FIX #3: Ensure consistent ascending chronological order
    local.sort((a, b) => a.timestamp - b.timestamp);

    const remote = await this.fetchRemote(userId);
    const merged: Tx[] = [...local];
    
    // Track which transactions were skipped (already existed)
    const localIds = new Set(local.map(tx => tx.id));
    let skipped = 0;
    let updated = 0;

    for (const r of remote) {
      // FIX #2: Use exact equality (===) instead of substring match (includes)
      if (!merged.find(m => m.id === r.id)) {
        merged.push(r);
        updated++;
      } else {
        skipped++;
      }
    }

    // FIX #3: Sort merged results by timestamp to maintain chronological order
    merged.sort((a, b) => a.timestamp - b.timestamp);

    // FIX #5: Update lastSync timestamp after successful reconciliation
    this.lastSync = now;

    // FIX #4: Return correct metrics - updated = newly added, skipped = already existed
    return { merged, updated, skipped };
  }

  private async refreshCache(userId: string): Promise<void> {
    const list = await this.fetchRemote(userId);
    // FIX #3: Remove the reverse() call - maintain chronological order
    // Sort in ascending order for consistency
    list.sort((a, b) => a.timestamp - b.timestamp);
    this.cache.set(userId, list);
  }

  addLocalTx(userId: string, tx: Tx) {
    const existing = this.cache.get(userId) || [];
    existing.push(tx);
    this.cache.set(userId, existing);
  }
}
