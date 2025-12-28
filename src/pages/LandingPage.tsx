/**
 * Landing Page with Pure MapLibre GL JS
 * Replaces Leaflet for native vector map rotation and smooth zoom
 */
import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { HelpCircle, X, MapPin, Locate, ChevronUp, ChevronDown, ArrowUp } from 'lucide-react';
import Map, { Marker, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';
import { RouteButton } from '../components/RouteButton';
import { clusterSpots, isCluster } from '../lib/clustering';
import { getCurrencySymbol } from '../lib/currency';

// Free vector tile styles - using simpler styles that match better
const MAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
};

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
    // If Map is rotated B. Screen Up is Map-Direction B.
    // North is at -B.
    // If User Heading H.
    // We want arrow to point H relative to North.
    // Relative to Screen Up?
    // Screen Up = Map Bearing B.
    // User Heading H.
    // Angle = H - B.
    const rotation = isNavigationMode ? 0 : (bearing - mapBearing);
    const scale = isNavigationMode ? 1 : 1;

    return (
        <div
            style={{
                transform: `rotate(${rotation}deg) scale(${scale})`,
                transition: 'transform 0.3s ease-out',
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

// Spot Marker Component
const SpotMarkerContent = memo(({ price, currency, type }: { price: number; currency: string; type: 'open' | 'history' }) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const bgColor = type === 'open' ? '#34C759' : '#8E8E93';
    const opacity = type === 'history' ? 0.7 : 1;
    const symbol = getCurrencySymbol(currency);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 32, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))', opacity }}>
                {emoji}
            </div>
            <div style={{
                background: bgColor,
                borderRadius: 12,
                padding: '2px 8px',
                fontWeight: 'bold',
                fontSize: 11,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transform: 'translateY(-5px)',
                whiteSpace: 'nowrap',
                color: 'white'
            }}>
                {symbol}{Math.round(price)}/hr
            </div>
        </div>
    );
});
SpotMarkerContent.displayName = 'SpotMarkerContent';

// Cluster Marker Component  
const ClusterMarkerContent = memo(({ count, minPrice, maxPrice, currency, type }: {
    count: number; minPrice: number; maxPrice: number; currency: string; type: 'open' | 'history'
}) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const bgColor = type === 'open' ? '#34C759' : '#8E8E93';
    const symbol = getCurrencySymbol(currency);
    const priceRange = minPrice === maxPrice ? `${symbol}${minPrice}` : `${symbol}${minPrice}-${maxPrice}`;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 28, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))', position: 'relative' }}>
                {emoji}
                <div style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    background: bgColor,
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 'bold',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid white'
                }}>
                    {count}
                </div>
            </div>
            <div style={{
                background: bgColor,
                borderRadius: 12,
                padding: '2px 8px',
                fontWeight: 'bold',
                fontSize: 10,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transform: 'translateY(-5px)',
                whiteSpace: 'nowrap',
                color: 'white'
            }}>
                {priceRange}
            </div>
        </div>
    );
});
ClusterMarkerContent.displayName = 'ClusterMarkerContent';

