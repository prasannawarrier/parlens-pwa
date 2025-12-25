import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Route, X, Trash2, MapPin, Eye, EyeOff, Navigation, FolderOpen, Clock, MapPinned, Save, Pencil, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { KINDS, DEFAULT_RELAYS } from '../lib/nostr';
import type { RouteLogContent } from '../lib/nostr';
import { encryptParkingLog, decryptParkingLog } from '../lib/encryption';
import { encodeGeohash, geohashToBounds } from '../lib/geo';

interface Waypoint {
    id: string;
    name: string;
    lat: number;
    lon: number;
}

interface SavedRoute {
    id: string;
    dTag: string;
    decryptedContent: RouteLogContent;
    created_at: number;
}

interface RouteButtonProps {
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    onRouteChange: (route: [number, number][] | null, alternateRoute: [number, number][] | null, waypoints: { lat: number; lon: number }[] | null, showOnMap: boolean) => void;
    currentLocation: [number, number] | null;
    onDropPinModeChange?: (enabled: boolean) => void;
    pendingDropPin?: { lat: number; lon: number } | null;
    onDropPinConsumed?: () => void;
    onOpenChange?: (isOpen: boolean) => void;
}

// Debounce hook for search input
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

export const RouteButton: React.FC<RouteButtonProps> = ({ vehicleType, onRouteChange, currentLocation, onDropPinModeChange, pendingDropPin, onDropPinConsumed, onOpenChange }) => {
    const { pool, pubkey, signEvent } = useAuth();
    const [isOpen, setIsOpen] = useState(false);

    // Notify parent on open change
    useEffect(() => {
        onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);
    const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showOnMap, setShowOnMap] = useState(false);
    const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
    const [alternateRouteCoords, setAlternateRouteCoords] = useState<[number, number][] | null>(null);
    const [isCreatingRoute, setIsCreatingRoute] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Saved routes state
    const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
    const [routeName, setRouteName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingSaved, setIsLoadingSaved] = useState(false);
    const [showSavedRoutes, setShowSavedRoutes] = useState(false);
    const [dropPinMode, setDropPinMode] = useState(false);
    const [editingWaypointId, setEditingWaypointId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const debouncedQuery = useDebounce(searchQuery, 800); // Increased debounce - wait for user to stop typing

    // Search saved waypoints from routes (offline search)
    const savedWaypointMatches = React.useMemo(() => {
        if (!searchQuery || searchQuery.length < 2) return [];
        const query = searchQuery.toLowerCase();
        const matches: Array<{ name: string; lat: number; lon: number; fromRoute: string }> = [];

        for (const route of savedRoutes) {
            for (const wp of route.decryptedContent.waypoints) {
                if (wp.name.toLowerCase().includes(query)) {
                    // Avoid duplicates
                    if (!matches.find(m => m.lat === wp.lat && m.lon === wp.lon)) {
                        matches.push({
                            name: wp.name,
                            lat: wp.lat,
                            lon: wp.lon,
                            fromRoute: route.decryptedContent.name
                        });
                    }
                }
            }
        }
        return matches.slice(0, 5); // Limit to 5 results
    }, [searchQuery, savedRoutes]);

    // Search for places using Nominatim (OpenStreetMap geocoding)
    useEffect(() => {
        if (!debouncedQuery || debouncedQuery.length < 3) {
            setSuggestions([]);
            return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const searchPlaces = async () => {
            setIsSearching(true);
            try {
                // Build URL with location bias via 1-char geohash bounds
                let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(debouncedQuery)}&limit=5`;

                // Use 1-character geohash bounds (large regional area) for location bias
                if (currentLocation) {
                    const [lat, lon] = currentLocation;
                    const geohash1 = encodeGeohash(lat, lon, 1); // 1-char = ~5000km x 5000km region
                    const bounds = geohashToBounds(geohash1);
                    url += `&viewbox=${bounds.sw[1]},${bounds.ne[0]},${bounds.ne[1]},${bounds.sw[0]}&bounded=0`;
                }

                const response = await fetch(url, {
                    headers: { 'User-Agent': 'Parlens PWA' },
                    signal: controller.signal
                });
                const data = await response.json();
                setSuggestions(data || []);
            } catch (error: any) {
                if (error.name !== 'AbortError') {
                    console.error('Geocoding error:', error);
                }
                setSuggestions([]);
            } finally {
                setIsSearching(false);
            }
        };

        searchPlaces();

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [debouncedQuery, currentLocation]);

    const addWaypoint = (suggestion: any) => {
        const newWaypoint: Waypoint = {
            id: crypto.randomUUID(),
            name: suggestion.display_name.split(',')[0],
            lat: parseFloat(suggestion.lat),
            lon: parseFloat(suggestion.lon)
        };
        setWaypoints(prev => [...prev, newWaypoint]);
        setSearchQuery('');
        setSuggestions([]);
        // Clear existing route when waypoints change
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, null, false);
    };

    const removeWaypoint = (id: string) => {
        setWaypoints(prev => prev.filter(w => w.id !== id));
        // Clear existing route when waypoints change
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, null, false);
    };

    const clearAllWaypoints = () => {
        setWaypoints([]);
        setRouteCoords(null);
        setAlternateRouteCoords(null);
        setShowOnMap(false);
        onRouteChange(null, null, null, false);
    };

    const createRoute = async () => {
        if (waypoints.length < 2) {
            alert('Add at least 2 waypoints to create a route');
            return;
        }

        setIsCreatingRoute(true);
        try {
            // Map vehicle type to OSRM profile
            const osrmProfileMap: Record<string, string> = {
                'bicycle': 'cycling',
                'motorcycle': 'driving',
                'car': 'driving'
            };
            const osrmProfile = osrmProfileMap[vehicleType];

            // For each segment between waypoints, get primary and alternate routes
            const primarySegments: [number, number][][] = [];
            const alternateSegments: [number, number][][] = [];

            for (let i = 0; i < waypoints.length - 1; i++) {
                const start = waypoints[i];
                const end = waypoints[i + 1];
                const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;

                console.log(`[Parlens] Fetching segment ${i + 1}: ${start.name} → ${end.name}`);

                const response = await fetch(
                    `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=true`
                );

                if (!response.ok) {
                    throw new Error(`OSRM error: ${response.status}`);
                }

                const data = await response.json();

                if (data.routes && data.routes[0]) {
                    // Get primary route for this segment
                    const primaryCoords = data.routes[0].geometry.coordinates.map(
                        (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
                    );
                    primarySegments.push(primaryCoords);

                    // Get alternate route for this segment (or use primary if no alternate)
                    if (data.routes.length > 1) {
                        const altCoords = data.routes[1].geometry.coordinates.map(
                            (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
                        );
                        alternateSegments.push(altCoords);
                        console.log(`[Parlens] Segment ${i + 1} has alternate route`);
                    } else {
                        // No alternate for this segment, use primary
                        alternateSegments.push(primaryCoords);
                        console.log(`[Parlens] Segment ${i + 1} has no alternate, using primary`);
                    }
                } else {
                    throw new Error(`No route found for segment ${i + 1}`);
                }
            }

            // Combine all segments into full routes (avoiding duplicate points at junctions)
            const primaryCoords: [number, number][] = [];
            const altCoords: [number, number][] = [];

            for (let i = 0; i < primarySegments.length; i++) {
                // Skip first point of subsequent segments (it's the same as last point of previous)
                const startIndex = i === 0 ? 0 : 1;
                primaryCoords.push(...primarySegments[i].slice(startIndex));
                altCoords.push(...alternateSegments[i].slice(startIndex));
            }

            console.log('[Parlens] Combined primary route:', primaryCoords.length, 'points');
            console.log('[Parlens] Combined alternate route:', altCoords.length, 'points');

            setRouteCoords(primaryCoords);
            setAlternateRouteCoords(altCoords);
            setShowOnMap(true);
            onRouteChange(primaryCoords, altCoords, waypoints.map(w => ({ lat: w.lat, lon: w.lon })), true);

            // Close the route page (user can reopen to save if desired)
            setIsOpen(false);
        } catch (error) {
            console.error('Route creation error:', error);
            // Fallback: Draw straight lines between waypoints
            const straightLineCoords = waypoints.map(w => [w.lat, w.lon] as [number, number]);
            setRouteCoords(straightLineCoords);
            setAlternateRouteCoords(null);
            setShowOnMap(true);
            onRouteChange(straightLineCoords, null, waypoints.map(w => ({ lat: w.lat, lon: w.lon })), true);
            setIsOpen(false);
        } finally {
            setIsCreatingRoute(false);
        }
    };

    const toggleShowOnMap = () => {
        const newValue = !showOnMap;
        setShowOnMap(newValue);
        onRouteChange(routeCoords, alternateRouteCoords, waypoints.map(w => ({ lat: w.lat, lon: w.lon })), newValue);
    };

    // Fetch saved routes on mount
    const fetchSavedRoutes = useCallback(async () => {
        if (!pool || !pubkey) return;

        setIsLoadingSaved(true);
        try {
            const events = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.ROUTE_LOG],
                authors: [pubkey],
            });

            console.log('[Parlens] Fetched route events:', events.length);

            // Get seckey for decryption
            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const routes: SavedRoute[] = [];
            for (const event of events) {
                // Skip deleted routes
                if (event.tags.find(t => t[0] === 'deleted')) continue;
                // Skip empty content
                if (!event.content) continue;

                try {
                    const decrypted = await decryptParkingLog(event.content, pubkey, seckey);
                    if (decrypted) {
                        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
                        routes.push({
                            id: event.id,
                            dTag,
                            decryptedContent: decrypted as RouteLogContent,
                            created_at: event.created_at,
                        });
                    }
                } catch (e) {
                    console.warn('[Parlens] Failed to decrypt route:', e);
                }
            }

            // Sort by created_at descending
            routes.sort((a, b) => b.created_at - a.created_at);
            setSavedRoutes(routes);
        } catch (error) {
            console.error('Error fetching saved routes:', error);
        } finally {
            setIsLoadingSaved(false);
        }
    }, [pool, pubkey]);

    // Load saved routes when modal opens
    useEffect(() => {
        if (isOpen && pubkey) {
            fetchSavedRoutes();
        }
    }, [isOpen, pubkey, fetchSavedRoutes]);

    // Handle drop pin mode toggle
    const toggleDropPinMode = () => {
        const newMode = !dropPinMode;
        setDropPinMode(newMode);
        onDropPinModeChange?.(newMode);
        if (newMode) {
            setIsOpen(false); // Close modal so user can see map
        }
    };

    // Handle pending drop pin from map
    useEffect(() => {
        if (pendingDropPin) {
            const newWaypoint: Waypoint = {
                id: crypto.randomUUID(),
                name: `Pin ${waypoints.length + 1}`,
                lat: pendingDropPin.lat,
                lon: pendingDropPin.lon,
            };
            setWaypoints(prev => [...prev, newWaypoint]);
            setRouteCoords(null);
            setAlternateRouteCoords(null);
            setShowOnMap(false);
            onRouteChange(null, null, null, false);
            onDropPinConsumed?.();

            // Reopen modal to show new waypoint
            setIsOpen(true);
            setDropPinMode(false);
            onDropPinModeChange?.(false);
        }
    }, [pendingDropPin]);

    // Save current route
    const saveRoute = async () => {
        if (!pool || !pubkey || !signEvent || !routeCoords || waypoints.length < 2) {
            alert('Please create a route first');
            return;
        }

        const name = routeName.trim() || `Route ${new Date().toLocaleDateString()}`;

        setIsSaving(true);
        try {
            const routeContent: RouteLogContent = {
                name,
                waypoints: waypoints.map(w => ({ name: w.name, lat: w.lat, lon: w.lon })),
                routeCoords,
                alternateRouteCoords: alternateRouteCoords || undefined,
                vehicleType,
                created_at: Math.floor(Date.now() / 1000),
            };

            // Get seckey from localStorage for local key users
            const privkeyHex = localStorage.getItem('parlens_privkey');
            const seckey = privkeyHex ? new Uint8Array(privkeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) : undefined;

            const encrypted = await encryptParkingLog(routeContent, pubkey, seckey);
            const dTag = `route_${Date.now()}`;

            const event = {
                kind: KINDS.ROUTE_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', dTag],
                    ['client', 'parlens'],
                ],
                content: encrypted,
            };

            const signedEvent = await signEvent(event);
            console.log('[Parlens] Signed route event:', signedEvent);

            const results = await Promise.any(pool.publish(DEFAULT_RELAYS, signedEvent));
            console.log('[Parlens] Route published:', results);

            setRouteName('');
            await fetchSavedRoutes();
            alert('Route saved!');
        } catch (error) {
            console.error('[Parlens] Error saving route:', error);
            alert('Failed to save route: ' + (error instanceof Error ? error.message : 'Unknown error'));
        } finally {
            setIsSaving(false);
        }
    };

    // Update waypoint name
    const updateWaypointName = (id: string, newName: string) => {
        setWaypoints(prev => prev.map(w => w.id === id ? { ...w, name: newName } : w));
        setEditingWaypointId(null);
        setEditingName('');
    };

    // Start editing a waypoint name
    const startEditingWaypoint = (waypoint: Waypoint) => {
        setEditingWaypointId(waypoint.id);
        setEditingName(waypoint.name);
    };

    // Load a saved route
    const loadRoute = async (saved: SavedRoute) => {
        const content = saved.decryptedContent;

        // Restore waypoints
        const restoredWaypoints: Waypoint[] = content.waypoints.map(w => ({
            id: crypto.randomUUID(),
            name: w.name,
            lat: w.lat,
            lon: w.lon,
        }));

        setWaypoints(restoredWaypoints);
        setRouteCoords(content.routeCoords);
        setAlternateRouteCoords(content.alternateRouteCoords || null);
        setShowOnMap(true);
        setShowSavedRoutes(false);

        onRouteChange(
            content.routeCoords,
            content.alternateRouteCoords || null,
            content.waypoints.map(w => ({ lat: w.lat, lon: w.lon })),
            true
        );

        setIsOpen(false);
    };

    // Delete a saved route
    const deleteRoute = async (saved: SavedRoute) => {
        if (!pool || !pubkey || !signEvent) return;

        if (!confirm('Are you sure you want to delete this route? This action cannot be undone.')) return;

        setIsDeleting(true);
        try {
            // Publish a delete event (kind 5)
            const deleteEvent = {
                kind: 5,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['e', saved.id],
                    ['a', `${KINDS.ROUTE_LOG}:${pubkey}:${saved.dTag}`],
                ],
                content: 'Deleted by user',
            };

            const signedEvent = await signEvent(deleteEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedEvent));

            // Also publish a replacement with empty content to overwrite
            const replaceEvent = {
                kind: KINDS.ROUTE_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', saved.dTag],
                    ['deleted', 'true'],
                ],
                content: '',
            };

            const signedReplace = await signEvent(replaceEvent);
            await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signedReplace));

            setSavedRoutes(prev => prev.filter(r => r.id !== saved.id));
            alert('Route deleted');
        } catch (error) {
            console.error('Error deleting route:', error);
            alert('Failed to delete route');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="h-12 w-12 flex items-center justify-center rounded-[1.5rem] bg-white/80 dark:bg-white/10 backdrop-blur-md text-zinc-600 dark:text-white/70 hover:bg-white dark:hover:bg-white/20 active:scale-95 transition-all shadow-lg border border-black/5 dark:border-white/10"
                title="Create Route"
            >
                <Route size={20} />
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-start bg-black/60 backdrop-blur-xl animate-in fade-in duration-300 pt-2 px-4 pb-4">
                    <button
                        onClick={() => setIsOpen(false)}
                        className="absolute inset-0 z-0 cursor-default"
                    />

                    <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2rem] shadow-2xl p-6 flex flex-col gap-6 animate-in slide-in-from-bottom-10 duration-300 h-[calc(100vh-1.5rem)] overflow-y-auto no-scrollbar border border-black/5 dark:border-white/5 transition-colors">

                        {/* Deleting Overlay */}
                        {isDeleting && (
                            <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                                    <p className="text-sm font-medium text-white">Deleting...</p>
                                </div>
                            </div>
                        )}

                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-500 to-cyan-500 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent">
                                Create Route
                            </h2>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                            >
                                <X size={20} className="text-black/60 dark:text-white/60" />
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/30 ml-2">
                                Add Waypoint
                            </label>
                            <div className="relative">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder="Search for a place..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-14 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {isSearching && (
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                        <div className="w-5 h-5 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
                                    </div>
                                )}
                            </div>

                            {/* Saved Waypoint Matches (offline/local) */}
                            {savedWaypointMatches.length > 0 && (
                                <div className="rounded-2xl overflow-hidden bg-green-50 dark:bg-green-500/10 border border-green-500/20">
                                    <div className="px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100/50 dark:bg-green-500/5">
                                        ⭐ From your saved routes
                                    </div>
                                    {savedWaypointMatches.map((match, index) => (
                                        <button
                                            key={`saved-${index}`}
                                            onClick={() => {
                                                const newWaypoint: Waypoint = {
                                                    id: crypto.randomUUID(),
                                                    name: match.name,
                                                    lat: match.lat,
                                                    lon: match.lon
                                                };
                                                setWaypoints(prev => [...prev, newWaypoint]);
                                                setSearchQuery('');
                                                setRouteCoords(null);
                                                setAlternateRouteCoords(null);
                                                setShowOnMap(false);
                                                onRouteChange(null, null, null, false);
                                            }}
                                            className="w-full p-3 flex items-center gap-3 hover:bg-green-100 dark:hover:bg-green-500/10 transition-colors text-left border-b border-green-500/10 last:border-0"
                                        >
                                            <MapPin size={16} className="text-green-600 dark:text-green-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm text-zinc-700 dark:text-white/80 truncate block">
                                                    {match.name}
                                                </span>
                                                <span className="text-xs text-green-600/70 dark:text-green-400/50 truncate block">
                                                    from {match.fromRoute}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* API Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="rounded-2xl overflow-hidden bg-zinc-50 dark:bg-white/5 border border-black/5 dark:border-white/10">
                                    {suggestions.map((suggestion, index) => (
                                        <button
                                            key={index}
                                            onClick={() => addWaypoint(suggestion)}
                                            className="w-full p-3 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors text-left border-b border-black/5 dark:border-white/5 last:border-0"
                                        >
                                            <MapPin size={16} className="text-blue-500 shrink-0" />
                                            <span className="text-sm text-zinc-700 dark:text-white/80 truncate">
                                                {suggestion.display_name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Add Current Location Button - below search results */}
                            {currentLocation && (
                                <button
                                    onClick={() => {
                                        const newWaypoint: Waypoint = {
                                            id: crypto.randomUUID(),
                                            name: 'Current Location',
                                            lat: currentLocation[0],
                                            lon: currentLocation[1]
                                        };
                                        setWaypoints(prev => [...prev, newWaypoint]);
                                        setRouteCoords(null);
                                        setAlternateRouteCoords(null);
                                        setShowOnMap(false);
                                        onRouteChange(null, null, null, false);
                                    }}
                                    className="w-full p-3 flex items-center gap-3 rounded-2xl bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                                >
                                    <Navigation size={16} className="text-blue-500" />
                                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Add Current Location</span>
                                </button>
                            )}

                            {/* Drop Pin on Map Button */}
                            <button
                                onClick={toggleDropPinMode}
                                className="w-full p-3 flex items-center gap-3 rounded-2xl bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                            >
                                <MapPinned size={16} className="text-orange-500" />
                                <span className="text-sm font-medium text-orange-600 dark:text-orange-400">Drop Pin on Map</span>
                            </button>
                        </div>

                        {/* Waypoints List */}
                        <div className="space-y-2 flex-1">
                            <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/30 ml-2">
                                Waypoints ({waypoints.length})
                            </label>

                            {waypoints.length === 0 ? (
                                <div className="p-8 text-center text-zinc-400 dark:text-white/30 text-sm">
                                    No waypoints added yet.<br />Search for places above to add them.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {waypoints.map((waypoint, index) => (
                                        <div
                                            key={waypoint.id}
                                            className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10"
                                        >
                                            <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                                {index + 1}
                                            </div>
                                            {editingWaypointId === waypoint.id ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="flex-1 text-sm bg-white dark:bg-white/10 rounded-lg px-2 py-1 text-zinc-700 dark:text-white border border-blue-500"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') updateWaypointName(waypoint.id, editingName);
                                                            if (e.key === 'Escape') setEditingWaypointId(null);
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => updateWaypointName(waypoint.id, editingName)}
                                                        className="p-2 rounded-xl text-green-500 hover:bg-green-500/10 transition-colors"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="flex-1 text-sm text-zinc-700 dark:text-white font-medium truncate">
                                                        {waypoint.name}
                                                    </span>
                                                    <button
                                                        onClick={() => startEditingWaypoint(waypoint)}
                                                        className="p-2 rounded-xl text-zinc-400 dark:text-white/40 hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => removeWaypoint(waypoint.id)}
                                                className="p-2 rounded-xl text-zinc-400 dark:text-white/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Show on Map Toggle */}
                        {routeCoords && (
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10">
                                <div className="flex items-center gap-3">
                                    {showOnMap ? <Eye size={20} className="text-blue-500" /> : <EyeOff size={20} className="text-zinc-400" />}
                                    <span className="font-medium text-zinc-700 dark:text-white">Show on Map</span>
                                </div>
                                <button
                                    onClick={toggleShowOnMap}
                                    className={`w-14 h-8 rounded-full transition-colors ${showOnMap ? 'bg-blue-500' : 'bg-zinc-300 dark:bg-white/20'}`}
                                >
                                    <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform ${showOnMap ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}

                        {/* Save Route Section - shows after route is created */}
                        {routeCoords && pubkey && (
                            <div className="space-y-3 p-4 rounded-2xl bg-green-500/5 dark:bg-green-500/10 border border-green-500/20">
                                <label className="text-xs font-bold uppercase tracking-widest text-green-600 dark:text-green-400 flex items-center gap-2">
                                    <Save size={14} />
                                    Save Route
                                </label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={routeName}
                                        onChange={(e) => setRouteName(e.target.value)}
                                        placeholder="Route name (optional)"
                                        className="w-full sm:flex-1 p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 text-zinc-700 dark:text-white placeholder-zinc-400 dark:placeholder-white/40 text-sm"
                                    />
                                    <button
                                        onClick={saveRoute}
                                        disabled={isSaving}
                                        className="w-full sm:w-auto px-6 rounded-xl bg-green-500 text-white font-bold disabled:opacity-50 transition-all active:scale-95 py-3 sm:py-0"
                                    >
                                        {isSaving ? '...' : 'Save'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={clearAllWaypoints}
                                disabled={waypoints.length === 0}
                                className="flex-1 h-14 rounded-2xl bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-white/70 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                Clear Route
                            </button>
                            <button
                                onClick={createRoute}
                                disabled={waypoints.length < 2 || isCreatingRoute}
                                className="flex-1 h-14 rounded-2xl bg-blue-500 text-white font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                {isCreatingRoute ? 'Creating...' : 'Create Route'}
                            </button>
                        </div>

                        {/* Hint about save option */}
                        {!routeCoords && waypoints.length >= 2 && pubkey && (
                            <p className="text-xs text-center text-zinc-400 dark:text-white/40">
                                💾 Save option will appear after you create the route
                            </p>
                        )}

                        {/* Saved Routes Section */}
                        {pubkey && (
                            <div className="space-y-3 border-t border-black/5 dark:border-white/10 pt-4">
                                <button
                                    onClick={() => setShowSavedRoutes(!showSavedRoutes)}
                                    className="w-full flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-2">
                                        <FolderOpen size={18} className="text-zinc-500 dark:text-white/50" />
                                        <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-white/30">
                                            Saved Routes ({savedRoutes.length})
                                        </span>
                                    </div>
                                    <span className="text-xs text-zinc-400 dark:text-white/40">
                                        {showSavedRoutes ? 'Hide' : 'Show'}
                                    </span>
                                </button>

                                {showSavedRoutes && (
                                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                        {isLoadingSaved ? (
                                            <div className="text-center text-zinc-400 dark:text-white/40 text-sm py-4">
                                                Loading...
                                            </div>
                                        ) : savedRoutes.length === 0 ? (
                                            <div className="text-center text-zinc-400 dark:text-white/40 text-sm py-4">
                                                No saved routes yet
                                            </div>
                                        ) : (
                                            savedRoutes.map((route) => (
                                                <div
                                                    key={route.id}
                                                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-100 dark:bg-white/5 border border-black/5 dark:border-white/10"
                                                >
                                                    <button
                                                        onClick={() => loadRoute(route)}
                                                        className="flex-1 text-left"
                                                    >
                                                        <div className="font-medium text-sm text-zinc-700 dark:text-white truncate">
                                                            {route.decryptedContent.name}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-white/40">
                                                            <span>{route.decryptedContent.waypoints.length} stops</span>
                                                            <span>•</span>
                                                            <Clock size={12} />
                                                            <span>{new Date(route.created_at * 1000).toLocaleDateString()}</span>
                                                        </div>
                                                    </button>
                                                    <button
                                                        onClick={() => deleteRoute(route)}
                                                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* API Warning Message */}
                        <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20">
                            <p className="text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                                <strong>Tip:</strong> Place search uses a rate-limited API. Use <strong>Drop Pin on Map</strong> and
                                <strong> edit waypoint names</strong> to label locations. When you <strong>save routes</strong>,
                                waypoint names become searchable — building your personal offline map over time! ⭐
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
