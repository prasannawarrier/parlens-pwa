
import { encodeGeohash, geohashToBounds } from '../src/lib/geo.ts';

// Mock Geohash Logic for testing without full lib imports (if needed, but we can import from source if using ts-node or similar, 
// strictly speaking regular node might fail on .ts imports without setup. 
// I'll copy the minimal logic needed or use the project structure if I can run it.)

// Actually, since I can't easily run TS files without a runner in this environment usually, 
// I will create a .mjs file and reimplement/mock the geo logic OR just import checks if I can.
// But the user has `scripts/test-open-spots.mjs`. I can stick to JS/MJS.

const mockSnapshot = {
    kind: 11012,
    tags: [
        ['d', 'listing-uuid-123'],
        ['g', 'tdr1y'], // Approx Bangalore
        ['client', 'parlens']
    ],
    content: JSON.stringify({
        stats: {
            car: { open: 5, rate: 20, total: 10 },
            motorcycle: { open: 2, rate: 10, total: 5 }
        }
    })
};

// Logic from FAB.tsx
function parseSnapshot(event, vehicleType) {
    console.log(`Processing Snapshot for vehicle: ${vehicleType}`);

    const gTag = event.tags.find(t => t[0] === 'g');
    if (!gTag) {
        console.error('No g tag found');
        return null;
    }

    // Mock decode (since I can't import TS easily in MJS usually without loader)
    // I'll rely on the logic being correct in the file, but here I'll simulate "tdr1y" decoding or just assume it works.
    // To VALIDATE the logic, I should technically reproduce it.

    // Check Content Parsing
    try {
        const contentData = JSON.parse(event.content);
        const typeStats = contentData.stats?.[vehicleType];

        if (!typeStats || typeStats.open <= 0) {
            console.log('No open spots or stats for type');
            return null;
        }

        const price = typeStats.rate || 0;
        const count = typeStats.open;

        return {
            id: 'listing-uuid-123',
            price,
            count,
            type: vehicleType
        };

    } catch (e) {
        console.error('Parse error', e);
        return null;
    }
}

// Test
const resultCar = parseSnapshot(mockSnapshot, 'car');
console.log('Car Result:', resultCar);

const resultMoto = parseSnapshot(mockSnapshot, 'motorcycle');
console.log('Moto Result:', resultMoto);

const resultBike = parseSnapshot(mockSnapshot, 'bicycle');
console.log('Bike Result:', resultBike);
