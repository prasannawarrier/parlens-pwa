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
      // Workbox config for iOS - ensure fresh content
      workbox: {
        // Skip waiting and claim clients immediately for faster updates
        skipWaiting: true,
        clientsClaim: true,
        // Don't cache API/WebSocket requests
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        // Runtime caching for faster loads but fresh data
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.github\.io\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-cache',
              expiration: {
                maxAgeSeconds: 60 * 5 // 5 minutes max cache
              }
            }
          }
        ]
      }
    })
  ],
})
