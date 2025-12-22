/**
 * Test script to verify Nostr event publishing and retrieval
 * Run with: node scripts/test-nostr.mjs
 */

import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent, nip44 } from 'nostr-tools';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social'];
const KIND_PARKING_LOG = 31012;

async function testNostrFlow() {
    console.log('🧪 Testing Nostr Event Publishing and Retrieval\n');

    // Generate a test keypair
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey);
    console.log(`📍 Test Pubkey: ${pubkey.slice(0, 16)}...`);

    const pool = new SimplePool();
    const timestamp = Math.floor(Date.now() / 1000);

    // Create test log content
    const logContent = {
        status: 'vacated',
        lat: 37.7749,
        lon: -122.4194,
        geohash: '9q8yyr9kbp',
        fee: '10',
        currency: 'USD',
        finished_at: timestamp
    };

    // Encrypt using NIP-44
    console.log('\n🔐 Encrypting content with NIP-44...');
    const json = JSON.stringify(logContent);
    const conversationKey = nip44.getConversationKey(privkey, pubkey);
    const encryptedContent = nip44.encrypt(json, conversationKey);
    console.log(`   Encrypted: ${encryptedContent.slice(0, 50)}...`);

    // Create the event
    const eventTemplate = {
        kind: KIND_PARKING_LOG,
        content: encryptedContent,
        tags: [
            ['g', '9q8yyr9kbp'],
            ['client', 'parlens-test'],
            ['d', `session_${timestamp}`]
        ],
        created_at: timestamp,
        pubkey: pubkey,
    };

    // Sign the event
    console.log('\n✍️  Signing event...');
    const signedEvent = finalizeEvent(eventTemplate, privkey);
    console.log(`   Event ID: ${signedEvent.id}`);
    console.log(`   Signature: ${signedEvent.sig.slice(0, 50)}...`);

    // Publish to relays
    console.log('\n📤 Publishing to relays...');
    const publishPromises = pool.publish(RELAYS, signedEvent);

    let successCount = 0;
    for (const p of publishPromises) {
        try {
            await p;
            successCount++;
        } catch (e) {
            console.log(`   ❌ Relay failed: ${e.message || e}`);
        }
    }
    console.log(`   ✅ Published to ${successCount}/${RELAYS.length} relays`);

    // Wait for relays to propagate
    console.log('\n⏳ Waiting 3 seconds for relay propagation...');
    await new Promise(r => setTimeout(r, 3000));

    // Retrieve the event
    console.log('\n📥 Retrieving events from relays...');
    const events = await pool.querySync(RELAYS, {
        kinds: [KIND_PARKING_LOG],
        authors: [pubkey],
    });

    console.log(`   Found ${events.length} event(s)`);

    if (events.length > 0) {
        const event = events[0];
        console.log(`   Event ID: ${event.id}`);
        console.log(`   Created At: ${new Date(event.created_at * 1000).toISOString()}`);

        // Decrypt the content
        console.log('\n🔓 Decrypting content...');
        try {
            const decrypted = nip44.decrypt(event.content, conversationKey);
            const parsed = JSON.parse(decrypted);
            console.log('   Decrypted content:', parsed);
        } catch (e) {
            console.log(`   ❌ Decryption failed: ${e.message}`);
        }
    }

    // Test summary
    console.log('\n' + '='.repeat(50));
    if (events.length > 0) {
        console.log('✅ TEST PASSED: Event was published and retrieved successfully!');
    } else {
        console.log('❌ TEST FAILED: Event was not found on relays.');
        console.log('   Possible causes:');
        console.log('   - Relay connection issues');
        console.log('   - Event rejected by relays');
        console.log('   - Propagation delay (try again)');
    }

    pool.close(RELAYS);
    process.exit(events.length > 0 ? 0 : 1);
}

testNostrFlow().catch(console.error);
