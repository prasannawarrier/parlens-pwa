#!/usr/bin/env node
/**
 * Test script - Simulates full broadcast and search flow
 */

import { SimplePool, finalizeEvent, generateSecretKey } from 'nostr-tools';

const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
];

const KIND = 31714;

// Bangalore geohash (5 char precision)
const GEOHASH = 'tdr1w';

async function test() {
    console.log('=== Full Broadcast & Search Test ===\n');

    const pool = new SimplePool();
    const privkey = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    // Create event
    const event = finalizeEvent({
        kind: KIND,
        content: '',
        tags: [
            ['d', `spot_${GEOHASH}_${now}`],
            ['g', GEOHASH],
            ['location', '12.9716,77.5946'],
            ['hourly_rate', '25.00'],
            ['currency', 'INR'],
            ['type', 'car'],
            ['expiration', String(now + 300)],
            ['client', 'parlens']
        ],
        created_at: now,
    }, privkey);

    console.log('Event ID:', event.id);
    console.log('Pubkey:', event.pubkey.substring(0, 20) + '...');
    console.log('Geohash:', GEOHASH);
    console.log('Expiration:', new Date((now + 300) * 1000).toLocaleTimeString());

    // Publish
    console.log('\n--- Publishing ---');
    const pubs = pool.publish(RELAYS, event);
    await Promise.allSettled(pubs);
    console.log('Published to all relays');

    // Wait
    console.log('\nWaiting 3s...\n');
    await new Promise(r => setTimeout(r, 3000));

    // Query with exact filter app uses
    console.log('--- Querying (same filter as app) ---');
    console.log('Kind:', KIND);
    console.log('Geohash filter:', [GEOHASH]);
    console.log('Since:', now - 300);

    const events = await pool.querySync(
        RELAYS,
        {
            kinds: [KIND],
            '#g': [GEOHASH],
            since: now - 300
        }
    );

    console.log('\n--- Results ---');
    console.log('Events found:', events.length);

    events.forEach((e, i) => {
        console.log(`\nEvent ${i + 1}:`);
        console.log('  ID:', e.id.substring(0, 20) + '...');
        console.log('  Kind:', e.kind);
        console.log('  Created:', new Date(e.created_at * 1000).toLocaleTimeString());

        const loc = e.tags.find(t => t[0] === 'location');
        const exp = e.tags.find(t => t[0] === 'expiration');
        const g = e.tags.find(t => t[0] === 'g');

        console.log('  Geohash:', g?.[1]);
        console.log('  Location:', loc?.[1]);
        console.log('  Expiration:', exp ? new Date(parseInt(exp[1]) * 1000).toLocaleTimeString() : 'none');
    });

    // Check if our event is there
    const ours = events.find(e => e.id === event.id);
    console.log('\n--- Verification ---');
    console.log('Our event found:', ours ? 'YES ✓' : 'NO ✗');

    pool.close(RELAYS);
    console.log('\n=== Test Complete ===');
}

test().catch(console.error);
