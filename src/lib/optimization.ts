import { SimplePool } from 'nostr-tools';

export interface DistributedFetchOptions {
    /** Called for each unique event as it arrives */
    onEvent: (event: any) => void;
    /** Called for events found during verification (optional) */
    onVerificationEvent?: (event: any) => void;
    /** AbortSignal to cancel the fetch */
    signal?: AbortSignal;
    /** Timeout per relay in ms (default: 10000) */
    timeoutMs?: number;
}

/**
 * Distributes a Nostr query across multiple relays by sharding the filter's
 * distributable array (e.g., '#g' geohashes). Events are streamed to onEvent
 * as they arrive, enabling progressive UI loading.
 *
 * @param pool - SimplePool instance
 * @param relays - Array of relay URLs
 * @param filter - Nostr filter with a distributable array key
 * @param options - Callbacks and abort signal
 * @returns Promise that resolves when primary fetch completes (EOSE from all shards)
 */
export async function fetchDistributedStream(
    pool: SimplePool,
    relays: string[],
    filter: Record<string, any>,
    options: DistributedFetchOptions
): Promise<void> {
    const { onEvent, onVerificationEvent, signal, timeoutMs = 10000 } = options;

    // Early abort check
    if (signal?.aborted) return;

    // Find distributable array in filter (e.g., '#g', 'ids', 'authors')
    const distributableKeys = ['#g', 'ids', 'authors', '#e', '#p', '#a'];
    let distributableKey: string | null = null;
    let distributableArray: string[] = [];

    for (const key of distributableKeys) {
        if (filter[key] && Array.isArray(filter[key]) && filter[key].length > 0) {
            distributableKey = key;
            distributableArray = filter[key];
            break;
        }
    }

    // If no distributable array or only 1 relay, fall back to simple fetch
    if (!distributableKey || relays.length <= 1 || distributableArray.length <= 1) {
        return fetchSimpleStream(pool, relays, filter, onEvent, signal, timeoutMs);
    }

    // Partition the array across relays
    const chunks = partitionArray(distributableArray, relays.length);
    const seenEventIds = new Set<string>();

    // Create promise for each relay-chunk pair
    const shardPromises = chunks.map((chunk, index) => {
        const relay = relays[index % relays.length];
        const shardFilter = { ...filter, [distributableKey!]: chunk };

        return fetchFromRelay(pool, relay, shardFilter, (event) => {
            // Deduplicate by event id
            if (!seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                onEvent(event);
            }
        }, signal, timeoutMs);
    });

    // Wait for all primary shards to complete
    await Promise.allSettled(shardPromises);

    // Background verification (detached, non-blocking)
    if (onVerificationEvent && !signal?.aborted) {
        // Rotate assignments: each relay re-checks a different chunk
        setTimeout(async () => {
            if (signal?.aborted) return;

            const verifyPromises = chunks.map((chunk, index) => {
                // Assign to a DIFFERENT relay for verification
                const verifyRelay = relays[(index + 1) % relays.length];
                const shardFilter = { ...filter, [distributableKey!]: chunk };

                return fetchFromRelay(pool, verifyRelay, shardFilter, (event) => {
                    if (!seenEventIds.has(event.id)) {
                        seenEventIds.add(event.id);
                        onVerificationEvent(event);
                    }
                }, signal, timeoutMs);
            });

            await Promise.allSettled(verifyPromises);
            console.log('[Parlens] Verification phase complete');
        }, 100); // Small delay before starting verification
    }
}

/**
 * Simple streaming fetch from all relays (fallback when sharding not applicable)
 */
async function fetchSimpleStream(
    pool: SimplePool,
    relays: string[],
    filter: Record<string, any>,
    onEvent: (event: any) => void,
    signal?: AbortSignal,
    timeoutMs = 10000
): Promise<void> {
    const seenEventIds = new Set<string>();

    const promises = relays.map(relay =>
        fetchFromRelay(pool, relay, filter, (event) => {
            if (!seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                onEvent(event);
            }
        }, signal, timeoutMs)
    );

    await Promise.allSettled(promises);
}

/**
 * Fetch events from a single relay with streaming and timeout
 */
function fetchFromRelay(
    pool: SimplePool,
    relay: string,
    filter: Record<string, any>,
    onEvent: (event: any) => void,
    signal?: AbortSignal,
    timeoutMs = 10000
): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }

        let resolved = false;
        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };

        // Timeout handler
        const timeout = setTimeout(() => {
            console.warn(`[Parlens] Relay ${relay} timed out after ${timeoutMs}ms`);
            sub.close();
            cleanup();
        }, timeoutMs);

        // Abort handler
        const abortHandler = () => {
            clearTimeout(timeout);
            sub.close();
            cleanup();
        };
        signal?.addEventListener('abort', abortHandler);

        // Subscribe to relay
        const sub = pool.subscribeMany(
            [relay],
            [filter] as any,
            {
                onevent(event) {
                    if (!signal?.aborted) {
                        onEvent(event);
                    }
                },
                oneose() {
                    clearTimeout(timeout);
                    signal?.removeEventListener('abort', abortHandler);
                    sub.close();
                    cleanup();
                }
            }
        );
    });
}

/**
 * Partition an array into N roughly equal chunks
 */
function partitionArray<T>(arr: T[], n: number): T[][] {
    const chunks: T[][] = Array.from({ length: n }, () => []);
    arr.forEach((item, index) => {
        chunks[index % n].push(item);
    });
    return chunks.filter(c => c.length > 0); // Remove empty chunks
}

/**
 * Creates a throttled version of a function that only executes once per interval
 */
export function createThrottle<T extends (...args: any[]) => void>(
    fn: T,
    intervalMs: number
): T {
    let lastCall = 0;
    let pending = false;
    let lastArgs: any[] | null = null;

    const throttled = (...args: any[]) => {
        lastArgs = args;
        const now = Date.now();

        if (now - lastCall >= intervalMs) {
            lastCall = now;
            fn(...args);
            pending = false;
        } else if (!pending) {
            pending = true;
            setTimeout(() => {
                if (lastArgs) {
                    lastCall = Date.now();
                    fn(...lastArgs);
                }
                pending = false;
            }, intervalMs - (now - lastCall));
        }
    };

    return throttled as T;
}
