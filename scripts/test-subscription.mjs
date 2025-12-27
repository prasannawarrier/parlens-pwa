
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

const KIND_PARKING_LOG = 31417; // Using the parking log kind
const SK = generateSecretKey();
const PK = getPublicKey(SK);

console.log(`[Test] Starting Subscription Flow Test`);
console.log(`[Test] Pubkey: ${PK}`);

const pool = new SimplePool();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    let eventReceived = false;
    let publishedEventId = null;

    console.log('[Step 1] Starting subscription...');

    // Subscribe to parking logs
    const sub = pool.subscribeMany(
        RELAYS,
        { kinds: [KIND_PARKING_LOG], authors: [PK], limit: 50 },
        {
            onevent: (event) => {
                console.log(`[Subscription] Received event: ${event.id.substring(0, 8)}...`);
                if (event.id === publishedEventId) {
                    console.log('[Subscription] ✅ MATCH! Received the event we just published!');
                    eventReceived = true;
                }
            },
            oneose: () => {
                console.log('[Subscription] EOSE received - synced with relays');
            }
        }
    );

    console.log('[Step 1] Subscription active. Waiting 2s...');
    await delay(2000);

    // Publish a NEW parking log
    console.log(`[Step 2] Publishing NEW parking log...`);
    const event = finalizeEvent({
        kind: KIND_PARKING_LOG,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', `session_${Date.now()}`],
            ['client', 'parlens-test']
        ],
        content: JSON.stringify({ status: 'parked' }),
    }, SK);

    publishedEventId = event.id;

    const pubs = await Promise.allSettled(pool.publish(RELAYS, event));
    const successCount = pubs.filter(p => p.status === 'fulfilled').length;
    console.log(`[Step 2] Published to ${successCount}/${RELAYS.length} relays`);

    // Wait for event to loop back
    console.log('[Step 3] Waiting for subscription callback...');

    // Wait up to 10 seconds
    const startWait = Date.now();
    while (!eventReceived && Date.now() - startWait < 10000) {
        await delay(500);
        process.stdout.write('.');
    }
    console.log('');

    if (eventReceived) {
        console.log('[Test] SUCCESS: Subscription received the event in real-time!');
    } else {
        console.error('[Test] FAILED: Subscription timed out without receiving event.');
    }

    sub.close();
    pool.close(RELAYS);

    if (!eventReceived) process.exit(1);
}

runTest().catch(console.error);
