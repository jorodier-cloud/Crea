const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Identifiant court, stable et utilisable comme ancre HTML.
 * Fonctionne dans les Workers, le navigateur et Node (crypto global).
 */
export function createId(prefix = 'n'): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}
