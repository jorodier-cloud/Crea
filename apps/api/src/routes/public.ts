import { Hono } from 'hono';
import {
  applyCalendarSync,
  escapeHtml,
  findPageBySlug,
  renderTreeToHtml,
  type AnyBlockNode,
  type SitePage,
} from '@crea/schema';

import type { AppBindings } from '../env.js';
import { findProductNode, productContent, PRODUCT_ID_FIELD } from '../lib/checkout.js';
import {
  FORM_ID_FIELD,
  HONEYPOT_FIELD,
  findFirstFormNode,
  findFormNode,
  missingRequired,
  readSubmission,
} from '../lib/contact.js';
import { badGateway, badRequest, notConfigured, notFound } from '../lib/http.js';
import { buildContactEmail, isMailerConfigured, sendEmail } from '../lib/mailer.js';
import { createCheckoutSession, StripeError } from '../lib/stripe.js';
import { fetchCalendarBlockedDates } from '../services/ical.js';
import {
  assertUnderRateLimit,
  findContactTarget,
  hashIp,
  markNotified,
  newMessageId,
  storeMessage,
} from '../services/messages.js';
import { createOrder, getStripeSecretForSlug } from '../services/payments.js';
import { getPublishedBySlug, type PublishedSite } from '../services/projects.js';

/** Chemin public d une page ('' = accueil, sert la racine du slug). */
function pagePath(slug: string, pageSlug: string): string {
  return pageSlug ? `/p/${slug}/${pageSlug}` : `/p/${slug}`;
}

