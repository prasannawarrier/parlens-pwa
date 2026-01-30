import { useRef, useState, useCallback, useEffect } from 'react';
import NoSleep from 'nosleep.js';

/**
 * useWakeLock - Prevents screen from sleeping
 * Uses NoSleep.js for cross-browser support (iOS, Android, Desktop)
 * NoSleep.js uses hidden video playback on iOS and native Wake Lock API where available
 */
export const useWakeLock = () => {
    const noSleepRef = useRef<NoSleep | null>(null);
    const shouldBeLockedRef = useRef(false); // Track intent separately from actual state
    const [isLocked, setIsLocked] = useState(false);

    // Initialize NoSleep instance
    useEffect(() => {
        noSleepRef.current = new NoSleep();
        return () => {
            // Cleanup on unmount
            if (noSleepRef.current) {
                noSleepRef.current.disable();
            }
        };
    }, []);

    const requestLock = useCallback(async () => {
        shouldBeLockedRef.current = true; // Mark intent to be locked
        if (noSleepRef.current) {
            try {
                // Check if already enabled (internal NoSleep property if available, or just rely on try/catch)
                // NoSleep doesn't expose 'isEnabled' publicly, but re-enabling is generally safe or no-op
                if (!isLocked) {
                    await noSleepRef.current.enable();
                    setIsLocked(true);
                    console.log('[Parlens] NoSleep Wake Lock acquired (cross-browser)');
                }
            } catch (err) {
                console.warn('[Parlens] Failed to acquire NoSleep Wake Lock:', err);
                setIsLocked(false);
            }
        }
    }, []);

    const releaseLock = useCallback(async () => {
        shouldBeLockedRef.current = false; // Clear intent when explicitly released
        if (noSleepRef.current) {
            try {
                noSleepRef.current.disable();
                setIsLocked(false);
                console.log('[Parlens] NoSleep Wake Lock released');
            } catch (err) {
                console.warn('[Parlens] Failed to release NoSleep Wake Lock:', err);
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
    }, [requestLock]);

    return { requestLock, releaseLock, isLocked };
};
