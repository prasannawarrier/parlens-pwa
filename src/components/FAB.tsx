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
    const prevVehicleTypeRef = React.useRef(vehicleType);

    // Search for open spots when entering search mode
    useEffect(() => {
        if (status === 'search' && location) {
            // Only clear spots when vehicleType changes, not on every refresh
            if (prevVehicleTypeRef.current !== vehicleType) {
                setOpenSpots([]);
                prevVehicleTypeRef.current = vehicleType;
            }

            // Get center + 8 neighboring geohashes for boundary-safe discovery
            const geohashes = getGeohashNeighbors(location[0], location[1], 5);
            console.log('[Parlens] Searching for spots in geohashes:', geohashes);

            const now = Math.floor(Date.now() / 1000);
            console.log('[Parlens] Searching for open spots - Kind:', KINDS.OPEN_SPOT_BROADCAST, 'Geohashes:', geohashes);

            // Use querySync which was proven to work in testing
            const searchSpots = async () => {
                try {
                    console.log('[Parlens] Starting querySync...');
                    const events = await pool.querySync(
                        DEFAULT_RELAYS,
                        { kinds: [KINDS.OPEN_SPOT_BROADCAST], '#g': geohashes, since: now - 300 } as any
                    );
                    console.log('[Parlens] querySync returned', events.length, 'events');

                    const currentTime = Math.floor(Date.now() / 1000);

                    for (const event of events) {
                        console.log('[Parlens] Processing event - ID:', event.id.substring(0, 16), 'Kind:', event.kind);

                        // Check expiration tag
                        const expirationTag = event.tags.find(t => t[0] === 'expiration');
                        if (expirationTag) {
                            const expTime = parseInt(expirationTag[1]);
                            console.log('[Parlens] Expiration check:', expTime, 'vs current:', currentTime, 'expired:', expTime < currentTime);
                            if (expTime < currentTime) {
                                console.log('[Parlens] Skipping expired spot');
                                continue;
                            }
                        }

                        try {
                            const tags = event.tags;
                            const locTag = tags.find(t => t[0] === 'location');
                            const priceTag = tags.find(t => t[0] === 'hourly_rate');
                            const currencyTag = tags.find(t => t[0] === 'currency');
                            const typeTag = tags.find(t => t[0] === 'type');

                            console.log('[Parlens] Tags - location:', locTag?.[1], 'type:', typeTag?.[1], 'price:', priceTag?.[1]);

                            if (locTag) {
                                const [lat, lon] = locTag[1].split(',').map(Number);
                                const spotType = typeTag ? typeTag[1] : 'car';

                                // Filter spots by vehicle type - only show matching spots
                                if (spotType !== vehicleType) {
                                    console.log('[Parlens] Skipping spot - type mismatch:', spotType, 'vs', vehicleType);
                                    continue;
                                }

                                // Get expiration from event tags
                                const expTag = event.tags.find(t => t[0] === 'expiration');
                                const expiresAt = expTag ? parseInt(expTag[1]) : (Math.floor(Date.now() / 1000) + 300);

                                const spot = {
                                    id: event.id,
                                    lat,
                                    lon,
                                    price: priceTag ? parseFloat(priceTag[1]) : 0,
                                    currency: currencyTag ? currencyTag[1] : 'USD',
                                    type: spotType,
                                    expiresAt
                                };
                                console.log('[Parlens] *** ADDING SPOT TO MAP ***', spot);
                                setOpenSpots((prev: any[]) => {
                                    // First filter out expired spots
                                    const now = Math.floor(Date.now() / 1000);
                                    const active = prev.filter((p: any) => !p.expiresAt || p.expiresAt > now);

                                    if (active.find((p: any) => p.id === spot.id)) {
                                        console.log('[Parlens] Spot already exists, skipping');
                                        return active;
                                    }
                                    console.log('[Parlens] New spots array length:', active.length + 1);
                                    return [...active, spot];
                                });
                            } else {
                                console.log('[Parlens] No location tag found');
                            }
                        } catch (e) {
                            console.warn('[Parlens] Error parsing spot:', e);
                        }
                    }
                } catch (e) {
                    console.error('[Parlens] querySync error:', e);
                }
            };

            // Run immediately
            searchSpots();

            // Also refresh every 30 seconds while in search mode
            const intervalId = setInterval(() => {
                console.log('[Parlens] Refreshing spot search...');
                searchSpots();
            }, 30000);

            return () => {
                clearInterval(intervalId);
                // Don't clear spots - let them persist until expiration
            };
        }
    }, [status, location, vehicleType]);

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
            // Clear spots when entering parked state (in case of session restore)
            setOpenSpots([]);
        } else if (status === 'search') {
            localStorage.setItem('parlens_session', JSON.stringify({ status: 'search' }));
        } else if (status === 'idle') {
            localStorage.removeItem('parlens_session');
            // Clear spots when returning to idle
            setOpenSpots([]);
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
            setOpenSpots([]); // Clear spots when starting parking session
            setStatus('parked');
        } else if (status === 'parked') {
            setCost('0'); // Reset cost to 0 when opening popup
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
                type: vehicleType,
                lat,
                lon,
                geohash,
                fee: cost,
                currency,
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
                    ['g', geohash],
                    ['client', 'parlens'],
                    ['d', `session_${startTime}`] // Unique ID for history
                ],
                created_at: endTime,
                pubkey: pubkey!,
            };

            const signedLog = await signEvent(logEvent);

            console.log('Publishing log:', signedLog.id, 'to', DEFAULT_RELAYS);
            const pubs = pool.publish(DEFAULT_RELAYS, signedLog);

            // Wait for all publishes to at least attempt
            await Promise.allSettled(pubs);
            console.log('Log published');

            // Broadcast open spot (Kind 31714 - Addressable) to help other users
            // Use anonymous one-time keypair for privacy
            const anonPrivkey = generateSecretKey();

            // Calculate hourly rate based on duration and fee (round up to next hour)
            const durationSeconds = endTime - startTime;
            const durationHours = Math.max(Math.ceil(durationSeconds / 3600), 1); // Minimum 1 hour, always round up
            const hourlyRate = (parseFloat(cost) / durationHours).toFixed(2);
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
                        onClick={() => { setOpenSpots([]); setStatus('idle'); }}
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
                <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 p-4">
                    <div className="w-full max-w-sm bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col items-center space-y-5 animate-in slide-in-from-bottom-10 sm:zoom-in-95 border border-black/5 dark:border-white/10 transition-colors">
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
