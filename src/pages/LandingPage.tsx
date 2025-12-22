import React, { useState, useEffect, useRef } from 'react';
import { Car } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FAB } from '../components/FAB';
import { ProfileButton } from '../components/ProfileButton';

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

// Custom Marker to handle rotation and state
const UserMarker = ({ location, bearing, status }: { location: [number, number], bearing: number, status: string }) => {
    // Custom icon for the user
    const content = status === 'parked'
        ? `<div style="font-size: 36px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));">🚗</div>`
        : `<div style="transform: rotate(${bearing}deg); transition: transform 0.1s linear; display: flex; align-items: center; justify-content: center;">
             <div style="width: 24px; height: 24px; background: #007AFF; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,122,255,0.4), 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; position: relative;">
                <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid white; transform: translateY(-1px);"></div>
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

// Controller to handle map centering and rotation
const MapController = ({ location, bearing }: { location: [number, number], bearing: number }) => {
    const map = useMap();

    useEffect(() => {
        if (location) {
            map.setView(location, map.getZoom(), { animate: true });

            const mapContainer = map.getContainer();
            // Using a more stable rotation container trick
            mapContainer.style.transition = 'transform 0.5s cubic-bezier(0.1, 0, 0.3, 1)';
            mapContainer.style.transformOrigin = 'center center';
            mapContainer.style.transform = `rotate(${-bearing}deg)`;

            // Scaled container to avoid edges - usually 150% is enough for rotation
            mapContainer.style.width = '200%';
            mapContainer.style.height = '200%';
            mapContainer.style.position = 'absolute';
            mapContainer.style.top = '-50%';
            mapContainer.style.left = '-50%';

            // Crucial for Leaflet to know its size changed
            map.invalidateSize();
        }
    }, [location, bearing, map]);

    return null;
};

export const LandingPage: React.FC = () => {
    const [location, setLocation] = useState<[number, number] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bearing, setBearing] = useState(0);
    const [status, setStatus] = useState<'idle' | 'search' | 'parked'>('idle');
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
                (err) => {
                    console.error('Location error:', err);
                    let msg = 'Could not get location.';
                    if (err.code === 1) msg = 'Location access denied. Please enable in settings.';
                    if (err.code === 2) msg = 'Position unavailable. Check your GPS signal.';
                    if (err.code === 3) msg = 'GPS timeout. Moving near a window may help.';
                    setError(msg);
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 20000
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

    if (!location) {
        return (
            <div className="flex h-screen items-center justify-center bg-black p-10 text-center">
                <div className="flex flex-col items-center gap-6 animate-in fade-in duration-700">
                    {error ? (
                        <>
                            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                                <span className="text-red-500 text-xl font-black">!</span>
                            </div>
                            <p className="text-sm font-semibold text-red-500/80 tracking-tight max-w-[200px] leading-relaxed">
                                {error}
                            </p>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-bold tracking-widest uppercase active:scale-95 transition-all"
                            >
                                Retry
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                            <div className="space-y-2">
                                <p className="text-sm font-semibold text-white/40 tracking-tight">Locating...</p>
                                <p className="text-[10px] font-bold text-white/10 tracking-[0.2em] uppercase">Waiting for GPS</p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-black">
            <div className="absolute inset-0">
                <MapContainer
                    center={location}
                    zoom={18}
                    zoomControl={false}
                    className="h-full w-full"
                    dragging={false}
                    scrollWheelZoom={false}
                    touchZoom={false}
                    doubleClickZoom={false}
                >
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; CARTO'
                    />
                    <UserMarker location={location} bearing={bearing} status={status} />
                    <MapController location={location} bearing={bearing} />
                </MapContainer>
            </div>

            <div className="absolute bottom-10 right-10 z-[1000] flex flex-col items-end gap-4">
                <ProfileButton />
                <FAB status={status} setStatus={setStatus} location={location} />
            </div>

            {status === 'search' && (
                <div className="absolute top-12 left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500">
                    <div className="px-6 py-3 rounded-full bg-white text-black font-bold shadow-xl flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        <span className="text-sm tracking-tight">Searching for spots</span>
                    </div>
                </div>
            )}

            {status === 'parked' && (
                <div className="absolute top-12 left-1/2 z-[1000] -translate-x-1/2 animate-in slide-in-from-top-6 duration-500">
                    <div className="px-6 py-3 rounded-full bg-[#34C759] text-white font-bold shadow-xl flex items-center gap-3">
                        <Car size={16} />
                        <span className="text-sm tracking-tight text-white/90">Session Active</span>
                    </div>
                </div>
            )}
        </div>
    );
};
