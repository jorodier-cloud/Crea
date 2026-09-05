import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import { allowedOrigins, isDevelopment, type AppBindings } from '../env.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { signSession } from '../lib/crypto.js';
import { badRequest, notFound, readJson, requireEmail, requireString } from '../lib/http.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, requireAuth } from '../middleware/auth.js';
import {
  consumeMagicLink,
  findOrCreateUser,
  findUserById,
  setMagicLink,
  toPublicUser,
} from '../services/users.js';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export const authRoutes = new Hono<AppBindings>();

/**
 * Demande d un magic link.
 *
 * Reponse volontairement identique que le compte existe ou non : l endpoint ne
 * doit pas permettre d enumerer les adresses inscrites. En developpement, le
 * lien est renvoye dans la reponse pour eviter d avoir a brancher un envoi
 * d email.
 */
authRoutes.post('/magic-link', async (c) => {
  const body = await readJson<{ email?: unknown }>(c.req.raw);
  const email = requireEmail(body.email);

  const user = await findOrCreateUser(c.env, email);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_SECONDS;

  await setMagicLink(c.env, user.id, tokenHash, expiresAt);

  const origin = allowedOrigins(c.env)[0] ?? 'http://localhost:4321';
  const link = `${origin}/auth/verify?token=${encodeURIComponent(token)}`;

  // TODO production : router `link` vers un service d envoi (Resend, Postmark,
  // MailChannels...) au lieu de le retourner.
  if (!isDevelopment(c.env)) {
    console.log(JSON.stringify({ event: 'magic_link_issued', userId: user.id, expiresAt }));
  }

  return c.json({
    ok: true,
    expiresAt,
    ...(isDevelopment(c.env) ? { devLink: link, devToken: token } : {}),
  });
});

/** Echange le jeton du magic link contre une session. Le jeton est consomme. */
authRoutes.post('/verify', async (c) => {
  const body = await readJson<{ token?: unknown }>(c.req.raw);
  const token = requireString(body.token, 'token', { max: 512 });
  const tokenHash = await sha256Hex(token);

  const user = await consumeMagicLink(c.env, tokenHash);
  if (!user) throw badRequest('Lien invalide ou expire. Demander un nouveau lien.');

  if (!c.env.SESSION_SECRET) {
    throw badRequest('SESSION_SECRET absent : impossible d emettre une session.');
  }

  const session = await signSession(
    { sub: user.id, email: user.email },
    c.env.SESSION_SECRET,
    SESSION_TTL_SECONDS,
  );

  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: !isDevelopment(c.env),
    sameSite: isDevelopment(c.env) ? 'Lax' : 'None',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  // Le jeton est aussi renvoye : le builder l envoie en `Authorization: Bearer`,
  // ce qui evite toute dependance aux cookies tiers entre les deux origines.
  return c.json({ token: session, user: toPublicUser(user) });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const row = await findUserById(c.env, c.get('user').id);
  if (!row) throw notFound('Compte introuvable.');
  return c.json({ user: toPublicUser(row) });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