// Active Session Marker
const ActiveSessionMarkerContent = memo(({ vehicleType }: { vehicleType: 'bicycle' | 'motorcycle' | 'car' }) => {
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
        <div className="flex flex-col rounded-[2rem] bg-white/80 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg mb-2 overflow-hidden transition-all duration-300">
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
                                : 'hover:bg-black/5 dark:hover:bg-white/10'
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
                        className="w-10 h-6 flex items-center justify-center text-zinc-400 dark:text-white/40 hover:text-zinc-600 dark:hover:text-white/60 transition-colors"
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
export const LandingPage: React.FC = () => {
    const mapRef = useRef<MapRef>(null);
    const [location, setLocation] = useState<[number, number] | null>(null);
    const [locationError, setLocationError] = useState<string | null>(null);
    const [bearing, setBearing] = useState(0);
    const [status, setStatus] = useState<'idle' | 'search' | 'parked'>('idle');
    const [orientationMode, setOrientationMode] = useState<'fixed' | 'recentre' | 'auto'>('fixed');
    const [showHelp, setShowHelp] = useState(false);
    const [vehicleType, setVehicleType] = useState<'bicycle' | 'motorcycle' | 'car'>(() => {
        const saved = localStorage.getItem('parlens_vehicle_type');
        return (saved === 'bicycle' || saved === 'motorcycle' || saved === 'car') ? saved : 'car';
    });
    const [openSpots, setOpenSpots] = useState<any[]>([]);
    const [historySpots, setHistorySpots] = useState<any[]>([]);
    const [parkLocation, setParkLocation] = useState<[number, number] | null>(null);
    const [needsRecenter, setNeedsRecenter] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(17);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<{ lat: number; lon: number }[] | null>(null);
    const [showRoute, setShowRoute] = useState(false);
    const [dropPinMode, setDropPinMode] = useState(false);
    const [pendingDropPin, setPendingDropPin] = useState<{ lat: number; lon: number } | null>(null);

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

    // Orientation permission state (for iOS)
    const [orientationNeedsPermission, setOrientationNeedsPermission] = useState(false);

    // Cumulative rotation for smooth bearing transitions
    const lastBearing = useRef(0);
    const [cumulativeRotation, setCumulativeRotation] = useState(0);

    // Initialize location tracking with simple geolocation
    useEffect(() => {
        if (!navigator.geolocation) {
            setLocationError('Geolocation is not supported by your browser');
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setLocation([latitude, longitude]);

                // Initialize view state on first location
                if (!location) {
                    setViewState(prev => ({
                        ...prev,
                        latitude,
                        longitude
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

        return () => {
            navigator.geolocation.clearWatch(watchId);
        };
    }, []);

    // Device orientation tracking
    useEffect(() => {
        // Check if orientation permission is needed (iOS 13+)
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            setOrientationNeedsPermission(true);
        }

        const handleOrientation = (event: DeviceOrientationEvent) => {
            let newBearing: number | null = null;

            // iOS uses webkitCompassHeading
            if ((event as any).webkitCompassHeading !== undefined) {
                newBearing = (event as any).webkitCompassHeading;
            } else if (event.alpha !== null && event.absolute) {
                // Android
                newBearing = (360 - event.alpha) % 360;
            }

            if (newBearing !== null) {
                setBearing(newBearing);

                // Calculate cumulative rotation for smooth animations
                let delta = newBearing - lastBearing.current;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                setCumulativeRotation(prev => prev + delta);
                lastBearing.current = newBearing;
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

    // Update map view when following user location
    useEffect(() => {
        // Don't update when: user interacting, transitioning, showing route, or not in tracking mode
        if (!isUserInteracting.current && !isTransitioning.current && !showRoute && location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            const newState: any = {
                longitude: location[1],
                latitude: location[0],
                pitch: 0 // Keep top-down view always
            };

            if (orientationMode === 'auto') {
                // In auto mode, use cumulative rotation for smooth 360 transitions
                newState.bearing = cumulativeRotation;
            }

            setViewState(prev => ({
                ...prev,
                ...newState
            }));
        }
    }, [location, cumulativeRotation, orientationMode, showRoute]);

    // Handle map move - Update state immediately when user moves map
    const handleMove = useCallback((evt: { viewState: typeof viewState }) => {
        setViewState(evt.viewState);

        // Immediate check for off-center to update icon to 'fixed' immediately
        if (location && isUserInteracting.current) {
            const distance = Math.sqrt(
                Math.pow(evt.viewState.longitude - location[1], 2) +
                Math.pow(evt.viewState.latitude - location[0], 2)
            );

            // ~50m threshold to switch to fixed mode
            if (distance > 0.0005) {
                if (!needsRecenter) setNeedsRecenter(true);
                if (orientationMode !== 'fixed') setOrientationMode('fixed');
            }
        }
    }, [location, orientationMode, needsRecenter]);

    const handleMoveStart = useCallback(() => {
        isUserInteracting.current = true;
        // ANY map interaction immediately switches to fixed mode
        // User must click location button to re-enable tracking
        if (orientationMode !== 'fixed') {
            setOrientationMode('fixed');
            setNeedsRecenter(true);
        }
    }, [orientationMode]);

    const handleMoveEnd = useCallback(() => {
        isUserInteracting.current = false;
        setZoomLevel(viewState.zoom);
    }, [viewState.zoom]);

    // Handle map click for drop pin
    const handleClick = useCallback((evt: maplibregl.MapMouseEvent) => {
        if (dropPinMode) {
            setPendingDropPin({ lat: evt.lngLat.lat, lon: evt.lngLat.lng });
        }
    }, [dropPinMode]);

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
            const lngs = main.map(c => c[1]);
            const lats = main.map(c => c[0]);
            const bounds = new maplibregl.LngLatBounds(
                [Math.min(...lngs), Math.min(...lats)],
                [Math.max(...lngs), Math.max(...lats)]
            );

            // Prevent location tracking from overriding the fit
            isTransitioning.current = true;
            mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
            mapRef.current.once('moveend', () => {
                isTransitioning.current = false;
            });
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
            original: s
        }));
    }, [openSpots, vehicleType, status]);

    const clusteredOpenSpots = useMemo(() =>
        clusterSpots(processedOpenSpots, zoomLevel)
        , [processedOpenSpots, zoomLevel]);

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

    // Loading state
    if (!location) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-gray-50 dark:bg-black">
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
                                className="mt-2 px-6 py-2 rounded-full bg-blue-500 text-white text-sm font-medium active:scale-95 transition-transform"
                            >
                                Try Again
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 overflow-hidden bg-gray-50 dark:bg-black transition-colors duration-300">
            {/* Drop Pin Mode Indicator */}
            {dropPinMode && (
                <div className="absolute top-0 left-0 right-0 z-[1000] bg-orange-500 text-white py-3 px-4 text-center font-medium shadow-lg animate-pulse">
                    📍 Tap anywhere on the map to drop a pin
                </div>
            )}

            {/* MapLibre GL Map */}
            <div className="absolute inset-0">
                <Map
                    ref={mapRef}
                    {...viewState}
                    onMove={handleMove}
                    onMoveStart={handleMoveStart}
                    onMoveEnd={handleMoveEnd}
                    onClick={handleClick}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle={mapStyle}
                    attributionControl={false}
                >
                    {/* Alternate route */}
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

                    {/* Main route */}
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

                    {/* History spots */}
                    {clusteredHistorySpots.map(item => (
                        <Marker
                            key={item.id}
                            longitude={item.lon}
                            latitude={item.lat}
                            anchor="bottom"
                        >
                            {isCluster(item) ? (
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
                                    type="history"
                                />
                            )}
                        </Marker>
                    ))}

                    {/* Open spots */}
                    {clusteredOpenSpots.map(item => (
                        <Marker
                            key={item.id}
                            longitude={item.lon}
                            latitude={item.lat}
                            anchor="bottom"
                        >
                            {isCluster(item) ? (
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
                                    type="open"
                                />
                            )}
                        </Marker>
                    ))}

                    {/* Route waypoints */}
                    {showRoute && routeWaypoints?.map((wp, index) => (
                        <Marker
                            key={`waypoint-${index}`}
                            longitude={wp.lon}
                            latitude={wp.lat}
                            anchor="center"
                        >
                            <div style={{
                                width: 20,
                                height: 20,
                                background: '#007AFF',
                                border: '2px solid white',
                                borderRadius: '50%',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: 10,
                                fontWeight: 'bold'
                            }}>
                                {index + 1}
                            </div>
                        </Marker>
                    ))}

                    {/* Parked vehicle marker */}
                    {status === 'parked' && parkLocation && (
                        <Marker
                            longitude={parkLocation[1]}
                            latitude={parkLocation[0]}
                            anchor="center"
                        >
                            <ActiveSessionMarkerContent vehicleType={vehicleType} />
                        </Marker>
                    )}

                    {/* User location marker - Always on top */}
                    <Marker
                        longitude={location[1]}
                        latitude={location[0]}
                        anchor="center"
                        style={{ zIndex: 1000 }}
                    >
                        <UserLocationMarker
                            bearing={bearing}
                            mapBearing={viewState.bearing}
                            isNavigationMode={orientationMode === 'auto'}
                        />
                    </Marker>
                </Map>
            </div>




            {/* Bottom Left Controls */}
            <div className="absolute z-[1000] flex flex-col items-start gap-3 animate-in slide-in-from-left-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                left: 'max(1rem, env(safe-area-inset-left))'
            }}>
                {/* Vehicle Toggle - Collapsible */}
                <VehicleToggle
                    vehicleType={vehicleType}
                    onVehicleChange={handleVehicleChange}
                    disabled={status !== 'idle'}
                />

                {/* Help Button */}
                <button
                    onClick={() => setShowHelp(true)}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg text-zinc-600 dark:text-white/70 transition-all active:scale-95"
                >
                    <HelpCircle size={20} />
                </button>
            </div>

            {/* Bottom Right Controls */}
            <div className="absolute z-[1000] flex flex-col items-end gap-3 animate-in slide-in-from-right-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                right: 'max(1rem, env(safe-area-inset-right))'
            }}>


                {/* Compass - show when map is rotated (matches other button styles) */}
                {Math.abs(viewState.bearing) > 5 && orientationMode !== 'auto' && (
                    <button
                        onClick={() => {
                            mapRef.current?.rotateTo(0, { duration: 400 });
                            setViewState(prev => ({ ...prev, bearing: 0, pitch: 0 }));
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

                        if (needsRecenter) {
                            // Case 1: Recenter User
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
                            // Just set to recentre mode, don't cycle yet
                            setOrientationMode('recentre');
                            setNeedsRecenter(false);
                            return;
                        }

                        // Case 2: Already Centered, incorrect zoom
                        if (Math.abs(currentZoom - DEFAULT_ZOOM) > 0.5) {
                            // Reset Zoom to default
                            isTransitioning.current = true;
                            mapRef.current?.flyTo({
                                zoom: DEFAULT_ZOOM,
                                duration: 600
                            });
                            mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                            return;
                        }

                        // Case 3: Cycle Modes
                        setOrientationMode(m => {
                            if (m === 'recentre') {
                                // Switch to Auto (Navigation) - SMOOTH TRANSITION
                                isTransitioning.current = true;
                                mapRef.current?.flyTo({
                                    bearing: cumulativeRotation,
                                    duration: 1000,
                                    easing: (t) => t
                                });
                                mapRef.current?.once('moveend', () => { isTransitioning.current = false; });
                                return 'auto';
                            }
                            if (m === 'auto') {
                                // Reset to North when exiting navigation smoothy
                                // "fix the orientation" -> rotate to 0
                                // Important: We use rotateTo for animation, and DO NOT manually set viewState.bearing
                                // Let the map update viewState via onMove
                                mapRef.current?.rotateTo(0, { duration: 600 });
                                // Don't return 'fixed' immediately if we want to ensure animation completes?
                                // Actually, returning 'fixed' is fine because we want to stop 'auto' tracking updates.
                                // isTransitioning is NOT needed here because useEffect is disabled for 'fixed' anyway.
                                return 'fixed';
                            }
                            // From Fixed -> Recentre
                            return 'recentre';
                        });
                    }}
                    className={`h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg ${orientationNeedsPermission
                        ? 'bg-orange-500/20 border-orange-500/50 text-orange-500 animate-pulse'
                        : 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70'
                        }`}
                >
                    {orientationNeedsPermission ? (
                        <MapPin size={20} />
                    ) : orientationMode === 'auto' ? (
                        <ArrowUp size={20} className="text-blue-500" />
                    ) : orientationMode === 'recentre' ? (
                        <Locate size={20} fill="currentColor" className="text-green-500" />
                    ) : (
                        <MapPin size={20} />
                    )}
                </button>

                {/* Route Button */}
                <RouteButton
                    vehicleType={vehicleType}
                    onRouteChange={handleRouteChange}
                    currentLocation={location}
                    onDropPinModeChange={setDropPinMode}
                    pendingDropPin={pendingDropPin}
                    onDropPinConsumed={() => setPendingDropPin(null)}
                />

                {/* Profile Button - Moved back here */}
                <div className="relative z-[1010]">
                    <ProfileButton
                        setHistorySpots={setHistorySpots}
                    />
                </div>

                {/* FAB */}
                <FAB
                    status={status}
                    setStatus={setStatus}
                    location={location}
                    vehicleType={vehicleType}
                    setOpenSpots={setOpenSpots}
                    parkLocation={parkLocation}
                    setParkLocation={setParkLocation}
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
                        <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] border border-black/5 dark:border-white/5 shadow-2xl p-6 space-y-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar transition-colors">
                            <button
                                onClick={() => setShowHelp(false)}
                                className="absolute top-6 right-6 p-2 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                            >
                                <X size={20} className="text-black/60 dark:text-white/60" />
                            </button>

                            <div className="text-center space-y-2 pt-4">
                                <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 dark:text-blue-400 mb-4">
                                    <HelpCircle size={32} />
                                </div>
                                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">How to use Parlens</h2>
                            </div>

                            {/* Install Instructions Accordion */}
                            <div className="space-y-3">
                                <h3 className="text-center font-bold text-zinc-600 dark:text-white/90">Add to your homescreen</h3>
                                {/* Android */}
                                <div className="rounded-2xl bg-zinc-100 dark:bg-white/5">
                                    <button onClick={() => {
                                        const el = document.getElementById('android-guide');
                                        el?.classList.toggle('hidden');
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
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
                                    }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-800 dark:text-zinc-200 transition-colors rounded-2xl" style={{ WebkitTapHighlightColor: 'transparent' }}>
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
                                    <strong className="text-zinc-900 dark:text-white block mb-1">1. Plan your route (optional)</strong>
                                    Tap the route button to add waypoints and create a route. Click the location button to re-centre and turn on follow-me or navigation mode for route tracking.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">2. Select vehicle type</strong>
                                    Use the vertical toggle on the bottom-left to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">3. Find and log parking spots</strong>
                                    Click the main button once to see open spots reported by others live or within the last minute. Click again to mark your location. When leaving, click once more to end the session and report the fee. Use the profile button to see your parking history.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">4. User privacy</strong>
                                    Parlens does not collect or share any user data. Your log and route data is encrypted by your keys and only accessible by you. Open spot broadcasts are ephemeral and not linked to any personal identifiers.
                                </p>

                                <p>
                                    <strong className="text-zinc-900 dark:text-white block mb-1">5. Create your own mirror</strong>
                                    <a
                                        href="https://github.com/prasannawarrier/parlens-pwa/blob/main/MIRROR_CREATION.md"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline"
                                    >
                                        Follow these steps
                                    </a> to create your own mirror of the Parlens app to distribute the bandwidth load while sharing with your friends.
                                </p>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default LandingPage;
