import assert from 'node:assert/strict';
import test from 'node:test';

import { decryptSecret, encryptSecret } from '../dist-test/lib/crypto.js';

test('un secret chiffre puis dechiffre redonne le texte original', async () => {
  const encrypted = await encryptSecret('cle-de-test', 'sk_live_exemple');
  assert.notEqual(encrypted, 'sk_live_exemple');
  assert.equal(await decryptSecret('cle-de-test', encrypted), 'sk_live_exemple');
});

test('deux chiffrements du meme texte ne produisent pas la meme sortie (IV aleatoire)', async () => {
  const a = await encryptSecret('cle-de-test', 'sk_live_exemple');
  const b = await encryptSecret('cle-de-test', 'sk_live_exemple');
  assert.notEqual(a, b);
  assert.equal(await decryptSecret('cle-de-test', a), 'sk_live_exemple');
  assert.equal(await decryptSecret('cle-de-test', b), 'sk_live_exemple');
});

test('une mauvaise cle ne dechiffre pas', async () => {
  const encrypted = await encryptSecret('cle-a', 'sk_live_exemple');
  assert.equal(await decryptSecret('cle-b', encrypted), null);
});

test('une valeur corrompue rend null plutot que de lever', async () => {
  assert.equal(await decryptSecret('cle-de-test', 'pas-du-tout-chiffre'), null);
});
