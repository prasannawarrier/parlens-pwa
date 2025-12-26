import React, { useState, useEffect } from 'react';
import { Search, MapPin, ArrowRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import { encodeGeohash, getGeohashNeighbors } from '../lib/geo';
import { encryptParkingLog } from '../lib/encryption';
import { getCurrencyFromLocation, getCurrencySymbol, getLocalCurrency } from '../lib/currency';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';

interface FABProps {
    status: 'idle' | 'search' | 'parked' | 'submitting';
    setStatus: (s: 'idle' | 'search' | 'parked' | 'submitting') => void;
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

            // Use subscribeMany for real-time updates
            console.log('[Parlens] Subscribing to spots - Kind:', KINDS.OPEN_SPOT_BROADCAST, 'Geohashes:', geohashes);

            const sub = pool.subscribeMany(
                DEFAULT_RELAYS,
                [{ kinds: [KINDS.OPEN_SPOT_BROADCAST], '#g': geohashes, since: now - 300 }] as any,
                {
                    onevent(event) {
                        try {
                            const tags = event.tags;
                            const locTag = tags.find(t => t[0] === 'location');
                            const priceTag = tags.find(t => t[0] === 'hourly_rate');
                            const currencyTag = tags.find(t => t[0] === 'currency');
                            const typeTag = tags.find(t => t[0] === 'type');

                            if (locTag) {
                                const [lat, lon] = locTag[1].split(',').map(Number);
                                const spotType = typeTag ? typeTag[1] : 'car';

                                if (spotType !== vehicleType) return;

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

                                setOpenSpots((prev: any[]) => {
                                    const now = Math.floor(Date.now() / 1000);
                                    const active = prev.filter((p: any) => !p.expiresAt || p.expiresAt > now);
                                    if (active.find((p: any) => p.id === spot.id)) return active;
                                    console.log('[Parlens] New spot received via SUB:', spot.id);
                                    return [...active, spot];
                                });
                            }
                        } catch (e) {
                            console.warn('[Parlens] Error parsing spot:', e);
                        }
                    },
                    oneose() {
                        console.log('[Parlens] EOSE received for spots');
                    }
                }
            );

            return () => {
                sub.close();
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
            // Check cool-off period
            const lastParked = parseInt(localStorage.getItem('parlens_last_parked_at') || '0');
            const now = Date.now();
            const cooldown = 5 * 60 * 1000; // 5 minutes

            if (now - lastParked < cooldown) {
                const remaining = Math.ceil((cooldown - (now - lastParked)) / 60000);
                alert(`Please wait ${remaining} minutes before searching for a new spot.`);
                return;
            }

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
        // Show submitting state for user feedback
        setShowCostPopup(false);
        setStatus('submitting');

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

            // Cool-off will be set only after confirmation of successful publish

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

            console.log('[Parlens] Publishing log:', signedLog.id, 'to', DEFAULT_RELAYS);
            console.log('[Parlens] Log content (encrypted):', signedLog.content.substring(0, 50) + '...');
            console.log('[Parlens] Log tags:', signedLog.tags);

            const pubs = pool.publish(DEFAULT_RELAYS, signedLog);

            // Wait for all publishes and log results
            const results = await Promise.allSettled(pubs);
            results.forEach((result, i) => {
                if (result.status === 'fulfilled') {
                    console.log(`[Parlens] Relay ${DEFAULT_RELAYS[i]}: Published successfully`);
                } else {
                    console.error(`[Parlens] Relay ${DEFAULT_RELAYS[i]}: Failed -`, result.reason);
                }
            });

            const successCount = results.filter(r => r.status === 'fulfilled').length;
            console.log(`[Parlens] Log published to ${successCount}/${DEFAULT_RELAYS.length} relays`);

            if (successCount > 0) {
                // Set cool-off only on success
                localStorage.setItem('parlens_last_parked_at', Date.now().toString());
            } else {
                alert('Could not save to Nostr. Check relay connections.');
                // Don't set cool-off so user can try again immediately
            }

            // Broadcast open spot (Kind 31714 - Addressable) to help other users
            // Use anonymous one-time keypair for privacy
            const anonPrivkey = generateSecretKey();

            // Calculate hourly rate based on duration and fee (round up to next hour)
            const durationSeconds = endTime - startTime;
            const durationHours = Math.max(Math.ceil(durationSeconds / 3600), 1); // Minimum 1 hour, always round up


            const hourlyRate = (parseFloat(cost) / durationHours).toFixed(2);
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

            const broadcastPubs = pool.publish(DEFAULT_RELAYS, signedBroadcast);
            await Promise.allSettled(broadcastPubs);
            console.log('[Parlens] Broadcast published to relays');

            // Reset session tracking
            setSessionStart(null);
            setParkLocation(null);

            // Now safe to change status after all async work is done
            setStatus('idle');

        } catch (e) {
            console.error('Persistence error:', e);
            alert('Could not save to Nostr. Check relay connections.');
            // Still reset to idle even on error
            setStatus('idle');
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
                    disabled={status === 'submitting'}
                    className={`h-20 w-20 flex items-center justify-center rounded-[2.5rem] shadow-2xl transition-all active:scale-90 ${status === 'idle' ? 'bg-[#007AFF] text-white shadow-blue-500/20' :
                        status === 'search' ? 'bg-[#FF9500] text-white shadow-orange-500/20' :
                            status === 'submitting' ? 'bg-[#007AFF] text-white shadow-blue-500/20' :
                                'bg-[#34C759] text-white shadow-green-500/20'
                        }`}
                >
                    {status === 'idle' && <Search size={32} strokeWidth={2.5} />}
                    {status === 'search' && <MapPin size={32} strokeWidth={2.5} className="animate-pulse" />}
                    {status === 'submitting' && (
                        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
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
