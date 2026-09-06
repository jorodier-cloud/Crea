import { Hono } from 'hono';
import { applyCalendarSync, escapeHtml, renderTreeToHtml } from '@crea/schema';

import type { AppBindings } from '../env.js';
import {
  FORM_ID_FIELD,
  HONEYPOT_FIELD,
  findFirstFormNode,
  findFormNode,
  missingRequired,
  readSubmission,
} from '../lib/contact.js';
import { badRequest, notFound } from '../lib/http.js';
import { buildContactEmail, isMailerConfigured, sendEmail } from '../lib/mailer.js';
import { fetchCalendarBlockedDates } from '../services/ical.js';
import {
  assertUnderRateLimit,
  findContactTarget,
  hashIp,
  markNotified,
  newMessageId,
  storeMessage,
} from '../services/messages.js';
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

/** Refus au-dela : un formulaire de contact n a aucune raison d etre volumineux. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Lit un corps de formulaire, encode en URL ou en multipart.
 * Les fichiers sont ignores : aucun formulaire declare n en accepte, et les
 * accepter ouvrirait un depot anonyme sur le bucket.
 */
async function readFormBody(request: Request): Promise<Record<string, string>> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw badRequest('Demande trop volumineuse.');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Formulaire illisible.');
  }

  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/**
 * Page affichee au visiteur apres l envoi.
 *
 * Autonome et sans dependance : elle est servie par l API, pas par le site, et
 * doit rester lisible meme si rien d autre ne charge.
 */
function confirmationPage({
  slug,
  title,
  message,
}: {
  slug: string;
  title: string;
  message: string | null;
}): string {
  const texte = message?.trim() || 'Votre message est bien arrive. Nous vous repondons vite.';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Message envoye${title ? ` — ${escapeHtml(title)}` : ''}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;
background:#FAF7F0;color:#1F2420;font-family:Georgia,'Times New Roman',serif;}
main{max-width:32rem;text-align:center}
p.kicker{margin:0 0 12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9CAF88;
font-family:Helvetica,Arial,sans-serif}
h1{margin:0 0 16px;font-size:2rem;font-weight:400;color:#2F4132}
p.lead{margin:0 0 28px;font-size:1.0625rem;line-height:1.7;color:#6B7169}
a{display:inline-block;padding:12px 26px;border-radius:999px;background:#2F4132;color:#FAF7F0;
font-family:Helvetica,Arial,sans-serif;font-size:.9375rem;font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<p class="kicker">Demande envoyee</p>
<h1>Merci.</h1>
<p class="lead">${escapeHtml(texte)}</p>
<a href="/p/${escapeHtml(slug)}">Retour au site</a>
</main>
</body>
</html>`;
}

publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');

  const site = await getPublishedBySlug(c.env, slug);
  // Les reservations Airbnb/Booking bloquent des nuits sans passer par l
  // editeur : sans cette synchronisation, le calendrier publie resterait
  // celui du dernier "Publier", potentiellement perime de plusieurs jours.
  const syncedBlockedDates = await fetchCalendarBlockedDates(site.tree);
  const tree = applyCalendarSync(site.tree, syncedBlockedDates);
  // Les formulaires qui ne declarent pas d adresse visent la reception
  // integree, servie juste en dessous.
  const html = renderTreeToHtml(tree, { formEndpoint: `/p/${slug}/contact` });

  return c.html(html, 200, {
    // Court, pour qu une republication soit visible rapidement, avec
    // revalidation en arriere-plan cote CDN.
    'cache-control': 'public, max-age=60, stale-while-revalidate=600',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'last-modified': new Date(site.publishedAt * 1000).toUTCString(),
  });
});

/**
 * Reception d une demande envoyee par un formulaire du site publie.
 *
 * Le formulaire rendu est du HTML sans JavaScript : la soumission est une
 * navigation, et la reponse doit donc etre une page, pas du JSON.
 *
 * Ordre volontaire : on enregistre d abord, on notifie ensuite. Une demande de
 * reservation perdue parce que le service d envoi a hoquete coute une nuitee ;
 * un email en retard ne coute rien.
 */
publicRoutes.post('/:slug/contact', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');

  const submitted = await readFormBody(c.req.raw);

  // Champ invisible pour un humain : rempli, c est un robot. On repond comme
  // si tout allait bien — signaler le piege apprendrait a le contourner.
  if ((submitted[HONEYPOT_FIELD] ?? '').trim()) {
    return c.html(confirmationPage({ slug, title: '', message: null }), 200);
  }

  const [target, site] = await Promise.all([
    findContactTarget(c.env, slug),
    getPublishedBySlug(c.env, slug),
  ]);

  const formId = submitted[FORM_ID_FIELD];
  const node = formId ? findFormNode(site.tree, formId) : findFirstFormNode(site.tree);
  if (!node) throw notFound('Ce site ne comporte aucun formulaire.');

  const manquants = missingRequired(node, submitted);
  if (manquants.length > 0) {
    throw badRequest(`Champs obligatoires manquants : ${manquants.join(', ')}.`);
  }

  const { fields, senderName, senderEmail } = readSubmission(node, submitted);
  if (fields.length === 0) throw badRequest('Le formulaire est vide.');

  const now = Math.floor(Date.now() / 1000);
  const ipHash = await hashIp(c.env, c.req.header('cf-connecting-ip') ?? 'inconnue');
  await assertUnderRateLimit(c.env, ipHash, now);

  const id = newMessageId();
  await storeMessage(c.env, target, {
    id,
    fields,
    senderName,
    senderEmail,
    ipHash,
    createdAt: now,
  });

  if (isMailerConfigured(c.env)) {
    try {
      await sendEmail(c.env, {
        to: target.ownerEmail,
        replyTo: senderEmail,
        ...buildContactEmail({ siteTitle: target.title, fields, senderName }),
      });
      await markNotified(c.env, id);
    } catch (error) {
      // La demande est enregistree : l echec de notification se repare, la
      // perdre non. Le visiteur n a pas a en connaitre l existence.
      console.error(
        JSON.stringify({
          event: 'contact_notify_failed',
          messageId: id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  } else {
    console.error(JSON.stringify({ event: 'contact_notify_skipped', messageId: id }));
  }

  const content = node.content as { successMessage?: string };
  return c.html(
    confirmationPage({ slug, title: site.title, message: content.successMessage ?? null }),
    200,
  );
});

/** Les sites publies sont indexables ; le reste de l API ne l est pas. */
publicRoutes.get('/:slug/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /p/${c.req.param('slug')}\n`, 200, {
    'content-type': 'text/plain; charset=utf-8',
  }),
);
