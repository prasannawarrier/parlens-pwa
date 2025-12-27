import React, { useState, useEffect, useRef, memo } from 'react';
import { HelpCircle, Compass, ChevronDown, X, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';
import { RouteButton } from '../components/RouteButton';
import { getCurrencySymbol } from '../lib/currency';
import { clusterSpots, isCluster, type Cluster, type SpotBase } from '../lib/clustering';
import { LocationSmoother, BearingAnimator } from '../lib/locationSmoothing';

// Fix Leaflet marker icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom Marker for User - ALWAYS navigation arrow
const UserMarker = ({ location, bearing }: { location: [number, number], bearing: number }) => {
    // Standard navigation arrow
    const content = `
           <div style="transform: rotate(${bearing}deg); transition: transform 0.05s linear; display: flex; align-items: center; justify-content: center;">
             <div style="width: 28px; height: 28px; background: #007AFF; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,122,255,0.4), 0 4px 12px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; position: relative;">
                <svg width="14" height="14" viewBox="0 0 14 14" style="transform: translateY(-1px); filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));">
                  <path d="M7 0L14 14L7 12L0 14L7 0Z" fill="white" />
                </svg>
             </div>
           </div>`;

    const customIcon = L.divIcon({
        className: 'user-location-marker',
        html: content,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    return <Marker position={location} icon={customIcon} zIndexOffset={1000} />;
}

// Marker for the user's currently parked vehicle
const ActiveSessionMarker = ({ location, vehicleType, bearing, orientationMode }: { location: [number, number], vehicleType: string, bearing: number, orientationMode: 'fixed' | 'recentre' | 'auto' }) => {
    const emoji = vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗';
    const rotation = orientationMode === 'auto' ? bearing : 0;
    const content = `<div style="font-size: 36px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4)); transform: rotate(${rotation}deg);">${emoji}</div>`;

    const customIcon = L.divIcon({
        className: 'active-session-marker',
        html: content,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    return <Marker position={location} icon={customIcon} />;
};

// Marker for Open Spots (Kind 31714) - shows 🅿️ - Memoized to prevent re-renders
// Marker for Open Spots (Kind 31714) - shows 🅿️ - Memoized to prevent re-renders
// Marker for Open Spots (Kind 31714) - shows 🅿️ - Memoized to prevent re-renders
const SpotMarker = memo(({ spot, bearing, orientationMode }: { spot: any, bearing: number, orientationMode: 'fixed' | 'recentre' | 'auto' }) => {
    const rotation = orientationMode === 'auto' ? bearing : 0;
    const content = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px; transform: rotate(${rotation}deg);">
             <div style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                🅿️
             </div>
             <div style="background: #34C759; border-radius: 12px; padding: 2px 8px; font-weight: bold; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transform: translateY(-5px); white-space: nowrap; color: white;">
                ${spot.price > 0 ? `${spot.currency === 'USD' ? '$' : spot.currency}${Math.round(spot.price)}/hr` : 'Free'}
             </div>
        </div>
    `;

    const icon = L.divIcon({
        className: 'spot-marker',
        html: content,
        iconSize: [60, 60],
        iconAnchor: [30, 45]
    });

    return <Marker position={[spot.lat, spot.lon]} icon={icon} />;
});

// Marker for History Spots (Kind 31417) - shows 🅟
const HistoryMarker = ({ spot, bearing, orientationMode }: { spot: any, bearing: number, orientationMode: 'fixed' | 'recentre' | 'auto' }) => {
    const content = spot.decryptedContent;
    if (!content || !content.lat || !content.lon) return null;

    const rotation = orientationMode === 'auto' ? bearing : 0;
    const htmlContent = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px; transform: rotate(${rotation}deg);">
             <div style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); opacity: 0.7;">
                🅟
             </div>
             <div style="background: #8E8E93; border-radius: 12px; padding: 2px 8px; font-weight: bold; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transform: translateY(-5px); white-space: nowrap; color: white;">
                ${content.fee ? `${getCurrencySymbol(content.currency || 'USD')}${content.fee}` : 'Free'}
             </div>
        </div>
    `;

    const icon = L.divIcon({
        className: 'history-marker',
        html: htmlContent,
        iconSize: [60, 60],
        iconAnchor: [30, 45]
    });

    return <Marker position={[content.lat, content.lon]} icon={icon} />;
};

// Cluster marker for grouped spots
const ClusterMarker = ({ cluster, type, bearing, orientationMode }: { cluster: Cluster<SpotBase>, type: 'open' | 'history', bearing: number, orientationMode: 'fixed' | 'recentre' | 'auto' }) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';

    // Determine color based on freshness of spots in cluster
    const bgColor = type === 'open' ? '#34C759' : '#8E8E93';

    const rotation = orientationMode === 'auto' ? bearing : 0;
    const priceRange = cluster.minPrice === cluster.maxPrice
        ? (cluster.minPrice > 0 ? `${getCurrencySymbol(cluster.currency)}${cluster.minPrice}` : 'Free')
        : `${getCurrencySymbol(cluster.currency)}${cluster.minPrice}-${cluster.maxPrice}`;

    const htmlContent = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 70px; transform: rotate(${rotation}deg);">
             <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); position: relative;">
                ${emoji}
                <div style="position: absolute; top: -5px; right: -5px; background: ${bgColor}; color: white; font-size: 10px; font-weight: bold; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border: 2px solid white;">
                    ${cluster.count}
                </div>
             </div>
             <div style="background: ${bgColor}; border-radius: 12px; padding: 2px 8px; font-weight: bold; font-size: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transform: translateY(-5px); white-space: nowrap; color: white;">
                ${priceRange}
             </div>
        </div>
    `;

    const icon = L.divIcon({
        className: 'cluster-marker',
        html: htmlContent,
        iconSize: [70, 60],
        iconAnchor: [35, 45]
    });

    return <Marker position={[cluster.lat, cluster.lon]} icon={icon} />;
};

// Component to track zoom level
const ZoomTracker = ({ onZoomChange }: { onZoomChange: (zoom: number) => void }) => {
    const map = useMapEvents({
        zoomend: () => {
            onZoomChange(map.getZoom());
        }
    });

    useEffect(() => {
        onZoomChange(map.getZoom());
    }, []);

    return null;
};

// Component to handle drop pin clicks on map
const DropPinHandler = ({ enabled, onDropPin }: { enabled: boolean, onDropPin: (lat: number, lon: number) => void }) => {
    useMapEvents({
        click: (e) => {
            if (enabled) {
                onDropPin(e.latlng.lat, e.latlng.lng);
            }
        }
    });
    return null;
};

// Controller to handle map centering and rotation
const MapController = ({ location, bearing, cumulativeRotation, orientationMode, setOrientationMode, shouldRecenter, setShouldRecenter, setNeedsRecenter, routeBounds, setRouteBounds }: {
    location: [number, number],
    bearing: number,
    cumulativeRotation: number,
    orientationMode: 'fixed' | 'recentre' | 'auto',
    setOrientationMode: (m: 'fixed' | 'recentre' | 'auto') => void,
    shouldRecenter: boolean,
    setShouldRecenter: (v: boolean) => void,
    setNeedsRecenter: (v: boolean) => void,
    routeBounds: L.LatLngBounds | null,
    setRouteBounds: (v: L.LatLngBounds | null) => void
}) => {
    const map = useMap();
    const isInteracting = useRef(false);
    const isProgrammaticZoom = useRef(false);

    // Handle user interactions - break out of auto/recentre modes on manual interaction
    useMapEvents({
        dragstart: () => {
            isInteracting.current = true;
            if (orientationMode !== 'fixed') {
                setOrientationMode('fixed');
            }
            setNeedsRecenter(true);
        },
        zoomstart: () => {
            // Only break out if this is a USER zoom, not our programmatic flyTo
            if (!isProgrammaticZoom.current) {
                isInteracting.current = true;
                if (orientationMode !== 'fixed') {
                    setOrientationMode('fixed');
                }
                setNeedsRecenter(true);
            }
        },
        dragend: () => {
            isInteracting.current = false;
        },
        zoomend: () => {
            isInteracting.current = false;
            // Reset programmatic flag after zoom completes
            isProgrammaticZoom.current = false;
        },
        moveend: () => {
            // Reset programmatic flag after move completes
            isProgrammaticZoom.current = false;
        }
    });

    // Force map to recalculate its size on mount (fixes iOS viewport issues)
    useEffect(() => {
        // Immediate invalidation
        map.invalidateSize();

        // Delayed invalidations to catch late layout calculations
        const timers = [
            setTimeout(() => map.invalidateSize(), 100),
            setTimeout(() => map.invalidateSize(), 300),
            setTimeout(() => map.invalidateSize(), 500),
            setTimeout(() => map.invalidateSize(), 1000),
        ];

        return () => timers.forEach(t => clearTimeout(t));
    }, [map]);

    // Fit to route bounds when a route is created
    useEffect(() => {
        if (routeBounds) {
            map.fitBounds(routeBounds, { padding: [50, 50], animate: true });
            setRouteBounds(null); // Clear after fitting
        }
    }, [routeBounds, map, setRouteBounds]);

    useEffect(() => {
        if (shouldRecenter && location) {
            map.setView(location, 17, { animate: true }); // Default zoom 17
            setShouldRecenter(false);
        }
    }, [shouldRecenter, location, map, setShouldRecenter]);

    // Track when user drags the map to enable recenter behavior
    useEffect(() => {
        const handleDragEnd = () => {
            // Notify parent that user has panned the map
            window.dispatchEvent(new CustomEvent('map-user-interaction'));
        };
        map.on('dragend', handleDragEnd);
        return () => {
            map.off('dragend', handleDragEnd);
        };
    }, [map]);

    // Handle map resize ONLY when orientation mode changes (not on every bearing update)
    useEffect(() => {
        const mapContainer = map.getContainer();

        if (orientationMode === 'auto') {
            // Increased buffer to 300% to prevent black edges during rotation
            mapContainer.style.width = '300%';
            mapContainer.style.height = '300%';
            mapContainer.style.top = '-100%';
            mapContainer.style.left = '-100%';
        } else {
            mapContainer.style.transform = 'rotate(0deg)';
            document.documentElement.style.setProperty('--map-rotation', '0deg');
            mapContainer.style.width = '100%';
            mapContainer.style.height = '100%';
            mapContainer.style.top = '0';
            mapContainer.style.left = '0';
        }
        mapContainer.style.position = 'absolute';

        // Only invalidate size when mode changes
        setTimeout(() => map.invalidateSize(), 50);
    }, [orientationMode, map]);

    // Handle rotation smoothly - use cumulativeRotation to prevent full-spin on wrap-around
    useEffect(() => {
        if (orientationMode === 'auto') {
            const mapContainer = map.getContainer();
            requestAnimationFrame(() => {
                // Use faster transition for responsive updates
                mapContainer.style.transition = 'transform 0.3s linear';
                mapContainer.style.transformOrigin = 'center center';
                // Use cumulative rotation (can go beyond 360) to take shortest path
                mapContainer.style.transform = `rotate(${-cumulativeRotation}deg)`;
                // Keep bearing for UserMarker counter-rotation
                document.documentElement.style.setProperty('--map-rotation', `${bearing}deg`);
            });
        }
    }, [cumulativeRotation, bearing, orientationMode, map]);

    // Reset zoom to 17 when entering auto/recentre modes
    useEffect(() => {
        if (location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            const currentZoom = map.getZoom();
            // Only flyTo if we are significantly off target, to set the "standard"
            if (Math.abs(currentZoom - 17) > 0.5) {
                isProgrammaticZoom.current = true;
                map.flyTo(location, 17, { animate: true, duration: 1.5 });
            }
        }
    }, [orientationMode, map]); // Only run when mode changes (or map/location init)

    // Follow user location (without enforcing zoom)
    useEffect(() => {
        // Only update map if user is NOT dragging
        if (!isInteracting.current && location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            // Just pan to follow, assume zoom is handled by user or initial mode set
            isProgrammaticZoom.current = true;
            map.panTo(location, { animate: true, duration: 0.3 });
        }
    }, [location, orientationMode, map]);

    // Smooth transition back to zoom 17 when switching to fixed mode
    useEffect(() => {
        if (orientationMode === 'fixed' && shouldRecenter && location) {
            const currentZoom = map.getZoom();
            if (Math.abs(currentZoom - 17) > 0.5) {
                isProgrammaticZoom.current = true;
                map.flyTo(location, 17, { animate: true, duration: 1.5 });
            } else {
                isProgrammaticZoom.current = true;
                map.panTo(location, { animate: true, duration: 0.5 });
            }
            // We handled the recentering, but let the parent know we're done
            // Note: setShouldRecenter(false) happens in the other useEffect, so we don't duplicate logic
        }
    }, [orientationMode, shouldRecenter, location, map]);

    // Handle orientation/resize changes to prevent black bars
    useEffect(() => {
        const handleResize = () => {
            // Delay to allow viewport to settle
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);

        // Also handle visual viewport changes on iOS
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', handleResize);
            }
        };
    }, [map]);

    return null;
};

export const LandingPage: React.FC = () => {
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
    const [shouldRecenter, setShouldRecenter] = useState(false);
    const [needsRecenter, setNeedsRecenter] = useState(false); // Track if user has panned away
    const [zoomLevel, setZoomLevel] = useState(17);
    const [isProfileOpen, setIsProfileOpen] = useState(false); // Track profile modal state
    const [isRouteOpen, setIsRouteOpen] = useState(false);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [routeWaypoints, setRouteWaypoints] = useState<{ lat: number; lon: number }[] | null>(null);
    const [showRoute, setShowRoute] = useState(false);
    const [routeBounds, setRouteBounds] = useState<L.LatLngBounds | null>(null);
    const [dropPinMode, setDropPinMode] = useState(false);
    const [pendingDropPin, setPendingDropPin] = useState<{ lat: number; lon: number } | null>(null);

    // Handler for route changes from RouteButton
    const handleRouteChange = (coords: [number, number][] | null, altCoords: [number, number][] | null, waypoints: { lat: number; lon: number }[] | null, show: boolean) => {
        setRouteCoords(coords);
        setAlternateRouteCoords(altCoords);
        setRouteWaypoints(waypoints);
        setShowRoute(show);

        // Calculate bounds and fit map to show entire route
        if (coords && coords.length > 1 && show) {
            const bounds = L.latLngBounds(coords);
            setRouteBounds(bounds);
        }
    };

    // Auto-expire OLD spots (older than 15 minutes instead of 10s) to keep memory clean
    // But keep "expired" spots visible on map for a while as specifically requested
    // Auto-expire old spots every 10 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            setOpenSpots(prev => {
                const filtered = prev.filter(spot => !spot.expiresAt || spot.expiresAt > now);
                if (filtered.length !== prev.length) {
                    console.log('[Parlens] Expired', prev.length - filtered.length, 'spots');
                }
                return filtered.length !== prev.length ? filtered : prev;
            });
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    // Listen for map drag events to enable recenter behavior
    useEffect(() => {
        const handleMapInteraction = () => setNeedsRecenter(true);
        window.addEventListener('map-user-interaction', handleMapInteraction);
        return () => window.removeEventListener('map-user-interaction', handleMapInteraction);
    }, []);

    // Theme state
    const [isDarkMode, setIsDarkMode] = useState(false);

    useEffect(() => {
        // Init theme
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        setIsDarkMode(mediaQuery.matches);

        // Listener
        const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    const watchIdRef = useRef<number | null>(null);

    // Location smoothing refs (persist across re-renders)
    const locationSmootherRef = useRef<LocationSmoother>(new LocationSmoother());
    const bearingAnimatorRef = useRef<BearingAnimator>(new BearingAnimator());

    // Cumulative rotation for CSS (handles wrap-around without full spins)
    const [cumulativeRotation, setCumulativeRotation] = useState(0);

    // High accuracy location tracking with Kalman smoothing
    useEffect(() => {
        if ("geolocation" in navigator) {
            // Set a timeout to show error message if location takes too long
            const timeoutId = setTimeout(() => {
                if (!location) {
                    setLocationError('Unable to get location. Please enable location permissions in your browser/device settings.');
                }
            }, 10000);

            // Throttling references
            let lastLocUpdate = 0;
            let lastRawLat = 0;
            let lastRawLon = 0;

            watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
                    const now = Date.now();
                    const currentSpeed = speed || 0;

                    // Apply Kalman filter to smooth GPS position
                    const [smoothedLat, smoothedLon] = locationSmootherRef.current.smoothLocation(latitude, longitude);

                    // Calculate distance moved (using raw values for threshold check)
                    const dLat = Math.abs(latitude - lastRawLat) * 111000;
                    const dLon = Math.abs(longitude - lastRawLon) * 111000 * Math.cos(latitude * (Math.PI / 180));
                    const dist = Math.sqrt(dLat * dLat + dLon * dLon);

                    // Speed-adaptive throttling with accuracy consideration
                    // Higher accuracy = trust smaller movements, lower accuracy = require bigger jumps
                    const accuracyFactor = Math.min(accuracy || 10, 30) / 10; // 1-3x multiplier
                    const baseThreshold = currentSpeed > 10 ? 6 : (currentSpeed > 5 ? 4 : 2);
                    const distThreshold = baseThreshold * accuracyFactor;
                    const timeThreshold = currentSpeed > 10 ? 1500 : 2500;

                    if (dist > distThreshold || (now - lastLocUpdate) > timeThreshold) {
                        // Direct setLocation - panTo in separate useEffect handles animation
                        setLocation([smoothedLat, smoothedLon]);

                        lastRawLat = latitude;
                        lastRawLon = longitude;
                        lastLocUpdate = now;
                    }

                    setLocationError(null);

                    // Smooth bearing update with speed gate and wrap-around handling
                    if (heading !== null && !isNaN(heading) && currentSpeed > 2) {
                        const smoothedBearing = locationSmootherRef.current.smoothBearing(heading, currentSpeed);
                        if (smoothedBearing !== null) {
                            // Get cumulative rotation for CSS (prevents full-spin on wrap-around)
                            const cumRotation = bearingAnimatorRef.current.setBearing(smoothedBearing);
                            setCumulativeRotation(cumRotation);
                            setBearing(smoothedBearing);
                        }
                    }
                },
                (err) => {
                    console.error('Location error:', err);
                    if (err.code === err.PERMISSION_DENIED) {
                        setLocationError('Location permission denied. Please enable location access in your browser settings.');
                    } else if (err.code === err.POSITION_UNAVAILABLE) {
                        setLocationError('Location unavailable. Please check your device\'s GPS settings.');
                    } else if (err.code === err.TIMEOUT) {
                        setLocationError('Location request timed out. Please try again.');
                    }
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 500, // Shorter cache for smoother updates
                    timeout: 15000
                }
            );

            return () => {
                clearTimeout(timeoutId);
                if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
            };
        } else {
            setLocationError('Geolocation is not supported by this browser.');
        }
    }, [location]);

    // Device orientation for heading - requires permission on iOS 13+
    // Uses ref to properly track event listener for cleanup
    const orientationHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
    const [orientationNeedsPermission, setOrientationNeedsPermission] = useState(false);

    // Function to request orientation permission (needs user gesture on iOS)
    const requestOrientationPermission = async () => {
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            try {
                const permission = await (DeviceOrientationEvent as any).requestPermission();
                if (permission === 'granted') {
                    setOrientationNeedsPermission(false);
                    if (orientationHandlerRef.current) {
                        window.addEventListener('deviceorientation', orientationHandlerRef.current, true);
                    }
                    return true;
                }
            } catch (e) {
                console.error('Error requesting device orientation permission:', e);
            }
        }
        return false;
    };

    useEffect(() => {
        // Throttling state
        let lastBearingUpdate = 0;
        let lastBearingValue = 0;

        const handleOrientation = (e: DeviceOrientationEvent) => {
            const now = Date.now();
            let newBearing = 0;

            // webkitCompassHeading is more accurate on iOS
            if ((e as any).webkitCompassHeading !== undefined) {
                newBearing = (e as any).webkitCompassHeading;
            } else if (e.alpha !== null) {
                // On Android, alpha represents device orientation relative to magnetic north
                newBearing = 360 - e.alpha;
            }

            // Only update if bearing changed by 3+ degrees OR 100ms passed
            const bearingDiff = Math.abs(newBearing - lastBearingValue);
            const timeDiff = now - lastBearingUpdate;

            if (bearingDiff > 3 || timeDiff > 100) {
                lastBearingValue = newBearing;
                lastBearingUpdate = now;
                setBearing(newBearing);
                // Also update cumulative rotation for smooth CSS transform
                const cumRotation = bearingAnimatorRef.current.setBearing(newBearing);
                setCumulativeRotation(cumRotation);
            }
        };

        orientationHandlerRef.current = handleOrientation;

        const startOrientationTracking = async () => {
            // Check if DeviceOrientationEvent exists and needs permission (iOS 13+)
            if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                // iOS requires user gesture for permission request
                // Show the orange prompt on the orientation button
                setOrientationNeedsPermission(true);
                return; // Don't try to auto-request, let user tap the button
            }

            // Android/other: add listener directly
            window.addEventListener('deviceorientation', handleOrientation, true);
        };

        // Handle visibility change - on iOS, need user gesture to re-request permission
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                // On iOS, check if we need to re-request permission
                if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                    // iOS requires user gesture for permission - show prompt via orientation button
                    setOrientationNeedsPermission(true);
                } else {
                    // Android/other: just re-add listener
                    if (orientationHandlerRef.current) {
                        window.addEventListener('deviceorientation', orientationHandlerRef.current, true);
                    }
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Small delay to allow geolocation to settle first
        const timer = setTimeout(startOrientationTracking, 500);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (orientationHandlerRef.current) {
                window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
            }
        };
    }, []);


    const handleVehicleChange = (type: 'bicycle' | 'motorcycle' | 'car') => {
        if (status !== 'idle') {
            alert('Please end your current session before changing vehicle type.');
            return;
        }
        setVehicleType(type);
        localStorage.setItem('parlens_vehicle_type', type);
    };

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
            <div className="absolute inset-0">
                <MapContainer
                    center={location}
                    zoom={17}
                    zoomControl={false}
                    className="absolute inset-0"
                    dragging={true}
                    scrollWheelZoom={true}
                    touchZoom={true}
                    doubleClickZoom={true}
                >
                    <TileLayer
                        url={isDarkMode
                            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        }

                        attribution='&copy; CARTO'
                        keepBuffer={12} // Load more tiles around viewport to prevent clipping during rotation
                        updateWhenIdle={false} // Update tiles during animation for smoother experience
                    />
                    <ZoomTracker onZoomChange={setZoomLevel} />
                    <DropPinHandler
                        enabled={dropPinMode}
                        onDropPin={(lat, lon) => setPendingDropPin({ lat, lon })}
                    />
                    {/* Render in order: History (bottom) -> Open Spots -> Parked Spot -> User (top) */}
                    {/* History spots (Kind 31417) */}
                    {historySpots.length > 0 && (() => {
                        const filtered = historySpots.filter(spot => {
                            // Type is stored in encrypted content for privacy, not in tags
                            const type = spot.decryptedContent?.type || 'car';
                            return type === vehicleType;
                        });
                        const spotsForClustering = filtered.map(s => {
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
                        const clustered = clusterSpots(spotsForClustering, zoomLevel);
                        return clustered.map(item =>
                            isCluster(item)
                                ? <ClusterMarker key={item.id} cluster={item} type="history" bearing={bearing} orientationMode={orientationMode} />
                                : <HistoryMarker key={item.id} spot={(item as any).original || item} bearing={bearing} orientationMode={orientationMode} />
                        );
                    })()}
                    {/* Open spots (Kind 21011) - only show during search, filtered by vehicle type */}
                    {status === 'search' && openSpots.length > 0 && (() => {
                        // Filter by vehicle type (type is in public tags for open spots)
                        const filteredSpots = openSpots.filter(s => {
                            const spotType = s.type || 'car';
                            return spotType === vehicleType;
                        });
                        const spotsForClustering = filteredSpots.map(s => ({
                            id: s.id,
                            lat: s.lat,
                            lon: s.lon,
                            price: s.price,
                            currency: s.currency,
                            original: s
                        }));
                        const clustered = clusterSpots(spotsForClustering, zoomLevel);
                        return clustered.map(item =>
                            isCluster(item)
                                ? <ClusterMarker key={item.id} cluster={item} type="open" bearing={bearing} orientationMode={orientationMode} />
                                : <SpotMarker key={item.id} spot={(item as any).original || item} bearing={bearing} orientationMode={orientationMode} />
                        );
                    })()}
                    {/* Parked spot marker */}
                    {status === 'parked' && parkLocation && (
                        <ActiveSessionMarker location={parkLocation} vehicleType={vehicleType} bearing={bearing} orientationMode={orientationMode} />
                    )}
                    {/* Alternate Route Polyline (dashed, lighter) */}
                    {showRoute && alternateRouteCoords && alternateRouteCoords.length > 1 && (
                        <Polyline positions={alternateRouteCoords} color="#007AFF" weight={3} opacity={0.4} dashArray="8, 8" />
                    )}
                    {/* Primary Route Polyline Overlay */}
                    {showRoute && routeCoords && routeCoords.length > 1 && (
                        <Polyline positions={routeCoords} color="#007AFF" weight={4} opacity={0.9} />
                    )}
                    {/* Route Waypoint Markers */}
                    {showRoute && routeWaypoints && routeWaypoints.map((wp, index) => (
                        <Marker
                            key={`waypoint-${index}`}
                            position={[wp.lat, wp.lon]}
                            icon={L.divIcon({
                                className: 'waypoint-marker',
                                html: `<div style="width: 20px; height: 20px; background: #007AFF; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">${index + 1}</div>`,
                                iconSize: [20, 20],
                                iconAnchor: [10, 10]
                            })}
                        />
                    ))}
                    {/* User location marker (on top) */}
                    <UserMarker location={location} bearing={bearing} />
                    <MapController
                        location={location}
                        bearing={bearing}
                        cumulativeRotation={cumulativeRotation}
                        orientationMode={orientationMode}
                        setOrientationMode={setOrientationMode}
                        shouldRecenter={shouldRecenter}
                        setShouldRecenter={setShouldRecenter}
                        setNeedsRecenter={setNeedsRecenter}
                        routeBounds={routeBounds}
                        setRouteBounds={setRouteBounds}
                    />
                </MapContainer>
            </div>

            {/* Bottom Left Controls - with safe area for portrait and landscape */}
            <div className="absolute z-[1000] flex flex-col items-start gap-4 animate-in slide-in-from-left-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                left: 'max(1rem, env(safe-area-inset-left))'
            }}>

                {/* Vehicle Toggle */}
                <div className="flex flex-col gap-1 p-1 rounded-[2rem] bg-white/80 dark:bg-white/10 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-lg mb-2">
                    <button
                        onClick={() => handleVehicleChange('bicycle')}
                        className={`p-2.5 rounded-full transition-all ${vehicleType === 'bicycle'
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-black dark:text-white shadow-lg scale-110'
                            : 'text-black/50 dark:text-white/50 hover:text-black hover:bg-black/5 dark:hover:text-white dark:hover:bg-white/10'}`}
                    >
                        <span className="text-xl">🚲</span>
                    </button>
                    <button
                        onClick={() => handleVehicleChange('motorcycle')}
                        className={`p-2.5 rounded-full transition-all ${vehicleType === 'motorcycle'
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-black dark:text-white shadow-lg scale-110'
                            : 'text-black/50 dark:text-white/50 hover:text-black hover:bg-black/5 dark:hover:text-white dark:hover:bg-white/10'}`}
                    >
                        <span className="text-xl">🏍️</span>
                    </button>
                    <button
                        onClick={() => handleVehicleChange('car')}
                        className={`p-2.5 rounded-full transition-all ${vehicleType === 'car'
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-black dark:text-white shadow-lg scale-110'
                            : 'text-black/50 dark:text-white/50 hover:text-black hover:bg-black/5 dark:hover:text-white dark:hover:bg-white/10'}`}
                    >
                        <span className="text-xl">🚗</span>
                    </button>
                </div>

                {/* Help Button */}
                <button
                    onClick={() => setShowHelp(true)}
                    className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl border border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70 shadow-2xl active:scale-95 transition-all"
                >
                    <HelpCircle size={20} />
                </button>
            </div>

            {/* Bottom Right Controls - with safe area for portrait and landscape */}
            <div className="absolute z-[1000] flex flex-col items-end gap-5 animate-in slide-in-from-right-6" style={{
                bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))',
                right: 'max(1rem, env(safe-area-inset-right))'
            }}>

                {/* Orientation Toggle - first click recenters, second click changes mode */}
                <button
                    onClick={async () => {
                        // If iOS needs permission re-request, do that first
                        if (orientationNeedsPermission) {
                            await requestOrientationPermission();
                            return;
                        }

                        if (needsRecenter) {
                            // First click: just recenter
                            setShouldRecenter(true);
                            setNeedsRecenter(false);
                        } else {
                            // Cycle: fixed ↔ recentre (no auto)
                            setOrientationMode(m => m === 'fixed' ? 'recentre' : 'fixed');
                            setShouldRecenter(true);
                        }
                    }}
                    className={`h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg ${orientationNeedsPermission
                        ? 'bg-orange-500/20 border-orange-500/50 text-orange-500 dark:text-orange-400 animate-pulse'
                        : orientationMode === 'recentre'
                            ? 'bg-green-500/20 border-green-500/50 text-green-500 dark:text-green-400'
                            : needsRecenter
                                ? 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-400 dark:text-white/40'
                                : 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70'
                        }`}
                >
                    {orientationMode === 'recentre' ? <MapPin size={20} /> : <Compass size={20} />}
                </button>

                {/* Route Button - below orientation button */}
                <RouteButton
                    vehicleType={vehicleType}
                    onRouteChange={handleRouteChange}
                    currentLocation={location}
                    onDropPinModeChange={setDropPinMode}
                    pendingDropPin={pendingDropPin}
                    onDropPinConsumed={() => setPendingDropPin(null)}
                    onOpenChange={setIsRouteOpen}
                />

                <ProfileButton setHistorySpots={setHistorySpots} onOpenChange={setIsProfileOpen} />
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

            {/* Help Popup */}
            {showHelp && (
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
                                Tap the route button to add waypoints and create a route. Click the location button to re-centre and turn on follow-me mode for route tracking.
                            </p>

                            <p>
                                <strong className="text-zinc-900 dark:text-white block mb-1">2. Select vehicle type</strong>
                                Use the vertical toggle on the bottom-left to switch between Bicycle 🚲, Motorcycle 🏍️, or Car 🚗.
                            </p>

                            <p>
                                <strong className="text-zinc-900 dark:text-white block mb-1">3. Find and log parking spots</strong>
                                Click the main button once to see open spots reported by others. Click again to mark your location. When leaving, click once more to end the session and report the fee. Use the profile button to see your parking history.
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
                                </a> to create your own mirror of the Parlens app to distribute the load and share with your friends.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {status === 'search' && !isProfileOpen && !isRouteOpen && (
                <div className="absolute left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500" style={{ top: 'max(3rem, calc(env(safe-area-inset-top) + 0.75rem))' }}>
                    <div className="px-6 py-3 rounded-full bg-white text-black font-bold shadow-xl flex items-center gap-3 border border-black/5 whitespace-nowrap min-w-max">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        <span className="text-sm tracking-tight">Searching for spots</span>
                    </div>
                </div>
            )}

            {status === 'parked' && !isProfileOpen && !isRouteOpen && (
                <div className="absolute left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500" style={{ top: 'max(3rem, calc(env(safe-area-inset-top) + 0.75rem))' }}>
                    <div className="px-6 py-3 rounded-full bg-[#34C759] text-white font-bold shadow-xl flex items-center gap-3">
                        <span className="text-lg">
                            {vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗'}
                        </span>
                        <span className="text-sm tracking-tight text-white/90">Session Active</span>
                    </div>
                </div>
            )}

            {/* Submitting bubble removed - Dec 23 FAB doesn't support this state */}
        </div>
    );
};
