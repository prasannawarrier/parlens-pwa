/**
 * Kind 1714 Migration Script
 * 
 * Republishes all existing Kind 1714 status events with the listing's geohash tag
 * so they become discoverable via map search.
 * 
 * Usage: Run this script once after deploying the fix.
 * Requirements: Must be run by an owner/manager with signing capability.
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

const KINDS = {
    LISTED_PARKING_METADATA: 31147,
    PARKING_SPOT_LISTING: 31713,
    LISTED_SPOT_LOG: 1714
};

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.nostr.band'
];

async function migrateKind1714Events(privateKeyHex) {
    const pool = new SimplePool();
    const sk = privateKeyHex ? Buffer.from(privateKeyHex, 'hex') : generateSecretKey();
    const pubkey = getPublicKey(sk);

    console.log('[Migration] Starting Kind 1714 geohash migration...');
    console.log('[Migration] Pubkey:', pubkey);

    try {
        // 1. Fetch all listings for this owner
        const listings = await pool.querySync(DEFAULT_RELAYS, {
            kinds: [KINDS.LISTED_PARKING_METADATA],
            authors: [pubkey]
        });

        console.log(`[Migration] Found ${listings.length} listings`);

        for (const listing of listings) {
            const dTag = listing.tags.find(t => t[0] === 'd')?.[1];
            const gTag = listing.tags.find(t => t[0] === 'g')?.[1];
            const locationTag = listing.tags.find(t => t[0] === 'location')?.[1];
            const listingName = listing.tags.find(t => t[0] === 'listing_name')?.[1] || 'Unknown';

            if (!gTag) {
                console.log(`[Migration] Skipping "${listingName}" - no geohash tag`);
                continue;
            }

            console.log(`[Migration] Processing "${listingName}" (geohash: ${gTag})`);

            // 2. Get all spots for this listing
            const aTag = `${KINDS.LISTED_PARKING_METADATA}:${pubkey}:${dTag}`;
            const spots = await pool.querySync(DEFAULT_RELAYS, {
                kinds: [KINDS.PARKING_SPOT_LISTING],
                '#a': [aTag]
            });

            console.log(`[Migration]   Found ${spots.length} spots`);

            for (const spot of spots) {
                const spotDTag = spot.tags.find(t => t[0] === 'd')?.[1];
                const spotATag = `${KINDS.PARKING_SPOT_LISTING}:${spot.pubkey}:${spotDTag}`;
                const typeTag = spot.tags.find(t => t[0] === 'type')?.[1] || 'car';

                // 3. Get latest status for this spot
                const statusEvents = await pool.querySync(DEFAULT_RELAYS, {
                    kinds: [KINDS.LISTED_SPOT_LOG],
                    '#a': [spotATag],
                    limit: 1
                });

                if (statusEvents.length === 0) {
                    console.log(`[Migration]   Spot ${spotDTag}: No status events, creating initial 'open'`);
                    // Create initial open status
                    const newEvent = {
                        kind: KINDS.LISTED_SPOT_LOG,
                        created_at: Math.floor(Date.now() / 1000),
                        tags: [
                            ['a', spotATag],
                            ['status', 'open'],
                            ['updated_by', pubkey],
                            ['client', 'parlens-migration'],
                            ['location', locationTag || ''],
                            ['g', gTag],
                            ['type', typeTag]
                        ],
                        content: JSON.stringify({ status: 'open', migrated: true })
                    };

                    const signed = finalizeEvent(newEvent, sk);
                    await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signed));
                    console.log(`[Migration]   ✓ Created initial status for ${spotDTag}`);
                } else {
                    const latestStatus = statusEvents[0];
                    const existingG = latestStatus.tags.find(t => t[0] === 'g')?.[1];

                    if (existingG === gTag) {
                        console.log(`[Migration]   Spot ${spotDTag}: Already has correct geohash, skipping`);
                        continue;
                    }

                    const statusValue = latestStatus.tags.find(t => t[0] === 'status')?.[1] || 'open';

                    console.log(`[Migration]   Spot ${spotDTag}: Republishing with geohash (status: ${statusValue})`);

                    // Republish with geohash
                    const newEvent = {
                        kind: KINDS.LISTED_SPOT_LOG,
                        created_at: Math.floor(Date.now() / 1000),
                        tags: [
                            ['a', spotATag],
                            ['status', statusValue],
                            ['updated_by', pubkey],
                            ['client', 'parlens-migration'],
                            ['location', locationTag || ''],
                            ['g', gTag],
                            ['type', typeTag]
                        ],
                        content: latestStatus.content || JSON.stringify({ status: statusValue, migrated: true })
                    };

                    const signed = finalizeEvent(newEvent, sk);
                    await Promise.allSettled(pool.publish(DEFAULT_RELAYS, signed));
                    console.log(`[Migration]   ✓ Republished ${spotDTag}`);
                }
            }
        }

        console.log('[Migration] Complete!');
    } catch (error) {
        console.error('[Migration] Error:', error);
    } finally {
        pool.close(DEFAULT_RELAYS);
    }
}

// Run with your private key (hex format, no 'nsec' prefix)
// migrateKind1714Events('your-private-key-hex-here');

export { migrateKind1714Events };
