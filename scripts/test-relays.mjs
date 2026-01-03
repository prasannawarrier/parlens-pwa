
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

// Polyfill WebSocket for Node environment if needed, but 'ws' package usually works.
// In this environment, we might need to rely on global WebSocket if available or import from 'ws'.
// Let's try standard import.

const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.snort.social'
];

const KINDS = {
    METADATA: 0,
    DELETION: 5,
    RELAY_LIST: 10002,
    PARKING_LOG: 31417,
    OPEN_SPOT_BROADCAST: 31714,
    ROUTE_LOG: 34171,
    LISTED_PARKING_METADATA: 31147,
    PARKING_SPOT_LISTING: 37141,
    LISTED_SPOT_LOG: 1714,
    PRIVATE_LOG_NOTE: 1417,
};

const sk = generateSecretKey();
const pk = getPublicKey(sk);

console.log('Testing Relays with Pubkey:', pk);

async function testRelay(url) {
    return new Promise((resolve) => {
        console.log(`\nConnecting to ${url}...`);
        const ws = new WebSocket(url);

        let successCount = 0;
        const results = {};
        const kindsToTest = Object.entries(KINDS);
        let pending = kindsToTest.length;

        ws.on('open', async () => {
            console.log(`Connected to ${url}. Publishing events...`);

            for (const [name, kind] of kindsToTest) {
                const event = {
                    kind,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [['d', 'test-relay-check-' + Date.now()]],
                    content: 'Parlens Relay Check',
                    pubkey: pk,
                };

                const signed = finalizeEvent(event, sk);

                // Manual publish command "EVENT"
                ws.send(JSON.stringify(['EVENT', signed]));

                // We need to wait for OK message. 
                // Since we send multiple, we need to map event IDs.
                results[signed.id] = { name, kind, status: 'pending' };

                // Add delay to avoid rate limiting
                await new Promise(r => setTimeout(r, 1000));
            }
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            // Format: ["OK", <event_id>, <true|false>, <message>]
            if (msg[0] === 'OK') {
                const eventId = msg[1];
                const accepted = msg[2];
                const info = msg[3];

                if (results[eventId]) {
                    results[eventId].status = accepted ? 'OK' : 'REJECTED';
                    results[eventId].info = info;
                    if (accepted) successCount++;

                    console.log(`  [${accepted ? '✅' : '❌'}] ${results[eventId].name} (Kind ${results[eventId].kind}): ${info || ''}`);

                    pending--;
                    if (pending === 0) {
                        ws.close();
                        resolve({ url, success: successCount === kindsToTest.length, results });
                    }
                }
            }
            // Handle NOTICE or CLOSED if needed, but OK is standard NIP-01
        });

        ws.on('error', (err) => {
            console.error(`Error on ${url}:`, err.message);
            resolve({ url, success: false, error: err.message });
        });

        // Timeout
        setTimeout(() => {
            if (pending > 0) {
                console.log(`Timeout on ${url}. Pending: ${pending}`);
                ws.close();
                resolve({ url, success: false, timeout: true });
            }
        }, 10000);
    });
}

(async () => {
    const report = [];
    for (const relay of RELAYS) {
        report.push(await testRelay(relay));
    }

    console.log('\n--- FINAL REPORT ---');
    let allGood = true;
    for (const r of report) {
        console.log(`${r.url}: ${r.success ? 'ALL ACCEPTED' : 'SOME FAILED'}`);
        if (!r.success) allGood = false;
    }

    if (allGood) {
        console.log('\nSUCCESS: Both relays accept all kinds.');
        process.exit(0);
    } else {
        console.log('\nFAILURE: Some kinds were rejected.');
        process.exit(1);
    }
})();
