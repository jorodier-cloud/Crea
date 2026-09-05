import { Hono } from 'hono';
import { renderTreeToHtml } from '@crea/schema';

import type { AppBindings } from '../env.js';
import { badRequest } from '../lib/http.js';
import { getPublishedBySlug } from '../services/projects.js';

/**
 * Sites publies — la seule surface accessible sans authentification.
 *
 * Le HTML servi est la projection de `published_tree`, l instantane fige au
 * moment de la publication : continuer a editer le projet ne change rien pour
 * les visiteurs tant qu on ne republie pas.
 */
export const publicRoutes = new Hono<AppBindings>();

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,59}$/;

publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');

  const site = await getPublishedBySlug(c.env, slug);
  const html = renderTreeToHtml(site.tree);

  return c.html(html, 200, {
    // Court, pour qu une republication soit visible rapidement, avec
    // revalidation en arriere-plan cote CDN.
    'cache-control': 'public, max-age=60, stale-while-revalidate=600',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'last-modified': new Date(site.publishedAt * 1000).toUTCString(),
  });
});

/** Les sites publies sont indexables ; le reste de l API ne l est pas. */
publicRoutes.get('/:slug/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /p/${c.req.param('slug')}\n`, 200, {
    'content-type': 'text/plain; charset=utf-8',
  }),
);
