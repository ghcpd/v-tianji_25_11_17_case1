# TxReconciler - Bugs, Expected vs Actual, and Fix Summary

This document lists functional bugs in `input.ts` (TxReconciler), describes expected vs actual behavior, outlines the fix applied in `TxReconciler.fixed.ts`, suggests tests, and summarizes remaining risks.

## 1) Bug: Sync refresh logic reversed and missing initial-refresh and lastSync update

- Where: `reconcile()` and `refreshCache()`
- Symptom (Actual behavior): The code checks `if (this.lastSync + this.syncInterval < now) { /* should refresh */ } else { await this.refreshCache(userId) }`. The logic is reversed: it refreshes when the sync interval has not elapsed and skips refresh when it has elapsed.
- Additional issue: `lastSync` is never updated after a successful refresh, so the condition becomes stale.
- Expected behavior: The cache should be refreshed when (a) there is no cached data for the user, or (b) the last sync is older than the configured sync interval. After a successful refresh, `lastSync` must be updated so the next call respects the interval.
- Fix: Implemented in `TxReconciler.fixed.ts` to refresh when `!hasLocal || now - lastSync >= syncInterval` and set `lastSync` in `refreshCache`.

## 2) Bug: The cache refresh mutates the fetched remote array via `reverse()`

- Where: `refreshCache()`
- Symptom: The remote array passed in by the caller or fetchRemote is reversed in-place using `list.reverse()`, which mutates it. An external caller can see the mutated array or get incorrect data if the array object is reused.
- Expected behavior: Do not mutate the array returned by `fetchRemote`. Copy it before reordering.
- Fix: Use `const copy = [...list]; copy.sort(...)` and store `copy` in cache.

## 3) Bug: ID deduplication uses `includes()` (substring) instead of equality

- Where: `reconcile()` merging remote into local uses `if (!merged.find(m => m.id.includes(r.id))) { merged.push(r); }`.
- Symptom: If local tx id is "abc" and remote tx id is "a", the remote tx would be considered a duplicate and not merged, because "abc".includes("a") returns true.
- Expected behavior: De-dupe using exact id equality (`m.id === r.id`) and preferably dedupe by choosing the authoritative or newest transaction by timestamp.
- Fix: Use Map keyed by exact id. When duplicates exist, choose the transaction with the higher timestamp (latest). This avoids the substring bug and ensures a deterministic choice.

## 4) Bug: Inconsistent merge ordering and deduplication semantics

- Symptom: The original merged array concatenated local and remote in a combined order (local first, then remote), and there was no guarantee on order or conflict resolution for duplicate IDs.
- Expected behavior: A merged result should be deduplicated deterministically and be sorted by timestamp (ascending) to be consistent.
- Fix: Use a Map to deduplicate by id with latest timestamp to pick definitive value, then output sorted by timestamp.

## 5) Bug: lastSync never updated, leading to frequent or missing cache refreshes

- Symptom: Because lastSync isn't updated after refresh, the refresh decision is inconsistent and may cause either no refresh at all (reversed logic) or indefinite refreshes.
- Fix: Update `lastSync` in `refreshCache` to the current timestamp.

## 6) Bug: `addLocalTx` did not prevent duplicates or update based on timestamp

- Symptom: `addLocalTx` simply pushes an entry into the cache; if an existing id exists, it duplicates the id in the cached array (makes deduplicate more expensive and risky). Also local newer updates might be overwritten sooner.
- Expected behavior: Replace existing local entry if the new one is newer, otherwise ignore or keep the latest.
- Fix: When adding a local tx, replace if same id and newer by timestamp; otherwise append.

## 7) Bug: Counting `updated` vs `skipped` is unclear

- Where: `reconcile()` uses `if (m.amount > 0) updated++; else skipped++`.
- Symptom: `updated` and `skipped` are counts based on positive vs non-positive amounts, not about duplicates, which may be confusing, but not necessarily a bug if documented.
- Expected behavior: If the intention is to count positive-value transactions as updated and non-positive as skipped, this is fine, but it must be documented clearly. Otherwise, if they intend `updated` to be count of new or changed transactions and `skipped` as de-duplicated or filtered-out transactions, the logic must change.
- Fix: We preserved the existing semantics, but clarified in docs and tests.

## Fix summary

- `TxReconciler.fixed.ts` resolves the logic reversals, avoids in-place mutations of remote results, uses exact id equality for deduplicating, merges deterministically by timestamp, and updates `lastSync` correctly.

## Tests added

- `TxReconciler.test.ts` uses Jest and covers:
  - Refresh on first reconcile when no cache exists
  - Prevent in-place mutation of remote arrays returned by `fetchRemote` on refresh
  - Exact id deduplication (not substring matching)
  - Duplicate conflict resolution chooses newest by timestamp
  - Correct updated/skipped counts by positive amount
  - Refresh after `syncInterval` elapsed
  - Propagate `fetchRemote` errors
  - Update behavior for `addLocalTx` when replacing an existing tx
  - Regression tests showcasing the original behavior (includes substring matching and remote array mutation)

## Remaining risks and missing test scenarios

1. Concurrency: The reconciler is not thread-safe across simultaneous `reconcile` or `addLocalTx` calls. If concurrency is expected (e.g., multiple calls from parallel contexts), consider adding locking/mutex or converting cache operations into atomic operations.

2. Partial failures: If `fetchRemote` resolves but does not return valid transactions (e.g., null, malformed entries), the code relies on `fetchRemote` to return well-formed Tx objects. Consider validating the remote payload and ignoring malformed entries.

3. Performance: The merging algorithm uses Maps and sorts; performance should be fine for typical numbers of transactions but can be optimized for extremely large data sets (e.g., using streams or merging two sorted lists).

4. Deterministic conflict resolution policy: Currently we pick the newest transaction when a duplicate id is found. If business rules prefer the remote authoritative source, change conflict resolution accordingly.

5. Test coverage: Tests added cover the functional bugs. Additional tests that would be beneficial:
  - Very large remote/local lists to confirm performance
  - Concurrency/regression when `reconcile` and `addLocalTx` are called concurrently
  - Behavior when `fetchRemote` intermittently returns malformed data (null entries)
  - Preserving ordering relative to user expectation (ascending vs descending should be documented)

## Final note

The corrected code attempts to preserve both the high-level intent and the previous `updated`/`skipped` semantics for compatibility while fixing the behavioral bugs that caused incorrect deduplication and incorrect refresh semantics. The test suite provides good coverage of those aspects and includes regression tests that show how the original implementation behaved incorrectly.
