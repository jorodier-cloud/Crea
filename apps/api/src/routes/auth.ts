import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import { allowedOrigins, isDevelopment, type AppBindings } from '../env.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { signSession } from '../lib/crypto.js';
import {
  badGateway,
  badRequest,
  notConfigured,
  notFound,
  readJson,
  requireEmail,
  requireString,
} from '../lib/http.js';
import { MailError, buildMagicLinkEmail, isMailerConfigured, sendEmail } from '../lib/mailer.js';
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
 * Le compte est cree a la volee s il n existe pas : la reponse est donc la meme
 * dans tous les cas, et l endpoint ne permet pas d enumerer les inscrits.
 *
 * En developpement, le lien est renvoye dans la reponse — inutile de brancher
 * un service d envoi pour travailler en local. En production il part par email,
 * et un echec d envoi est signale : repondre `ok` a quelqu un qui ne recevra
 * jamais rien est la pire des reponses.
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

  if (isDevelopment(c.env)) {
    return c.json({ ok: true, expiresAt, devLink: link, devToken: token });
  }

  if (!isMailerConfigured(c.env)) {
    throw notConfigured(
      'Envoi d emails non configure : le lien ne peut pas etre transmis. ' +
        'Poser le secret RESEND_API_KEY sur le Worker.',
    );
  }

  const message = buildMagicLinkEmail({ link, expiresAt });

  try {
    await sendEmail(c.env, { to: user.email, ...message });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const status = error instanceof MailError ? error.status : undefined;

    // Le lien lui-meme ne doit jamais atterrir dans les journaux : quiconque y
    // a acces prendrait la main sur le compte.
    console.error(
      JSON.stringify({
        event: 'magic_link_send_failed',
        userId: user.id,
        ...(status !== undefined ? { upstreamStatus: status } : {}),
        reason,
      }),
    );

    // Le motif remonte jusqu a la page de connexion. Il decrit notre propre
    // configuration — cle refusee, expediteur non verifie — jamais une donnee
    // d utilisateur, et le lire dans les journaux Cloudflare depuis un
    // telephone est hors de portee : sans lui, la panne est indiagnosticable.
    throw badGateway(`L envoi de l email a echoue : ${reason}`, {
      ...(status !== undefined ? { statut: status } : {}),
    });
  }

  console.log(JSON.stringify({ event: 'magic_link_sent', userId: user.id, expiresAt }));
  return c.json({ ok: true, expiresAt });
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