/** Cherche un formulaire par id sur l ensemble des pages, dans leur ordre de stockage. */
function findContactForm(
  pages: SitePage[],
  formId: string | undefined,
): { node: AnyBlockNode; page: SitePage } | null {
  for (const page of pages) {
    const node = formId ? findFormNode(page.tree, formId) : findFirstFormNode(page.tree);
    if (node) return { node, page };
  }
  return null;
}

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
  backHref,
  title,
  message,
}: {
  backHref: string;
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
<a href="${escapeHtml(backHref)}">Retour au site</a>
</main>
</body>
</html>`;
}

/** Sert une page publiee ('' = accueil). Partage par les deux routes GET ci-dessous. */
async function renderSitePage(
  site: PublishedSite,
  slug: string,
  pageSlug: string,
): Promise<Response> {
  const page = findPageBySlug({ pages: site.pages }, pageSlug);
  if (!page) throw notFound('Aucune page a cette adresse.');

  // Les reservations Airbnb/Booking bloquent des nuits sans passer par l
  // editeur : sans cette synchronisation, le calendrier publie resterait
  // celui du dernier "Publier", potentiellement perime de plusieurs jours.
  const syncedBlockedDates = await fetchCalendarBlockedDates(page.tree);
  const tree = applyCalendarSync(page.tree, syncedBlockedDates);
  // Les formulaires qui ne declarent pas d adresse visent la reception
  // integree, servie juste en dessous — commune a toutes les pages du site.
  // Meme logique pour l achat : le bouton pointe toujours vers la route de
  // paiement, qui repond elle-meme si Stripe n est pas encore configure.
  const html = renderTreeToHtml(tree, {
    formEndpoint: `/p/${slug}/contact`,
    checkoutEndpoint: `/p/${slug}/checkout`,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Court, pour qu une republication soit visible rapidement, avec
      // revalidation en arriere-plan cote CDN.
      'cache-control': 'public, max-age=60, stale-while-revalidate=600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'last-modified': new Date(site.publishedAt * 1000).toUTCString(),
    },
  });
}

publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');
  const site = await getPublishedBySlug(c.env, slug);
  return renderSitePage(site, slug, '');
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
    return c.html(confirmationPage({ backHref: `/p/${slug}`, title: '', message: null }), 200);
  }

  const [target, site] = await Promise.all([
    findContactTarget(c.env, slug),
    getPublishedBySlug(c.env, slug),
  ]);

  const formId = submitted[FORM_ID_FIELD];
  const found = findContactForm(site.pages, formId);
  if (!found) throw notFound('Ce site ne comporte aucun formulaire.');
  const { node } = found;

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
    confirmationPage({
      backHref: pagePath(slug, found.page.slug),
      title: site.title,
      message: content.successMessage ?? null,
    }),
    200,
  );
});

/**
 * Achat d un produit : reception d une navigation POST (pas d appel JSON),
 * exactement comme le formulaire de contact ci-dessus. Elle cree la session
 * de paiement chez Stripe puis redirige — la carte du visiteur ne transite
 * jamais par ce Worker, Stripe l heberge sur sa propre page.
 */
publicRoutes.post('/:slug/checkout', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');

  const submitted = await readFormBody(c.req.raw);
  const productId = submitted[PRODUCT_ID_FIELD];
  if (!productId) throw badRequest('Produit non precise.');

  const [site, credentials] = await Promise.all([
    getPublishedBySlug(c.env, slug),
    getStripeSecretForSlug(c.env, slug),
  ]);
  if (!credentials) throw notConfigured('Le proprietaire de ce site n a pas encore active les paiements.');

  const node = findProductNode(site.pages, productId);
  if (!node) throw notFound('Produit introuvable.');
  const content = productContent(node);

  const currency = (content.currency || 'eur').toLowerCase();
  const unitAmount = Math.round(Math.max(0, content.price ?? 0) * 100);
  if (unitAmount <= 0) throw badRequest('Ce produit n a pas encore de prix.');

  const origin = new URL(c.req.url).origin;

  let session;
  try {
    session = await createCheckoutSession(credentials.secretKey, {
      successUrl: `${origin}/p/${slug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/p/${slug}`,
      productName: content.name || 'Produit',
      description: content.description,
      unitAmount,
      currency,
      metadata: { project_id: credentials.projectId, product_node_id: node.id, slug },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'checkout_session_failed',
        slug,
        reason: error instanceof StripeError ? error.message : String(error),
      }),
    );
    throw badGateway('Paiement momentanement indisponible. Reessayez dans un instant.');
  }
  if (!session.url) throw badGateway('Paiement momentanement indisponible. Reessayez dans un instant.');

  // Ecrite avant la redirection : une tentative d achat existe des ce point,
  // meme si le visiteur abandonne sur la page Stripe.
  await createOrder(c.env, {
    projectId: credentials.projectId,
    slug,
    productNodeId: node.id,
    productName: content.name || 'Produit',
    unitAmount,
    currency,
    stripeSessionId: session.id,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return c.redirect(session.url, 303);
});

/** Page affichee au retour de Stripe apres paiement. */
publicRoutes.get('/:slug/checkout/success', (c) => {
  const slug = c.req.param('slug').toLowerCase();
  return c.html(
    confirmationPage({
      backHref: `/p/${slug}`,
      title: '',
      message: 'Paiement recu, merci. Une confirmation vous est envoyee par email.',
    }),
    200,
  );
});

/** Les sites publies sont indexables ; le reste de l API ne l est pas. */
publicRoutes.get('/:slug/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /p/${c.req.param('slug')}\n`, 200, {
    'content-type': 'text/plain; charset=utf-8',
  }),
);

/**
 * Pages du site autres que l accueil, ex. /p/domaine/tarifs.
 * Enregistree apres `/robots.txt` : un segment statique doit toujours
 * l emporter sur un parametre, quoi que fasse le routeur avec l ordre.
 */
publicRoutes.get('/:slug/:pageSlug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw badRequest('Adresse invalide.');
  const pageSlug = c.req.param('pageSlug').toLowerCase();
  const site = await getPublishedBySlug(c.env, slug);
  return renderSitePage(site, slug, pageSlug);
});
