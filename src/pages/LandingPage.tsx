/**
 * Landing Page with Pure MapLibre GL JS
 * Replaces Leaflet for native vector map rotation and smooth zoom
 */
import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { MapPin, Locate, X, ChevronDown, Check, Trash, Pencil, QrCode, ArrowUp, ArrowRight, ArrowLeft, ChevronUp, Copy, ScanLine, Route } from 'lucide-react';
import Map, { Marker, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';
import { RouteButton } from '../components/RouteButton';
import { clusterSpots, isCluster } from '../lib/clustering';
import { getCurrencySymbol } from '../lib/currency';
// @ts-ignore
import Geohash from 'ngeohash';
import { StableLocationTracker, LocationSmoother, PositionAnimator, BearingAnimator } from '../lib/locationSmoothing';
import { useWakeLock } from '../hooks/useWakeLock';
import { ListedParkingPage } from './ListedParkingPage';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import { QRCodeSVG } from 'qrcode.react';

// Free vector tile styles - using simpler styles that match better
const MAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
};





// Restored Stable SpotMarkerContent
const SpotMarkerContent = memo(({ price, emoji, currency, isHistory = false }: { price: number, emoji: string, currency: string, isHistory?: boolean }) => {
    const symbol = getCurrencySymbol(currency);
    return (
        <div className="flex flex-col items-center justify-center transition-transform active:scale-95 pointer-events-none group">
            <div className="text-[32px] leading-none drop-shadow-md z-10 filter pointer-events-auto cursor-pointer">
                {emoji}
            </div>
            <div
                className={`
                    px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-md border-[1.5px] border-white -mt-1.5 z-0 whitespace-nowrap pointer-events-auto
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}
            >
                {symbol}{Math.round(price)}/hr
            </div>
        </div>
    );
});


// User Location Marker Component
const UserLocationMarker = memo(({ bearing, mapBearing, isNavigationMode }: { bearing: number; mapBearing: number; isNavigationMode: boolean }) => {
    // In navigation mode, map is rotated "Up" (Bearing). User matches Bearing. Relative = 0.
    // In fixed mode, Map Bearing is B. User Heading is H.
    // Screen Up is -B. Screen User Dir is H.
    // We want arrow to point H relative to screen.
    // Marker rotates with map? If yes, it points -B (Map North).
    // We need to rotate it R such that -B + R = H  =>  R = H + B ?
    // No, react-map-gl Marker is screen-aligned (rotationAlignment="auto" -> "viewport").
    // So Marker Up is Screen Up (0).
    // We want Marker to point H relative to screen.
    // But H is absolute (0=North).
    // Simplified Rotation Logic:
    // Auto/Navigation Mode: Map rotates. Marker Points UP (Relative 0).
    // Fixed Mode: Map is Fixed (0 or user-set). Marker Points Compass Bearing.

    // In AutoMode: We pass "bearing" (Smoothed User Heading) to the map as the bearing.
    // So the Map rotates such that "North" is at -Bearing.
    // The screen "Forward" is Bearing.
    // So the marker should just point UP (0).

    // Unified Rotation Logic:
    // Always calculate targetRotation = bearing - mapBearing.
    // In Fixed Mode: mapBearing is roughly constant (0 or set). Bearing rotates. Marker rotates.
    // In Auto Mode: mapBearing follows Bearing. Ideally targetRotation = 0.
    // BUT due to animation lag, mapBearing might lag behind Bearing.
    // By using (Bearing - MapBearing), the marker points to the TRUE Bearing relative to Screen/Map.
    // If Map lags by 5deg, Marker points 5deg right (True North). This masks the lag.

    const targetRotation = bearing - mapBearing;

    // Shortest Path Logic
    const rotationRef = useRef(0);
    const lastTargetRef = useRef(0);
    const diff = targetRotation - lastTargetRef.current;
    if (Math.abs(diff) > 180) {
        if (diff > 0) {
            rotationRef.current -= 360;
        } else {
            rotationRef.current += 360;
        }
    }
    lastTargetRef.current = targetRotation;
    const finalRotation = targetRotation + rotationRef.current;


    const scale = isNavigationMode ? 1 : 1;

    return (
        <div
            style={{
                transform: `rotate(${finalRotation}deg) scale(${scale})`,
                transition: 'transform 0.2s ease-out', // Re-enabled to smooth out compass noise
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none'
            }}
        >
            <div
                style={{
                    width: 28,
                    height: 28,
                    background: '#007AFF',
                    border: '3px solid white',
                    borderRadius: '50%',
                    boxShadow: `0 0 0 ${isNavigationMode ? 3 : 2}px rgba(0,122,255,${isNavigationMode ? 0.5 : 0.4}), 0 4px 12px rgba(0,0,0,0.4)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                {/* Arrow always points UP relative to the rotation container */}
                <svg width="14" height="14" viewBox="0 0 14 14" style={{ transform: 'translateY(-1px)' }}>
                    <path d="M7 0L14 14L7 12L0 14L7 0Z" fill="white" />
                </svg>
            </div>
        </div>
    );
});
UserLocationMarker.displayName = 'UserLocationMarker';



// Cluster Marker Component
const ClusterMarkerContent = memo(({ count, minPrice, maxPrice, currency, type }: {
    count: number; minPrice: number; maxPrice: number; currency: string; type: 'open' | 'history'
}) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const isHistory = type === 'history';
    const symbol = getCurrencySymbol(currency);
    const priceRange = minPrice === maxPrice ? `${symbol}${minPrice}` : `${symbol}${minPrice}-${maxPrice}`;

    return (
        <div className="flex flex-col items-center justify-center transition-transform active:scale-95 pointer-events-none group">
            <div className="relative text-[32px] leading-none drop-shadow-md z-10 filter pointer-events-auto cursor-pointer">
                {emoji}
                {/* Count Badge */}
                <div className={`
                    absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1
                    text-[10px] font-bold text-white rounded-full border-2 border-white shadow-sm
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}>
                    {count}
                </div>
            </div>
            <div
                className={`
                    px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-md border-[1.5px] border-white -mt-1.5 z-0 whitespace-nowrap
                    ${isHistory ? 'bg-zinc-500' : 'bg-[#34C759]'}
                `}
            >
                {priceRange}/hr
            </div>
        </div>
    );
});
ClusterMarkerContent.displayName = 'ClusterMarkerContent';

// Active Session Marker (Map Icon)
const ActiveSessionMarkerContent = memo(({ vehicleType }: { vehicleType: 'bicycle' | 'motorcycle' | 'car' }) => {
    // Only the emoji marker on the map
    const emoji = vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗';
    return (
        <div style={{ fontSize: 36, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))', pointerEvents: 'none' }}>
            {emoji}
        </div>
    );
});
ActiveSessionMarkerContent.displayName = 'ActiveSessionMarkerContent';

// Collapsible Vehicle Toggle Component
const VehicleToggle = memo(({
    vehicleType,
    onVehicleChange,
    disabled
}: {
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    onVehicleChange: (type: 'bicycle' | 'motorcycle' | 'car') => void;
    disabled: boolean;
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const vehicles = ['bicycle', 'motorcycle', 'car'] as const;
    const emojis = { bicycle: '🚲', motorcycle: '🏍️', car: '🚗' };

    return (
        <div className="flex flex-col rounded-[2rem] bg-white/80 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg overflow-hidden transition-all duration-300">
            {isExpanded ? (
                // Expanded: show all vehicle options
                <div className="flex flex-col gap-1 p-1">
                    {vehicles.map((type) => (
                        <button
                            key={type}
                            onClick={() => {
                                if (!disabled) {
                                    onVehicleChange(type);
                                    setIsExpanded(false);
                                } else if (disabled) {
                                    alert('Please end your current session before changing vehicle type.');
                                }
                            }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${vehicleType === type
                                ? 'bg-blue-500/20 shadow-inner'
                                : 'transition-colors'
                                }`}
                        >
                            <span className={`text-lg ${vehicleType === type ? '' : 'opacity-50'}`}>
                                {emojis[type]}
                            </span>
                        </button>
                    ))}
                    {/* Collapse arrow */}
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="w-10 h-6 flex items-center justify-center text-zinc-400 dark:text-white/40 transition-colors"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>
            ) : (
                // Collapsed: show only selected vehicle + expand arrow
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex flex-col items-center p-1 transition-all"
                >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/20">
                        <span className="text-lg">{emojis[vehicleType]}</span>
                    </div>
                    <ChevronDown size={14} className="text-zinc-400 dark:text-white/40 mt-0.5" />
                </button>
            )}
        </div>
    );
});
VehicleToggle.displayName = 'VehicleToggle';

