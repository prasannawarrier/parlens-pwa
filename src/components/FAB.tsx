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
    listedParkingSession?: any; // Active listed parking session
    onQRScan?: () => void; // Trigger QR scanner
    routeWaypoints?: { lat: number; lon: number }[]; // Route waypoints for extended search
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
    setSessionStart,
    listedParkingSession,
    onQRScan,
    routeWaypoints
}) => {
    const { pubkey, pool, signEvent } = useAuth();
    const [showCostPopup, setShowCostPopup] = useState(false);
    const [cost, setCost] = useState('0');
    const [parkingNote, setParkingNote] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [symbol, setSymbol] = useState('$');
    const [elapsedTime, setElapsedTime] = useState('00:00:00');

    // Hidden items filtering
    const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());

    // Track cumulative geohashes for the current session
    const [sessionGeohashes, setSessionGeohashes] = useState<Set<string>>(new Set());
    // Use a ref to store spots to avoid blinking/reflickering on every update
    const spotsMapRef = useRef<Map<string, any>>(new Map());
    // Track last search geohash to prevent unnecessary re-searches on iOS GPS drift
    const lastSearchGeohashRef = useRef<string | null>(null);

    // Load hidden items
    useEffect(() => {
        try {
            const saved = localStorage.getItem('parlens-hidden-items');
            if (saved) {
                const items: { id: string }[] = JSON.parse(saved);
                setHiddenItems(new Set(items.map(i => i.id)));
            }
        } catch (e) {
            console.error('Error loading hidden items:', e);
        }
    }, []);

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

    // Update cumulative geohashes when search location or route waypoints change (geohash-stabilized for iOS)
    useEffect(() => {
        if (status === 'search' && searchLocation) {
            // Only trigger if user has moved to a different 5-digit geohash cell (~4.9km)
            const currentGeohash = encodeGeohash(searchLocation[0], searchLocation[1], 5);
            if (currentGeohash === lastSearchGeohashRef.current) {
                return; // Skip - user hasn't moved significantly
            }
            lastSearchGeohashRef.current = currentGeohash;

            const newGeohashes = getGeohashNeighbors(searchLocation[0], searchLocation[1], 5);

            // Also include geohashes for route waypoints
            if (routeWaypoints && routeWaypoints.length > 0) {
                for (const wp of routeWaypoints) {
                    const wpGeohashes = getGeohashNeighbors(wp.lat, wp.lon, 5);
                    wpGeohashes.forEach(g => newGeohashes.push(g));
                }
            }

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
            lastSearchGeohashRef.current = null; // Reset on idle
        }
    }, [status, searchLocation, routeWaypoints, setOpenSpots]);

    // Fetch Open Spots (Kind 31714 & Kind 1714 'open')
    useEffect(() => {
        if (!pool) return;

        // Don't clear existing spots - accumulate across geohashes

        if (status === 'search' && sessionGeohashes.size > 0) {
            console.log('[Parlens] Subscribing to spots in geohashes:', Array.from(sessionGeohashes));

            const now = Math.floor(Date.now() / 1000);

            const processSpotEvent = (event: any, shouldUpdateState = false) => {
                try {
                    const currentTime = Math.floor(Date.now() / 1000);

                    // Check expiration for Kind 31714
                    if (event.kind === KINDS.PARKING_AREA_INDICATOR) {
                        const expirationTag = event.tags.find((t: string[]) => t[0] === 'expiration');
                        if (expirationTag) {
                            const expTime = parseInt(expirationTag[1]);
                            if (expTime < currentTime) return; // Expired
                        }
                    }

                    // Check hidden items
                    if (hiddenItems.has(event.pubkey)) return;

                    // For listed spots, check if listing is hidden
                    if (event.kind === KINDS.LISTED_SPOT_LOG) {
                        const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                        if (aTag) {
                            const parts = aTag.split(':');
                            if (parts.length === 3) {
                                const pkb = parts[1];
                                const d = parts[2];
                                // Check if listing owner or listing ID is hidden
                                if (hiddenItems.has(pkb) || hiddenItems.has(d)) return;
                            }
                        }
                    }

                    // Determine Unique Key (Logical ID)
                    // Kind 1714: Use 'a' tag (address) to handle updates/removals
                    // Kind 31714: Use 'id' (ephemeral)
                    let uniqueKey = event.id;
                    if (event.kind === KINDS.LISTED_SPOT_LOG) {
                        const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                        if (aTag) uniqueKey = aTag;
                    }

                    // Check valid location
                    const locTag = event.tags.find((t: string[]) => t[0] === 'location');
                    let lat = 0;
                    let lon = 0;

                    if (locTag) {
                        [lat, lon] = locTag[1].split(',').map(Number);
                    } else {
                        return;
                    }

                    // Handle Status Updates (Removals)
                    if (event.kind === KINDS.LISTED_SPOT_LOG) {
                        const statusTag = event.tags.find((t: string[]) => t[0] === 'status');
                        // If not open, remove from map if it exists
                        if (statusTag?.[1] !== 'open') {
                            if (spotsMapRef.current.has(uniqueKey)) {
                                spotsMapRef.current.delete(uniqueKey);
                                if (shouldUpdateState) setOpenSpots(Array.from(spotsMapRef.current.values()));
                            }
                            return;
                        }
                    }

                    let spotType = 'car';
                    let price = 0;
                    let spotCurrency = 'USD';
                    let spotCount = 1;
                    let listingName: string | undefined;

                    if (event.kind === KINDS.PARKING_AREA_INDICATOR) {
                        const priceTag = event.tags.find((t: string[]) => t[0] === 'hourly_rate');
                        const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency');
                        const typeTag = event.tags.find((t: string[]) => t[0] === 'type');
                        price = priceTag ? parseFloat(priceTag[1]) : 0;
                        spotCurrency = currencyTag ? currencyTag[1] : 'USD';
                        spotType = typeTag ? typeTag[1] : 'car';
                    } else if (event.kind === KINDS.LISTED_SPOT_LOG) {
                        if (!locTag) return;

                        const typeTag = event.tags.find((t: string[]) => t[0] === 'type');
                        const rateTag = event.tags.find((t: string[]) => t[0] === 'hourly_rate');
                        const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency');
                        const listingNameTag = event.tags.find((t: string[]) => t[0] === 'listing_name');

                        spotType = typeTag?.[1] || 'car';
                        price = rateTag ? parseFloat(rateTag[1]) : 0;
                        spotCurrency = currencyTag?.[1] || 'USD';
                        listingName = listingNameTag?.[1];

                        if (spotType !== vehicleType) return;
                    }

                    const spot = {
                        id: event.id,
                        lat,
                        lon,
                        price: price,
                        currency: spotCurrency,
                        type: spotType,
                        count: spotCount,
                        kind: event.kind,
                        created_at: event.created_at,
                        listing_name: listingName
                    };

                    // Update Map & State
                    spotsMapRef.current.set(uniqueKey, spot);
                    if (shouldUpdateState) {
                        setOpenSpots(Array.from(spotsMapRef.current.values()));
                    }

                } catch (e) {
                    console.warn('[Parlens] Error parsing spot event:', e);
                }
            };

            // 1. Immediate fetch of existing spots - with isolated error handling per Kind
            const initialFetch = async () => {
                // Determine query geohash(es) - use per-waypoint geohashes for routes, neighbors for single location
                let queryGeohashes: string[] = [];
                if (routeWaypoints && routeWaypoints.length > 0) {
                    // Route mode: Generate 5-char geohash for EACH waypoint
                    // This handles routes spanning different geohash regions (even with no common prefix)
                    const waypointHashes = new Set<string>();
                    routeWaypoints.forEach(wp => {
                        waypointHashes.add(encodeGeohash(wp.lat, wp.lon, 5));
                    });
                    queryGeohashes = Array.from(waypointHashes);
                    console.log('[Parlens] FAB: Using route waypoint geohashes:', queryGeohashes);
                }
                // Fallback to session geohashes (neighbors) if no route or bad prefix
                if (queryGeohashes.length === 0) {
                    queryGeohashes = Array.from(sessionGeohashes);
                }

                if (queryGeohashes.length === 0) return; // No geohashes to query

                // === BATCH 1: Parking Area Indicators (Kind 31714) ===
                try {
                    const areaTimeFilter = localStorage.getItem('parlens_parking_area_filter') || 'week';
                    let areaSince = now - 604800; // Default: 7 days
                    if (areaTimeFilter === 'today') areaSince = now - 86400;
                    else if (areaTimeFilter === 'month') areaSince = now - 2592000;
                    else if (areaTimeFilter === 'year') areaSince = now - 31536000;
                    else if (areaTimeFilter === 'all') areaSince = 0;

                    const broadcastEvents = await pool.querySync(
                        DEFAULT_RELAYS,
                        {
                            kinds: [KINDS.PARKING_AREA_INDICATOR],
                            '#g': queryGeohashes,
                            since: areaSince
                        } as any
                    );

                    // Process broadcast events immediately
                    for (const event of broadcastEvents) {
                        processSpotEvent(event);
                    }
                    // Update state after Batch 1
                    if (spotsMapRef.current.size > 0) {
                        setOpenSpots(Array.from(spotsMapRef.current.values()));
                    }
                    console.log('[Parlens] Batch 1 (Kind 31714) loaded:', broadcastEvents.length, 'events');
                } catch (e) {
                    console.error('[Parlens] Batch 1 (Kind 31714) failed:', e);
                }

                // === BATCH 2: Listed Spot Logs (Kind 1714) + Orphan Validation ===
                // Combined to ensure orphans never appear temporarily on the map
                try {
                    const spotStatusEvents = await pool.querySync(
                        DEFAULT_RELAYS,
                        {
                            kinds: [KINDS.LISTED_SPOT_LOG],
                            '#g': queryGeohashes,
                        } as any
                    );
                    console.log('[Parlens] Batch 2 (Kind 1714) loaded:', spotStatusEvents.length, 'events');

                    // Process spot status events - only keep latest per spot (a-tag)
                    const latestBySpot = new Map<string, any>();
                    // Collect parent Listing Metadata addresses via 'root' tag to validate existence
                    const parentListingAddresses = new Set<string>();

                    for (const event of spotStatusEvents) {
                        const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                        if (!aTag) continue;

                        // Get root a-tag pointing to parent Listing (has 'root' marker at position 3)
                        // Format: ['a', '31147:pubkey:d_tag', '', 'root']
                        const rootATag = event.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                        if (rootATag) {
                            const parts = rootATag.split(':');
                            if (parts.length === 3) {
                                parentListingAddresses.add(rootATag);
                            }
                        }

                        const existing = latestBySpot.get(aTag);
                        if (!existing || existing.created_at < event.created_at) {
                            latestBySpot.set(aTag, event);
                        }
                    }

                    // Batch verify parent existence (Kind 31147 Listed Parking Metadata)
                    // If the parent Listing (31147) is deleted, the Spot Log (1714) is an orphan.
                    if (parentListingAddresses.size > 0) {
                        const uniqueAddresses = Array.from(parentListingAddresses);

                        const dTags = new Set<string>();
                        const authors = new Set<string>();
                        uniqueAddresses.forEach(a => {
                            const p = a.split(':');
                            if (p.length === 3) {
                                authors.add(p[1]);
                                dTags.add(p[2]);
                            }
                        });

                        const validListingsMap = await pool.querySync(DEFAULT_RELAYS, {
                            kinds: [KINDS.LISTED_PARKING_METADATA], // 31147
                            '#d': Array.from(dTags),
                            authors: Array.from(authors)
                        } as any);

                        // Create set of valid listing addresses found
                        const validAddresses = new Set<string>();
                        validListingsMap.forEach((e: any) => {
                            const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
                            if (d) validAddresses.add(`${KINDS.LISTED_PARKING_METADATA}:${e.pubkey}:${d}`);
                        });

                        // Filter Process loop - only add valid (non-orphaned) spots
                        // Events without root a-tags (legacy) are skipped
                        for (const event of latestBySpot.values()) {
                            const rootATag = event.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                            if (rootATag && validAddresses.has(rootATag)) {
                                processSpotEvent(event);
                            }
                        }
                    }
                    // If no parentListingAddresses found, nothing is processed (strict mode)

                    // Update state after Batch 2 (now includes orphan filtering)
                    if (spotsMapRef.current.size > 0) {
                        setOpenSpots(Array.from(spotsMapRef.current.values()));
                    } else {
                        setOpenSpots([]);
                    }
                    console.log('[Parlens] Batch 2 (Kind 1714 + orphan validation) completed');
                } catch (e) {
                    console.error('[Parlens] Batch 2 (Kind 1714 + orphan validation) failed:', e);
                }
            };
            initialFetch();

            // 2. Subscribe to NEW spots in real-time (from now onwards only)
            const sub = pool.subscribeMany(
                DEFAULT_RELAYS,
                [
                    {
                        kinds: [KINDS.PARKING_AREA_INDICATOR, KINDS.LISTED_SPOT_LOG],
                        '#g': Array.from(sessionGeohashes),
                        since: now  // Only NEW events from this point on
                    }
                ] as any,
                {
                    onevent(event) {
                        // Use updated process logic with state update enabled
                        processSpotEvent(event, true);
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

    const hasCheckedCurrency = useRef(false);

    useEffect(() => {
        const detectCurrency = async () => {
            // Only check once
            if (hasCheckedCurrency.current) return;

            // First use locale as fallback
            const localCurrency = getLocalCurrency();
            setCurrency(localCurrency);
            setSymbol(getCurrencySymbol(localCurrency));

            // Then try GPS-based detection
            if (searchLocation) {
                hasCheckedCurrency.current = true; // Mark as checked
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
            if (listedParkingSession) {
                onQRScan?.();
            } else {
                setCost('0'); // Reset to 0 for new session
                setShowCostPopup(true);
            }
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
                note: parkingNote || undefined, // Optional note
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
            // ONLY if user has opted in via Profile settings
            const shareParkingAreas = localStorage.getItem('parlens_share_parking_areas');
            if (shareParkingAreas === 'true') {
                // Use anonymous one-time keypair for privacy
                const anonPrivkey = generateSecretKey();

                // Calculate hourly rate based on duration and fee
                // Round duration UP to whole hours (10 mins = 1hr, 61 mins = 2hrs)
                const durationSeconds = endTime - startTime;
                const durationHours = Math.max(Math.ceil(durationSeconds / 3600), 1); // Minimum 1 hour
                const hourlyRate = String(Math.round(parseFloat(cost) / durationHours));

                const broadcastEventTemplate = {
                    kind: KINDS.PARKING_AREA_INDICATOR,
                    content: '',
                    tags: [
                        ['d', `spot_${geohash}_${endTime}`], // Unique identifier for addressable event
                        ['g', geohash],
                        // Add hierarchical geohash tags (1-10 chars) for flexible route queries
                        ...Array.from({ length: Math.min(geohash.length, 10) }, (_, i) => ['g', geohash.substring(0, i + 1)]).filter(tag => tag[1].length < geohash.length),
                        ['location', `${lat},${lon}`],
                        ['hourly_rate', hourlyRate],
                        ['currency', currency],
                        ['type', vehicleType],
                        ['session_start', String(startTime)],
                        ['session_end', String(endTime)],
                        ['client', 'parlens']
                    ],
                    created_at: endTime,
                };

                // Sign with anonymous key using nostr-tools
                const signedBroadcast = finalizeEvent(broadcastEventTemplate, anonPrivkey);

                console.log('[Parlens] *** BROADCASTING OPEN SPOT (User opted in) ***');
                console.log('[Parlens] Geohash:', geohash);
                console.log('[Parlens] Location:', `${lat},${lon}`);
                console.log('[Parlens] Event ID:', signedBroadcast.id);
                console.log('[Parlens] Pubkey:', signedBroadcast.pubkey.substring(0, 20) + '...');
                pool.publish(DEFAULT_RELAYS, signedBroadcast);
            } else {
                console.log('[Parlens] Parking area reporting is disabled. Skipping Kind 31714 broadcast.');
            }

            // Reset session tracking
            setSessionStart(null);
            setParkLocation(null);
            setParkingNote('');

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

                        {/* Notes input */}
                        <input
                            type="text"
                            value={parkingNote}
                            onChange={(e) => setParkingNote(e.target.value)}
                            placeholder="Add a note (optional)"
                            className="w-full bg-zinc-100 dark:bg-white/5 px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/50"
                        />

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
