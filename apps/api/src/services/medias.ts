import { createId } from '@crea/schema';

import type { Env } from '../env.js';
import { badRequest, notFound } from '../lib/http.js';

export interface MediaRow {
  id: string;
  user_id: string;
  original_name: string;
  r2_key: string;
  r2_public_url: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: number;
}

export interface Media {
  id: string;
  originalName: string;
  key: string;
  url: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: number;
}

export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
] as const;

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function toMedia(row: MediaRow): Media {
  return {
    id: row.id,
    originalName: row.original_name,
    key: row.r2_key,
    url: row.r2_public_url,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function assertAllowedType(contentType: string): void {
  if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(contentType)) {
    throw badRequest(
      `Type de fichier non autorise : ${contentType}. Autorises : ${ALLOWED_MEDIA_TYPES.join(', ')}.`,
    );
  }
}

/** Nom de fichier assaini, prefixe par l utilisateur pour cloisonner le bucket. */
export function buildObjectKey(userId: string, originalName: string): string {
  const safeName = originalName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(-80)
    .toLowerCase();
  return `u/${userId}/${createId('m')}-${safeName || 'fichier'}`;
}

/** La cle doit rester dans l espace de l utilisateur : garde-fou anti-traversee. */
export function assertOwnedKey(userId: string, key: string): void {
  if (!key.startsWith(`u/${userId}/`) || key.includes('..')) {
    throw badRequest('Cle d objet invalide.');
  }
}

export function publicUrlFor(env: Env, key: string): string {
  const base = (env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/${key}`;
}

export async function insertMedia(
  env: Env,
  userId: string,
  input: {
    originalName: string;
    key: string;
    contentType: string | null;
    sizeBytes: number | null;
  },
): Promise<Media> {
  const id = createId('med');
  const url = publicUrlFor(env, input.key);

  await env.DB.prepare(
    `INSERT INTO Medias (id, user_id, original_name, r2_key, r2_public_url, content_type, size_bytes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (r2_key) DO UPDATE SET
       original_name = excluded.original_name,
       content_type  = excluded.content_type,
       size_bytes    = excluded.size_bytes`,
  )
    .bind(
      id,
      userId,
      input.originalName,
      input.key,
      url,
      input.contentType,
      input.sizeBytes,
    )
    .run();

  const row = await env.DB.prepare('SELECT * FROM Medias WHERE r2_key = ?1 AND user_id = ?2')
    .bind(input.key, userId)
    .first<MediaRow>();
  if (!row) throw notFound('Media introuvable apres insertion.');
  return toMedia(row);
}

export async function listMedias(env: Env, userId: string): Promise<Media[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM Medias WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 300',
  )
    .bind(userId)
    .all<MediaRow>();
  return (results ?? []).map(toMedia);
}

export async function getMedia(env: Env, userId: string, id: string): Promise<MediaRow> {
  const row = await env.DB.prepare('SELECT * FROM Medias WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first<MediaRow>();
  if (!row) throw notFound('Media introuvable.');
  return row;
}

export async function deleteMedia(env: Env, userId: string, id: string): Promise<void> {
  const row = await getMedia(env, userId, id);
  await env.MEDIA_BUCKET.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM Medias WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
}
