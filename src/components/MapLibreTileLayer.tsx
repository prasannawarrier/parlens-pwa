/**
 * MapLibre GL Leaflet Integration
 * Provides vector tile rendering within Leaflet map
 * Enables smooth zoom/rotation while keeping existing marker logic
 */
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';

// Free vector tile styles - minimalist with good road visibility
const MAP_STYLES = {
    // OpenFreeMap styles (completely free, no API key)
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
    // Alternative: Stadia Maps (free tier available)
    stadiaLight: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
    stadiaDark: 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json'
};

interface MapLibreTileLayerProps {
    isDarkMode: boolean;
}

/**
 * React-Leaflet component that adds MapLibre GL vector tiles
 * Replaces raster TileLayer for smooth zoom/rotation
 */
export const MapLibreTileLayer: React.FC<MapLibreTileLayerProps> = ({ isDarkMode }) => {
    const map = useMap();

    useEffect(() => {
        // Choose style based on theme
        const styleUrl = isDarkMode ? MAP_STYLES.dark : MAP_STYLES.light;

        // Create MapLibre GL layer
        // @ts-ignore - maplibre-gl-leaflet types not perfect
        const gl = L.maplibreGL({
            style: styleUrl,
            // Enable interactive features
            interactive: true
        });

        // Add to map (below markers)
        gl.addTo(map);

        // Cleanup on unmount or theme change
        return () => {
            map.removeLayer(gl);
        };
    }, [map, isDarkMode]);

    return null;
};

export default MapLibreTileLayer;