// Main Landing Page Component
interface LandingPageProps {
    onRequestScan?: () => void;
    initialScannedCode?: string | null;
    onScannedCodeConsumed?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onRequestScan, initialScannedCode, onScannedCodeConsumed }) => {
    const { pubkey, signEvent, pool } = useAuth();
    const mapRef = useRef<MapRef>(null);
    const [location, setLocation] = useState<[number, number] | null>(null);
    const locationSmoother = useRef(new LocationSmoother());
    // Use BearingAnimator for map rotation to prevent 0/360 flip flickering
    const bearingAnimator = useRef(new BearingAnimator());
    // Animator for marker position
    const positionAnimator = useRef(new PositionAnimator());
    const [locationError, setLocationError] = useState<string | null>(null);

    const [status, setStatus] = useState<'idle' | 'search' | 'parked'>('idle');
    const [orientationMode, setOrientationMode] = useState<'fixed' | 'recentre' | 'auto'>('fixed');
    const [pendingAutoMode, setPendingAutoMode] = useState(false); // Immediate visual feedback for button
    const [showHelp, setShowHelp] = useState(false);
    const [showListedParking, setShowListedParking] = useState(false);
    // Currency state - removed (logic in FAB)
    const [vehicleType, setVehicleType] = useState<'bicycle' | 'motorcycle' | 'car'>(() => {
        const saved = localStorage.getItem('parlens_vehicle_type');
        return (saved === 'bicycle' || saved === 'motorcycle' || saved === 'car') ? saved : 'car';
    });
    const [openSpots, setOpenSpots] = useState<any[]>([]);
    const [historySpots, setHistorySpots] = useState<any[]>([]);
    const [parkLocation, setParkLocation] = useState<[number, number] | null>(null);

    // Listed Parking Session - for overlay display
    const [listedParkingSession, setListedParkingSession] = useState<{
        spotATag: string;
        startTime: number;
        dTag?: string;
        listingName?: string;
        spotNumber?: string;
        shortName?: string;
        authorizer?: string;
        tempPubkey?: string;
        listingLocation?: [number, number];
    } | null>(() => {
        const saved = localStorage.getItem('parlens_listed_parking_session');
        return saved ? JSON.parse(saved) : null;
    });
    const [showListedDetails, setShowListedDetails] = useState(false);

    // Handle scanned code passed from QRScanPage via App.tsx
    useEffect(() => {
        if (initialScannedCode) {
            console.log('[LandingPage] Processing scanned code from QRScanPage:', initialScannedCode);
            handleScannedCode(initialScannedCode);
            onScannedCodeConsumed?.();
        }
    }, [initialScannedCode, onScannedCodeConsumed]);

    // State for Route Creation Modal and Bubble
    const [routeModalOpen, setRouteModalOpen] = useState(false);
    const [isRouteBubbleMinimized, setIsRouteBubbleMinimized] = useState(false);

    // QR Code Handler for Listed Parking - Session Toggle with Temp Keys
    const handleScannedCode = useCallback(async (code: string) => {
        console.log('[Parlens] Processing scanned code:', code);

        try {
            // Dynamic import for temp key generation
            const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');

            // Try to parse as JSON auth data
            let authData: {
                a: string;
                authorizer: string;
                auth: string;
                listingName?: string;
                spotNumber?: string;
                shortName?: string;
                listingLocation?: [number, number];
                spotType?: string;
                hourlyRate?: number;
                currency?: string;
            };
            try {
                authData = JSON.parse(code);
            } catch {
                // Fallback: if it's just an a-tag, create minimal auth
                authData = { a: code, authorizer: '', auth: '' };
            }

            if (!authData.a) {
                alert('Invalid QR code format');
                return;
            }

            // Prevent owners/managers from self-parking via QR
            // If the authorizer (person who generated QR) matches the user's pubkey, block
            if (pubkey && authData.authorizer && authData.authorizer === pubkey) {
                alert('Owners and managers cannot use QR authentication to park at their own listing. Please use the spot card to update status directly.');
                return;
            }

            // Check for existing session in localStorage
            const sessionKey = 'parlens_listed_parking_session';
            const existingSession = localStorage.getItem(sessionKey);
            let isEndingSession = false;

            if (existingSession) {
                const session = JSON.parse(existingSession);
                if (session.spotATag === authData.a) {
                    // Same spot - ending session
                    isEndingSession = true;
                }
            }

            // Generate ephemeral keypair for Kind 1714
            const tempPrivkey = generateSecretKey();
            const tempPubkey = getPublicKey(tempPrivkey);

            if (isEndingSession) {
                // Set pending session for Popup Modal
                const session = JSON.parse(existingSession!);
                setPendingEndSession({
                    authData,
                    session,
                    tempPrivkey,
                    tempPubkey
                });
                setShowListedEndPopup(true);
                return;
            }

            const newStatus = 'occupied';
            // Start Session Logic (unchanged)
            const tags = [
                ['a', authData.a],
                ['status', newStatus],
                ['updated_by', tempPubkey], // Temp pubkey
                ['authorizer', authData.authorizer || pubkey || ''], // Owner/manager who authorized
                ...(authData.auth ? [['auth', authData.auth]] : []),
                ['client', 'parlens']
            ];

            // Add location/geohash for search discovery (if available)
            // Use listingLocation from authData or session, or current location as fallback if starting
            const loc = authData.listingLocation || null;
            if (loc) {
                tags.push(['location', `${loc[0]},${loc[1]}`]);
                try {
                    const g = Geohash.encode(loc[0], loc[1], 5); // 5-char for search compatibility
                    tags.push(['g', g]);
                } catch { }
            }
            // Add type, rate, and currency for map display
            if (authData.spotType) tags.push(['type', authData.spotType]);
            if (authData.hourlyRate !== undefined) {
                tags.push(['hourly_rate', String(authData.hourlyRate)]);
                tags.push(['currency', authData.currency || 'USD']);
            }

            const statusEventTemplate = {
                kind: KINDS.LISTED_SPOT_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags as string[][],
                content: JSON.stringify({
                    hourly_rate: authData.hourlyRate || 0,
                    currency: authData.currency || 'USD',
                    type: authData.spotType || 'car'
                })
            };

            // Sign with temp key
            const signedStatus = finalizeEvent(statusEventTemplate, tempPrivkey);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedStatus));
            console.log('[Parlens] Status update published:', signedStatus.id);

            // Start parking session - create Kind 31417 with 'parked' status
            const dTag = `parking-${Date.now()}`;
            const listingLocation = authData.listingLocation || location;

            // Encrypted content with all listing refs
            const logContent = JSON.stringify({
                spotATag: authData.a,
                listingATag: authData.a.replace(/37141:/, '31147:').split(':').slice(0, 2).join(':'), // Derive listing a-tag
                statusLogEventId: signedStatus.id,
                listingName: authData.listingName || '',
                spotNumber: authData.spotNumber || '',
                shortName: authData.shortName || '',
                tempPubkey,
                started_at: Date.now()
            });

            const logEvent = {
                kind: KINDS.PARKING_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', dTag],
                    ['a', authData.a],
                    ['status', 'parked'],
                    ['client', 'parlens']
                ],
                content: logContent // TODO: NIP-44 encrypt
            };
            const signedLog = await signEvent(logEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedLog));

            // Store session with all details (including rate info for session end)
            const sessionData = {
                spotATag: authData.a,
                dTag,
                startTime: Date.now(),
                authorizer: authData.authorizer,
                tempPubkey,
                listingName: authData.listingName || '',
                spotNumber: authData.spotNumber || '',
                shortName: authData.shortName || '',
                listingLocation: listingLocation || undefined,
                spotType: authData.spotType || 'car',
                hourlyRate: authData.hourlyRate || 0,
                currency: authData.currency || 'USD'
            };
            localStorage.setItem(sessionKey, JSON.stringify(sessionData));
            setListedParkingSession(sessionData);

            // Update UI state - behave like regular parking
            setStatus('parked');
            setParkLocation(listingLocation as [number, number] || null);
            setSessionStart(Math.floor(Date.now() / 1000));

            console.log('[Parlens] Listed parking started:', signedLog.id);

        } catch (e) {
            console.error('Failed to process QR code:', e);
            alert('Failed to process parking. Please try again.');
        }
    }, [pubkey, signEvent, pool, location, setStatus]);

    const handleConfirmEndListedSession = async () => {
        if (!pendingEndSession) return;
        const { authData, session, tempPrivkey, tempPubkey } = pendingEndSession;

        try {
            const { finalizeEvent } = await import('nostr-tools/pure');

            // 1. Update Status to 'open' (Kind 1714) using NEW temp key (or reused one?)
            // We generated a NEW temp key in handleScannedCode just now.
            const tags = [
                ['a', authData.a],
                ['status', 'open'],
                ['updated_by', tempPubkey],
                ['authorizer', authData.authorizer || pubkey || ''],
                ...(authData.auth ? [['auth', authData.auth]] : []),
                ['client', 'parlens']
            ];

            const loc = authData.listingLocation || session.listingLocation;
            if (loc) {
                tags.push(['location', `${loc[0]},${loc[1]}`]);
                try {
                    const g = Geohash.encode(loc[0], loc[1], 5); // 5-char for search compatibility
                    tags.push(['g', g]);
                } catch { }
            }
            // Add type, rate, and currency for map display (when spot becomes open)
            const spotType = authData.spotType || session.spotType || 'car';
            const hourlyRate = authData.hourlyRate ?? session.hourlyRate ?? 0;
            const currency = authData.currency || session.currency || 'USD';
            tags.push(['type', spotType]);
            tags.push(['hourly_rate', String(hourlyRate)]);
            tags.push(['currency', currency]);

            const statusEventTemplate = {
                kind: KINDS.LISTED_SPOT_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags as string[][],
                content: JSON.stringify({
                    hourly_rate: hourlyRate,
                    currency: currency,
                    type: spotType
                })
            };

            const signedStatus = finalizeEvent(statusEventTemplate, tempPrivkey);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedStatus));

            // 2. Publish End Log (Kind 31417)
            const logContent = JSON.stringify({
                spotATag: authData.a,
                statusLogEventId: signedStatus.id,
                listingName: session.listingName || '',
                spotNumber: session.spotNumber || '',
                shortName: session.shortName || '',
                ended_at: Date.now(),
                fee: endSessionCost,
                currency: 'USD' // TODO: Detect or use listing currency? Default USD for now matching FAB simple logic
            });

            const endLogEvent = {
                kind: KINDS.PARKING_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', session.dTag || `parking-${Date.now()}`],
                    ['a', authData.a],
                    ['status', 'idle'],
                    ['client', 'parlens']
                ],
                content: logContent
            };
            const signedEndLog = await signEvent(endLogEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEndLog));

            // Clear session
            localStorage.removeItem('parlens_listed_parking_session');
            setListedParkingSession(null);
            setStatus('idle');
            setParkLocation(null);
            setSessionStart(null);
            setShowListedEndPopup(false);
            setPendingEndSession(null);
            setEndSessionCost('0');

            console.log('[Parlens] Listed parking ended');
        } catch (e) {
            console.error('Failed to end listed session:', e);
            alert('Failed to end session. Please try again.');
        }
    };
    const [needsRecenter, setNeedsRecenter] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(17);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<{ lat: number; lon: number }[] | null>(null);
    const [showRoute, setShowRoute] = useState(false);




    // Session State (Lifted from FAB)
    const [sessionStart, setSessionStart] = useState<number | null>(null);
    const [isMapLoaded, setIsMapLoaded] = useState(false);

    // MapLibre view state
    const [viewState, setViewState] = useState({
        longitude: 77.5946,
        latitude: 12.9716,
        zoom: 17,
        bearing: 0,
        pitch: 0
    });

    // Track user interaction
    const isUserInteracting = useRef(false);
    const isTransitioning = useRef(false);
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Drop Pin Mode State (Multi-waypoint) - Moved here to have access to viewState
    const [dropPinMode, setDropPinMode] = useState(false);
    const [tempWaypoints, setTempWaypoints] = useState<{ id: string; lat: number; lon: number; name: string }[]>([]);
    const [pendingWaypoints, setPendingWaypoints] = useState<{ lat: number; lon: number; name?: string }[] | null>(null);
    const [activeEditingId, setActiveEditingId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [, setRouteButtonOpen] = useState(false);
    const [listWaypoints, setListWaypoints] = useState<{ id: string; lat: number; lon: number; name: string }[]>([]);

    // Listed Session End Popup State
    const [showListedEndPopup, setShowListedEndPopup] = useState(false);
    const [endSessionCost, setEndSessionCost] = useState('0');
    const [pendingEndSession, setPendingEndSession] = useState<any>(null);

    // Listed Parking Picker State
    const [isPickingLocation, setIsPickingLocation] = useState(false);
    const [pickedListingLocation, setPickedListingLocation] = useState<{ lat: number, lon: number } | null>(null);
    const [countryCode, setCountryCode] = useState<string | null>(null);

    // Fetch Country Code for Currency
    useEffect(() => {
        const fetchCountry = async () => {
            if (!location || countryCode) return;
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${location[0]}&lon=${location[1]}&format=json`);
                const data = await res.json();
                if (data && data.address && data.address.country_code) {
                    console.log('[Parlens] Detected Country:', data.address.country_code);
                    setCountryCode(data.address.country_code.toUpperCase());
                }
            } catch (e) {
                console.error('[Parlens] Failed to detect country:', e);
            }
        };
        // Simple debounce/check
        const timer = setTimeout(fetchCountry, 2000);
        return () => clearTimeout(timer);
    }, [location, countryCode]);

    // Handlers for Drop Pin
    const handleDropPin = useCallback(() => {
        const center = viewState;
        // Calculate global index: listWaypoints count + current tempWaypoints count + 1
        const globalNumber = listWaypoints.length + tempWaypoints.length + 1;
        const newWaypoint = {
            id: crypto.randomUUID(),
            lat: center.latitude,
            lon: center.longitude,
            name: `Waypoint ${globalNumber}` // Name matches marker number
        };
        setTempWaypoints(prev => [...prev, newWaypoint]);
    }, [viewState, listWaypoints.length, tempWaypoints.length]);

    const updateTempWaypointName = (id: string, newName: string) => {
        setTempWaypoints(prev => prev.map(wp => wp.id === id ? { ...wp, name: newName } : wp));
    };

    const removeTempWaypoint = (id: string) => {
        setTempWaypoints(prev => {
            const filtered = prev.filter(wp => wp.id !== id);
            // Renumber remaining waypoints if they used default names
            return filtered.map((wp, index) => {
                if (wp.name.startsWith('Waypoint ')) {
                    return { ...wp, name: `Waypoint ${index + 1}` };
                }
                return wp;
            });
        });
        if (activeEditingId === id) setActiveEditingId(null);
    };


    const confirmDrop = useCallback(() => {
        const waypointsToPass = tempWaypoints.map(wp => ({
            lat: wp.lat,
            lon: wp.lon,
            name: wp.name
        }));
        setPendingWaypoints(waypointsToPass);
        setTempWaypoints([]);
        setDropPinMode(false); // Helper will consume pendingWaypoints
        // Note: RouteButton handles the actual routing update when it receives pendingWaypoints
    }, [tempWaypoints]);

    // Orientation permission state (for iOS)
    const [orientationNeedsPermission, setOrientationNeedsPermission] = useState(false);

    // Cumulative rotation for smooth bearing transitions
    const [cumulativeRotation, setCumulativeRotation] = useState(0);
    const [userHeading, setUserHeading] = useState(0); // Responsive heading for marker

    // Screen Wake Lock
    const { requestLock, releaseLock } = useWakeLock();

    // Location smoothing with dynamic buffer zones
    const locationTracker = useRef(new StableLocationTracker());
    const [_userSpeed, setUserSpeed] = useState(0); // Available for future speed indicator UI
    const initialLocationSet = useRef(false); // Track if we've set initial location
    const userSpeedRef = useRef(0); // Live speed ref for animator callback
    const latestCompassHeading = useRef(0); // Live compass heading for smooth transitions


    // Auto-switch to 'fixed' mode when Parking to prevent vibration
    // 'Auto' mode (compass) can be jittery when stationary/parked.
    // We lock map to North Up (Fixed) for stability.
    useEffect(() => {
        if (status === 'parked') {
            setOrientationMode('fixed');
            // Smoothly rotate to nearest North
            const currentBearing = mapRef.current?.getBearing() || 0;
            const nearestNorth = Math.round(currentBearing / 360) * 360;
            mapRef.current?.rotateTo(nearestNorth, { duration: 800 });
        }
    }, [status]);

    // Wake Lock Automation (Always On)
    useEffect(() => {
        requestLock();
        return () => {
            releaseLock();
        };
    }, [requestLock, releaseLock]);

    // Initialize location tracking with smoothing
    useEffect(() => {
        if (!navigator.geolocation) {
            setLocationError('Geolocation is not supported by your browser');
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;

                // Use accuracy-aware location tracking
                // This applies buffer zone when stationary to prevent GPS jitter
                const result = locationTracker.current.updateLocationWithAccuracy(
                    latitude, longitude, accuracy
                );

                // Track speed for UI feedback
                setUserSpeed(result.speed);
                userSpeedRef.current = result.speed;

                // STATIONARY MODE: Use buffered position to prevent jitter
                // This is critical for accurate parking spot marking
                if (result.speedClass === 'stationary') {
                    // Only update position if outside buffer zone
                    if (result.shouldUpdate) {
                        positionAnimator.current.animateTo(
                            result.displayLat,
                            result.displayLon,
                            result.animationDuration
                        );
                    }
                    // Else: keep current position (inside buffer zone)
                } else {
                    // MOVING MODE: Use raw GPS for precision tracking
                    positionAnimator.current.animateTo(
                        latitude,
                        longitude,
                        300 // Quick animation for responsive feel
                    );
                }

                // Initialize view state ONLY on first location (using ref to avoid stale closure)
                if (!initialLocationSet.current) {
                    initialLocationSet.current = true;
                    setLocation([result.displayLat, result.displayLon]);
                    setViewState(prev => ({
                        ...prev,
                        latitude: result.displayLat,
                        longitude: result.displayLon
                    }));
                }
            },
            (error) => {
                let message = 'Unable to get your location';
                if (error.code === 1) message = 'Location access denied. Please enable location services.';
                else if (error.code === 2) message = 'Location unavailable. Check your GPS settings.';
                else if (error.code === 3) message = 'Location request timed out.';
                setLocationError(message);
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );

        // Bind animator callback to state updates
        positionAnimator.current.setUpdateCallback((lat, lon) => {
            // Always update marker location
            setLocation([lat, lon]);

            // Sync Map Center in Auto Mode (Hard Lock)
            // This prevents "jitter" where the marker moves independently of the map camera
            // We use a functional update to access the latest state without closure issues
            setOrientationMode(currentMode => {
                // GUARD: If user is interacting (pinching/panning), DO NOT force update viewState
                // This prevents "fighting" the user's gestures and allows smooth zooming
                if ((currentMode === 'auto' || currentMode === 'recentre') && !isUserInteracting.current) {

                    // GUARD: Stationary Check
                    // If speed is very low (< 0.3 m/s), do not recenter automatically.
                    // This allows the user to browse the map freely when stopped
                    if (userSpeedRef.current < 0.3 && currentMode !== 'recentre') {
                        return currentMode;
                    }

                    setViewState(prev => {
                        // CRITICAL: Use LIVE zoom from map instance if available, otherwise fallback to state
                        const liveZoom = mapRef.current?.getZoom() ?? prev.zoom;



                        // Soft Follow (LERP)
                        // Move camera 10% of the distance to the target per frame.
                        // This removes the "Jitter" effect caused by frame misalignment.
                        const lerpFactor = 0.1;
                        const newLat = prev.latitude + (lat - prev.latitude) * lerpFactor;
                        const newLon = prev.longitude + (lon - prev.longitude) * lerpFactor;

                        return {
                            ...prev,
                            latitude: newLat,
                            longitude: newLon,
                            zoom: liveZoom
                        };
                    });
                }
                return currentMode;
            });
        });

        return () => {
            navigator.geolocation.clearWatch(watchId);
            positionAnimator.current.stop();
        };
    }, []);

    // Device orientation tracking
    useEffect(() => {
        // Check if orientation permission is needed (iOS 13+)
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            setOrientationNeedsPermission(true);
        }

        const handleOrientation = (event: DeviceOrientationEvent) => {
            // STOP updating orientation if user is interacting (panning/zooming)
            // This prevents React re-renders from interrupting the MapLibre gesture handling
            if (isUserInteracting.current) return;

            let heading: number | null = null;


            if ((event as any).webkitCompassHeading) {
                // iOS
                heading = (event as any).webkitCompassHeading;
            } else if (event.alpha !== null) {
                // Android (absolute)
                heading = 360 - (event.alpha as number);
            }

            if (heading !== null) {
                // Adjust for screen orientation
                // window.orientation is deprecated but required for iOS Safari
                // screen.orientation is standard
                const orientation = (window.screen as any).orientation?.angle ?? window.orientation ?? 0;

                // Add orientation angle to align compass with screen "up" (Fixes 180deg flip)
                heading = (heading + orientation) % 360;
            }



            if (heading !== null) {
                latestCompassHeading.current = heading; // Update for button transition logic
                // Noise Gate: Ignore micro-changes (< 2 degrees) to filter vibrations
                // We use a ref to store the last processed heading to compare against
                // Note: We need to handle 360 wrap-around for the diff check

                // 1. Update Marker (Heavy Smoothing for Stability)
                // Reduced factor from 0.7 (twitchy) to 0.1 (stable)
                setUserHeading(h => {
                    const diff = heading! - h;
                    let d = diff;
                    if (d > 180) d -= 360;
                    if (d < -180) d += 360;

                    // Noise Gate: If change is < 2 degrees, ignore it (return current h)
                    // limit updates to significant movements
                    if (Math.abs(d) < 2) return h;

                    return h + d * 0.1;
                });

                // 2. Update Map Smoothly (Heavy Smoothing to prevent motion sickness)
                const smoothed = locationSmoother.current.smoothBearing(heading, 0, true);
                if (smoothed !== null) {
                    // Use animator to ensure continuous rotation (handles 359->1 wrap correctly)
                    const continuous = bearingAnimator.current.setBearing(smoothed);
                    setCumulativeRotation(continuous);
                }
            }
        };

        window.addEventListener('deviceorientation', handleOrientation, true);

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation, true);
        };
    }, []);

    // Request orientation permission (iOS)
    const requestOrientationPermission = async () => {
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            const permission = await (DeviceOrientationEvent as any).requestPermission();
            if (permission === 'granted') {
                setOrientationNeedsPermission(false);
            }
        }
    };

    // Update map view in tracking modes (auto and recentre)
    // auto = follows position + rotates with device heading
    // recentre = follows position only, keeps current bearing
    useEffect(() => {
        // Only update if we're in a tracking mode and not being interrupted
        // REMOVED !showRoute constraint to allow updates during navigation
        if (!isUserInteracting.current && !isTransitioning.current && location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            setViewState(prev => {
                // CRITICAL: Use LIVE zoom from map instance if available.
                // React state (prev.zoom) lags behind native map gestures (pinch).
                // If we force prev.zoom back to the map, we effectively cancel the user's pinch every 60Hz frame.
                const liveZoom = mapRef.current?.getZoom() ?? prev.zoom;

                const newState = {
                    ...prev,
                    longitude: location[1],
                    latitude: location[0],
                    zoom: liveZoom, // Use live zoom
                    pitch: 0
                };

                // NEW: If drop pin mode is active, center on the crosshair?
                // Actually, in drop pin mode, we want the user to pan FREELY.
                // So we should NOT track user location in dropPinMode if they are moving the map.
                // But if they are just driving?
                // Let's Disable auto-tracking updates during dropPinMode to let user pan.
                if (dropPinMode) return prev;

                // Only auto mode rotates with device
                if (orientationMode === 'auto') {
                    // Smooth bearing is already applied to cumulativeRotation
                    newState.bearing = cumulativeRotation;
                    // Dynamic transition based on zoom: higher zoom = slower animation (more visible)
                    // Zoom 17+: 300ms, Zoom 15-17: 200ms, Below 15: 150ms
                    const zoomBasedDuration = liveZoom >= 17 ? 300 : liveZoom >= 15 ? 200 : 150;
                    (newState as any).transitionDuration = zoomBasedDuration;
                } else if (orientationMode === 'recentre') {
                    // Smooth position updates for recentre mode too (prevents snappy feel)
                    // Higher zoom = slower animation for smoother feel
                    const zoomBasedDuration = liveZoom >= 17 ? 400 : liveZoom >= 15 ? 300 : 200;
                    (newState as any).transitionDuration = zoomBasedDuration;
                }
                return newState;
            });
        }
    }, [location, cumulativeRotation, orientationMode, showRoute, dropPinMode]);





    // Manage Wake Lock based on orientation mode
    // Manage Wake Lock globally (always active when app is open)
    useEffect(() => {
        requestLock();
        return () => {
            releaseLock();
        };
    }, [requestLock, releaseLock]);

    // Session Persistence
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

    // Save session
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
            setSessionStart(null);
        }
    }, [status, sessionStart, parkLocation]);


    // Update needsRecenter based on distance from user location
    useEffect(() => {
        if (!location) {
            setNeedsRecenter(false);
            return;
        }
        const [userLat, userLon] = location;
        const dist = Math.sqrt(
            Math.pow(viewState.latitude - userLat, 2) +
            Math.pow(viewState.longitude - userLon, 2)
        );
        // Fade icon if > 50m away (approx 0.0005 degrees)
        setNeedsRecenter(dist > 0.0005);
    }, [location, viewState.latitude, viewState.longitude]);


    // Handle map move - Update state immediately when user moves map
    const handleMove = useCallback((evt: { viewState: typeof viewState }) => {
        setViewState(evt.viewState);

        // Strict Pan-to-Fixed for BOTH Auto and Recentre modes
        // If user is interacting (dragging), immediately switch to 'fixed'.
        // Removed distance buffer as per user request ("if the user pans at all").

        // Interaction Logic:
        // 1. Z O O M: Use multi-touch check (most robust) or isZoomingRef
        //    If >1 touch point, it's a zoom/pitch -> KEEP tracking mode.
        // 2. T H R E S H O L D: Allow small pans in Recentering mode (framing).
        //    Only switch to Fixed if pan is significant (intentional drag away).

        let isZooming = false;

        // Robust Zoom Detection
        if (mapRef.current) {
            // Check ref from event listeners
            if (isZoomingRef.current) isZooming = true;
            // Check active map state
            if (mapRef.current.isZooming()) isZooming = true;
            // Check touch points (if available in original event)
            if (evt && (evt as any).originalEvent && (evt as any).originalEvent.touches && (evt as any).originalEvent.touches.length > 1) {
                isZooming = true;
            }
        }

        if (isUserInteracting.current && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            if (!isZooming) {
                // Calculate pan distance from current location
                // If very small (< 100 meters?), might be accidental or framing.
                // User request: "ensure if the user pans to fix centring in re-centre mdoe it doesn't change back to fixed mode"
                // So we need a threshold.

                let distance = 1.0;
                if (location) {
                    distance = Math.sqrt(
                        Math.pow(evt.viewState.longitude - location[1], 2) +
                        Math.pow(evt.viewState.latitude - location[0], 2)
                    );
                }

                // Threshold: 0.0001 degrees is approx 11 meters.
                // Allow very small jitters, but any real pan switches to Fixed.
                if (distance > 0.0001) {
                    setOrientationMode('fixed');
                }
            }
        }
    }, [location, orientationMode, needsRecenter]);

    const handleMoveStart = useCallback((evt: any) => {
        // Only consider it a USER interaction if caused by input (touch/mouse)
        // Programmatic moves (flyTo, easeTo) do not have originalEvent in some versions, 
        // or we can check specific boolean flags if needed. 
        // MapLibre standard: check if originalEvent exists.
        if (evt.originalEvent) {
            isUserInteracting.current = true;
            // STOP auto-centering animation immediately when user interacts
            // This prevents the "fighting" feeling where the map tries to pull back
            positionAnimator.current.stop();
            // CRITICAL: Stop any ongoing camera animations (flyTo/easeTo) ONLY if we initiated one.
            // If the map is just idle or finishing a previous user fling, calling stop() might break the new gesture.
            if (isTransitioning.current) {
                mapRef.current?.stop();
                isTransitioning.current = false;
            }
        }
    }, []);

    const handleMoveEnd = useCallback(() => {
        // Debounce the interaction end to prevent fighting during multi-touch gestures
        setTimeout(() => {
            isUserInteracting.current = false;
        }, 1000); // 1-second cooldown after user lets go before auto-tracking resumes
        setZoomLevel(viewState.zoom);
    }, [viewState.zoom]);

    // Track Zoom State explicitly (isZooming is unreliable in handleMove)
    const isZoomingRef = useRef(false);
    const handleZoomStart = useCallback(() => {
        isZoomingRef.current = true;
        isUserInteracting.current = true;
        // Stop any ongoing animations to prevents fighting
        positionAnimator.current.stop();
        if (isTransitioning.current) {
            mapRef.current?.stop();
            isTransitioning.current = false;
        }
    }, []);
    const handleZoomEnd = useCallback(() => {
        isZoomingRef.current = false;
        // Debounce the interaction end (same as handleMoveEnd)
        setTimeout(() => {
            if (!isZoomingRef.current) {
                isUserInteracting.current = false;
            }
        }, 1000);
    }, []);



    // Handle vehicle type change
    const handleVehicleChange = (type: 'bicycle' | 'motorcycle' | 'car') => {
        if (status !== 'idle') {
            alert('Please end your current session before changing vehicle type.');
            return;
        }
        setVehicleType(type);
        localStorage.setItem('parlens_vehicle_type', type);
    };

    // Handle route changes from RouteButton
    const handleRouteChange = useCallback((
        main: [number, number][] | null,
        alternate: [number, number][] | null,
        waypoints: { lat: number; lon: number }[] | null,
        showOnMap: boolean
    ) => {
        setRouteCoords(main);
        setAlternateRouteCoords(alternate);
        setRouteWaypoints(waypoints);
        setShowRoute(showOnMap);

        // Fit bounds to route
        if (main && main.length > 1 && mapRef.current && showOnMap) {
            // Combine coordinates from both main and alternate routes for bounds
            const allCoords = [...main];
            if (alternate && alternate.length > 0) {
                allCoords.push(...alternate);
            }

            const lngs = allCoords.map(c => c[1]);
            const lats = allCoords.map(c => c[0]);
            const bounds = new maplibregl.LngLatBounds(
                [Math.min(...lngs), Math.min(...lats)],
                [Math.max(...lngs), Math.max(...lats)]
            );

            // Prevent location tracking from overriding the fit
            isTransitioning.current = true;
            mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
            // Force Fixed Mode so the user can inspect the route without Auto-Centering hijacking the view
            setOrientationMode('fixed');

            // Safety timeout to reset transitioning flag
            setTimeout(() => {
                isTransitioning.current = false;
                // Prompt for toggle if needed to refresh orientation
                if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                    setOrientationNeedsPermission(true);
                }
            }, 1200);
        }
    }, []);

    // Prepare spots for clustering
    const processedHistorySpots = useMemo(() => {
        const filtered = historySpots.filter(spot => {
            const type = spot.decryptedContent?.type || 'car';
            return type === vehicleType;
        });
        return filtered.map(s => {
            const content = s.decryptedContent;
            return content && content.lat && content.lon ? {
                id: s.id,
                lat: content.lat,
                lon: content.lon,
                price: parseFloat(content.fee) || 0,
                currency: content.currency || 'USD',
                original: s
            } : null;
        }).filter(Boolean) as any[];
    }, [historySpots, vehicleType]);

    const clusteredHistorySpots = useMemo(() =>
        clusterSpots(processedHistorySpots, zoomLevel)
        , [processedHistorySpots, zoomLevel]);

    const processedOpenSpots = useMemo(() => {
        if (status !== 'search') return [];
        return openSpots.filter(s => (s.type || 'car') === vehicleType).map(s => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            price: s.price,
            currency: s.currency,
            count: s.count,
            original: s
        }));
    }, [openSpots, vehicleType, status]);

    const clusteredOpenSpots = useMemo(() =>
        clusterSpots(processedOpenSpots, zoomLevel)
        , [processedOpenSpots, zoomLevel]);

    // Memoize GeoJSON Sources to prevent re-renders


    // Map style based on theme
    const mapStyle = isDarkMode ? MAP_STYLES.dark : MAP_STYLES.light;

    // Route layer configs (inline, no type annotation)
    const routeLayerProps = {
        id: 'route',
        type: 'line' as const,
        paint: {
            'line-color': '#007AFF',
            'line-width': 5,
            'line-opacity': 0.9
        }
    };

    const alternateRouteLayerProps = {
        id: 'alternate-route',
        type: 'line' as const,
        paint: {
            'line-color': '#007AFF',
            'line-width': 3,
            'line-opacity': 0.4,
            'line-dasharray': [2, 2]
        }
    };



    // Auto-minimize route bubble when a route is active (created or loaded from saved)
    useEffect(() => {
        if (routeCoords || alternateRouteCoords) {
            setIsRouteBubbleMinimized(true);
        }
    }, [routeCoords, alternateRouteCoords]);

    return (
        <div className="fixed inset-0 overflow-hidden bg-gray-50 dark:bg-black transition-colors duration-300">
            {/* Loading Overlay - Covers everything until ready */}
            {((!location && !locationError) || !isMapLoaded) && (
                <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-gray-50 dark:bg-black transition-opacity duration-500">
                    <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700 px-8 max-w-sm text-center">
                        {!locationError ? (
                            <>
                                <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                                <p className="text-sm font-semibold text-zinc-400 dark:text-white/40 tracking-tight">Locating...</p>
                            </>
                        ) : (
                            <>
                                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <span className="text-2xl">📍</span>
                                </div>
                                <p className="text-sm font-medium text-red-500 dark:text-red-400">{locationError}</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-2 px-6 py-2 rounded-full bg-[#007AFF] text-white text-sm font-medium active:scale-95 transition-transform"
                                >
                                    Try Again
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}




            {/* STATIC USER MARKER (Auto Mode Only) - Eliminates Vibration & Shaking */}
            {orientationMode === 'auto' && location && (
                <div
                    className="absolute top-1/2 left-1/2 z-[900] pointer-events-none flex items-center justify-center"
                    style={{
                        transform: 'translate(-50%, -50%)', // Robust centering
                        width: '40px', // Explicit size to prevent layout collapse/skew
                        height: '40px'
                    }}
                >
                    <UserLocationMarker
                        bearing={userHeading}
                        mapBearing={viewState.bearing}
                        isNavigationMode={true}
                    />
                </div>
            )
            }

            {/* MapLibre GL Map */}
            <div
                className="absolute inset-0"
                // CAPTURE ALL TOUCHES/CLICKS EARLY
                // This guarantees we mark interaction BEFORE MapLibre or React updates processing
                onPointerDownCapture={() => {
                    isUserInteracting.current = true;
                    positionAnimator.current.stop();
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                }}
                // CAPTURE TOUCH GESTURES (Multi-touch Zoom/Rotate)
                onTouchStartCapture={() => {
                    isUserInteracting.current = true;
                    positionAnimator.current.stop();
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                }}
                // CAPTURE WHEEL/TRACKPAD ZOOM EARLY
                onWheelCapture={() => {
                    isUserInteracting.current = true;
                    if (isTransitioning.current) {
                        mapRef.current?.stop();
                        isTransitioning.current = false;
                    }
                    if ((window as any).wheelDebounce) clearTimeout((window as any).wheelDebounce);
                    (window as any).wheelDebounce = setTimeout(() => {
                        isUserInteracting.current = false;
                    }, 1000);
                }}
                // Ensure browser doesn't hijack gestures (e.g. pull-to-refresh)
                style={{ touchAction: 'none' }}
            >


                <Map
                    ref={mapRef}
                    {...viewState}
                    onStyleData={(e) => {
                        const map = e.target;
                        if (map) {
                            // Hide oneway arrows persistently on style change
                            const layers = map.getStyle().layers;
                            layers?.forEach(layer => {
                                if (layer.id.includes('oneway') || layer.id.includes('arrow') || layer.id.includes('direction')) {
                                    if (map.getLayoutProperty(layer.id, 'visibility') !== 'none') {
                                        map.setLayoutProperty(layer.id, 'visibility', 'none');
                                    }
                                }
                            });

                            // Load custom transit icons (SDF for dynamic coloring)
                            // We do this in onStyleData to ensure they persist across style changes
                            const icons = {
                                'icon-bus': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M4 6C4 4.89543 4.89543 4 6 4H18C19.1046 4 20 4.89543 20 6V17C20 18.1046 19.1046 19 18 19H16.5L17.5 21H15.5L14.5 19H9.5L8.5 21H6.5L7.5 19H6C4.89543 19 4 18.1046 4 17V6ZM6 6V10H18V6H6ZM6 12V16H18V12H6ZM8 14C8.55228 14 9 13.5523 9 13C9 12.4477 8.55228 12 8 12C7.44772 12 7 12.4477 7 13C7 13.5523 7.44772 14 8 14ZM16 14C16.5523 14 17 13.5523 17 13C17 12.4477 16.5523 12 16 12C15.4477 12 15 12.4477 15 13C15 13.5523 15.4477 14 16 14Z"/></svg>`,
                                'icon-train': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8 2 4 2.5 4 6V15.5C4 17.433 5.567 19 7.5 19L6 20.5V21H18V20.5L16.5 19C18.433 19 20 17.433 20 15.5V6C20 2.5 16 2 12 2ZM12 4C14.5 4 18 4.5 18 6V10H6V6C6 4.5 9.5 4 12 4ZM12 17C10.8954 17 10 16.1046 10 15C10 13.8954 10.8954 13 12 13C13.1046 13 14 13.8954 14 15C14 16.1046 13.1046 17 12 17ZM7.5 17C6.67157 17 6 16.3284 6 15.5V12H9.05C9.02 12.3 9 12.64 9 13C9 14.6569 10.3431 16 12 16C13.6569 16 15 14.6569 15 13C15 12.64 14.98 12.3 14.95 12H18V15.5C18 16.3284 17.3284 17 16.5 17H7.5Z"/></svg>`,
                                'icon-subway': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.8 2.8C16 2.09 13.86 2 12 2C10.14 2 8 2.09 6.2 2.8C4.30002 3.55 3.00002 4.97 3.00002 6.5V15.5C3.00002 17.4 4.40002 19.34 6.6 19.89L5.00002 21.5V22H19V21.5L17.4 19.89C19.6 19.34 21 17.4 21 15.5V6.5C21 4.97 19.7 3.55 17.8 2.8ZM16.5 16C15.12 16 14 14.88 14 13.5C14 12.12 15.12 11 16.5 11C17.88 11 19 12.12 19 13.5C19 14.88 17.88 16 16.5 16ZM12 9C7.58 9 6 6.5 6 6.5C6 6.5 8 5.5 12 5.5C16 5.5 18 6.5 18 6.5C18 6.5 16.42 9 12 9ZM7.5 16C6.12 16 5.00002 14.88 5.00002 13.5C5.00002 12.12 6.12 11 7.5 11C8.88 11 10 12.12 10 13.5C10 14.88 8.88 16 7.5 16Z"/></svg>`,
                                'icon-tram': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M13 5.5V2H11V5.5L7 8H17L13 5.5ZM5 9V17.5C5 18.7 5.7 19.7 6.8 20.2L6 21H8L9 20H15L16 21H18L17.2 20.2C18.3 19.7 19 18.7 19 17.5V9H5ZM16 16.5C16 17.05 15.55 17.5 15 17.5H9C8.45 17.5 8 17.05 8 16.5V14H16V16.5ZM16 12.5H8V10.5H16V12.5Z"/></svg>`,
                                'icon-stop': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="6" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="white"/></svg>`
                            };

                            Object.entries(icons).forEach(([name, svg]) => {
                                if (!map.hasImage(name)) {
                                    const img = new Image(24, 24);
                                    img.onload = () => map.addImage(name, img, { sdf: true });
                                    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
                                }
                            });

                            // Add transit stops with icons
                            if (!map.getLayer('transit-stops')) {
                                map.addLayer({
                                    id: 'transit-stops',
                                    type: 'symbol',
                                    source: 'openmaptiles',
                                    'source-layer': 'poi',
                                    minzoom: 12,
                                    filter: ['match', ['get', 'class'],
                                        ['bus_station', 'railway', 'bus_stop', 'tram_stop', 'subway', 'rail', 'train_station'],
                                        true, false
                                    ],
                                    layout: {
                                        'icon-image': ['match', ['get', 'class'],
                                            'bus_station', 'icon-bus',
                                            'bus_stop', 'icon-stop',
                                            'railway', 'icon-train',
                                            'rail', 'icon-train',
                                            'train_station', 'icon-train',
                                            'tram_stop', 'icon-tram',
                                            'subway', 'icon-subway',
                                            'icon-stop' // default
                                        ],
                                        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 0.6, 18, 1],
                                        'icon-allow-overlap': false,
                                        'icon-padding': 2,
                                        // Merge text properties here from the old transit-labels layer
                                        'text-field': ['upcase', ['coalesce', ['get', 'name_en'], ['get', 'name']]],
                                        'text-size': 11,
                                        'text-offset': [0, 1.2],
                                        'text-anchor': 'top',
                                        'text-font': ['Noto Sans Regular'],
                                        'text-optional': true // Hide text if it doesn't fit, but keep icon
                                    },
                                    paint: {
                                        'icon-color': isDarkMode ? '#999999' : '#555555',
                                        'icon-halo-color': isDarkMode ? 'rgba(0,0,0,0.5)' : '#ffffff',
                                        'icon-halo-width': 1,
                                        'text-color': isDarkMode ? '#aaaaaa' : '#666666',
                                        'text-halo-color': isDarkMode ? 'rgba(0,0,0,0.8)' : '#ffffff',
                                        'text-halo-width': 1,
                                        // Fade text in starting at zoom 14 (so zoom 12-14 is icon only)
                                        'text-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14, 1]
                                    }
                                });
                            }



                        }
                    }}
                    onLoad={(e) => {
                        setIsMapLoaded(true);
                        const map = e.target;
                        if (map) {
                            // Hide oneway arrows
                            const layers = map.getStyle().layers;
                            layers?.forEach(layer => {
                                if (layer.id.includes('oneway') || layer.id.includes('arrow') || layer.id.includes('direction')) {
                                    map.setLayoutProperty(layer.id, 'visibility', 'none');
                                }
                            });







                        }
                    }}
                    onMove={handleMove}
                    onMoveStart={handleMoveStart}
                    onMoveEnd={handleMoveEnd}
                    onZoomStart={handleZoomStart}
                    onZoomEnd={handleZoomEnd}
                    onRotateStart={() => { isUserInteracting.current = true; positionAnimator.current.stop(); }}
                    onRotateEnd={handleMoveEnd} // Reuse debounce logic
                    onPitchStart={() => { isUserInteracting.current = true; positionAnimator.current.stop(); }}
                    onPitchEnd={handleMoveEnd} // Reuse debounce logic

                    style={{ width: '100%', height: '100%' }}
                    mapStyle={mapStyle}
                    attributionControl={false}
                    dragPan={!isTransitioning.current}
                    // Fix for "Map breaks on zoom out" - Restrict zoom and ensure copies
                    minZoom={3} // Prevents zooming out too far (perf killer)
                    maxZoom={20}
                    renderWorldCopies={true}
                    // Improve tile loading performance - larger cache for faster zoom out
                    maxTileCacheSize={500}
                >
                    {/* Routes */}
                    {showRoute && alternateRouteCoords && alternateRouteCoords.length > 1 && (
                        <Source
                            id="alternate-route"
                            type="geojson"
                            data={{
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                    type: 'LineString',
                                    coordinates: alternateRouteCoords.map(c => [c[1], c[0]])
                                }
                            }}
                        >
                            <Layer {...alternateRouteLayerProps} />
                        </Source>
                    )}

                    {showRoute && routeCoords && routeCoords.length > 1 && (
                        <Source
                            id="route"
                            type="geojson"
                            data={{
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                    type: 'LineString',
                                    coordinates: routeCoords.map(c => [c[1], c[0]])
                                }
                            }}
                        >
                            <Layer {...routeLayerProps} />
                        </Source>
                    )}

                    {/* Open Spots Markers */}
                    {status === 'search' && clusteredOpenSpots.map(item => {
                        // eslint-disable-next-line
                        const isClusterItem = isCluster(item);
                        return (
                            <Marker
                                key={`open-${item.id}`}
                                longitude={item.lon}
                                latitude={item.lat}
                                anchor="center"
                                style={{ willChange: 'transform' }} // Stabilization
                                onClick={(e) => {
                                    e.originalEvent.stopPropagation();
                                    if (isClusterItem) {
                                        mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: viewState.zoom + 2 });
                                    } else {
                                        // Was handleClick for drop pin, now no-op or handle specific spot selection if needed?
                                        // Current logic: markers are just visual unless cluster expands.
                                        // If we need to open details, that logic should be here.
                                        // But for now, removing the broken call.
                                    }
                                }}
                            >
                                {isClusterItem ? (
                                    <ClusterMarkerContent
                                        count={item.count}
                                        minPrice={item.minPrice}
                                        maxPrice={item.maxPrice}
                                        currency={item.currency}
                                        type="open"
                                    />
                                ) : (
                                    <SpotMarkerContent
                                        price={item.price}
                                        currency={item.currency}
                                        emoji="🅿️"
                                    />
                                )}
                            </Marker>
                        );
                    })}

                    {/* Routes Layer */}
                    {(showRoute || dropPinMode) && (routeWaypoints || listWaypoints.length > 0) && (
                        <>
                            {/* Render List Waypoints (synced from RouteButton) OR Route Waypoints (if calculated) */}
                            {/* In drop pin mode: prefer listWaypoints. Outside: use routeWaypoints */}
                            {(dropPinMode ? (listWaypoints.length > 0 ? listWaypoints : routeWaypoints || []) : routeWaypoints || []).map((wp, i) => (
                                <Marker
                                    key={`wp-${(wp as any).id || i}`}
                                    longitude={wp.lon}
                                    latitude={wp.lat}
                                    anchor="center"
                                    onClick={(e: any) => {
                                        e.originalEvent?.preventDefault();
                                        e.originalEvent?.stopPropagation();
                                        // Toggle selection
                                        const id = (wp as any).id;
                                        setActiveEditingId(activeEditingId === id ? null : id);
                                        setEditingName((wp as any).name || `Stop ${i + 1}`);
                                    }}
                                    className="cursor-pointer"
                                    style={{ zIndex: activeEditingId === (wp as any).id ? 200 : 100 }}
                                >
                                    <div className="relative flex flex-col items-center">
                                        {/* Waypoint Label with Edit/Delete - Always visible in Drop Pin Mode */}
                                        {dropPinMode && (
                                            <div
                                                className="absolute bottom-full mb-1 bg-[#1c1c1e] text-white rounded-xl shadow-2xl flex items-center gap-1 p-1.5 min-w-[max-content] border border-white/10 z-[200]"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {renamingId === (wp as any).id ? (
                                                    // Renaming Mode
                                                    <>
                                                        <input
                                                            type="text"
                                                            value={editingName}
                                                            onChange={(e) => setEditingName(e.target.value)}
                                                            className="w-28 bg-zinc-800 rounded-lg px-2 py-1 text-xs outline-none border border-zinc-600 focus:border-blue-500 transition-colors"
                                                            autoFocus
                                                            onFocus={(e) => e.currentTarget.select()}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const id = (wp as any).id;
                                                                    if (id) {
                                                                        setListWaypoints(prev => prev.map(p => p.id === id ? { ...p, name: editingName } : p));
                                                                    }
                                                                    setRenamingId(null);
                                                                }
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                const id = (wp as any).id;
                                                                if (id) {
                                                                    setListWaypoints(prev => prev.map(p => p.id === id ? { ...p, name: editingName } : p));
                                                                }
                                                                setRenamingId(null);
                                                            }}
                                                            className="p-1 bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white rounded-lg transition-colors"
                                                        >
                                                            <Check size={12} strokeWidth={3} />
                                                        </button>
                                                        <button
                                                            onClick={() => setRenamingId(null)}
                                                            className="p-1 bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white rounded-lg transition-colors"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    // View Mode - Name + Edit + Delete always visible
                                                    <>
                                                        <span className="font-semibold text-xs px-1 max-w-[120px] truncate">{(wp as any).name || `Stop ${i + 1}`}</span>
                                                        <button
                                                            onClick={() => {
                                                                setEditingName((wp as any).name || `Stop ${i + 1}`);
                                                                setRenamingId((wp as any).id);
                                                            }}
                                                            className="p-1 rounded-lg transition-colors"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const id = (wp as any).id;
                                                                if (id) {
                                                                    setListWaypoints(prev => prev.filter(p => p.id !== id));
                                                                }
                                                            }}
                                                            className="p-1 rounded-lg transition-colors"
                                                        >
                                                            <Trash size={12} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* Standard Blue Dot (Start, End, Intermediate - All Blue) */}
                                        <div className="w-6 h-6 rounded-full bg-[#007AFF] border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs" style={{ zIndex: 10 }}>
                                            {i + 1}
                                        </div>
                                    </div>
                                </Marker>
                            ))}
                        </>
                    )}

                    {/* Temporary Waypoints (Drop Pin Mode) */}
                    {dropPinMode && tempWaypoints.map((wp, index) => {
                        // Continue numbering from listWaypoints (not routeWaypoints)
                        const globalIndex = listWaypoints.length + index + 1;

                        return (
                            <Marker
                                key={wp.id}
                                longitude={wp.lon}
                                latitude={wp.lat}
                                anchor="center" // Center anchor for dots
                                onClick={(e: any) => {
                                    e.originalEvent?.preventDefault();
                                    e.originalEvent?.stopPropagation();
                                    // Toggle selection
                                    setActiveEditingId(activeEditingId === wp.id ? null : wp.id);
                                    setEditingName(wp.name);
                                }}
                                className="cursor-pointer"
                                style={{ zIndex: activeEditingId === wp.id ? 2000 : 1000 }} // Bring to front if selected
                            >
                                <div className="relative flex flex-col items-center">
                                    {/* Waypoint Label with Edit/Delete - Always visible */}
                                    <div
                                        className="absolute bottom-full mb-1 bg-[#1c1c1e] text-white rounded-xl shadow-2xl flex items-center gap-1 p-1.5 min-w-[max-content] border border-white/10 z-[2000]"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {renamingId === wp.id ? (
                                            // Renaming Mode
                                            <>
                                                <input
                                                    type="text"
                                                    value={editingName}
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    className="w-28 bg-zinc-800 rounded-lg px-2 py-1 text-xs outline-none border border-zinc-600 focus:border-blue-500 transition-colors"
                                                    autoFocus
                                                    onFocus={(e) => e.currentTarget.select()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            updateTempWaypointName(wp.id, editingName);
                                                            setRenamingId(null);
                                                        }
                                                    }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        updateTempWaypointName(wp.id, editingName);
                                                        setRenamingId(null);
                                                    }}
                                                    className="p-1 bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white rounded-lg transition-colors"
                                                >
                                                    <Check size={12} strokeWidth={3} />
                                                </button>
                                                <button
                                                    onClick={() => setRenamingId(null)}
                                                    className="p-1 bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white rounded-lg transition-colors"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </>
                                        ) : (
                                            // View Mode - Name + Edit + Delete always visible
                                            <>
                                                <span className="font-semibold text-xs px-1 max-w-[120px] truncate">{wp.name}</span>
                                                <button
                                                    onClick={() => {
                                                        setEditingName(wp.name);
                                                        setRenamingId(wp.id);
                                                    }}
                                                    className="p-1 rounded-lg transition-colors"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                                <button
                                                    onClick={() => removeTempWaypoint(wp.id)}
                                                    className="p-1 rounded-lg transition-colors"
                                                >
                                                    <Trash size={12} />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* Marker Dot */}
                                    <div className="w-6 h-6 rounded-full bg-[#007AFF] border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs">
                                        {globalIndex}
                                    </div>
                                </div>
                            </Marker>
                        );
                    })}     {/* History Spots Markers */}
                    {clusteredHistorySpots.map(item => {
                        const isClusterItem = isCluster(item);
                        return (
                            <Marker
                                key={`history-${item.id}`}
                                longitude={item.lon}
                                latitude={item.lat}
                                anchor="center"
                                style={{ willChange: 'transform' }}
                                onClick={(e) => {
                                    e.originalEvent.stopPropagation();
                                    if (isClusterItem) {
                                        mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: viewState.zoom + 2 });
                                    }
                                }}
                            >
                                {isClusterItem ? (
                                    <ClusterMarkerContent
                                        count={item.count}
                                        minPrice={item.minPrice}
                                        maxPrice={item.maxPrice}
                                        currency={item.currency}
                                        type="history"
                                    />
                                ) : (
                                    <SpotMarkerContent
                                        price={item.price}
                                        currency={item.currency}
                                        emoji="🅟"
                                        isHistory={true}
                                    />
                                )}
                            </Marker>
                        );
                    })}

                    {/* Parked Vehicle Marker */}
                    {status === 'parked' && parkLocation && (
                        <Marker
                            longitude={parkLocation[1]}
                            latitude={parkLocation[0]}
                            anchor="center"
                        >
                            <ActiveSessionMarkerContent vehicleType={vehicleType} />
                        </Marker>
                    )}

                    {/* Listed Parking Bubble Marker - Click to open details */}
                    {listedParkingSession && (listedParkingSession.listingLocation || parkLocation) && (
                        <Marker
                            longitude={(listedParkingSession.listingLocation || parkLocation!)[1]}
                            latitude={(listedParkingSession.listingLocation || parkLocation!)[0]}
                            anchor="bottom"
                            onClick={(e) => {
                                e.originalEvent.stopPropagation();
                                setShowListedDetails(true);
                            }}
                            style={{ zIndex: 20 }} // Above parked marker
                        >
                            <div className="flex flex-col items-center -translate-y-8">
                                {/* Bubble */}
                                <div className="bg-white dark:bg-zinc-800 p-3 rounded-full shadow-xl border-2 border-[#007AFF] cursor-pointer hover:scale-110 transition-transform">
                                    <QrCode size={20} className="text-[#007AFF]" />
                                </div>
                                <div className="w-0.5 h-3 bg-[#007AFF]/50"></div>
                            </div>
                        </Marker>
                    )}

                    {/* Listed Parking Details Modal */}
                    {showListedDetails && listedParkingSession && (
                        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setShowListedDetails(false)}>
                            <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-sm rounded-[2rem] shadow-2xl p-6 space-y-6 relative border border-black/5 dark:border-white/10" onClick={e => e.stopPropagation()}>
                                <button
                                    onClick={() => setShowListedDetails(false)}
                                    className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-zinc-600 dark:text-white/40 dark:hover:text-white/60"
                                >
                                    <X size={24} />
                                </button>

                                <div className="text-center space-y-1">
                                    <div className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Active Session</div>
                                    <h2 className="text-2xl font-bold dark:text-white leading-tight">
                                        {listedParkingSession.listingName || 'Parking Spot'}
                                    </h2>
                                    <div className="text-lg text-blue-500 font-bold">
                                        {listedParkingSession.shortName || `#${listedParkingSession.spotNumber}`}
                                    </div>
                                </div>

                                {/* QR / ID Display */}
                                <div className="space-y-4">
                                    <div className="p-6 bg-zinc-50 dark:bg-white/5 rounded-3xl flex justify-center border border-black/5 dark:border-white/5">
                                        {/* Real QR Code for Session */}
                                        <QRCodeSVG
                                            value={JSON.stringify({
                                                a: listedParkingSession.spotATag,
                                                authorizer: listedParkingSession.authorizer
                                            })}
                                            size={180}
                                            level="M"
                                            bgColor="transparent"
                                            fgColor="currentColor"
                                            className="text-black dark:text-white"
                                        />
                                    </div>

                                    <div
                                        onClick={() => {
                                            navigator.clipboard.writeText(listedParkingSession.dTag || '');
                                            alert('Copied parking ID');
                                        }}
                                        className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
                                    >
                                        <div className="overflow-hidden">
                                            <div className="text-xs font-bold text-zinc-400 uppercase mb-1">Parking ID</div>
                                            <div className="text-sm font-mono text-zinc-600 dark:text-white/70 truncate">
                                                {listedParkingSession.dTag || 'N/A'}
                                            </div>
                                        </div>
                                        <div className="p-2 bg-blue-500/10 rounded-full text-blue-500">
                                            <Copy size={20} />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => setShowListedDetails(false)}
                                    className="w-full py-4 bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white font-bold rounded-2xl"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {/* User location marker - Unified for ALL modes for smooth transitions */}
                    {location && orientationMode !== 'auto' && (
                        <Marker
                            longitude={location[1]}
                            latitude={location[0]}
                            anchor="center"
                            style={{ zIndex: 1000 }}
                        >
                            <UserLocationMarker
                                bearing={userHeading}
                                mapBearing={viewState.bearing}
                                isNavigationMode={false}
                            />
                        </Marker>
                    )}
                </Map>

                {/* Status Bubbles Container */}
                <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 transition-all duration-300 pointer-events-none ${status !== 'idle' ? 'opacity-100' : ''}`}>
                    {status === 'search' && (
                        <div className="bg-white dark:bg-zinc-800 shadow-lg rounded-full px-4 py-2 flex items-center gap-2 border border-black/5 dark:border-white/10 animate-in fade-in zoom-in slide-in-from-top-4 pointer-events-auto">
                            <div className="animate-spin w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full" />
                            <span className="text-sm font-medium text-zinc-900 dark:text-white whitespace-nowrap">Searching for spots...</span>
                        </div>
                    )}
                    {status === 'parked' && (
                        <div className="bg-white dark:bg-zinc-800 shadow-lg rounded-full px-4 py-2 flex items-center gap-2 border border-black/5 dark:border-white/10 animate-in fade-in zoom-in slide-in-from-top-4 pointer-events-auto">
                            <div className="w-4 h-4 rounded-full bg-green-500 shadow-md" />
                            <span className="text-sm font-medium text-zinc-900 dark:text-white">Session Active</span>
                        </div>
                    )}

                    {/* Create Route Bubble - IDLE state */}
                    {status === 'idle' && !isRouteBubbleMinimized && !dropPinMode && (
                        <div className="bg-white dark:bg-zinc-800 shadow-lg rounded-full px-4 py-2 flex items-center gap-2 border border-black/5 dark:border-white/10 animate-in fade-in zoom-in slide-in-from-top-4 pointer-events-auto">
                            <button
                                onClick={() => setRouteModalOpen(true)}
                                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                            >
                                <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 shadow-sm" />
                                <span className="text-sm font-medium text-zinc-900 dark:text-white whitespace-nowrap">Create Route</span>
                            </button>
                            <div className="w-px h-4 bg-zinc-200 dark:bg-white/10" />
                            <button
                                onClick={() => setIsRouteBubbleMinimized(true)}
                                className="text-zinc-400 hover:text-zinc-600 dark:text-white/40 dark:hover:text-white/80 transition-colors active:scale-95"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Minimized Route Button - Top Right */}
                {status === 'idle' && isRouteBubbleMinimized && !dropPinMode && (
                    <div className="absolute top-4 right-4 z-[1000] animate-in fade-in zoom-in slide-in-from-left-4 duration-300 pointer-events-auto">
                        <button
                            onClick={() => setRouteModalOpen(true)}
                            className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md text-zinc-600 dark:text-white/70 active:scale-95 transition-all shadow-lg border border-black/5 dark:border-white/10"
                            title="Create Route"
                        >
                            <Route size={20} />
                        </button>
                    </div>
                )}

                {/* Drop Pin Mode UI Overlays */}
                {dropPinMode && (
                    <>
                        {/* Center Crosshair (Static over map) */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1600]">
                            {/* Elegant Crosshair Design */}
                            <div className="relative flex items-center justify-center">
                                {/* Outer Glow/Ring */}
                                <div className="absolute w-8 h-8 rounded-full bg-blue-500/10 dark:bg-blue-400/10 animate-pulse" />

                                {/* Center Dot */}
                                <div className="w-1.5 h-1.5 bg-[#007AFF] rounded-full shadow-sm z-10" />

                                {/* Cross Lines */}
                                <div className="absolute w-6 h-[1.5px] bg-[#007AFF]/60 rounded-full" />
                                <div className="absolute h-6 w-[1.5px] bg-[#007AFF]/60 rounded-full" />
                            </div>
                        </div>

                        {/* "Drop Pin Here" Button below crosshair */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-12 z-[1500]">
                            <button
                                onClick={handleDropPin}
                                className="bg-white dark:bg-zinc-800 text-[#007AFF] px-6 py-2.5 rounded-full font-bold text-sm shadow-xl backdrop-blur-md active:scale-95 transition-all flex items-center gap-2 border border-black/5 dark:border-white/10"
                            >
                                <MapPin size={16} className="fill-current" />
                                Drop Pin Here
                            </button>
                        </div>

                        {/* Top Right "Done" Button */}
                        <div className="absolute top-4 right-4 z-[2000] animate-in slide-in-from-top-4 fade-in">
                            <button
                                onClick={confirmDrop}
                                className="bg-[#007AFF] text-white px-6 py-2.5 rounded-full font-bold shadow-lg flex items-center gap-2 transition-transform active:scale-95 active:bg-[#007AFF]"
                            >
                                <Check size={18} strokeWidth={3} />
                                Done
                            </button>
                        </div>


                    </>
                )}
            </div>




            {/* Bottom Left Controls */}
            <div className={`absolute z-[1000] flex flex-col items-start gap-3 animate-in slide-in-from-left-6 transition-opacity duration-300 ${dropPinMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                left: 'max(1rem, env(safe-area-inset-left))'
            }}>
                {/* Vehicle Toggle - Collapsible */}
                <VehicleToggle
                    vehicleType={vehicleType}
                    onVehicleChange={handleVehicleChange}
                    disabled={status !== 'idle'}
                />

                {/* QR Scan Button - Camera with Scan Viewfinder */}
                {/* QR Scan Button - Camera with Scan Viewfinder */}
                <button
                    onClick={() => onRequestScan?.()}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        const code = prompt("Enter Parking Code manually:");
                        if (code) handleScannedCode(code);
                    }}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg text-zinc-600 dark:text-white/70 transition-all active:scale-95"
                    title="Scan QR Code (Long press for manual)"
                >
                    <div className="relative">
                        <ScanLine size={20} />
                    </div>
                </button>

                {/* Listed Parking Button */}
                <button
                    onClick={() => setShowListedParking(true)}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg text-zinc-600 dark:text-white/70 transition-all active:scale-95"
                    title="Listed Parking"
                >
                    <span className="text-3xl font-light leading-none pb-1">‽</span>
                </button>
            </div>

            {/* Bottom Right Controls - Positioned ABOVE Drop Pin 'Done' button if needed? No, Done is top right. */}
            <div className="absolute z-[1000] flex flex-col items-end gap-3 animate-in slide-in-from-right-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                right: 'max(1rem, env(safe-area-inset-right))'
            }}>


                {/* Compass - show when map is rotated (matches other button styles) */}
                {Math.abs(viewState.bearing) > 5 && orientationMode !== 'auto' && (
                    <button
                        onClick={() => {
                            const currentBearing = mapRef.current?.getBearing() || 0;
                            const nearestNorth = Math.round(currentBearing / 360) * 360;
                            mapRef.current?.rotateTo(nearestNorth, { duration: 400 });
                            setViewState(prev => ({ ...prev, pitch: 0 }));
                        }}
                        className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10"
                        title="Reset to true north"
                    >
                        <div
                            className="flex flex-col items-center justify-center"
                            style={{ transform: `rotate(${-viewState.bearing}deg)` }}
                        >
                            <div style={{
                                width: 0,
                                height: 0,
                                borderLeft: '6px solid transparent',
                                borderRight: '6px solid transparent',
                                borderBottom: '10px solid rgb(239 68 68)'
                            }} />
                            <span className="text-sm font-bold text-zinc-600 dark:text-white/70" style={{ marginTop: '-2px' }}>N</span>
                        </div>
                    </button>
                )}

                {/* Orientation Toggle */}
                <button
                    onClick={async () => {
                        if (orientationNeedsPermission) {
                            await requestOrientationPermission();
                            return;
                        }

                        // Drop Pin Mode: One-shot Recenter ONLY (No Auto/Follow modes)
                        if (dropPinMode) {
                            if (location) {
                                mapRef.current?.flyTo({
                                    center: [location[1], location[0]],
                                    zoom: 17,
                                    duration: 800,
                                    essential: true
                                });
                            }
                            return;
                        }

                        // CRITICAL: Stop any ongoing map animations (e.g. flyTo) immediately
                        // This ensures the button works even if the map is currently moving/animating
                        mapRef.current?.stop();
                        isTransitioning.current = false; // Reset transition flag just in case

                        // Logic:
                        // 1. If map is not centered on user (needsRecenter):
                        //    - Recenter ONLY (keep zoom if > 17).
                        //    - If Zoom < 17, also zoom to 17.
                        // 2. If map IS centered (needsRecenter = false):
                        //    - If Zoom != 17 (specifically > 17 per requirement):
                        //      "If the user is zoomed in beyond the default level... next time they click it we will fix it to the default level."
                        //      "If the user is zoomed out... first click first recentres... then we zoom in."

                        const currentZoom = viewState.zoom;
                        const DEFAULT_ZOOM = 17;

                        // Case 1: Needs Recenter (User panned away)
                        if (needsRecenter) {
                            if (location) {
                                // If zoomed out, zoom in. If zoomed in, keep zoom.
                                const targetZoom = currentZoom < DEFAULT_ZOOM ? DEFAULT_ZOOM : currentZoom;

                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    center: [location[1], location[0]],
                                    zoom: targetZoom,
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                            }
                            setOrientationMode('recentre');
                            setNeedsRecenter(false);
                            return;
                        }

                        // Case 2: Already Centered but Incorrect Zoom OR Manual Re-trigger
                        // If we are already in 'recentre' or 'fixed' and coming back, make it smooth.
                        if (orientationMode === 'fixed' || orientationMode === 'recentre') {
                            if (location) {
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    center: [location[1], location[0]], // Ensure we fly to user
                                    zoom: currentZoom < DEFAULT_ZOOM ? DEFAULT_ZOOM : currentZoom,
                                    bearing: Math.round((mapRef.current?.getBearing() || 0) / 360) * 360, // Shortest path to North
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => {
                                    isTransitioning.current = false;
                                    // Ensure we stay in recentre mode after flyTo (fixes any pending state)
                                    if (orientationMode === 'fixed') setOrientationMode('recentre');
                                });
                            }
                        }

                        // Case 3: Cycle Modes
                        // Standard mobile map pattern:
                        // Fixed (Off) -> Recentre (Follow) -> Auto (Heading) -> Recentre (Follow)
                        // Pan -> Fixed (Handled in handleMove)

                        if (orientationMode === 'recentre') {
                            // If PARKED, skip Auto mode and go back to Fixed
                            if (status === 'parked') {
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    bearing: Math.round((mapRef.current?.getBearing() || 0) / 360) * 360, // Shortest path to North
                                    pitch: 0,
                                    zoom: 16.5,
                                    duration: 800,
                                    essential: true
                                });
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                                setOrientationMode('fixed');
                                return;
                            }

                            // Normal behavior: Recentre -> Auto
                            // Smoothly rotate map to current compass heading BEFORE switching mode
                            // This prevents the "snap" from 0 to current heading
                            const targetBearing = userHeading || 0;
                            isTransitioning.current = true;
                            setPendingAutoMode(true); // Immediate visual update
                            mapRef.current?.rotateTo(targetBearing, { duration: 800 });
                            mapRef.current?.once('moveend', () => {
                                isTransitioning.current = false;
                                setPendingAutoMode(false);
                                // Reset animator to match target to prevent spin on takeover
                                bearingAnimator.current.reset(targetBearing);
                                setOrientationMode('auto');
                            });
                            return; // Don't change mode yet
                        }

                        setOrientationMode(m => {
                            if (m === 'auto') {
                                // NEW: Auto -> Fixed (Exit Cycle)
                                // Reset zoom to default (16.5) and rotation to 0
                                // Calculate shortest rotation to North to preventing spinning/flashing
                                const currentBearing = mapRef.current?.getBearing() || 0;
                                const nearestNorth = Math.round(currentBearing / 360) * 360;

                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    bearing: nearestNorth,
                                    pitch: 0,
                                    zoom: 16.5,
                                    duration: 800,
                                    essential: true
                                });
                                // Reset flags
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                                setPendingAutoMode(false);
                                return 'fixed'; // Switch to Fixed
                            }
                            // Fixed -> Recentre (Cycle started by flyTo above)
                            return 'recentre';
                        });
                    }}
                    className={`h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg ${orientationNeedsPermission
                        ? 'bg-orange-500/20 border-orange-500/50 text-orange-500 animate-pulse'
                        : 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70'
                        }`}
                >
                    {orientationNeedsPermission ? (
                        <Locate size={20} className="text-orange-500 animate-pulse" />
                    ) : dropPinMode ? (
                        <Locate size={20} className="text-zinc-600 dark:text-white/70" />
                    ) : (orientationMode === 'auto' || pendingAutoMode) ? (
                        <ArrowUp size={20} className="text-blue-500" />
                    ) : orientationMode === 'recentre' ? (
                        <Locate size={20} fill="currentColor" className="text-green-500" />
                    ) : (
                        <Locate size={20} className={`text-zinc-600 dark:text-white/70 ${needsRecenter ? 'opacity-50' : ''}`} />
                    )}
                </button>

                {/* Profile Button - Hidden in Drop Pin Mode */}
                {!dropPinMode && (
                    <div className="relative z-[1010]">
                        <ProfileButton
                            setHistorySpots={setHistorySpots}
                            onHelpClick={() => setShowHelp(true)}
                        />
                    </div>
                )}

                {/* FAB - Hidden in Drop Pin Mode */}
                {!dropPinMode && (
                    <FAB
                        status={status}
                        setStatus={setStatus}
                        searchLocation={location}
                        vehicleType={vehicleType}
                        setOpenSpots={setOpenSpots}
                        parkLocation={parkLocation}
                        setParkLocation={setParkLocation}
                        sessionStart={sessionStart}
                        setSessionStart={setSessionStart}
                        listedParkingSession={listedParkingSession}
                        onQRScan={() => onRequestScan?.()}
                    />
                )}
            </div>

            {/* Route Button Component (Moved out of visual stack to prevent spacing gaps) */}
            <div className={dropPinMode ? 'hidden' : 'block'}>
                <RouteButton
                    vehicleType={vehicleType}
                    onRouteChange={handleRouteChange}
                    currentLocation={location}
                    onDropPinModeChange={setDropPinMode}
                    pendingWaypoints={pendingWaypoints}
                    onDropPinConsumed={() => setPendingWaypoints(null)}
                    onOpenChange={setRouteButtonOpen} // Track open state
                    onWaypointsChange={setListWaypoints} // Sync waypoints
                    onRequestOrientationPermission={requestOrientationPermission} // iOS compass permission
                    // Controlled props for new UI
                    isOpen={routeModalOpen}
                    onClose={() => setRouteModalOpen(false)}
                    hideTrigger={true}
                    onRouteCreated={() => setIsRouteBubbleMinimized(true)}
                />
            </div>



            {/* Help Modal */}
            {
                showHelp && (
                    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl pt-2 px-4 pb-4 animate-in fade-in">
                        <button
                            onClick={() => setShowHelp(false)}
                            className="absolute inset-0 z-0 cursor-default"
                        />
                        <div
                            className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] border border-black/5 dark:border-white/5 shadow-2xl p-6 space-y-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar transition-colors"
                            style={{ overscrollBehaviorY: 'contain' }}
                        >
                            <button
                                onClick={() => setShowHelp(false)}
                                className="absolute top-6 left-6 p-2 rounded-full transition-colors text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/20"
                            >
                                <ArrowLeft size={20} />
                            </button>

                            <div className="text-center space-y-2 pt-4">
                                <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 dark:text-blue-400 mb-4">
                                    <span className="text-3xl font-bold">?</span>
                                </div>
                                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">How to use Parlens</h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Decentralized Route & Parking Management</p>
                            </div>



                            {/* Install Instructions Accordion */}
                            <div className="space-y-3">
                                <h3 className="text-center font-bold text-zinc-600 dark:text-white/90">Add to your homescreen</h3>
                                {/* Android */}
                                <div className="rounded-2xl bg-zinc-100 dark:bg-white/5">
                                    <button onClick={() => {
                                        const el = document.getElementById('android-guide');
                                        el?.classList.toggle('hidden');
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
                                        <span>Using Browser Menu (Android)</span>
                                        <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
                                    </button>
                                    <div id="android-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/70 space-y-2">
                                        <p className="font-semibold text-zinc-900 dark:text-white">Chrome & Brave:</p>
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap menu button (three dots)</li>
                                            <li>Tap <strong>Add to Home screen</strong></li>
                                            <li>Tap <strong>Add</strong> to confirm</li>
                                        </ol>
                                        <p className="font-semibold text-zinc-900 dark:text-white mt-3">Firefox:</p>
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap menu button (three dots)</li>
                                            <li>Tap <strong>Install</strong></li>
                                        </ol>
                                    </div>
                                </div>

                                {/* iOS */}
                                <div className="rounded-2xl bg-zinc-100 dark:bg-white/5">
                                    <button onClick={() => {
                                        const el = document.getElementById('ios-guide');
                                        el?.classList.toggle('hidden');
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
                                        <span>Using Share Button (iOS)</span>
                                        <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
                                    </button>
                                    <div id="ios-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/70 space-y-2">
                                        <ol className="list-decimal pl-5 space-y-1">
                                            <li>Tap the <strong>Share</strong> button in Safari menu bar.</li>
                                            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                                            <li>Launch Parlens from your home screen.</li>
                                        </ol>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 text-sm text-zinc-600 dark:text-white/80 leading-relaxed pt-4 border-t border-black/5 dark:border-white/10">
                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">1. Select vehicle type</strong>
                                    Use the vertical toggle on the bottom-left to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">2. Plan your route (optional)</strong>
                                    Tap the route button to add waypoints and create a route. If the system generated route(s) between your start and end points are not to your liking, add additional waypoints in locations you would prefer travelling through. Click the location button to re-centre and turn on follow-me or navigation mode for route tracking.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">3. Find and log parking</strong>
                                    Click the main button once to see open spots in listed parking spaces and open spots reported by others live or within the last 5 minutes. For standard parking: Click again to mark your location. When leaving, click once more to end the session, log the fee and report the spot. For listed parking: Click the QR code scanner button below the vehicle type selector. Scan the QR code at the parking location to start the session. When leaving, scan it again to end the session and log the fee. Use the profile button to see your parking history.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">4. Create and manage a listed parking (optional)</strong>
                                    Users who oversee one or more parking spots can create a listed parking to simplify spot and lot management. Click the parking services button (‽) at the bottom left-hand corner of the screen, and click the '+' button to create a listing. Provide the relevant details requested in the form to create an online listing that matches your real-world space. Listed parkings can be public (open to all users) or private (open to select users and only publish to select relays). Once created you can see your listings as viewed by other users in the public or private listing page. You should use the my listing page to manage your listing(s). Larger listings may take longer to create. You may manually refresh the page using the button provided next to the search bar if automatic updates are not returned fast enough.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">5. Create your own mirror (optional)</strong>
                                    <a
                                        href="https://github.com/prasannawarrier/parlens-pwa/blob/main/MIRROR_CREATION.md"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 dark:text-blue-400 underline"
                                    >
                                        Follow these steps
                                    </a> to create your own mirror of the Parlens app to distribute the bandwidth load while sharing with your friends.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">6. User privacy</strong>
                                    Parlens does not collect or share any user data. Your log and route data is encrypted by your keys, only accessible by you and stored on relays of your preference. Open spot broadcasts and listed parking log updates use temporary identifiers to prevent your permanent public key from being shared.
                                </p>

                                {/* Bottom tip */}
                                <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 mt-6">
                                    <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                                        <span className="font-bold">Tip: </span>
                                        Use Parlens over your cellular internet connection to prevent personal IP address(es) from being associated with your data.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Listed Parking Fullscreen Page */}
            {/* Listed Parking Page Overlay */}
            <div style={{ display: showListedParking && !isPickingLocation ? 'block' : 'none' }}>
                {showListedParking && (
                    <ListedParkingPage
                        onClose={() => setShowListedParking(false)}
                        currentLocation={location}
                        countryCode={countryCode}
                        onPickLocation={() => setIsPickingLocation(true)}
                        pickedLocation={pickedListingLocation}
                    />
                )}
            </div>

            {/* Location Picker UI for Listings */}
            {isPickingLocation && (
                <>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1500]">
                        <div className="relative">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-4 bg-black/50" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-1 bg-black/50" />
                            <div className="w-8 h-8 border-2 border-purple-500 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-sm shadow-xl animate-in zoom-in spin-in-180 duration-500">
                                <MapPin size={16} className="text-purple-600 fill-current" />
                            </div>
                        </div>
                    </div>
                    <div className="absolute bottom-10 left-0 right-0 z-[2000] flex justify-center gap-4 px-4 pb-safe animate-in slide-in-from-bottom">
                        <button
                            onClick={() => setIsPickingLocation(false)}
                            className="px-6 py-3 rounded-full bg-white text-zinc-900 font-bold shadow-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                setPickedListingLocation({ lat: viewState.latitude, lon: viewState.longitude });
                                setIsPickingLocation(false);
                            }}
                            className="px-6 py-3 rounded-full bg-purple-600 text-white font-bold shadow-lg shadow-purple-500/30"
                        >
                            Confirm Location
                        </button>
                    </div>
                </>
            )}

            {/* QR Scanner Overlay */}
            {/* Listed Session End Cost Popup */}
            {showListedEndPopup && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 p-4">
                    <div className="w-full max-w-sm bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col items-center space-y-5 animate-in zoom-in-95 border border-black/5 dark:border-white/10 transition-colors">
                        <div className="text-center space-y-1">
                            <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">End Session</h3>
                            <p className="text-xs font-medium text-zinc-500 dark:text-white/40">Enter total parking fee</p>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 bg-zinc-100 dark:bg-white/5 px-5 py-4 rounded-[1.5rem] border border-black/5 dark:border-white/5">
                                <span className="text-2xl font-bold text-blue-500">$</span>
                                <input
                                    type="number"
                                    value={endSessionCost}
                                    onChange={(e) => setEndSessionCost(e.target.value)}
                                    autoFocus
                                    className="w-20 bg-transparent text-4xl font-black text-center text-zinc-900 dark:text-white focus:outline-none placeholder:text-zinc-300 dark:placeholder:text-white/10 appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                                    min="0"
                                />
                                <span className="text-sm font-bold text-zinc-400 dark:text-white/20">USD</span>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <button
                                    onClick={() => setEndSessionCost(String(Math.max(0, parseFloat(endSessionCost || '0') + 1)))}
                                    className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronUp size={22} className="text-zinc-600 dark:text-white/70" />
                                </button>
                                <button
                                    onClick={() => setEndSessionCost(String(Math.max(0, parseFloat(endSessionCost || '0') - 1)))}
                                    className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
                                >
                                    <ChevronDown size={22} className="text-zinc-600 dark:text-white/70" />
                                </button>
                            </div>
                        </div>

                        <div className="w-full space-y-3">
                            <button
                                onClick={handleConfirmEndListedSession}
                                className="w-full h-14 rounded-[1.5rem] bg-[#007AFF] text-white text-lg font-bold flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all"
                            >
                                Log Parking <ArrowRight size={20} />
                            </button>

                            <button
                                onClick={() => {
                                    setShowListedEndPopup(false);
                                    setPendingEndSession(null);
                                    setEndSessionCost('0');
                                }}
                                className="w-full text-xs font-bold text-zinc-400 dark:text-white/30 tracking-widest uppercase py-3 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div >
    );
};

export default LandingPage;
