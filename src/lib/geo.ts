/**
 * Encodes a lat/lng pair into a 10-digit geohash.
 * Simple implementation for the purpose of the prototype.
 */
export function encodeGeohash(lat: number, lng: number, precision: number = 10): string {
    const BITS = [16, 8, 4, 2, 1];
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    let isEven = true;
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let geohash = '';
    let bit = 0;
    let ch = 0;

    while (geohash.length < precision) {
        if (isEven) {
            const mid = (lngMin + lngMax) / 2;
            if (lng > mid) {
                ch |= BITS[bit];
                lngMin = mid;
            } else {
                lngMax = mid;
            }
        } else {
            const mid = (latMin + latMax) / 2;
            if (lat > mid) {
                ch |= BITS[bit];
                latMin = mid;
            } else {
                latMax = mid;
            }
        }

        isEven = !isEven;
        if (bit < 4) {
            bit++;
        } else {
            geohash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return geohash;
}

/**
 * Formats coordinates to 6 decimal places.
 */
export function formatCoords(lat: number, lng: number): string {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Gets the neighboring geohashes (including center) for boundary-safe searching.
 * Returns an array of 9 geohashes: center + 8 neighbors.
 */
export function getGeohashNeighbors(lat: number, lng: number, precision: number = 5): string[] {
    const center = encodeGeohash(lat, lng, precision);

    // Approximate offset for a geohash cell at given precision
    // These are rough estimates that work well enough for our use case
    const latOffset = precision === 5 ? 0.02 : precision === 6 ? 0.005 : 0.001;
    const lngOffset = precision === 5 ? 0.04 : precision === 6 ? 0.01 : 0.002;

    const neighbors = new Set<string>();
    neighbors.add(center);

    // Add 8 neighbors by offsetting lat/lng
    const offsets = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];

    for (const [latMult, lngMult] of offsets) {
        const neighborLat = lat + (latMult * latOffset);
        const neighborLng = lng + (lngMult * lngOffset);
        neighbors.add(encodeGeohash(neighborLat, neighborLng, precision));
    }

    return Array.from(neighbors);
}
