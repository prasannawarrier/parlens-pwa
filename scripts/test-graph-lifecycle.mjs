#!/usr/bin/env node

/**
 * Graph Lifecycle Test Script
 * Tests the Explicit Entity data model by:
 * 1. Creating a listing with spots
 * 2. Verifying the graph structure (root tags, parent links)
 * 3. Deleting all events (cleanup)
 * 4. Verifying deletion
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

const RELAYS = ['wss://relay.primal.net', 'wss://nos.lol'];

const KINDS = {
    LISTED_PARKING_METADATA: 31147,
    PARKING_SPOT_LISTING: 37141,
    LISTED_SPOT_LOG: 1714,
    DELETION: 5
};

async function runTest() {
    console.log('=== Graph Lifecycle Test ===\n');

    // Generate test key
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    console.log('Test pubkey:', pk.slice(0, 16) + '...');

    const pool = new SimplePool();
    const createdEventIds = [];
    const listingId = `test-${Date.now()}`;
    const listingATag = `${KINDS.LISTED_PARKING_METADATA}:${pk}:${listingId}`;

    try {
        // === PHASE 1: CREATE ===
        console.log('\n--- Phase 1: Create Graph ---');

        // Create Parent Listing (Kind 31147)
        const listingEvent = {
            kind: KINDS.LISTED_PARKING_METADATA,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['d', listingId],
                ['listing_name', 'Test Listing'],
                ['location', '12.9716,77.5946'],
                ['total_spots', '3'],
                ['client', 'parlens-test']
            ],
            content: ''
        };
        const signedListing = finalizeEvent(listingEvent, sk);
        await Promise.allSettled(pool.publish(RELAYS, signedListing));
        createdEventIds.push(signedListing.id);
        console.log('✓ Created Listing:', signedListing.id.slice(0, 16) + '...');

        // Create 3 Spots (Kind 37141)
        const spotIds = [];
        for (let i = 1; i <= 3; i++) {
            const spotId = `${listingId}-spot-${i}`;
            spotIds.push(spotId);

            const spotEvent = {
                kind: KINDS.PARKING_SPOT_LISTING,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', spotId],
                    ['a', listingATag],
                    ['spot_number', String(i)],
                    ['type', 'car'],
                    ['client', 'parlens-test']
                ],
                content: `Spot #${i}`
            };
            const signedSpot = finalizeEvent(spotEvent, sk);
            await Promise.allSettled(pool.publish(RELAYS, signedSpot));
            createdEventIds.push(signedSpot.id);
            console.log(`✓ Created Spot ${i}:`, signedSpot.id.slice(0, 16) + '...');

            // Create Status (Kind 1714) with root tag
            const spotATag = `${KINDS.PARKING_SPOT_LISTING}:${pk}:${spotId}`;
            const statusEvent = {
                kind: KINDS.LISTED_SPOT_LOG,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['a', spotATag],
                    ['a', listingATag, '', 'root'],
                    ['status', 'open'],
                    ['type', 'car'],
                    ['g', '12345'],
                    ['client', 'parlens-test']
                ],
                content: JSON.stringify({ status: 'open' })
            };
            const signedStatus = finalizeEvent(statusEvent, sk);
            await Promise.allSettled(pool.publish(RELAYS, signedStatus));
            createdEventIds.push(signedStatus.id);
            console.log(`✓ Created Status ${i}:`, signedStatus.id.slice(0, 16) + '...');
        }

        console.log(`\nTotal events created: ${createdEventIds.length}`);

        // === PHASE 2: VERIFY ===
        console.log('\n--- Phase 2: Verify Graph ---');
        await new Promise(r => setTimeout(r, 2000)); // Wait for relay propagation

        // Query Spots by parent listing
        const spotsFound = await pool.querySync(RELAYS, {
            kinds: [KINDS.PARKING_SPOT_LISTING],
            '#a': [listingATag]
        });
        console.log(`Spots found by parent tag: ${spotsFound.length} (expected: 3)`);

        // Query Status by parent listing (root tag)
        const statusFound = await pool.querySync(RELAYS, {
            kinds: [KINDS.LISTED_SPOT_LOG],
            '#a': [listingATag]
        });
        console.log(`Status events found by root tag: ${statusFound.length} (expected: 3)`);

        // Verify root tags exist
        let rootTagsFound = 0;
        for (const status of statusFound) {
            const rootTag = status.tags.find(t => t[0] === 'a' && t[3] === 'root');
            if (rootTag) rootTagsFound++;
        }
        console.log(`Status events with root tag: ${rootTagsFound} (expected: 3)`);

        const verifyPassed = spotsFound.length === 3 && statusFound.length === 3 && rootTagsFound === 3;
        console.log(verifyPassed ? '\n✓ VERIFICATION PASSED' : '\n✗ VERIFICATION FAILED');

        // === PHASE 3: DELETE ===
        console.log('\n--- Phase 3: Delete (Cleanup) ---');

        for (const eventId of createdEventIds) {
            const deleteEvent = {
                kind: KINDS.DELETION,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['e', eventId]],
                content: 'Test cleanup'
            };
            const signedDelete = finalizeEvent(deleteEvent, sk);
            await Promise.allSettled(pool.publish(RELAYS, signedDelete));
        }
        console.log(`✓ Published ${createdEventIds.length} deletion events`);

        // === PHASE 4: VERIFY DELETION ===
        console.log('\n--- Phase 4: Verify Deletion ---');
        await new Promise(r => setTimeout(r, 2000)); // Wait for relay propagation

        const spotsAfterDelete = await pool.querySync(RELAYS, {
            kinds: [KINDS.PARKING_SPOT_LISTING],
            '#a': [listingATag]
        });
        const statusAfterDelete = await pool.querySync(RELAYS, {
            kinds: [KINDS.LISTED_SPOT_LOG],
            '#a': [listingATag]
        });

        console.log(`Spots remaining: ${spotsAfterDelete.length} (expected: 0 or relay-dependent)`);
        console.log(`Status events remaining: ${statusAfterDelete.length} (expected: 0 or relay-dependent)`);

        // Note: Some relays may not process deletions or may cache events
        const deletePassed = spotsAfterDelete.length === 0 && statusAfterDelete.length === 0;
        console.log(deletePassed
            ? '\n✓ DELETION VERIFIED (events removed)'
            : '\n⚠ DELETION SENT (relay may cache events temporarily)');

        console.log('\n=== Test Complete ===');
        console.log(`Summary: Created ${createdEventIds.length} events, sent ${createdEventIds.length} deletions`);

    } catch (e) {
        console.error('Test failed:', e);
    } finally {
        pool.close(RELAYS);
    }
}

runTest().catch(console.error);
