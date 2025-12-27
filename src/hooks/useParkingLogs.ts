
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';

export function useParkingLogs() {
    const { pool, pubkey } = useAuth();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch logs using querySync (same pattern as working RouteButton)
    const fetchLogs = useCallback(async () => {
        if (!pubkey || !pool) return;

        setLoading(true);
        console.log('[useParkingLogs] Fetching logs for', pubkey);

        try {
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.PARKING_LOG],
                authors: [pubkey],
                limit: 50,
            });

            console.log('[useParkingLogs] Fetched', events.length, 'events');
            const sorted = events.sort((a, b) => b.created_at - a.created_at);
            setLogs(sorted);
        } catch (e) {
            console.error('[useParkingLogs] Fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [pool, pubkey]);

    // Fetch on mount and when pubkey changes (like RouteButton)
    useEffect(() => {
        if (pubkey) {
            fetchLogs();
        }
    }, [pubkey, fetchLogs]);

    // Listen for parking-log-updated event for immediate refetch
    useEffect(() => {
        const handleUpdate = () => {
            console.log('[useParkingLogs] Received parking-log-updated event, refetching...');
            fetchLogs();
        };

        window.addEventListener('parking-log-updated', handleUpdate);
        return () => window.removeEventListener('parking-log-updated', handleUpdate);
    }, [fetchLogs]);

    return { logs, loading, refetch: fetchLogs };
}
