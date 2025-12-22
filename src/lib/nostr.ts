export const KINDS = {
    PARKING_LOG: 31012, // My Parking Log (Parameterized Replaceable for history)
    OPEN_SPOT_BROADCAST: 21011, // Open Spot Broadcast (Ephemeral)
};

export const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

export interface ParkingLogContent {
    location: string; // "lat, lng" with 6 decimal places
    g: string; // 10-digit geohash
    start: number; // timestamp
    end?: number; // timestamp
    fee?: string; // e.g., "10 USD", "0 FREE"
}

export interface BroadcastTags {
    location: string;
    g: string;
    client: string;
}
