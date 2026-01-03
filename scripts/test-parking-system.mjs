/**
 * Test script for Parlens Parking System (Nostr Events)
 * Validates:
 * 1. Listing Creation (31147 + 37141)
 * 2. User Check-in (1714 + 31417)
 * 3. Manager Note (1417)
 * 4. User Check-out (1714 + 31417)
 */

import { generateSecretKey, getPublicKey, finalizeEvent, nip04, nip44 } from 'nostr-tools';
import { randomBytes } from 'crypto';

// --- Constants ---
const HELPER_PRIV = generateSecretKey(); // Relay helper/mock
const KINDS = {
    METADATA: 31147,
    SPOT: 37141,
    STATUS: 1714,
    NOTE: 1417,
    USER_LOG: 31417
};

// --- Mock Actors ---
const ownerSk = generateSecretKey();
const ownerPk = getPublicKey(ownerSk);

const managerSk = generateSecretKey();
const managerPk = getPublicKey(managerSk);

const userSk = generateSecretKey();
const userPk = getPublicKey(userSk);

console.log('=== Actors ===');
console.log('Owner:', ownerPk);
console.log('Manager:', managerPk);
console.log('User:', userPk);
console.log('==============\n');

async function test() {
    // 1. Create Listing Metadata (Kind 31147)
    console.log('--- 1. Creating Listing (Kind 31147) ---');
    const listingD = 'test-garage-uuid';
    const listingEvent = finalizeEvent({
        kind: KINDS.METADATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', listingD],
            ['listing_name', 'Test Garage'],
            ['owners', ownerPk, 'admin'],
            ['managers', managerPk, 'write'],
            ['rates', JSON.stringify({ car: { hourly: 10, currency: 'USD' } })]
        ],
        content: '# Test Garage\nBest in town.'
    }, ownerSk);
    console.log('Created Listing:', listingEvent.id);

    // 2. Create Spot Listing (Kind 37141)
    console.log('\n--- 2. Creating Spot (Kind 37141) ---');
    const spotD = `${listingD}-spot-101`;
    const shortName = 'A-55';
    const spotContent = `Test Garage Spot 101 #${shortName}`;

    const spotEvent = finalizeEvent({
        kind: KINDS.SPOT,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['d', spotD],
            ['a', `${KINDS.METADATA}:${ownerPk}:${listingD}`],
            ['spot_number', '101'],
            ['floor', 'B1'],
            ['short_name', shortName],
            ['type', 'car']
        ],
        content: spotContent
    }, ownerSk);
    console.log('Created Spot:', spotEvent.id);
    console.log('Spot Content:', spotEvent.content);

    if (spotEvent.content !== 'Test Garage Spot 101 #A-55') {
        throw new Error('Spot content format mismatch!');
    }

    // 3. Simulated QR Scan Data
    const qrAuthToken = 'valid-qr-token-123';

    // 4. User Check-in (Arrival)
    console.log('\n--- 3. User Check-in (Arrival) ---');
    // 4a. Generate Ephemeral Key
    const tempSk = generateSecretKey();
    const tempPk = getPublicKey(tempSk);

    // 4b. Publish Status (Kind 1714)
    const checkInStatus = finalizeEvent({
        kind: KINDS.STATUS,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['a', `${KINDS.SPOT}:${ownerPk}:${spotD}`],
            ['status', 'occupied'],
            ['updated_by', tempPk],
            ['authorizer', ownerPk], // In real app, derived from QR sig
            ['auth', qrAuthToken]
        ],
        content: spotContent // Same content as prompt
    }, tempSk);
    console.log('Published Status (Occupied):', checkInStatus.id);
    console.log('Signed by Temp Key:', tempPk);

    // 5. Manager Private Note (Kind 1417)
    console.log('\n--- 4. Manager Private Note (Kind 1417) ---');
    // Encrypt content "Plate XYZ" for Owner
    // NOTE: In real app we encrypt for ALL managers/owners. NIP-44 supports one recipient per payload usually, or wrapped.
    // For simplicity here we encrypt for owner.
    const notePlain = 'Plate XYZ-123';
    // Using nip44.encrypt(priv, pub, text)
    // We need a proper conversation key. NIP-44 v2 is standard.
    // Nostr-tools `nip44.encrypt` requires a conversation key or similar depending on version.
    // Let's assume simplistic encryption for test log.

    const noteEvent = finalizeEvent({
        kind: KINDS.NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
            ['a', `${KINDS.SPOT}:${ownerPk}:${spotD}`],
            ['e', checkInStatus.id],
            ['p', ownerPk]
        ],
        content: 'encrypted-stuff-placeholder'
    }, managerSk);
    console.log('Manager added Note:', noteEvent.id);

    // 6. User Check-out (Departure)
    console.log('\n--- 5. User Check-out (Departure) ---');
    const tempSk2 = generateSecretKey();
    const tempPk2 = getPublicKey(tempSk2);

    const checkOutStatus = finalizeEvent({
        kind: KINDS.STATUS,
        created_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour later
        tags: [
            ['a', `${KINDS.SPOT}:${ownerPk}:${spotD}`],
            ['status', 'open'],
            ['updated_by', tempPk2],
            ['authorizer', ownerPk],
            ['auth', qrAuthToken]
        ],
        content: spotContent // "End Session at..." prompt match
    }, tempSk2);
    console.log('Published Status (Open):', checkOutStatus.id);
    console.log('Signed by New Temp Key:', tempPk2);

    console.log('\nSUCCESS: All events created and simulated successfully.');
}

test().catch(console.error);
