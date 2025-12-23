import React, { useState, useEffect, useRef } from 'react';
import { HelpCircle, Compass, Navigation, ChevronDown, X } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';
import { getCurrencySymbol } from '../lib/currency';

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

    return <Marker position={location} icon={customIcon} />;
}

// Marker for the user's currently parked vehicle
const ActiveSessionMarker = ({ location, vehicleType }: { location: [number, number], vehicleType: string }) => {
    const emoji = vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗';
    const content = `<div style="font-size: 36px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));">${emoji}</div>`;

    const customIcon = L.divIcon({
        className: 'active-session-marker',
        html: content,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    return <Marker position={location} icon={customIcon} />;
};

// Marker for Open Spots
const SpotMarker = ({ spot }: { spot: any }) => {
    const content = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px;">
             <div style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                ${spot.type === 'bicycle' ? '🚲' : spot.type === 'motorcycle' ? '🏍️' : '🅿️'}
             </div>
             <div style="background: white; border-radius: 12px; padding: 2px 8px; font-weight: bold; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transform: translateY(-5px); white-space: nowrap; color: black; border: 1px solid rgba(0,0,0,0.1);">
                ${spot.price > 0 ? `${spot.currency === 'USD' ? '$' : spot.currency}${spot.price.toFixed(2)}` : 'Free'}
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
};

// Marker for History Spots (Purple)
const HistoryMarker = ({ spot }: { spot: any }) => {
    const content = spot.decryptedContent;
    if (!content || !content.lat || !content.lon) return null;

    const htmlContent = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px;">
             <div style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); grayscale: 100%;">
                🅿️
             </div>
             <div style="background: white; border-radius: 12px; padding: 2px 8px; font-weight: bold; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transform: translateY(-5px); white-space: nowrap; color: black; border: 1px solid rgba(0,0,0,0.1);">
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

// Controller to handle map centering and rotation
const MapController = ({ location, bearing, orientationMode, shouldRecenter, setShouldRecenter }: {
    location: [number, number],
    bearing: number,
    orientationMode: 'auto' | 'fixed',
    shouldRecenter: boolean,
    setShouldRecenter: (v: boolean) => void
}) => {
    const map = useMap();

    useEffect(() => {
        if (shouldRecenter && location) {
            map.setView(location, 16, { animate: true }); // Default zoom 16
            setShouldRecenter(false);
        }
    }, [shouldRecenter, location, map, setShouldRecenter]);

    useEffect(() => {
        if (location) {
            // Simple logic: if orientationMode is auto, follow the user.
            if (orientationMode === 'auto') {
                map.setView(location, map.getZoom(), { animate: true });
            }

            const mapContainer = map.getContainer();
            // Using a more stable rotation container trick
            mapContainer.style.transition = 'transform 0.5s cubic-bezier(0.1, 0, 0.3, 1)';
            mapContainer.style.transformOrigin = 'center center';

            if (orientationMode === 'auto') {
                mapContainer.style.transform = `rotate(${-bearing}deg)`;
                // Scaled container to avoid edges - usually 150% is enough for rotation
                mapContainer.style.width = '200%';
                mapContainer.style.height = '200%';
                mapContainer.style.top = '-50%';
                mapContainer.style.left = '-50%';
            } else {
                mapContainer.style.transform = 'rotate(0deg)';
                mapContainer.style.width = '100%';
                mapContainer.style.height = '100%';
                mapContainer.style.top = '0';
                mapContainer.style.left = '0';
            }
            mapContainer.style.position = 'absolute';

            // Crucial for Leaflet to know its size changed
            map.invalidateSize();
        }
    }, [location, bearing, orientationMode, map]);

    return null;
};

export const LandingPage: React.FC = () => {
    const [location, setLocation] = useState<[number, number] | null>(null);
    const [bearing, setBearing] = useState(0);
    const [status, setStatus] = useState<'idle' | 'search' | 'parked'>('idle');
    const [orientationMode, setOrientationMode] = useState<'auto' | 'fixed'>('auto');
    const [showHelp, setShowHelp] = useState(false);
    const [vehicleType, setVehicleType] = useState<'bicycle' | 'motorcycle' | 'car'>('car');
    const [openSpots, setOpenSpots] = useState<any[]>([]);
    const [historySpots, setHistorySpots] = useState<any[]>([]);
    const [parkLocation, setParkLocation] = useState<[number, number] | null>(null);
    const [shouldRecenter, setShouldRecenter] = useState(false);

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

    // High accuracy location tracking
    useEffect(() => {
        if ("geolocation" in navigator) {
            watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                    const { latitude, longitude, heading } = pos.coords;
                    setLocation([latitude, longitude]);
                    if (heading !== null) {
                        setBearing(heading);
                    }
                },
                (err) => console.error('Location error:', err),
                {
                    enableHighAccuracy: true,
                    maximumAge: 0, // Request live data without caching
                    timeout: 5000
                }
            );
        }
        return () => {
            if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, []);

    // Device orientation for heading - requires permission on iOS 13+
    useEffect(() => {
        const requestOrientationPermission = async () => {
            // Check if DeviceOrientationEvent exists and needs permission (iOS 13+)
            if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                try {
                    const permission = await (DeviceOrientationEvent as any).requestPermission();
                    if (permission !== 'granted') {
                        console.warn('Device orientation permission denied');
                        return;
                    }
                } catch (e) {
                    console.error('Error requesting device orientation permission:', e);
                    return;
                }
            }

            const handleOrientation = (e: DeviceOrientationEvent) => {
                // webkitCompassHeading is more accurate on iOS
                if ((e as any).webkitCompassHeading !== undefined) {
                    setBearing((e as any).webkitCompassHeading);
                } else if (e.alpha !== null) {
                    // On Android, alpha represents device orientation relative to magnetic north
                    setBearing(360 - e.alpha);
                }
            };

            window.addEventListener('deviceorientation', handleOrientation, true);
            return () => window.removeEventListener('deviceorientation', handleOrientation, true);
        };

        // Small delay to allow geolocation to settle first
        const timer = setTimeout(requestOrientationPermission, 500);
        return () => clearTimeout(timer);
    }, []);


    const handleVehicleChange = (type: 'bicycle' | 'motorcycle' | 'car') => {
        if (status !== 'idle') {
            alert('Please end your current session before changing vehicle type.');
            return;
        }
        setVehicleType(type);
    };

    if (!location) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-black">
                <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700">
                    <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                    <p className="text-sm font-semibold text-zinc-400 dark:text-white/40 tracking-tight">Locating...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-gray-50 dark:bg-black transition-colors duration-300">
            <div className="absolute inset-0">
                <MapContainer
                    center={location}
                    zoom={16}
                    zoomControl={false}
                    className="h-full w-full"
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
                    />
                    <UserMarker location={location} bearing={bearing} />
                    {status === 'parked' && parkLocation && (
                        <ActiveSessionMarker location={parkLocation} vehicleType={vehicleType} />
                    )}
                    {status === 'search' && openSpots.map(spot => (
                        <SpotMarker key={spot.id} spot={spot} />
                    ))}
                    {historySpots.length > 0 && historySpots
                        .filter(spot => {
                            // Filter by current vehicle type, matching logic
                            const type = spot.tags?.find((t: string[]) => t[0] === 'type')?.[1] || 'car';
                            return type === vehicleType;
                        })
                        .map(spot => (
                            <HistoryMarker key={spot.id} spot={spot} />
                        ))}
                    <MapController
                        location={location}
                        bearing={bearing}
                        orientationMode={orientationMode}
                        shouldRecenter={shouldRecenter}
                        setShouldRecenter={setShouldRecenter}
                    />
                </MapContainer>
            </div>

            {/* Bottom Left Controls */}
            <div className="absolute bottom-10 left-6 z-[1000] flex flex-col items-start gap-4 animate-in slide-in-from-left-6">

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

            {/* Bottom Right Controls */}
            <div className="absolute bottom-10 right-6 z-[1000] flex flex-col items-end gap-5 animate-in slide-in-from-right-6">

                {/* Orientation Toggle */}
                <button
                    onClick={() => {
                        setOrientationMode(m => m === 'auto' ? 'fixed' : 'auto');
                        setShouldRecenter(true);
                    }}
                    className={`h-12 w-12 flex items-center justify-center rounded-[1.5rem] backdrop-blur-md transition-all active:scale-95 border shadow-lg ${orientationMode === 'auto'
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-500 dark:text-blue-400'
                        : 'bg-white/80 dark:bg-zinc-800/80 border-black/5 dark:border-white/10 text-zinc-600 dark:text-white/70'
                        }`}
                >
                    {orientationMode === 'auto' ? <Navigation size={20} className="fill-current" /> : <Compass size={20} />}
                </button>

                <ProfileButton setHistorySpots={setHistorySpots} />
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
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 dark:bg-black/80 backdrop-blur-xl p-6 animate-in fade-in">
                    <div className="w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[2.5rem] border border-black/5 dark:border-white/10 shadow-2xl p-8 space-y-8 animate-in zoom-in-95 max-h-[85vh] overflow-y-auto no-scrollbar relative transition-colors">
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
                            <div className="rounded-2xl bg-zinc-100 dark:bg-white/5 overflow-hidden">
                                <button onClick={() => {
                                    const el = document.getElementById('android-guide');
                                    el?.classList.toggle('hidden');
                                }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-800 dark:text-zinc-200 transition-colors">
                                    <span>Using Browser Menu (Android)</span>
                                    <ChevronDown size={16} className="text-zinc-400 dark:text-white/50" />
                                </button>
                                <div id="android-guide" className="hidden p-4 pt-0 text-xs text-zinc-600 dark:text-white/70 space-y-2">
                                    <p className="font-semibold text-zinc-900 dark:text-white">Chrome & Brave:</p>
                                    <ol className="list-decimal pl-5 space-y-1">
                                        <li>Tap menu button (three dots)</li>
                                        <li>Tap "Add to Home screen"</li>
                                        <li>Tap "Add" to confirm</li>
                                    </ol>
                                    <p className="font-semibold text-zinc-900 dark:text-white mt-3">Firefox:</p>
                                    <ol className="list-decimal pl-5 space-y-1">
                                        <li>Tap menu button (three dots)</li>
                                        <li>Tap "Install"</li>
                                    </ol>
                                </div>
                            </div>

                            {/* iOS */}
                            <div className="rounded-2xl bg-zinc-100 dark:bg-white/5 overflow-hidden">
                                <button onClick={() => {
                                    const el = document.getElementById('ios-guide');
                                    el?.classList.toggle('hidden');
                                }} className="w-full flex items-center justify-between p-4 font-bold text-sm text-left hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-800 dark:text-zinc-200 transition-colors">
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
                                <strong className="text-zinc-900 dark:text-white block mb-1">2. Search for spots</strong>
                                Click the main button once to see open spots reported by others.
                            </p>

                            <p>
                                <strong className="text-zinc-900 dark:text-white block mb-1">3. Park & End Session</strong>
                                Click again to mark your location. When leaving, click once more to end the session and report the fee.
                            </p>

                            <p>
                                <strong className="text-zinc-900 dark:text-white block mb-1">4. View History</strong>
                                Use the log button (clipboard icon) to see your parking history.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {status === 'search' && (
                <div className="absolute top-12 left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500">
                    <div className="px-6 py-3 rounded-full bg-white text-black font-bold shadow-xl flex items-center gap-3 border border-black/5">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        <span className="text-sm tracking-tight">Searching for spots</span>
                    </div>
                </div>
            )}

            {status === 'parked' && (
                <div className="absolute top-12 left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500">
                    <div className="px-6 py-3 rounded-full bg-[#34C759] text-white font-bold shadow-xl flex items-center gap-3">
                        <span className="text-lg">
                            {vehicleType === 'bicycle' ? '🚲' : vehicleType === 'motorcycle' ? '🏍️' : '🚗'}
                        </span>
                        <span className="text-sm tracking-tight text-white/90">Session Active</span>
                    </div>
                </div>
            )}
        </div>
    );
};
