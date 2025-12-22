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
