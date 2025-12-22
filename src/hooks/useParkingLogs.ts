import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';

export function useParkingLogs() {
    const { pool, pubkey } = useAuth();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLogs = useCallback(async () => {
        if (!pubkey) return;

        setLoading(true);
        console.log('[useParkingLogs] Fetching logs for', pubkey);

        try {
            // Use querySync for a one-time fetch (more reliable than subscribeMany)
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.PARKING_LOG],
                authors: [pubkey],
                limit: 50,
            });

            console.log('[useParkingLogs] Fetched', events.length, 'events');

            // Sort by created_at descending
            const sorted = events.sort((a, b) => b.created_at - a.created_at);
            setLogs(sorted);
        } catch (e) {
            console.error('[useParkingLogs] Fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [pool, pubkey]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    return { logs, loading, refetch: fetchLogs };
}
