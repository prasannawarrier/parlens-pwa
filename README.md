# Parlens PWA

Parlens is a decentralized parking utility app built on the [Nostr](https://nostr.com/) protocol. It allows users to track their parking history, find open parking spots broadcasted by other users, and plan routes with offline capabilities—all without a centralized server holding your data.

## Features

- **🚗 Vehicle Types**: Support for Cars, Motorcycles, and Bicycles with custom rates.
- **🕒 Parking History**: Log where you parked providing a personal history of your spots.
- **📡 Open Spot Broadcast**: Share vacated spots with the community anonymously.
- **🗺️ Privacy-First Routing**: Plan routes and save them encrypted to your profile.
- **📍 Offline Maps**: Saved waypoints become searchable locally, building a personal offline map over time.
- **🔐 End-to-End Encryption**: All personal data (logs, routes) is encrypted using NIP-44.
- **📱 PWA Ready**: Installable on iOS and Android for a native app experience.

## Technology Stack

- **Frontend**: [React](https://react.dev/) with [Vite](https://vitejs.dev/)
- **Language**: TypeScript
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Maps**: [Leaflet](https://leafletjs.com/) with [React Leaflet](https://react-leaflet.js.org/)
- **Routing**: [OSRM](http://project-osrm.org/) (Open Source Routing Machine)
- **Protocol**: [Nostr](https://github.com/nostr-protocol/nostr) (via `nostr-tools` and `@nostrify/react`)
- **State Management**: React Context + Nostr Relays

## Nostr Event Kinds

Parlens uses specific Nostr event kinds to manage data:

| Kind | Name | Description | Encryption |
|------|------|-------------|------------|
| **31417** | Parking Log | User's personal parking history. | ✅ NIP-44 |
| **31714** | Open Spot | Ephemeral broadcast of a vacated spot. | ❌ Public |
| **34171** | Route Log | User-saved routes and waypoints. | ✅ NIP-44 |

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/parlens-pwa.git
   cd parlens-pwa
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

## Login Methods

Parlens supports multiple ways to login:
- **NSEC**: Login with your private key (stored locally encrypted).
- **Guest**: Create a burner account for testing.

## Attribution

Parlens is built on the shoulders of giants. Special thanks to:

- **OpenStreetMap Contributors**: For map data and geocoding services.
- **Nostr Protocol**: For the decentralized, censorship-resistant communication layer.
- **Leaflet & OSRM**: For powerful open-source mapping and routing tools.
- **Lucide React**: For the beautiful icon set.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the `LICENSE` file for details.
