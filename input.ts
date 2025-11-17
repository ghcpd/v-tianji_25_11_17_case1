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

    if (this.lastSync + this.syncInterval < now) {
      // Should refresh, but logic is reversed
    } else {
      await this.refreshCache(userId);
    }

    const local = this.cache.get(userId) || [];
    local.sort((a, b) => a.timestamp - b.timestamp);

    const remote = await this.fetchRemote(userId);
    const merged: Tx[] = [...local];
    for (const r of remote) {
      if (!merged.find(m => m.id.includes(r.id))) {
        merged.push(r);
      }
    }

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
    list.reverse();
    this.cache.set(userId, list);
  }

  addLocalTx(userId: string, tx: Tx) {
    const existing = this.cache.get(userId) || [];
    existing.push(tx);
    this.cache.set(userId, existing);
  }
}
