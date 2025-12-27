
import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { WebSocket } from 'ws';

// Polyfill WebSocket for Node environment
global.WebSocket = WebSocket;

const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

const KIND_OPEN_SPOT = 31714;
const SK = generateSecretKey();
const PK = getPublicKey(SK);

// Test Location (San Francisco)
const LAT = 37.7749;
const LON = -122.4194;
const GEOHASH = '9q8yy'; // Approximate

console.log(`[Test] Starting Backend Flow Test`);
console.log(`[Test] Pubkey: ${PK}`);
console.log(`[Test] Relays: ${RELAYS.join(', ')}`);

const pool = new SimplePool();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    for (let i = 1; i <= 3; i++) {
        console.log(`\n--- Iteration ${i} ---`);

        // 1. Search for existing spots
        console.log(`[Step 1] Searching for spots (Kind ${KIND_OPEN_SPOT})...`);
        const startSearch = Date.now();
        const events = await pool.querySync(RELAYS, {
            kinds: [KIND_OPEN_SPOT],
            '#g': [GEOHASH],
            limit: 5 // Keep it small
        });
        const endSearch = Date.now();
        console.log(`[Step 1] Found ${events.length} events in ${endSearch - startSearch}ms`);

        // 2. Publish a NEW spot
        console.log(`[Step 2] Publishing NEW spot...`);
        const event = finalizeEvent({
            kind: KIND_OPEN_SPOT,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['d', `test_spot_${Date.now()}`],
                ['g', GEOHASH],
                ['location', `${LAT},${LON}`],
                ['client', 'parlens-test']
            ],
            content: 'Test spot from backend script',
        }, SK);

        const startPub = Date.now();
        const pubs = await Promise.allSettled(pool.publish(RELAYS, event));
        const endPub = Date.now();

        const successCount = pubs.filter(p => p.status === 'fulfilled').length;
        console.log(`[Step 2] Published to ${successCount}/${RELAYS.length} relays in ${endPub - startPub}ms`);

        if (successCount === 0) {
            console.error('[!] Failed to publish to any relay!');
        }

        // 3. Verify Immediate Retrieval (by ID)
        console.log(`[Step 3] Verifying immediate retrieval (Event ID: ${event.id.substring(0, 8)}...)...`);
        const startGet = Date.now();
        const retrieved = await pool.get(RELAYS, { ids: [event.id] });
        const endGet = Date.now();

        if (retrieved) {
            console.log(`[Step 3] SUCCESS: Retrieved event in ${endGet - startGet}ms`);
        } else {
            console.error(`[Step 3] FAILED: Could not retrieve event immediately!`);
        }

        // Wait a bit before next loop
        await delay(2000);
    }

    console.log('\n[Test] Closing pool...');
    pool.close(RELAYS);
    process.exit(0);
}

runTest().catch(console.error);
