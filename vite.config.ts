import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/parlens-pwa/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Parlens',
        short_name: 'Parlens',
        description: 'Nostr-powered parking session tracker and spot broadcaster',
        theme_color: '#005A8C',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      // Workbox config for iOS - aggressive cache busting
      workbox: {
        // Skip waiting and claim clients immediately for faster updates
        skipWaiting: true,
        clientsClaim: true,
        // Clean up outdated caches from previous versions
        cleanupOutdatedCaches: true,
        // Don't cache API/WebSocket requests
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        // Precache with revision for cache busting
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Runtime caching - very short cache for app files
        runtimeCaching: [
          {
            // App files - always try network first with very short cache
            urlPattern: /^https:\/\/.*\.github\.io\/parlens-pwa\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-cache',
              networkTimeoutSeconds: 3, // Fall back to cache after 3s
              expiration: {
                maxAgeSeconds: 60, // 1 minute max cache
                maxEntries: 50
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Map tiles can be cached longer
            urlPattern: /^https:\/\/.*\.(openstreetmap|tile)\.org\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
                maxEntries: 500
              }
            }
          }
        ]
      }
    })
  ],
})
