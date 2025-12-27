#!/usr/bin/env node
/**
 * Test script for Parlens Open Spot (Kind 31714) broadcast and query
 * Run with: node scripts/test-open-spots.mjs
 */

import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.nostr.band',
    'wss://nostr.wine',
];

const KINDS = {
    OPEN_SPOT_BROADCAST: 31714,
};

// Simple geohash encoder (matching the app's implementation)
function encodeGeohash(lat, lng, precision = 5) {
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

async function main() {
    console.log('=== Parlens Open Spot Test ===\n');

    const pool = new SimplePool();

    // Test location (Bangalore, India area)
    const testLat = 12.9716;
    const testLon = 77.5946;
    const geohash = encodeGeohash(testLat, testLon, 5);

    console.log('Test Location:', testLat, testLon);
    console.log('Geohash (precision 5):', geohash);
    console.log('Relays:', DEFAULT_RELAYS.join(', '));
    console.log('');

    // Step 1: Pre-connect to relays
    console.log('--- Step 1: Pre-connecting to relays ---');
    for (const url of DEFAULT_RELAYS) {
        try {
            await pool.ensureRelay(url);
            console.log(`✓ Connected to ${url}`);
        } catch (e) {
            console.log(`✗ Failed to connect to ${url}: ${e.message}`);
        }
    }
    console.log('');

    // Step 2: Create and publish test open spot
    console.log('--- Step 2: Publishing test open spot (Kind 31714) ---');
    const anonPrivkey = generateSecretKey();
    const anonPubkey = getPublicKey(anonPrivkey);
    const now = Math.floor(Date.now() / 1000);
    const expirationTime = now + 300; // 5 minutes

    const broadcastEventTemplate = {
        kind: KINDS.OPEN_SPOT_BROADCAST,
        content: '',
        tags: [
            ['d', `test_spot_${geohash}_${now}`],
            ['g', geohash],
            ['location', `${testLat},${testLon}`],
            ['hourly_rate', '50.00'],
            ['currency', 'INR'],
            ['type', 'car'],
            ['expiration', String(expirationTime)],
            ['client', 'parlens-test']
        ],
        created_at: now,
    };

    const signedBroadcast = finalizeEvent(broadcastEventTemplate, anonPrivkey);

    console.log('Event ID:', signedBroadcast.id);
    console.log('Pubkey:', anonPubkey.substring(0, 20) + '...');
    console.log('Tags:', JSON.stringify(signedBroadcast.tags, null, 2));

    const pubs = pool.publish(DEFAULT_RELAYS, signedBroadcast);
    const results = await Promise.allSettled(pubs);

    let successCount = 0;
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            console.log(`✓ Published to ${DEFAULT_RELAYS[i]}`);
            successCount++;
        } else {
            console.log(`✗ Failed to publish to ${DEFAULT_RELAYS[i]}: ${result.reason}`);
        }
    });
    console.log(`Published to ${successCount}/${DEFAULT_RELAYS.length} relays`);
    console.log('');

    // Wait a moment for propagation
    console.log('Waiting 2 seconds for relay propagation...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Query for the open spot
    console.log('--- Step 3: Querying for open spots (Kind 31714) ---');
    console.log('Query filter: { kinds: [31714], #g: [' + geohash + '], since: ' + (now - 300) + ' }');

    try {
        const events = await pool.querySync(DEFAULT_RELAYS, {
            kinds: [KINDS.OPEN_SPOT_BROADCAST],
            '#g': [geohash],
            since: now - 300
        });

        console.log(`\n✓ Query returned ${events.length} event(s)`);

        if (events.length > 0) {
            console.log('\nFound events:');
            events.forEach((event, i) => {
                const locTag = event.tags.find(t => t[0] === 'location');
                const typeTag = event.tags.find(t => t[0] === 'type');
                const priceTag = event.tags.find(t => t[0] === 'hourly_rate');
                console.log(`  ${i + 1}. ID: ${event.id.substring(0, 16)}... | Location: ${locTag?.[1]} | Type: ${typeTag?.[1]} | Rate: ${priceTag?.[1]}`);
            });

            // Check if our test event is in the results
            const ourEvent = events.find(e => e.id === signedBroadcast.id);
            if (ourEvent) {
                console.log('\n✓✓✓ SUCCESS: Our test event was found in query results!');
            } else {
                console.log('\n⚠ Our test event was NOT found. Other events exist in this geohash area.');
            }
        } else {
            console.log('\n✗ No events found. This could mean:');
            console.log('  1. The broadcast failed to reach all relays');
            console.log('  2. Relay propagation is slow');
            console.log('  3. Geohash filtering is not working as expected');
        }
    } catch (e) {
        console.log('✗ Query failed:', e.message);
    }

    console.log('\n=== Test Complete ===');

    // Close pool
    pool.close(DEFAULT_RELAYS);
    process.exit(0);
}

main().catch(console.error);
