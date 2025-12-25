export const KINDS = {
    PARKING_LOG: 31417, // My Parking Log (Parameterized Replaceable for history)
    OPEN_SPOT_BROADCAST: 31714, // Open Spot Broadcast (Addressable/Replaceable with expiration)
    ROUTE_LOG: 34171, // My Route Log (Addressable for saved routes)
};

export const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

export interface ParkingLogContent {
    status?: 'parked' | 'vacated'; // Encrypted for privacy
    type?: 'bicycle' | 'motorcycle' | 'car'; // Encrypted for privacy
    location?: string; // Legacy: "lat, lng" with 6 decimal places
    lat?: number; // Latitude
    lon?: number; // Longitude
    g?: string; // Legacy: 10-digit geohash
    geohash?: string; // 10-digit geohash
    start?: number; // Legacy: timestamp
    started_at?: number; // Start timestamp
    end?: number; // Legacy: timestamp
    finished_at?: number; // End timestamp
    fee?: string; // e.g., "10"
    currency?: string; // e.g., "USD"
}

// Waypoint for route storage
export interface RouteWaypoint {
    name: string;
    lat: number;
    lon: number;
}

// Content for Route Log (Kind 34171) - NIP-44 encrypted
export interface RouteLogContent {
    name: string; // User-provided route name
    waypoints: RouteWaypoint[]; // Array of waypoints
    routeCoords: [number, number][]; // Primary route coordinates
    alternateRouteCoords?: [number, number][]; // Optional alternate route
    vehicleType: 'bicycle' | 'motorcycle' | 'car';
    created_at: number; // Unix timestamp
}

export interface BroadcastTags {
    location: string;
    g: string;
    client: string;
    type: 'car' | 'motorcycle' | 'bicycle';
}
