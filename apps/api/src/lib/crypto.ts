/** Primitives cryptographiques bâties sur la WebCrypto des Workers. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Jeton opaque a usage unique (magic link). */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(signature);
}

/** Comparaison a temps constant, pour ne pas fuiter d information par timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Chiffrement au repos des cles Stripe saisies par chaque proprietaire de
 * site (voir services/payments.ts). `SESSION_SECRET` sert deja de sel aux
 * empreintes d IP ; ici il faut un vrai chiffrement reversible puisque la
 * cle secrete doit repartir en clair vers l API Stripe au moment de creer
 * une session de paiement — d ou une cle dediee (`PAYMENTS_ENCRYPTION_KEY`)
 * plutot que de reutiliser `SESSION_SECRET`, pour ne pas faire deux usages
 * d un seul secret.
 */
async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Chiffre `plaintext`. IV aleatoire prefixe au texte chiffre, le tout en base64url. */
export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return toBase64Url(combined);
}

/** Inverse de `encryptSecret`. `null` si le texte est illisible (cle changee, corruption). */
export async function decryptSecret(secret: string, encoded: string): Promise<string | null> {
  try {
    const key = await encryptionKey(secret);
    const combined = fromBase64Url(encoded);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}

export interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

const JWT_HEADER = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

/** Emet un JWT HS256. */
export async function signSession(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = toBase64Url(encoder.encode(JSON.stringify(full)));
  const data = `${JWT_HEADER}.${body}`;
  const signature = toBase64Url(await hmacSha256(secret, data));
  return `${data}.${signature}`;
}

/** Verifie signature et expiration. Retourne `null` si le jeton est invalide. */
export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (header !== JWT_HEADER) return null;

  const expected = toBase64Url(await hmacSha256(secret, `${header}.${body}`));
  if (!timingSafeEqual(expected, signature)) return null;

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
