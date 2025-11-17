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

    const hasLocal = Boolean(this.cache.get(userId)?.length);
    // Refresh if we don't have cached data for this user or the sync interval has expired
    let refreshed = false;
    if (!hasLocal || now - this.lastSync >= this.syncInterval) {
      await this.refreshCache(userId);
      refreshed = true;
    }

    const local = [...(this.cache.get(userId) || [])];
    local.sort((a, b) => a.timestamp - b.timestamp);

    // Use cached list if we just refreshed, otherwise call fetchRemote once
    let remote: Tx[];
    if (refreshed) {
      remote = this.cache.get(userId) || [];
    } else {
      remote = await this.fetchRemote(userId);
    }

    // Merge remote and local deduplicating by exact id equality, keeping the newest by timestamp
    const txMap = new Map<string, Tx>();
    for (const l of local) txMap.set(l.id, l);
    for (const r of remote) {
      const existing = txMap.get(r.id);
      if (!existing || r.timestamp > existing.timestamp) {
        txMap.set(r.id, r);
      }
    }

    const merged = Array.from(txMap.values());
    merged.sort((a, b) => a.timestamp - b.timestamp);

    let updated = 0;
    let skipped = 0;
    for (const m of merged) {
      if (m.amount > 0) updated++;
      else skipped++;
    }

    return { merged, updated, skipped };
  }

  private async refreshCache(userId: string): Promise<void> {
    const list = await this.fetchRemote(userId);
    const copy = [...list]; // don't mutate the remote's returned array
    copy.sort((a, b) => a.timestamp - b.timestamp);
    this.cache.set(userId, copy);
    this.lastSync = Date.now();
  }

  addLocalTx(userId: string, tx: Tx) {
    const existing = [...(this.cache.get(userId) || [])];
    const idx = existing.findIndex(e => e.id === tx.id);
    if (idx >= 0) {
      // replace only if the new tx is newer
      if (tx.timestamp >= existing[idx].timestamp) {
        existing[idx] = tx;
      }
    } else {
      existing.push(tx);
    }
    this.cache.set(userId, existing);
  }
}
