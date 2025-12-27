import React, { useState, useEffect } from 'react';
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
    location: [number, number];
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    setOpenSpots: React.Dispatch<React.SetStateAction<any[]>>;
    parkLocation: [number, number] | null;
    setParkLocation: (loc: [number, number] | null) => void;
}

export const FAB: React.FC<FABProps> = ({ status, setStatus, location, vehicleType, setOpenSpots, parkLocation, setParkLocation }) => {
    const { pubkey, pool, signEvent } = useAuth();
    const [showCostPopup, setShowCostPopup] = useState(false);
    const [cost, setCost] = useState('0');
    const [currency, setCurrency] = useState('USD');
    const [symbol, setSymbol] = useState('$');
    const [sessionStart, setSessionStart] = useState<number | null>(null);

    // Search for open spots when entering search mode - POLLING (iOS compatible)
    useEffect(() => {
        if (status === 'search' && location) {
            // Get center + 8 neighboring geohashes for boundary-safe discovery
            const geohashes = getGeohashNeighbors(location[0], location[1], 5);
            console.log('[Parlens] Starting spot search with polling in geohashes:', geohashes);

            // Use querySync (HTTP-like, works on iOS) instead of subscribeMany (WebSocket issues on iOS)
            const searchSpots = async () => {
                try {
                    const now = Math.floor(Date.now() / 1000);
                    console.log('[Parlens] Querying for spots since:', now - 300);

                    const events = await pool.querySync(
                        DEFAULT_RELAYS,
                        { kinds: [KINDS.OPEN_SPOT_BROADCAST], '#g': geohashes, since: now - 300 } as any
                    );

                    console.log('[Parlens] Found', events.length, 'spot events');
                    const currentTime = Math.floor(Date.now() / 1000);
                    const newSpots: any[] = [];

                    for (const event of events) {
                        // Check expiration tag
                        const expirationTag = event.tags.find((t: string[]) => t[0] === 'expiration');
                        if (expirationTag) {
                            const expTime = parseInt(expirationTag[1]);
                            if (expTime < currentTime) {
                                continue; // Skip expired
                            }
                        }

                        try {
                            const tags = event.tags;
                            const locTag = tags.find((t: string[]) => t[0] === 'location');
                            const priceTag = tags.find((t: string[]) => t[0] === 'hourly_rate');
                            const currencyTag = tags.find((t: string[]) => t[0] === 'currency');
                            const typeTag = tags.find((t: string[]) => t[0] === 'type');

                            if (locTag) {
                                const [lat, lon] = locTag[1].split(',').map(Number);
                                const spotType = typeTag ? typeTag[1] : 'car';

                                newSpots.push({
                                    id: event.id,
                                    lat,
                                    lon,
                                    price: priceTag ? parseFloat(priceTag[1]) : 0,
                                    currency: currencyTag ? currencyTag[1] : 'USD',
                                    type: spotType
                                });
                            }
                        } catch (e) {
                            console.warn('[Parlens] Error parsing spot:', e);
                        }
                    }

                    console.log('[Parlens] Setting', newSpots.length, 'valid spots');
                    setOpenSpots(newSpots);
                } catch (e) {
                    console.error('[Parlens] Spot query error:', e);
                }
            };

            // Search immediately
            searchSpots();

            // Poll every 10 seconds for new spots
            const intervalId = setInterval(searchSpots, 10000);

            return () => {
                console.log('[Parlens] Stopping spot search');
                clearInterval(intervalId);
                // Note: Don't clear spots here - spots are cleared when status changes away from 'search'
            };
        } else {
            // Clear spots when NOT in search mode
            setOpenSpots([]);
        }
    }, [status, vehicleType, pool]); // Removed location - we use it inside but don't need to re-run effect on location change

    // Session persistence: restore session on mount
    useEffect(() => {
        const savedSession = localStorage.getItem('parlens_session');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                if (session.status === 'parked' && session.parkLocation && session.sessionStart) {
                    console.log('[Parlens] Restoring parked session:', session);
                    setSessionStart(session.sessionStart);
                    setParkLocation(session.parkLocation);
                    setStatus('parked');
                } else if (session.status === 'search') {
                    console.log('[Parlens] Restoring search session');
                    setStatus('search');
                }
            } catch (e) {
                console.warn('[Parlens] Failed to restore session:', e);
                localStorage.removeItem('parlens_session');
            }
        }
    }, []);

    // Save session state changes to localStorage
    useEffect(() => {
        if (status === 'parked' && sessionStart && parkLocation) {
            localStorage.setItem('parlens_session', JSON.stringify({
                status: 'parked',
                sessionStart,
                parkLocation
            }));
        } else if (status === 'search') {
            localStorage.setItem('parlens_session', JSON.stringify({ status: 'search' }));
        } else if (status === 'idle') {
            localStorage.removeItem('parlens_session');
        }
    }, [status, sessionStart, parkLocation]);

    useEffect(() => {
        const detectCurrency = async () => {
            // First use locale as fallback
            const localCurrency = getLocalCurrency();
            setCurrency(localCurrency);
            setSymbol(getCurrencySymbol(localCurrency));

            // Then try GPS-based detection
            if (location) {
                try {
                    const gpsCurrency = await getCurrencyFromLocation(location[0], location[1]);
                    setCurrency(gpsCurrency);
                    setSymbol(getCurrencySymbol(gpsCurrency));
                } catch (e) {
                    console.warn('GPS currency detection failed');
                }
            }
        };
        detectCurrency();
    }, [location]);

    const handleClick = async () => {
        if (status === 'idle') {
            setStatus('search');
        } else if (status === 'search') {
            setSessionStart(Math.floor(Date.now() / 1000));
            setParkLocation([location[0], location[1]]);
            setStatus('parked');
        } else if (status === 'parked') {
            setCost('0'); // Reset to 0 for new session
            setShowCostPopup(true);
        }
    };

    const handleFinishParking = async () => {
        setStatus('idle');
        setShowCostPopup(false);

        const lat = parkLocation ? parkLocation[0] : location[0];
        const lon = parkLocation ? parkLocation[1] : location[1];
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
            const expirationTime = endTime + 60; // Expires in 60 seconds

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
                                    className="h-10 w-10 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-white/10 dark:hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronUp size={22} className="text-zinc-600 dark:text-white/70" />
                                </button>
                                <button
                                    onClick={() => setCost(String(Math.max(0, parseFloat(cost || '0') - 1)))}
                                    className="h-10 w-10 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-white/10 dark:hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
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
                                className="w-full text-xs font-bold text-zinc-400 dark:text-white/30 tracking-widest uppercase py-3 hover:text-zinc-600 dark:hover:text-white/50 transition-colors"
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
