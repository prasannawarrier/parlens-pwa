/**
 * Pure MapLibre GL JS Map Component
 * Replaces Leaflet for native vector map support with rotation, smooth zoom
 */
import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import Map, { Marker, Source, Layer, NavigationControl, useMap, MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Free vector tile styles - minimalist with good road visibility
const MAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark'
};

// User location marker component
interface UserMarkerProps {
    bearing: number;
    isNavigationMode?: boolean;
}

const UserLocationMarker: React.FC<UserMarkerProps> = ({ bearing, isNavigationMode }) => {
    const scale = isNavigationMode ? 1.3 : 1;

    return (
        <div
            style={{
                transform: `rotate(${bearing}deg) scale(${scale})`,
                transition: 'transform 0.3s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
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
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    style={{ transform: 'translateY(-1px)', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}
                >
                    <path d="M7 0L14 14L7 12L0 14L7 0Z" fill="white" />
                </svg>
            </div>
        </div>
    );
};

// Spot marker component
interface SpotMarkerContentProps {
    price: number;
    currency: string;
    type: 'open' | 'history';
}

const SpotMarkerContent: React.FC<SpotMarkerContentProps> = ({ price, currency, type }) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const bgColor = type === 'open' ? '#34C759' : '#8E8E93';
    const opacity = type === 'history' ? 0.7 : 1;
    const symbol = currency === 'USD' ? '$' : currency;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
};

// Cluster marker component
interface ClusterMarkerContentProps {
    count: number;
    minPrice: number;
    maxPrice: number;
    currency: string;
    type: 'open' | 'history';
}

const ClusterMarkerContent: React.FC<ClusterMarkerContentProps> = ({ count, minPrice, maxPrice, currency, type }) => {
    const emoji = type === 'open' ? '🅿️' : '🅟';
    const bgColor = type === 'open' ? '#34C759' : '#8E8E93';
    const symbol = currency === 'USD' ? '$' : currency;
    const priceRange = minPrice === maxPrice ? `${symbol}${minPrice}` : `${symbol}${minPrice}-${maxPrice}`;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
};

// Active session marker (parked vehicle)
interface ActiveSessionMarkerContentProps {
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
}

const ActiveSessionMarkerContent: React.FC<ActiveSessionMarkerContentProps> = ({ vehicleType }) => {
    const emoji = vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗';

    return (
        <div style={{ fontSize: 36, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>
            {emoji}
        </div>
    );
};

// Main Map Props
export interface MapLibreMapProps {
    location: [number, number] | null;
    bearing: number;
    isDarkMode: boolean;
    orientationMode: 'fixed' | 'recentre' | 'auto';
    onMapMove?: () => void;
    onMapClick?: (lat: number, lon: number) => void;
    onZoomChange?: (zoom: number) => void;
    onBearingChange?: (bearing: number) => void;
    // Spots data
    openSpots?: Array<{ id: string; lat: number; lon: number; price: number; currency: string }>;
    historySpots?: Array<{ id: string; lat: number; lon: number; price: number; currency: string }>;
    // Route data
    routeCoords?: [number, number][] | null;
    alternateRouteCoords?: [number, number][] | null;
    // Active session
    activeSessionLocation?: [number, number] | null;
    vehicleType?: 'bicycle' | 'motorcycle' | 'car';
    // Drop pin mode
    dropPinMode?: boolean;
}

export interface MapLibreMapRef {
    flyTo: (center: [number, number], zoom?: number) => void;
    panTo: (center: [number, number]) => void;
    setBearing: (bearing: number) => void;
    getZoom: () => number;
    getBearing: () => number;
}

export const MapLibreMap = forwardRef<MapLibreMapRef, MapLibreMapProps>(({
    location,
    bearing,
    isDarkMode,
    orientationMode,
    onMapMove,
    onMapClick,
    onZoomChange,
    onBearingChange,
    openSpots = [],
    historySpots = [],
    routeCoords,
    alternateRouteCoords,
    activeSessionLocation,
    vehicleType = 'car',
    dropPinMode = false
}, ref) => {
    const mapRef = useRef<MapRef>(null);
    const [viewState, setViewState] = useState({
        longitude: location?.[1] ?? 77.5946,
        latitude: location?.[0] ?? 12.9716,
        zoom: 17,
        bearing: 0,
        pitch: orientationMode === 'auto' ? 45 : 0
    });

    // Track if user is interacting with map
    const isUserInteracting = useRef(false);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        flyTo: (center: [number, number], zoom?: number) => {
            mapRef.current?.flyTo({
                center: [center[1], center[0]],
                zoom: zoom ?? viewState.zoom,
                duration: 1000
            });
        },
        panTo: (center: [number, number]) => {
            mapRef.current?.panTo([center[1], center[0]], { duration: 300 });
        },
        setBearing: (bearing: number) => {
            mapRef.current?.rotateTo(bearing, { duration: 400 });
        },
        getZoom: () => viewState.zoom,
        getBearing: () => viewState.bearing
    }));

    // Update view when location changes (follow mode)
    useEffect(() => {
        if (!isUserInteracting.current && location && (orientationMode === 'auto' || orientationMode === 'recentre')) {
            const newViewState = {
                ...viewState,
                longitude: location[1],
                latitude: location[0]
            };

            // In auto mode, also rotate with bearing and add pitch
            if (orientationMode === 'auto') {
                newViewState.bearing = bearing;
                newViewState.pitch = 45;
            }

            setViewState(newViewState);
        }
    }, [location, bearing, orientationMode]);

    // Style URL based on theme
    const mapStyle = isDarkMode ? MAP_STYLES.dark : MAP_STYLES.light;

    const handleMove = useCallback((evt: { viewState: typeof viewState }) => {
        setViewState(evt.viewState);
    }, []);

    const handleMoveStart = useCallback(() => {
        isUserInteracting.current = true;
    }, []);

    const handleMoveEnd = useCallback(() => {
        isUserInteracting.current = false;
        if (onMapMove) {
            onMapMove();
        }
        if (onZoomChange) {
            onZoomChange(viewState.zoom);
        }
        if (onBearingChange) {
            onBearingChange(viewState.bearing);
        }
    }, [onMapMove, onZoomChange, onBearingChange, viewState]);

    const handleClick = useCallback((evt: maplibregl.MapMouseEvent) => {
        if (dropPinMode && onMapClick) {
            onMapClick(evt.lngLat.lat, evt.lngLat.lng);
        }
    }, [dropPinMode, onMapClick]);

    // Route line style
    const routeLayer: maplibregl.LayerSpecification = {
        id: 'route',
        type: 'line',
        paint: {
            'line-color': '#007AFF',
            'line-width': 5,
            'line-opacity': 0.8
        }
    };

    const alternateRouteLayer: maplibregl.LayerSpecification = {
        id: 'alternate-route',
        type: 'line',
        paint: {
            'line-color': '#8E8E93',
            'line-width': 4,
            'line-opacity': 0.6,
            'line-dasharray': [2, 2]
        }
    };

    return (
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
            {/* Alternate route (render first, below main route) */}
            {alternateRouteCoords && alternateRouteCoords.length > 1 && (
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
                    <Layer {...alternateRouteLayer} />
                </Source>
            )}

            {/* Main route */}
            {routeCoords && routeCoords.length > 1 && (
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
                    <Layer {...routeLayer} />
                </Source>
            )}

            {/* History spots */}
            {historySpots.map(spot => (
                <Marker
                    key={spot.id}
                    longitude={spot.lon}
                    latitude={spot.lat}
                    anchor="bottom"
                >
                    <SpotMarkerContent price={spot.price} currency={spot.currency} type="history" />
                </Marker>
            ))}

            {/* Open spots */}
            {openSpots.map(spot => (
                <Marker
                    key={spot.id}
                    longitude={spot.lon}
                    latitude={spot.lat}
                    anchor="bottom"
                >
                    <SpotMarkerContent price={spot.price} currency={spot.currency} type="open" />
                </Marker>
            ))}

            {/* Active session marker */}
            {activeSessionLocation && (
                <Marker
                    longitude={activeSessionLocation[1]}
                    latitude={activeSessionLocation[0]}
                    anchor="center"
                >
                    <ActiveSessionMarkerContent vehicleType={vehicleType} />
                </Marker>
            )}

            {/* User location marker */}
            {location && (
                <Marker
                    longitude={location[1]}
                    latitude={location[0]}
                    anchor="center"
                >
                    <UserLocationMarker
                        bearing={bearing}
                        isNavigationMode={orientationMode === 'auto'}
                    />
                </Marker>
            )}
        </Map>
    );
});

MapLibreMap.displayName = 'MapLibreMap';

export default MapLibreMap;
