import { toHex } from './crypto.js';

/**
 * Signature AWS SigV4 en query string, pour generer des URL presignees R2.
 *
 * L upload va directement du navigateur vers R2 : le Worker ne voit jamais
 * l octet du fichier, il ne fait que signer. Aucune dependance externe.
 */

const encoder = new TextEncoder();

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(message)));
}

/** Encodage RFC 3986 : `encodeURIComponent` laisse passer ! ' ( ) *. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) => rfc3986(segment))
    .join('/');
}

function amzDate(date: Date): { full: string; short: string } {
  const full = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { full, short: full.slice(0, 8) };
}

export interface SignInput {
  host: string;
  /** Chemin deja encode, commencant par "/". */
  canonicalUri: string;
  accessKeyId: string;
  secretAccessKey: string;
  method?: 'PUT' | 'GET' | 'DELETE';
  expiresIn?: number;
  region?: string;
  service?: string;
  now?: Date;
}

/**
 * Coeur de la signature, isole de R2 pour rester verifiable contre les
 * vecteurs de test officiels AWS (voir test/sigv4.test.mjs).
 */
export async function presignUrl({
  host,
  canonicalUri,
  accessKeyId,
  secretAccessKey,
  method = 'PUT',
  expiresIn = 900,
  region = 'auto',
  service = 's3',
  now = new Date(),
}: SignInput): Promise<string> {
  const { full, short } = amzDate(now);
  const scope = `${short}/${region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': full,
    'X-Amz-Expires': String(Math.max(1, Math.min(expiresIn, 604800))),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${rfc3986(name)}=${rfc3986(query[name]!)}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), short);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface PresignInput {
  accountId: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  method?: 'PUT' | 'GET' | 'DELETE';
  expiresIn?: number;
  now?: Date;
}

/** URL R2 signee, valable `expiresIn` secondes. */
export function presignR2Url({
  accountId,
  bucket,
  key,
  ...rest
}: PresignInput): Promise<string> {
  return presignUrl({
    ...rest,
    host: `${accountId}.r2.cloudflarestorage.com`,
    canonicalUri: `/${rfc3986(bucket)}/${encodePath(key)}`,
    region: 'auto',
    service: 's3',
  });
}
