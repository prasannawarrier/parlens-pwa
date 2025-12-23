/**
 * Clustering utility for grouping spots based on zoom level.
 * Uses geohash truncation for efficient spatial grouping.
 */

import { encodeGeohash } from './geo';

export interface SpotBase {
    id: string;
    lat: number;
    lon: number;
    price: number;
    currency: string;
}

export interface Cluster<T extends SpotBase> {
    id: string;
    lat: number;
    lon: number;
    spots: T[];
    minPrice: number;
    maxPrice: number;
    currency: string;
    count: number;
}

/**
 * Maps zoom level to geohash precision for clustering.
 * Lower zoom = lower precision = bigger clusters.
 */
function getClusterPrecision(zoom: number): number {
    if (zoom >= 17) return 8;  // ~20m - no clustering
    if (zoom >= 15) return 7;  // ~150m
    if (zoom >= 13) return 6;  // ~600m
    if (zoom >= 11) return 5;  // ~2.4km
    if (zoom >= 9) return 4;   // ~20km
    return 3;                   // ~150km
}

/**
 * Clusters spots by truncated geohash based on current zoom level.
 * Returns original spots if zoom is high enough, otherwise returns clusters.
 */
export function clusterSpots<T extends SpotBase>(
    spots: T[],
    zoom: number,
    shouldCluster: boolean = true
): (T | Cluster<T>)[] {
    // Don't cluster at high zoom levels
    if (!shouldCluster || zoom >= 17 || spots.length < 2) {
        return spots;
    }

    const precision = getClusterPrecision(zoom);
    const clusters = new Map<string, Cluster<T>>();

    for (const spot of spots) {
        const hash = encodeGeohash(spot.lat, spot.lon, precision);

        if (clusters.has(hash)) {
            const cluster = clusters.get(hash)!;
            cluster.spots.push(spot);
            cluster.count++;
            cluster.minPrice = Math.min(cluster.minPrice, spot.price);
            cluster.maxPrice = Math.max(cluster.maxPrice, spot.price);
            // Update center to average
            cluster.lat = cluster.spots.reduce((sum, s) => sum + s.lat, 0) / cluster.count;
            cluster.lon = cluster.spots.reduce((sum, s) => sum + s.lon, 0) / cluster.count;
        } else {
            clusters.set(hash, {
                id: `cluster-${hash}`,
                lat: spot.lat,
                lon: spot.lon,
                spots: [spot],
                minPrice: spot.price,
                maxPrice: spot.price,
                currency: spot.currency,
                count: 1
            });
        }
    }

    // Return clusters with count > 1, and individual spots for single-item clusters
    const result: (T | Cluster<T>)[] = [];
    for (const cluster of clusters.values()) {
        if (cluster.count === 1) {
            result.push(cluster.spots[0]);
        } else {
            result.push(cluster);
        }
    }

    return result;
}

/**
 * Helper to check if an item is a cluster.
 */
export function isCluster<T extends SpotBase>(item: T | Cluster<T>): item is Cluster<T> {
    return 'count' in item && item.count > 1;
}
