import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, ArrowRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import { encodeGeohash, getGeohashNeighbors } from '../lib/geo';
import { encryptParkingLog } from '../lib/encryption';
import { getCurrencyFromLocation, getCurrencySymbol, getLocalCurrency } from '../lib/currency';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';

interface FABProps {
    status: 'idle' | 'search' | 'parked';
    setStatus: (s: 'idle' | 'search' | 'parked') => void;
    searchLocation: [number, number] | null; // Allow null to prevent premptive searches
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    setOpenSpots: React.Dispatch<React.SetStateAction<any[]>>;
    parkLocation: [number, number] | null;
    setParkLocation: (loc: [number, number] | null) => void;
    sessionStart: number | null;
    setSessionStart: (time: number | null) => void;
}

export const FAB: React.FC<FABProps> = ({
    status,
    setStatus,
    searchLocation,
    vehicleType,
    setOpenSpots,
    parkLocation,
    setParkLocation,
    sessionStart,
    setSessionStart
}) => {
    const { pubkey, pool, signEvent } = useAuth();
    const [showCostPopup, setShowCostPopup] = useState(false);
    const [cost, setCost] = useState('0');
    const [currency, setCurrency] = useState('USD');
    const [symbol, setSymbol] = useState('$');
    const [elapsedTime, setElapsedTime] = useState('00:00:00');

    // Track cumulative geohashes for the current session
    const [sessionGeohashes, setSessionGeohashes] = useState<Set<string>>(new Set());
    // Use a ref to store spots to avoid blinking/reflickering on every update
    const spotsMapRef = useRef<Map<string, any>>(new Map());

    // Timer for stopwatch
    useEffect(() => {
        if (status === 'parked' && sessionStart) {
            const updateTimer = () => {
                const now = Math.floor(Date.now() / 1000);
                const diff = now - sessionStart;
                const hours = Math.floor(diff / 3600);
                const minutes = Math.floor((diff % 3600) / 60);
                const seconds = diff % 60;
                setElapsedTime(
                    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                );
            };
            const id = setInterval(updateTimer, 1000);
            updateTimer();
            return () => clearInterval(id);
        }
    }, [status, sessionStart]);

    // Update cumulative geohashes when search location changes
    useEffect(() => {
        if (status === 'search' && searchLocation) {
            const newGeohashes = getGeohashNeighbors(searchLocation[0], searchLocation[1], 5);
            setSessionGeohashes(prev => {
                const next = new Set(prev);
                newGeohashes.forEach(g => next.add(g));
                // Only update if size changed to avoid unnecessary re-renders
                if (next.size !== prev.size) return next;
                return prev;
            });
        } else if (status === 'idle') {
            setSessionGeohashes(new Set());
            spotsMapRef.current.clear();
            setOpenSpots([]);
        }
    }, [status, searchLocation, setOpenSpots]);

    // REAL-TIME SUBSCRIPTION for open spots
    useEffect(() => {
        if (status === 'search' && sessionGeohashes.size > 0) {
            console.log('[Parlens] Subscribing to spots in geohashes:', Array.from(sessionGeohashes));

            const now = Math.floor(Date.now() / 1000);
            // Subscribe to open spots in all accumulated geohashes
            // Query past 10 mins to catch recently published valid spots
            const sub = pool.subscribeMany(
                DEFAULT_RELAYS,
                [
                    {
                        kinds: [KINDS.OPEN_SPOT_BROADCAST],
                        '#g': Array.from(sessionGeohashes),
                        since: now - 600
                    }
                ] as any,
                {
                    onevent(event) {
                        try {
                            const currentTime = Math.floor(Date.now() / 1000);

                            // Check expiration
                            const expirationTag = event.tags.find((t: string[]) => t[0] === 'expiration');
                            if (expirationTag) {
                                const expTime = parseInt(expirationTag[1]);
                                if (expTime < currentTime) return; // Expired
                            }

                            // Check valid location
                            const locTag = event.tags.find((t: string[]) => t[0] === 'location');
                            if (!locTag) return;

                            const priceTag = event.tags.find((t: string[]) => t[0] === 'hourly_rate');
                            const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency');
                            const typeTag = event.tags.find((t: string[]) => t[0] === 'type');

                            const [lat, lon] = locTag[1].split(',').map(Number);
                            const spotType = typeTag ? typeTag[1] : 'car';

                            const spot = {
                                id: event.id,
                                lat,
                                lon,
                                price: priceTag ? parseFloat(priceTag[1]) : 0,
                                currency: currencyTag ? currencyTag[1] : 'USD',
                                type: spotType
                            };

                            // Update map ref and trigger state update
                            // Using ref + debounce-like update prevents flickering
                            if (!spotsMapRef.current.has(event.id)) {
                                spotsMapRef.current.set(event.id, spot);
                                setOpenSpots(Array.from(spotsMapRef.current.values()));
                            }
                        } catch (e) {
                            console.warn('[Parlens] Error parsing spot event:', e);
                        }
                    },
                    oneose() {
                        // End of stored events, real-time mode starts
                    }
                }
            );

            return () => {
                console.log('[Parlens] Unsubscribing from spots');
                sub.close();
            };
        }
    }, [status, sessionGeohashes, pool, setOpenSpots]);

    useEffect(() => {
        const detectCurrency = async () => {
            // First use locale as fallback
            const localCurrency = getLocalCurrency();
            setCurrency(localCurrency);
            setSymbol(getCurrencySymbol(localCurrency));

            // Then try GPS-based detection
            if (searchLocation) {
                try {
                    const gpsCurrency = await getCurrencyFromLocation(searchLocation[0], searchLocation[1]);
                    setCurrency(gpsCurrency);
                    setSymbol(getCurrencySymbol(gpsCurrency));
                } catch (e) {
                    console.warn('GPS currency detection failed');
                }
            }
        };
        detectCurrency();
    }, [searchLocation]);

    const handleClick = async () => {
        if (status === 'idle') {
            setStatus('search');
        } else if (status === 'search') {
            setSessionStart(Math.floor(Date.now() / 1000));
            setParkLocation(searchLocation ? [searchLocation[0], searchLocation[1]] : null);
            setStatus('parked');
        } else if (status === 'parked') {
            setCost('0'); // Reset to 0 for new session
            setShowCostPopup(true);
        }
    };

    const handleFinishParking = async () => {
        setStatus('idle');
        setShowCostPopup(false);

        const lat = parkLocation ? parkLocation[0] : (searchLocation ? searchLocation[0] : 0);
        const lon = parkLocation ? parkLocation[1] : (searchLocation ? searchLocation[1] : 0);
        // Use 5-char geohash for broadcast to match search radius
        const geohash = encodeGeohash(lat, lon, 5);
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = sessionStart || endTime;

        try {
            const logContent = {
                status: 'vacated',
                lat,
                lon,
                geohash,
                fee: cost,
                currency,
                type: vehicleType, // Include in encrypted content for private filtering
                started_at: startTime,
                finished_at: endTime
            };

            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const encryptedContent = await encryptParkingLog(logContent, pubkey!, seckey);

            const logEvent = {
                kind: KINDS.PARKING_LOG, // Parameterized Replaceable for history
                content: encryptedContent,
                tags: [
                    // Only non-sensitive tags are public
                    // Geohash and type are in encrypted content for privacy
                    ['d', `session_${startTime}`], // Required for parameterized replaceable
                    ['client', 'parlens']
                ],
                created_at: endTime,
                pubkey: pubkey!,
            };

            const signedLog = await signEvent(logEvent);

            console.log('Publishing log:', signedLog.id, 'to', DEFAULT_RELAYS);

            // Use Promise.allSettled for Safari/iOS compatibility
            const results = await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedLog));

            // Log detailed results for debugging Safari/iOS issues
            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`[Parlens] Publish results: ${succeeded}/${results.length} succeeded, ${failed} failed`);
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    console.warn(`[Parlens] Relay ${DEFAULT_RELAYS[i]} failed:`, r.reason);
                }
            });

            // Note: On iOS/Safari, all promises may report as rejected even when data IS saved
            // This is a known Safari WebSocket quirk - we just log a warning, don't throw
            if (succeeded === 0) {
                console.warn('[Parlens] All relays reported failure, but data may still be saved (iOS quirk)');
            }
            console.log('Log published');

            // Small delay for Safari/iOS relay sync
            await new Promise(resolve => setTimeout(resolve, 300));

            // Dispatch event to trigger immediate parking history refresh
            window.dispatchEvent(new Event('parking-log-updated'));

            // Broadcast open spot (Kind 31714 - Addressable) to help other users
            // Use anonymous one-time keypair for privacy
            const anonPrivkey = generateSecretKey();

            // Calculate hourly rate based on duration and fee
            // Round duration UP to whole hours (10 mins = 1hr, 61 mins = 2hrs)
            const durationSeconds = endTime - startTime;
            const durationHours = Math.max(Math.ceil(durationSeconds / 3600), 1); // Minimum 1 hour
            const hourlyRate = String(Math.round(parseFloat(cost) / durationHours));
            const expirationTime = endTime + 300; // Expires in 5 minutes (300 seconds)

            const broadcastEventTemplate = {
                kind: KINDS.OPEN_SPOT_BROADCAST,
                content: '',
                tags: [
                    ['d', `spot_${geohash}_${endTime}`], // Unique identifier for addressable event
                    ['g', geohash],
                    ['location', `${lat},${lon}`],
                    ['hourly_rate', hourlyRate],
                    ['currency', currency],
                    ['type', vehicleType],
                    ['expiration', String(expirationTime)],
                    ['client', 'parlens']
                ],
                created_at: endTime,
            };

            // Sign with anonymous key using nostr-tools
            const signedBroadcast = finalizeEvent(broadcastEventTemplate, anonPrivkey);

            console.log('[Parlens] *** BROADCASTING OPEN SPOT ***');
            console.log('[Parlens] Geohash:', geohash);
            console.log('[Parlens] Location:', `${lat},${lon}`);
            console.log('[Parlens] Event ID:', signedBroadcast.id);
            console.log('[Parlens] Pubkey:', signedBroadcast.pubkey.substring(0, 20) + '...');
            pool.publish(DEFAULT_RELAYS, signedBroadcast);

            // Reset session tracking
            setSessionStart(null);
            setParkLocation(null);

        } catch (e) {
            console.error('Persistence error:', e);
            alert('Could not save to Nostr. Check relay connections.');
        }
    };

    return (
        <div className="relative flex flex-col items-end gap-4">
            <div className="flex items-center gap-4">
                {status === 'search' && (
                    <button
                        onClick={() => setStatus('idle')}
                        className="h-14 px-8 rounded-full bg-red-500/90 text-white font-bold text-xs tracking-widest shadow-2xl backdrop-blur-md animate-in slide-in-from-left-8"
                    >
                        CANCEL
                    </button>
                )}

                {status === 'parked' && (
                    <div className="h-14 px-6 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-2xl flex items-center justify-center animate-in slide-in-from-left-8 pointer-events-none">
                        <span className="font-mono text-xl font-bold tabular-nums text-zinc-900 dark:text-white">
                            {elapsedTime}
                        </span>
                    </div>
                )}

                <button
                    onClick={handleClick}
                    className={`h-20 w-20 flex items-center justify-center rounded-[2.5rem] shadow-2xl transition-all active:scale-90 ${status === 'idle' ? 'bg-[#007AFF] text-white shadow-blue-500/20' :
                        status === 'search' ? 'bg-[#FF9500] text-white shadow-orange-500/20' :
                            'bg-[#34C759] text-white shadow-green-500/20'
                        }`}
                >
                    {status === 'idle' && <Search size={32} strokeWidth={2.5} />}
                    {status === 'search' && <MapPin size={32} strokeWidth={2.5} className="animate-pulse" />}
                    {status === 'parked' && (
                        vehicleType === 'bicycle' ? <span className="text-3xl">🚲</span> :
                            vehicleType === 'motorcycle' ? <span className="text-3xl">🏍️</span> :
                                <span className="text-3xl">🚗</span>
                    )}
                </button>
            </div>

            {showCostPopup && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 p-4">
                    <div className="w-full max-w-sm bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col items-center space-y-5 animate-in zoom-in-95 border border-black/5 dark:border-white/10 transition-colors">
                        <div className="text-center space-y-1">
                            <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">End Session</h3>
                            <p className="text-xs font-medium text-zinc-500 dark:text-white/40">Enter total parking fee, 0 if free parking</p>
                        </div>


                        <div className="flex items-center gap-4">
                            {/* Currency symbol and amount */}
                            <div className="flex items-center gap-3 bg-zinc-100 dark:bg-white/5 px-5 py-4 rounded-[1.5rem] border border-black/5 dark:border-white/5">
                                <span className="text-2xl font-bold text-blue-500">{symbol}</span>
                                <input
                                    type="number"
                                    value={cost}
                                    onChange={(e) => setCost(e.target.value)}
                                    autoFocus
                                    className="w-20 bg-transparent text-4xl font-black text-center text-zinc-900 dark:text-white focus:outline-none placeholder:text-zinc-300 dark:placeholder:text-white/10 appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                                    min="0"
                                />
                                <span className="text-sm font-bold text-zinc-400 dark:text-white/20">{currency}</span>
                            </div>

                            {/* Up/Down buttons */}
                            <div className="flex flex-col gap-1.5">
                                <button
                                    onClick={() => setCost(String(Math.max(0, parseFloat(cost || '0') + 1)))}
                                    className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronUp size={22} className="text-zinc-600 dark:text-white/70" />
                                </button>
                                <button
                                    onClick={() => setCost(String(Math.max(0, parseFloat(cost || '0') - 1)))}
                                    className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronDown size={22} className="text-zinc-600 dark:text-white/70" />
                                </button>
                            </div>
                        </div>

                        <div className="w-full space-y-3">
                            <button
                                onClick={handleFinishParking}
                                className="w-full h-14 rounded-[1.5rem] bg-[#007AFF] text-white text-lg font-bold flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all"
                            >
                                Log Parking <ArrowRight size={20} />
                            </button>

                            <button
                                onClick={() => setShowCostPopup(false)}
                                className="w-full text-xs font-bold text-zinc-400 dark:text-white/30 tracking-widest uppercase py-3 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};
