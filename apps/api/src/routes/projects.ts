import { Hono } from 'hono';
import { normalizeSite, renderTreeToHtml, SchemaError, type SitePage } from '@crea/schema';

import type { AppBindings } from '../env.js';
import { badRequest, readJson, requireString } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  clearPaymentSettings,
  getPaymentSettings,
  listOrders,
  savePaymentSettings,
} from '../services/payments.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  publishProject,
  unpublishProject,
  updateProject,
  type Project,
} from '../services/projects.js';

export const projectRoutes = new Hono<AppBindings>();

projectRoutes.use('*', requireAuth);

/**
 * URL publique du site, derivee de l origine de la requete : un domaine
 * personnalise route vers ce Worker fonctionne sans configuration supplementaire.
 */
function publicUrlOf(requestUrl: string, project: Project): string | null {
  if (!project.slug || !project.publishedAt) return null;
  return `${new URL(requestUrl).origin}/p/${project.slug}`;
}

/** Tout site entrant est normalise : le client n ecrit jamais directement en base. */
function normalizeIncomingPages(raw: unknown): { pages: SitePage[]; issues: string[] } {
  try {
    const { site, issues } = normalizeSite({ pages: raw });
    return { pages: site.pages, issues };
  } catch (error) {
    if (error instanceof SchemaError) {
      throw badRequest(`Site invalide : ${error.message}`, error.issues);
    }
    throw error;
  }
}

projectRoutes.get('/', async (c) => {
  const projects = await listProjects(c.env, c.get('user').id);
  return c.json({ projects });
});

projectRoutes.post('/', async (c) => {
  const body = await readJson<{ title?: unknown; pages?: unknown }>(c.req.raw);
  const title = requireString(body.title, 'title', { max: 120 });
  const pages =
    Array.isArray(body.pages) && body.pages.length > 0
      ? normalizeIncomingPages(body.pages).pages
      : undefined;

  const project = await createProject(c.env, c.get('user').id, title, pages);
  return c.json({ project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const project = await getProject(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ project, publicUrl: publicUrlOf(c.req.url, project) });
});

/** Sauvegarde du builder : titre et/ou site complet (toutes les pages). */
projectRoutes.put('/:id', async (c) => {
  const body = await readJson<{ title?: unknown; pages?: unknown }>(c.req.raw);

  const title = body.title === undefined ? undefined : requireString(body.title, 'title', { max: 120 });
  let pages: SitePage[] | undefined;
  let issues: string[] = [];

  if (body.pages !== undefined) {
    if (!Array.isArray(body.pages) || body.pages.length === 0) {
      throw badRequest('"pages" doit etre un tableau non vide.');
    }
    const normalized = normalizeIncomingPages(body.pages);
    pages = normalized.pages;
    issues = normalized.issues;
  }

  if (title === undefined && pages === undefined) {
    throw badRequest('Rien a sauvegarder : fournir "title" et/ou "pages".');
  }

  const project = await updateProject(c.env, c.get('user').id, c.req.param('id'), {
    ...(title !== undefined ? { title } : {}),
    ...(pages !== undefined ? { pages } : {}),
  });

  return c.json({ project, issues });
});

projectRoutes.delete('/:id', async (c) => {
  await deleteProject(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

/**
 * Projection HTML d une page du projet (l accueil par defaut). Le stockage
 * reste l AST : ce rendu est jetable.
 */
projectRoutes.get('/:id/html', async (c) => {
  const project = await getProject(c.env, c.get('user').id, c.req.param('id'));
  const pageId = c.req.query('page');
  const page = (pageId ? project.pages.find((p) => p.id === pageId) : undefined) ?? project.pages[0]!;
  return c.html(renderTreeToHtml(page.tree));
});

/**
 * Met le site en ligne : l arbre de travail est fige dans un instantane servi
 * par /p/:slug. Sans `slug`, l adresse est derivee du titre.
 */
projectRoutes.post('/:id/publish', async (c) => {
  const body = await c.req
    .json<{ slug?: unknown }>()
    .catch(() => ({}) as { slug?: unknown });

  const slug =
    body.slug === undefined ? undefined : requireString(body.slug, 'slug', { max: 60, min: 3 });

  const project = await publishProject(c.env, c.get('user').id, c.req.param('id'), {
    ...(slug !== undefined ? { slug } : {}),
  });

  return c.json({ project, publicUrl: publicUrlOf(c.req.url, project) });
});

/** Retire le site de la ligne. L adresse reste reservee pour une republication. */
projectRoutes.post('/:id/unpublish', async (c) => {
  const project = await unpublishProject(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ project, publicUrl: null });
});

/**
 * Reglages de paiement du projet : etat de connexion Stripe (jamais les cles
 * elles-memes, meme dechiffrees, une fois enregistrees) et adresse a coller
 * dans le webhook Stripe pour recevoir les confirmations de paiement.
 */
projectRoutes.get('/:id/payments', async (c) => {
  const id = c.req.param('id');
  const settings = await getPaymentSettings(c.env, c.get('user').id, id);
  const webhookUrl = `${new URL(c.req.url).origin}/webhooks/stripe/${id}`;
  return c.json({ settings, webhookUrl });
});

/** Connecte ou remplace les cles Stripe du projet. Chiffrees avant stockage. */
projectRoutes.put('/:id/payments', async (c) => {
  const body = await readJson<{ publicKey?: unknown; secretKey?: unknown; webhookSecret?: unknown }>(
    c.req.raw,
  );
  const publicKey = requireString(body.publicKey, 'publicKey', { max: 300 });
  const secretKey = requireString(body.secretKey, 'secretKey', { max: 300 });
  const webhookSecret = requireString(body.webhookSecret, 'webhookSecret', { max: 300 });

  if (!publicKey.startsWith('pk_')) {
    throw badRequest('Cle publique Stripe invalide (elle commence par "pk_").');
  }
  if (!secretKey.startsWith('sk_') && !secretKey.startsWith('rk_')) {
    throw badRequest('Cle secrete Stripe invalide (elle commence par "sk_" ou "rk_").');
  }
  if (!webhookSecret.startsWith('whsec_')) {
    throw badRequest('Secret de webhook Stripe invalide (il commence par "whsec_").');
  }

  const settings = await savePaymentSettings(c.env, c.get('user').id, c.req.param('id'), {
    publicKey,
    secretKey,
    webhookSecret,
  });
  return c.json({ settings });
});

/** Deconnecte Stripe : les commandes deja enregistrees restent consultables. */
projectRoutes.delete('/:id/payments', async (c) => {
  await clearPaymentSettings(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

/** Commandes du projet, les plus recentes en tete. */
projectRoutes.get('/:id/orders', async (c) => {
  const orders = await listOrders(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ orders });
});
