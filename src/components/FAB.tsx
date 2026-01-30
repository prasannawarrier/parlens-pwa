import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, ArrowRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS, APPROVER_PUBKEY } from '../lib/nostr';
import { encodeGeohash, getGeohashNeighbors } from '../lib/geo';
import { encryptParkingLog } from '../lib/encryption';
import { getCurrencyFromLocation, getCurrencySymbol, getLocalCurrency } from '../lib/currency';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import { relayHealthMonitor } from '../lib/relayHealth';

interface FABProps {
    status: 'idle' | 'search' | 'parked';
    setStatus: (s: 'idle' | 'search' | 'parked') => void;
    searchLocation: [number, number] | null; // Allow null to prevent premptive searches
    userLocation: [number, number] | null; // User's actual GPS location for parked marker
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    setOpenSpots: React.Dispatch<React.SetStateAction<any[]>>;
    parkLocation: [number, number] | null;
    setParkLocation: (loc: [number, number] | null) => void;
    sessionStart: number | null;
    setSessionStart: (time: number | null) => void;
    listedParkingSession?: any; // Active listed parking session
    onQRScan?: () => void; // Trigger QR scanner
    onSpotStatusUpdate?: (spotId: string, status: string, event: any) => void;
}

// Memoized to prevent re-renders on map drag (LandingPage viewState updates)
export const FAB = React.memo<FABProps>(({
    status,
    setStatus,
    searchLocation,
    userLocation,
    vehicleType,
    setOpenSpots,
    parkLocation,
    setParkLocation,
    sessionStart,
    setSessionStart,
    listedParkingSession,
    onQRScan,
    onSpotStatusUpdate
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
    // Track approved listing a-tags (fetched from approver's Kind 1985 labels)
    const approvedListingATagsRef = useRef<Set<string>>(new Set());

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
    }, [status, searchLocation, setOpenSpots]);

    // Fetch Open Spots (Kind 31714 & Kind 1714 'open')
    useEffect(() => {
        if (!pool) return;

        // Don't clear existing spots - accumulate across geohashes

        if (status === 'search' && sessionGeohashes.size > 0) {
            console.log('[Parlens] Subscribing to spots in geohashes:', Array.from(sessionGeohashes));

            const now = Math.floor(Date.now() / 1000);

            // Shared helper to aggregate spots by listing for UI
            function updateOpenSpotsState() {
                const individualSpots = Array.from(spotsMapRef.current.values());
                const aggregated = new Map<string, any>();

                individualSpots.forEach(s => {
                    // Group by listing a-tag if available
                    if (s.listing_a_tag) {
                        if (aggregated.has(s.listing_a_tag)) {
                            const existing = aggregated.get(s.listing_a_tag);
                            existing.count += 1;
                            // Keep mostly existing metadata, maybe update timestamp if newer
                            if (s.created_at > existing.created_at) {
                                existing.created_at = s.created_at;
                            }
                        } else {
                            // Start new group, use listing a-tag as ID
                            aggregated.set(s.listing_a_tag, { ...s, count: 1, id: s.listing_a_tag });
                        }
                    } else {
                        // Keep independent spots as they are
                        aggregated.set(s.id, s);
                    }
                });

                setOpenSpots(Array.from(aggregated.values()));
            }

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

                    // Check hidden items (Basic Pubkey check)
                    if (hiddenItems.has(event.pubkey)) return;

                    // Parse Listing Info early for hidden check
                    let listingId: string | undefined;
                    let listingATag: string | undefined;
                    let listingName: string | undefined;
                    let spotType = 'car';
                    let price = 0;
                    let spotCurrency = 'USD';

                    // Check valid location early
                    const locTag = event.tags.find((t: string[]) => t[0] === 'location');
                    let lat = 0;
                    let lon = 0;

                    if (locTag) {
                        [lat, lon] = locTag[1].split(',').map(Number);
                    } else {
                        return;
                    }

                    if (event.kind === KINDS.LISTED_SPOT_LOG) {
                        const rootATag = event.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                        if (rootATag) {
                            const parts = rootATag.split(':');
                            if (parts.length === 3) {
                                listingId = parts[2]; // D-tag of the listing
                                listingATag = rootATag; // Full address
                                const pkb = parts[1];

                                // Check if listing owner or listing ID is hidden
                                if (hiddenItems.has(pkb) || (listingId && hiddenItems.has(listingId))) return;
                            }
                        }

                        // Handle Status Updates (Removals) - Logic depends on uniqueKey
                        const statusTag = event.tags.find((t: string[]) => t[0] === 'status');

                        // Determine Unique Key (Spot A-Tag)
                        let uniqueKey = event.id;
                        const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                        if (aTag) uniqueKey = aTag;

                        // Trigger callback for Listed Session Cancellation (if active spot changes status)
                        if (onSpotStatusUpdate && listedParkingSession && listedParkingSession.spotATag === uniqueKey) {
                            onSpotStatusUpdate(uniqueKey, statusTag?.[1] || 'unknown', event);
                        }

                        if (statusTag?.[1] !== 'open') {
                            if (spotsMapRef.current.has(uniqueKey)) {
                                spotsMapRef.current.delete(uniqueKey);
                                if (shouldUpdateState) updateOpenSpotsState();
                            }
                            return;
                        }

                        // Parse Metadata
                        const typeTag = event.tags.find((t: string[]) => t[0] === 'type');
                        const rateTag = event.tags.find((t: string[]) => t[0] === 'hourly_rate');
                        const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency');
                        const listingNameTag = event.tags.find((t: string[]) => t[0] === 'listing_name');

                        spotType = typeTag?.[1] || 'car';
                        price = rateTag ? (Number(rateTag[1]) || 0) : 0;
                        spotCurrency = currencyTag?.[1] || 'USD';
                        listingName = listingNameTag?.[1];

                        if (spotType !== vehicleType) return;

                        // Race Condition Check: Don't overwrite newer data with older data
                        const existing = spotsMapRef.current.get(uniqueKey);
                        if (existing && existing.created_at > event.created_at) {
                            return;
                        }

                        // Update Map
                        const spot = {
                            id: event.id,
                            lat,
                            lon,
                            price,
                            currency: spotCurrency,
                            type: spotType,
                            count: 1,
                            kind: event.kind,
                            created_at: event.created_at,
                            listing_name: listingName,
                            listing_id: listingId,
                            listing_a_tag: listingATag,
                            tags: event.tags
                        };
                        spotsMapRef.current.set(uniqueKey, spot);

                    } else if (event.kind === KINDS.PARKING_AREA_INDICATOR) {
                        // ... Standard Indicator Logic ...
                        const priceTag = event.tags.find((t: string[]) => t[0] === 'hourly_rate');
                        const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency');
                        const typeTag = event.tags.find((t: string[]) => t[0] === 'type');
                        price = priceTag ? (Number(priceTag[1]) || 0) : 0;
                        spotCurrency = currencyTag ? currencyTag[1] : 'USD';
                        spotType = typeTag ? typeTag[1] : 'car';

                        const spot = {
                            id: event.id,
                            lat,
                            lon,
                            price,
                            currency: spotCurrency,
                            type: spotType,
                            count: 1,
                            kind: event.kind,
                            created_at: event.created_at,
                            tags: event.tags
                        };
                        spotsMapRef.current.set(event.id, spot);
                    }

                    if (shouldUpdateState) {
                        updateOpenSpotsState();
                    }

                } catch (e) {
                    console.warn('[Parlens] Error parsing spot event:', e);
                }
            };

            // 1. Immediate fetch of existing spots - with isolated error handling per Kind
            const initialFetch = async () => {
                // Query based on session geohashes (current location neighbors)
                const queryGeohashes = Array.from(sessionGeohashes);

                if (queryGeohashes.length === 0) return; // No geohashes to query

                // === BATCH 1: Parking Area Indicators (Kind 31714) ===
                try {
                    const areaTimeFilter = localStorage.getItem('parlens_parking_area_filter') || 'all';
                    let areaSince = now - 604800; // Default: 7 days
                    if (areaTimeFilter === 'today') areaSince = now - 86400;
                    else if (areaTimeFilter === 'month') areaSince = now - 2592000;
                    else if (areaTimeFilter === 'year') areaSince = now - 31536000;
                    else if (areaTimeFilter === 'all') areaSince = 0;

                    const batch1Start = Date.now();
                    const broadcastEvents = await pool.querySync(
                        DEFAULT_RELAYS,
                        {
                            kinds: [KINDS.PARKING_AREA_INDICATOR],
                            '#g': queryGeohashes,
                            since: areaSince
                        } as any
                    );
                    const batch1Latency = Date.now() - batch1Start;

                    // Record success for all healthy relays
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, batch1Latency));

                    // Process broadcast events immediately
                    for (const event of broadcastEvents) {
                        processSpotEvent(event);
                    }
                    // Update state after Batch 1
                    if (spotsMapRef.current.size > 0) {
                        setOpenSpots(Array.from(spotsMapRef.current.values()));
                    }
                    console.log('[Parlens] Batch 1 (Kind 31714) loaded:', broadcastEvents.length, 'events in', batch1Latency, 'ms');
                } catch (e) {
                    // Record failure for all relays
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordFailure(relay));
                    console.error('[Parlens] Batch 1 (Kind 31714) failed:', e);
                }

                // === BATCH 1.5: No-Parking Labels (Kind 1985) ===
                // Fetch Kind 1985 labels with no-parking tag for visible area
                try {
                    const noParkingLabelEvents = await pool.querySync(
                        DEFAULT_RELAYS,
                        {
                            kinds: [KINDS.LABEL],
                            '#g': queryGeohashes,
                            '#L': ['parlens'],
                            '#l': ['no-parking']
                        } as any
                    );

                    // Add no-parking labels to openSpots for aggregation
                    for (const event of noParkingLabelEvents) {
                        const geohash = event.tags.find((t: string[]) => t[0] === 'g')?.[1];
                        const locationTag = event.tags.find((t: string[]) => t[0] === 'location')?.[1];
                        if (!geohash) continue;

                        // Create a spot-like object for aggregation
                        const labelSpot = {
                            id: event.id,
                            kind: KINDS.LABEL,
                            tags: event.tags,
                            lat: locationTag ? parseFloat(locationTag.split(',')[0]) : 0,
                            lon: locationTag ? parseFloat(locationTag.split(',')[1]) : 0,
                            price: 0,
                            currency: 'INR',
                            created_at: event.created_at,
                            pubkey: event.pubkey
                        };
                        spotsMapRef.current.set(event.id, labelSpot);
                    }

                    if (noParkingLabelEvents.length > 0) {
                        setOpenSpots(Array.from(spotsMapRef.current.values()));
                        console.log('[Parlens] Batch 1.5 (Kind 1985 no-parking) loaded:', noParkingLabelEvents.length, 'labels');
                    }
                } catch (e) {
                    console.error('[Parlens] Batch 1.5 (Kind 1985 no-parking) failed:', e);
                }

                // === BATCH 2: Listed Spot Logs (Kind 1714) + Orphan Validation ===
                // Combined to ensure orphans never appear temporarily on the map
                try {
                    const batch2Start = Date.now();
                    const spotStatusEvents = await pool.querySync(
                        DEFAULT_RELAYS,
                        {
                            kinds: [KINDS.LISTED_SPOT_LOG],
                            '#g': queryGeohashes,
                        } as any
                    );
                    const batch2Latency = Date.now() - batch2Start;
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordSuccess(relay, batch2Latency));
                    console.log('[Parlens] Batch 2 (Kind 1714) loaded:', spotStatusEvents.length, 'events in', batch2Latency, 'ms');

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

                        // === APPROVAL FILTER ===
                        // Fetch Kind 1985 (Label) from APPROVER_PUBKEY to get approved listing a-tags
                        try {
                            const approvalEvents = await pool.querySync(DEFAULT_RELAYS, {
                                kinds: [KINDS.LABEL],
                                authors: [APPROVER_PUBKEY],
                                '#l': ['approved']
                            } as any);

                            // Build set of approved listing a-tags
                            approvedListingATagsRef.current = new Set();
                            for (const event of approvalEvents) {
                                const aTag = event.tags.find((t: string[]) => t[0] === 'a')?.[1];
                                if (aTag) approvedListingATagsRef.current.add(aTag);
                            }
                            console.log('[Parlens] Found', approvedListingATagsRef.current.size, 'approved listings from approver');
                        } catch (e) {
                            console.error('[Parlens] Failed to fetch approval labels:', e);
                        }

                        // Filter Process loop - only add valid (non-orphaned) AND approved spots
                        // Events without root a-tags (legacy) are skipped
                        for (const event of latestBySpot.values()) {
                            const rootATag = event.tags.find((t: string[]) => t[0] === 'a' && t[3] === 'root')?.[1];
                            if (rootATag && validAddresses.has(rootATag)) {
                                // Check if listing is approved (from APPROVER or has approval label)
                                const listingPubkey = rootATag.split(':')[1];
                                const isAutoApproved = listingPubkey === APPROVER_PUBKEY;
                                const hasApprovalLabel = approvedListingATagsRef.current.has(rootATag);

                                if (isAutoApproved || hasApprovalLabel) {
                                    processSpotEvent(event);
                                }
                            }
                        }
                    }
                    // If no parentListingAddresses found, nothing is processed (strict mode)

                    // Update state after Batch 2 (now includes orphan filtering)
                    if (spotsMapRef.current.size > 0) {
                        updateOpenSpotsState();
                    } else {
                        setOpenSpots([]);
                    }
                    console.log('[Parlens] Batch 2 (Kind 1714 + orphan validation) completed');
                } catch (e) {
                    DEFAULT_RELAYS.forEach(relay => relayHealthMonitor.recordFailure(relay));
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
            // Use user's actual GPS location for parked marker, not screen center
            setParkLocation(userLocation ? [userLocation[0], userLocation[1]] : null);
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
        <div className="relative flex flex-col items-end gap-4 pointer-events-none">
            <div className="flex items-center gap-4">
                {status === 'search' && (
                    <button
                        onClick={() => setStatus('idle')}
                        className="h-14 px-8 rounded-full bg-red-500/90 text-white font-bold text-xs tracking-widest shadow-2xl backdrop-blur-md animate-in slide-in-from-left-8 pointer-events-auto"
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
                    className={`h-20 w-20 flex items-center justify-center rounded-[2.5rem] shadow-2xl transition-all active:scale-90 pointer-events-auto ${status === 'idle' ? 'bg-[#007AFF] text-white shadow-blue-500/20' :
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
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 p-4 pointer-events-auto">
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
});
