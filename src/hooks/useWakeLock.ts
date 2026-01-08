import { useRef, useState, useCallback, useEffect } from 'react';

export const useWakeLock = () => {
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const shouldBeLockedRef = useRef(false); // Track intent separately from actual state
    const [isLocked, setIsLocked] = useState(false);

    const requestLock = useCallback(async () => {
        shouldBeLockedRef.current = true; // Mark intent to be locked
        if ('wakeLock' in navigator) {
            try {
                const lock = await navigator.wakeLock.request('screen');
                wakeLockRef.current = lock;
                setIsLocked(true);

                lock.addEventListener('release', () => {
                    setIsLocked(false);
                    wakeLockRef.current = null;
                    // Note: shouldBeLockedRef remains true if user didn't explicitly release
                });
                console.log('[Parlens] Screen Wake Lock acquired');
            } catch (err) {
                console.warn('[Parlens] Failed to acquire Wake Lock:', err);
                setIsLocked(false);
            }
        } else {
            console.warn('[Parlens] Wake Lock API not supported');
        }
    }, []);

    const releaseLock = useCallback(async () => {
        shouldBeLockedRef.current = false; // Clear intent when explicitly released
        if (wakeLockRef.current) {
            try {
                await wakeLockRef.current.release();
                wakeLockRef.current = null;
                setIsLocked(false);
                console.log('[Parlens] Screen Wake Lock released');
            } catch (err) {
                console.warn('[Parlens] Failed to release Wake Lock:', err);
            }
        }
    }, []);

    // Re-acquire lock when visibility changes (e.g. switching back to tab/app)
    useEffect(() => {
        const handleVisibilityChange = async () => {
            // Use shouldBeLockedRef (intent) instead of isLocked (actual state)
            // because isLocked becomes false when system releases the lock on background
            if (document.visibilityState === 'visible' && shouldBeLockedRef.current) {
                // If we were supposed to be locked, try to re-acquire
                await requestLock();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [requestLock]); // Removed isLocked dependency as we now use ref

    return { requestLock, releaseLock, isLocked };
};
