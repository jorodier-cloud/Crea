import assert from 'node:assert/strict';
import test from 'node:test';

import { presignR2Url, presignUrl } from '../dist-test/lib/sigv4.js';

/**
 * Vecteur de test officiel AWS (Signature Version 4, "Query Parameters" —
 * GET presigne sur examplebucket.s3.amazonaws.com/test.txt).
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */
test('la signature reproduit le vecteur de test AWS SigV4', async () => {
  const url = await presignUrl({
    host: 'examplebucket.s3.amazonaws.com',
    canonicalUri: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    method: 'GET',
    expiresIn: 86400,
    region: 'us-east-1',
    service: 's3',
    now: new Date('2013-05-24T00:00:00Z'),
  });

  const signature = new URL(url).searchParams.get('X-Amz-Signature');
  assert.equal(signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('l URL R2 vise le bon hote et encode la cle', async () => {
  const url = await presignR2Url({
    accountId: 'abc123',
    bucket: 'crea-media',
    key: 'u/usr_1/photo suite moorea.png',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: new Date('2026-01-15T10:00:00Z'),
  });

  const parsed = new URL(url);
  assert.equal(parsed.host, 'abc123.r2.cloudflarestorage.com');
  assert.equal(parsed.pathname, '/crea-media/u/usr_1/photo%20suite%20moorea.png');
  assert.equal(parsed.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(parsed.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(parsed.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
});

test('la duree de validite est bornee a sept jours', async () => {
  const url = await presignR2Url({
    accountId: 'abc123',
    bucket: 'crea-media',
    key: 'u/usr_1/a.png',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
    expiresIn: 10_000_000,
  });
  assert.equal(new URL(url).searchParams.get('X-Amz-Expires'), '604800');
});
