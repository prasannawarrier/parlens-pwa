
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';

export function useParkingLogs() {
    const { pool, pubkey } = useAuth();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Track locally deleted d-tags to prevent re-appearing after refetch
    const deletedDTagsRef = useRef<Set<string>>(new Set());

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

            // Filter out locally deleted logs
            const filteredEvents = events.filter(event => {
                const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1];
                if (!dTag) return true;
                return !deletedDTagsRef.current.has(dTag);
            });

            console.log('[useParkingLogs] After filtering locally deleted:', filteredEvents.length, 'events');
            const sorted = filteredEvents.sort((a, b) => b.created_at - a.created_at);
            setLogs(sorted);
        } catch (e) {
            console.error('[useParkingLogs] Fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [pool, pubkey]);

    // Mark a d-tag as deleted locally (called from ProfileButton after deletion)
    const markDeleted = useCallback((dTag: string) => {
        console.log('[useParkingLogs] Marking deleted:', dTag);
        deletedDTagsRef.current.add(dTag);
    }, []);

    // Fetch on mount and when pubkey changes (like RouteButton)
    useEffect(() => {
        if (pubkey) {
            fetchLogs();
        }
    }, [pubkey, fetchLogs]);

    // Listen for parking-log-updated event for immediate refetch
    // Also listen for visibility-refresh when app returns from background (iOS)
    useEffect(() => {
        const handleUpdate = () => {
            console.log('[useParkingLogs] Received update event, refetching...');
            fetchLogs();
        };

        window.addEventListener('parking-log-updated', handleUpdate);
        window.addEventListener('visibility-refresh', handleUpdate);
        return () => {
            window.removeEventListener('parking-log-updated', handleUpdate);
            window.removeEventListener('visibility-refresh', handleUpdate);
        };
    }, [fetchLogs]);

    return { logs, loading, refetch: fetchLogs, markDeleted };
}
