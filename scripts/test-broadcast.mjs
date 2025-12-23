#!/usr/bin/env node
/**
 * Test script for Parlens Open Spot Broadcast
 * Tests Kind 31714 addressable events with anonymous keypair
 */

import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

const KIND_OPEN_SPOT = 31714;

async function testBroadcast() {
    console.log('=== Parlens Open Spot Broadcast Test ===\n');

    const pool = new SimplePool();

    // Generate anonymous keypair
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey);
    console.log('Generated anonymous pubkey:', pubkey.substring(0, 16) + '...');

    const now = Math.floor(Date.now() / 1000);
    const testGeohash = 'tdr1w'; // Bangalore area

    // Create test event
    const eventTemplate = {
        kind: KIND_OPEN_SPOT,
        content: '',
        tags: [
            ['d', `spot_${testGeohash}_${now}`],
            ['g', testGeohash],
            ['location', '12.9716,77.5946'],
            ['hourly_rate', '10.00'],
            ['currency', 'INR'],
            ['type', 'car'],
            ['expiration', String(now + 300)], // 5 minutes
            ['client', 'parlens']
        ],
        created_at: now,
    };

    const signedEvent = finalizeEvent(eventTemplate, privkey);
    console.log('\nEvent created:');
    console.log('  ID:', signedEvent.id);
    console.log('  Kind:', signedEvent.kind);
    console.log('  Pubkey:', signedEvent.pubkey.substring(0, 16) + '...');
    console.log('  Tags:', signedEvent.tags.map(t => t[0]).join(', '));

    // Publish
    console.log('\nPublishing to relays...');
    const pubs = pool.publish(RELAYS, signedEvent);

    // Wait for publish results
    const results = await Promise.allSettled(pubs);
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            console.log(`  ✓ ${RELAYS[i]} - accepted`);
        } else {
            console.log(`  ✗ ${RELAYS[i]} - rejected: ${result.reason}`);
        }
    });

    // Wait a moment for propagation
    console.log('\nWaiting 2s for propagation...');
    await new Promise(r => setTimeout(r, 2000));

    // Query for the event
    console.log('\nQuerying for Kind 31714 events with #client: parlens...');

    const events = await pool.querySync(
        RELAYS,
        {
            kinds: [KIND_OPEN_SPOT],
            '#client': ['parlens'],
            since: now - 300
        }
    );

    console.log(`\nReceived ${events.length} event(s):`);
    events.forEach(event => {
        const locTag = event.tags.find(t => t[0] === 'location');
        const expTag = event.tags.find(t => t[0] === 'expiration');
        console.log(`  - ID: ${event.id.substring(0, 16)}...`);
        console.log(`    Kind: ${event.kind}`);
        console.log(`    Location: ${locTag?.[1] || 'N/A'}`);
        console.log(`    Expiration: ${expTag?.[1] || 'N/A'}`);
        console.log(`    Created: ${new Date(event.created_at * 1000).toISOString()}`);
    });

    // Also try querying by geohash
    console.log('\nQuerying by #g tag (geohash)...');
    const geoEvents = await pool.querySync(
        RELAYS,
        {
            kinds: [KIND_OPEN_SPOT],
            '#g': [testGeohash],
            since: now - 300
        }
    );
    console.log(`Received ${geoEvents.length} event(s) by geohash`);

    pool.close(RELAYS);
    console.log('\n=== Test Complete ===');
}

testBroadcast().catch(console.error);
