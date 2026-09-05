import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

import type { AppBindings } from '../env.js';
import { unauthorized } from '../lib/http.js';
import { verifySession } from '../lib/crypto.js';

export const SESSION_COOKIE = 'crea_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function readToken(header: string | undefined, cookie: string | undefined): string | null {
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return cookie ?? null;
}

/** Refuse la requete si aucune session valide n est presentee. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.env.SESSION_SECRET) {
    throw unauthorized('SESSION_SECRET absent : authentification indisponible.');
  }

  const token = readToken(c.req.header('Authorization'), getCookie(c, SESSION_COOKIE));
  if (!token) throw unauthorized();

  const payload = await verifySession(token, c.env.SESSION_SECRET);
  if (!payload) throw unauthorized('Session expiree ou invalide.');

  c.set('user', { id: payload.sub, email: payload.email });
  await next();
};
