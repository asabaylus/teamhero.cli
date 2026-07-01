/**
 * Bounded-concurrency async map.
 *
 * Runs `fn` over `items` with at most `limit` invocations in flight at once,
 * returning results in the original input order. Used to parallelize per-item
 * network I/O (e.g. per-PR GitHub fetches) without folding the results
 * concurrently — callers fold the returned array sequentially so shared
 * aggregation state is never mutated from overlapping tasks.
 *
 * A rejected task rejects the whole operation (matching `Promise.all`); guard
 * inside `fn` if individual failures should be tolerated.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const effectiveLimit = Number.isFinite(limit)
		? Math.max(1, Math.floor(limit))
		: 1;
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (true) {
			const current = nextIndex;
			nextIndex += 1;
			if (current >= items.length) {
				return;
			}
			results[current] = await fn(items[current], current);
		}
	}

	const workerCount = Math.min(effectiveLimit, items.length);
	const workers: Promise<void>[] = [];
	for (let i = 0; i < workerCount; i += 1) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}
