export interface Tx {
  id: string;
  amount: number;
  currency: string;
  timestamp: number;
}

export interface ReconcileResult {
  merged: Tx[];
  updated: number; // number of remote txs added
  skipped: number; // number of remote txs skipped (duplicates)
}

export class TxReconciler {
  private cache: Map<string, Tx[]> = new Map();
  // Start with 0 to force initial fetch on first reconcile
  private lastSync: number = 0;
  private readonly syncInterval = 4000;

  constructor(private fetchRemote: (userId: string) => Promise<Tx[]>) {}

  async reconcile(userId: string): Promise<ReconcileResult> {
    const now = Date.now();

    // If the cache is stale, refresh it and capture the remote list; otherwise fetch remote once
    let remote: Tx[];
    if (now - this.lastSync >= this.syncInterval) {
      remote = await this.refreshCache(userId); // refreshCache now returns remote list
    } else {
      remote = await this.fetchRemote(userId);
    }

    // Work with a copy of local cache so we don't mutate internally stored order
    const local = [...(this.cache.get(userId) || [])];
    local.sort((a, b) => a.timestamp - b.timestamp);

    // Ensure we have up-to-date remote list (won't re-fetch when refreshed)

    const merged: Tx[] = [...local];

    let updated = 0;
    let skipped = 0;

    // Merge remote txs into merged array, avoiding duplicates by exact id match
    for (const r of remote) {
      if (!merged.find(m => m.id === r.id)) {
        merged.push(r);
        updated++;
      } else {
        skipped++;
      }
    }

    // Keep merged list ordered by timestamp
    merged.sort((a, b) => a.timestamp - b.timestamp);

    return { merged, updated, skipped };
  }

  // Refresh the in-memory cache with the latest remote list and return it
  private async refreshCache(userId: string): Promise<Tx[]> {
    const list = await this.fetchRemote(userId);
    // store a sorted copy for deterministic cache order
    list.sort((a, b) => a.timestamp - b.timestamp);
    this.cache.set(userId, [...list]);
    this.lastSync = Date.now();
    return list;
  }

  addLocalTx(userId: string, tx: Tx) {
    const existing = this.cache.get(userId) || [];
    existing.push(tx);
    this.cache.set(userId, existing);
  }
}
