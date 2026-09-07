#!/usr/bin/env node
/**
 * Generate a fresh Nostr keypair for a Buzz agent.
 * Prints hex pubkey/secret and npub/nsec bech32 forms.
 */
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { npubEncode, nsecEncode } from 'nostr-tools/nip19';
import { bytesToHex } from '@noble/hashes/utils.js';

const sk = generateSecretKey();
const pk = getPublicKey(sk);

console.log('=== Buzz agent keypair ===');
console.log('');
console.log('pubkey (hex):', pk);
console.log('secret (hex):', bytesToHex(sk));
console.log('');
console.log('npub:', npubEncode(pk));
console.log('nsec:', nsecEncode(sk));
console.log('');
console.log('Set BUZZ_PRIVATE_KEY to the secret hex or nsec value.');
console.log('Add this pubkey as a Buzz community member before the agent can post.');
