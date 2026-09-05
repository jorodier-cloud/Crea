import { Hono } from 'hono';
import { normalizeTree, renderTreeToHtml, SchemaError, type PageTree } from '@crea/schema';

import type { AppBindings } from '../env.js';
import { badRequest, readJson, requireString } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '../services/projects.js';

export const projectRoutes = new Hono<AppBindings>();

projectRoutes.use('*', requireAuth);

/** Tout arbre entrant est normalise : le client n ecrit jamais directement en base. */
function normalizeIncomingTree(raw: unknown): { tree: PageTree; issues: string[] } {
  try {
    return normalizeTree(raw);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw badRequest(`Arbre invalide : ${error.message}`, error.issues);
    }
    throw error;
  }
}

projectRoutes.get('/', async (c) => {
  const projects = await listProjects(c.env, c.get('user').id);
  return c.json({ projects });
});

projectRoutes.post('/', async (c) => {
  const body = await readJson<{ title?: unknown; tree?: unknown }>(c.req.raw);
  const title = requireString(body.title, 'title', { max: 120 });
  const tree = body.tree === undefined ? undefined : normalizeIncomingTree(body.tree).tree;

  const project = await createProject(c.env, c.get('user').id, title, tree);
  return c.json({ project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const project = await getProject(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ project });
});

/** Sauvegarde du builder : titre et/ou AST complet. */
projectRoutes.put('/:id', async (c) => {
  const body = await readJson<{ title?: unknown; tree?: unknown }>(c.req.raw);

  const title = body.title === undefined ? undefined : requireString(body.title, 'title', { max: 120 });
  let tree: PageTree | undefined;
  let issues: string[] = [];

  if (body.tree !== undefined) {
    const normalized = normalizeIncomingTree(body.tree);
    tree = normalized.tree;
    issues = normalized.issues;
  }

  if (title === undefined && tree === undefined) {
    throw badRequest('Rien a sauvegarder : fournir "title" et/ou "tree".');
  }

  const project = await updateProject(c.env, c.get('user').id, c.req.param('id'), {
    ...(title !== undefined ? { title } : {}),
    ...(tree !== undefined ? { tree } : {}),
  });

  return c.json({ project, issues });
});

projectRoutes.delete('/:id', async (c) => {
  await deleteProject(c.env, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

/** Projection HTML du projet. Le stockage reste l AST : ce rendu est jetable. */
projectRoutes.get('/:id/html', async (c) => {
  const project = await getProject(c.env, c.get('user').id, c.req.param('id'));
  return c.html(renderTreeToHtml(project.tree));
});
