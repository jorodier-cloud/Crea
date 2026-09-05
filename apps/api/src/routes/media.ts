import { Hono } from 'hono';

import type { AppBindings } from '../env.js';
import { badRequest, notFound, readJson, requireString, serverError } from '../lib/http.js';
import { presignR2Url } from '../lib/sigv4.js';
import { requireAuth } from '../middleware/auth.js';
import {
  assertAllowedType,
  assertOwnedKey,
  buildObjectKey,
  deleteMedia,
  insertMedia,
  listMedias,
  publicUrlFor,
  MAX_MEDIA_BYTES,
} from '../services/medias.js';

export const mediaRoutes = new Hono<AppBindings>();

const PRESIGN_TTL_SECONDS = 900;

function hasS3Credentials(env: AppBindings['Bindings']): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

/**
 * URL d upload direct navigateur -> R2.
 *
 * Le Worker ne transporte jamais le fichier : il signe une URL PUT valable 15
 * minutes. Si les cles S3 de R2 ne sont pas configurees, on retombe sur un
 * upload via le binding (`mode: "worker"`), utile en developpement.
 */
mediaRoutes.post('/presigned-url', requireAuth, async (c) => {
  const body = await readJson<{
    originalName?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
  }>(c.req.raw);

  const originalName = requireString(body.originalName, 'originalName', { max: 255 });
  const contentType = requireString(body.contentType, 'contentType', { max: 120 });
  assertAllowedType(contentType);

  const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;
  if (sizeBytes > MAX_MEDIA_BYTES) {
    throw badRequest(`Fichier trop volumineux (max ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} Mo).`);
  }

  const key = buildObjectKey(c.get('user').id, originalName);
  const publicUrl = publicUrlFor(c.env, key);

  if (!hasS3Credentials(c.env)) {
    return c.json({
      mode: 'worker' as const,
      key,
      uploadUrl: `/api/media/upload?key=${encodeURIComponent(key)}`,
      method: 'PUT' as const,
      publicUrl,
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  }

  const uploadUrl = await presignR2Url({
    accountId: c.env.R2_ACCOUNT_ID,
    bucket: c.env.R2_BUCKET_NAME,
    key,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    method: 'PUT',
    expiresIn: PRESIGN_TTL_SECONDS,
  });

  return c.json({
    mode: 's3' as const,
    key,
    uploadUrl,
    method: 'PUT' as const,
    publicUrl,
    expiresIn: PRESIGN_TTL_SECONDS,
  });
});

/** Repli developpement : upload traversant le Worker. */
mediaRoutes.put('/upload', requireAuth, async (c) => {
  const key = c.req.query('key');
  if (!key) throw badRequest('Parametre "key" manquant.');
  assertOwnedKey(c.get('user').id, key);

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  assertAllowedType(contentType);

  if (!c.req.raw.body) throw badRequest('Corps de requete vide.');

  await c.env.MEDIA_BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType },
  });

  return c.json({ ok: true, key });
});

/**
 * Enregistre en D1 un objet deja present dans R2.
 * L existence est verifiee cote serveur : impossible d inscrire un media fantome.
 */
mediaRoutes.post('/sync', requireAuth, async (c) => {
  const body = await readJson<{ key?: unknown; originalName?: unknown }>(c.req.raw);
  const key = requireString(body.key, 'key', { max: 512 });
  const originalName = requireString(body.originalName, 'originalName', { max: 255 });

  assertOwnedKey(c.get('user').id, key);

  const object = await c.env.MEDIA_BUCKET.head(key);
  if (!object) throw notFound('Objet absent de R2 : upload incomplet.');

  if (object.size > MAX_MEDIA_BYTES) {
    await c.env.MEDIA_BUCKET.delete(key);
    throw badRequest('Fichier trop volumineux, objet supprime.');
  }

  const contentType = object.httpMetadata?.contentType ?? null;
  if (contentType) assertAllowedType(contentType);

  const media = await insertMedia(c.env, c.get('user').id, {
    originalName,
    key,
    contentType,
    sizeBytes: object.size,
  });

  return c.json({ media }, 201);
});

mediaRoutes.get('/', requireAuth, async (c) => {
  const medias = await listMedias(c.env, c.get('user').id);
  return c.json({ medias });
});

mediaRoutes.delete('/:id', requireAuth, async (c) => {
  await deleteMedia(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

/**
 * Service public des objets.
 * En production, on prefere un domaine R2 dedie (R2_PUBLIC_BASE_URL) ; cette
 * route existe pour que les medias s affichent des le premier `wrangler dev`.
 */
mediaRoutes.get('/file/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace('/api/media/file/', ''));
  if (!key || key.includes('..')) throw badRequest('Cle invalide.');

  const object = await c.env.MEDIA_BUCKET.get(key);
  if (!object) throw notFound('Fichier introuvable.');
  if (!object.body) throw serverError('Fichier illisible.');

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
});
