import assert from 'node:assert/strict';
import test from 'node:test';

import { hmacSha256, toHex } from '../dist-test/lib/crypto.js';
import { verifyWebhookSignature } from '../dist-test/lib/stripe.js';

/**
 * Reproduit la signature Stripe : HMAC-SHA256 de `${timestamp}.${payload}`
 * avec le secret de webhook, au meme format que l en-tete `Stripe-Signature`.
 */
async function sign(secret, timestamp, payload) {
  const digest = toHex(await hmacSha256(secret, `${timestamp}.${payload}`));
  return `t=${timestamp},v1=${digest}`;
}

const PAYLOAD = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', payment_status: 'paid' } },
});

test('une signature valide et recente est acceptee', async () => {
  const header = await sign('whsec_test', Math.floor(Date.now() / 1000), PAYLOAD);
  const event = await verifyWebhookSignature(PAYLOAD, header, 'whsec_test');
  assert.equal(event?.id, 'evt_1');
  assert.equal(event?.data.object.payment_status, 'paid');
});

test('une signature produite avec un autre secret est rejetee', async () => {
  const header = await sign('whsec_autre', Math.floor(Date.now() / 1000), PAYLOAD);
  assert.equal(await verifyWebhookSignature(PAYLOAD, header, 'whsec_test'), null);
});

test('une signature perimee (plus de 5 minutes) est rejetee', async () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  const header = await sign('whsec_test', old, PAYLOAD);
  assert.equal(await verifyWebhookSignature(PAYLOAD, header, 'whsec_test'), null);
});

test('un payload modifie apres coup casse la signature', async () => {
  const header = await sign('whsec_test', Math.floor(Date.now() / 1000), PAYLOAD);
  const tampered = PAYLOAD.replace('cs_1', 'cs_2');
  assert.equal(await verifyWebhookSignature(tampered, header, 'whsec_test'), null);
});

test('sans en-tete ou mal forme, aucune signature n est acceptee', async () => {
  assert.equal(await verifyWebhookSignature(PAYLOAD, undefined, 'whsec_test'), null);
  assert.equal(await verifyWebhookSignature(PAYLOAD, 'valeur-quelconque', 'whsec_test'), null);
});
