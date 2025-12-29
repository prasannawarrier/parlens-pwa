import { useRef, useState, useCallback, useEffect } from 'react';

export const useWakeLock = () => {
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const [isLocked, setIsLocked] = useState(false);

    const requestLock = useCallback(async () => {
        if ('wakeLock' in navigator) {
            try {
                const lock = await navigator.wakeLock.request('screen');
                wakeLockRef.current = lock;
                setIsLocked(true);

                lock.addEventListener('release', () => {
                    setIsLocked(false);
                    wakeLockRef.current = null;
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

    // Re-acquire lock when visibility changes (e.g. switching back to tab)
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && isLocked) {
                // If we were supposed to be locked, try to re-acquire
                await requestLock();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isLocked, requestLock]);

    return { requestLock, releaseLock, isLocked };
};
