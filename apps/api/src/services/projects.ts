import {
  createEmptySite,
  createId,
  parseSite,
  serializeSite,
  SchemaError,
  type Site,
  type SitePage,
} from '@crea/schema';

import type { Env } from '../env.js';
import { badRequest, conflict, notFound, serverError } from '../lib/http.js';
import { slugify, SLUG_MAX_LENGTH } from '../lib/slug.js';

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  json_tree: string;
  slug: string | null;
  published_tree: string | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  slug: string | null;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectSummary {
  pages: SitePage[];
}

const MAX_TREE_BYTES = 900_000; // marge sous la limite de taille d une ligne D1.

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toProject(row: ProjectRow): Project {
  try {
    const { site } = parseSite(row.json_tree);
    return { ...toSummary(row), pages: site.pages };
  } catch (error) {
    if (error instanceof SchemaError) {
      throw serverError(`Projet ${row.id} corrompu : ${error.message}`, error.issues);
    }
    throw error;
  }
}

export async function listProjects(env: Env, userId: string): Promise<ProjectSummary[]> {
  // Ni `json_tree` ni `published_tree` ne sont charges ici : une liste ne doit
  // pas tirer les AST complets.
  const { results } = await env.DB.prepare(
    `SELECT id, title, slug, published_at, created_at, updated_at
       FROM Projects WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(userId)
    .all<Omit<ProjectRow, 'user_id' | 'json_tree' | 'published_tree'>>();

  return (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Charge un projet en verifiant la propriete : jamais de fuite inter-comptes. */
export async function getProject(env: Env, userId: string, id: string): Promise<Project> {
  const row = await env.DB.prepare('SELECT * FROM Projects WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first<ProjectRow>();
  if (!row) throw notFound('Projet introuvable.');
  return toProject(row);
}

export async function createProject(
  env: Env,
  userId: string,
  title: string,
  pages?: SitePage[],
): Promise<Project> {
  const id = createId('prj');
  const site: Site = pages && pages.length > 0 ? { pages } : createEmptySite(title);
  const json = serializeSite(site);

  await env.DB.prepare(
    'INSERT INTO Projects (id, user_id, title, json_tree) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(id, userId, title, json)
    .run();

  return getProject(env, userId, id);
}

export interface UpdateProjectInput {
  title?: string;
  pages?: SitePage[];
}

/** Sauvegarde le titre et/ou les pages. Chaque arbre est deja normalise par l appelant. */
export async function updateProject(
  env: Env,
  userId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const existing = await env.DB.prepare(
    'SELECT id FROM Projects WHERE id = ?1 AND user_id = ?2',
  )
    .bind(id, userId)
    .first<{ id: string }>();
  if (!existing) throw notFound('Projet introuvable.');

  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    assignments.push(`title = ?${values.length + 1}`);
    values.push(input.title);
  }
  if (input.pages !== undefined) {
    const json = serializeSite({ pages: input.pages });
    if (json.length > MAX_TREE_BYTES) {
      throw badRequest(`Site trop volumineux (${json.length} octets, max ${MAX_TREE_BYTES}).`);
    }
    assignments.push(`json_tree = ?${values.length + 1}`);
    values.push(json);
  }

  if (assignments.length === 0) return getProject(env, userId, id);

  assignments.push('updated_at = unixepoch()');
  values.push(id, userId);

  await env.DB.prepare(
    `UPDATE Projects SET ${assignments.join(', ')} WHERE id = ?${values.length - 1} AND user_id = ?${values.length}`,
  )
    .bind(...values)
    .run();

  return getProject(env, userId, id);
}

export async function deleteProject(env: Env, userId: string, id: string): Promise<void> {
  const result = await env.DB.prepare('DELETE FROM Projects WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) throw notFound('Projet introuvable.');
}

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

async function slugOwner(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM Projects WHERE slug = ?1')
    .bind(slug)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export interface PublishInput {
  /** Slug demande explicitement par l utilisateur. */
  slug?: string;
}

/**
 * Publie le projet : l arbre de travail est copie dans `published_tree`.
 *
 * La copie se fait en SQL (`published_tree = json_tree`) pour que l instantane
 * corresponde exactement a ce qui est en base au moment du clic, sans aller-retour.
 */
export async function publishProject(
  env: Env,
  userId: string,
  id: string,
  input: PublishInput = {},
): Promise<Project> {
  const project = await getProject(env, userId, id);

  let slug: string;
  if (input.slug !== undefined) {
    slug = slugify(input.slug);
    if (slug.length < 3) {
      throw badRequest('Adresse trop courte : au moins 3 caracteres alphanumeriques.');
    }
    const owner = await slugOwner(env, slug);
    if (owner && owner !== id) {
      throw conflict(`L adresse "${slug}" est deja prise.`);
    }
  } else if (project.slug) {
    slug = project.slug;
  } else {
    // Slug derive du titre, suffixe si l adresse est deja occupee.
    const base = slugify(project.title) || 'site';
    slug = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const owner = await slugOwner(env, slug);
      if (!owner || owner === id) break;
      slug = `${base.slice(0, SLUG_MAX_LENGTH - 5)}-${randomSuffix()}`;
    }
  }

  await env.DB.prepare(
    `UPDATE Projects
        SET slug = ?1, published_tree = json_tree, published_at = unixepoch()
      WHERE id = ?2 AND user_id = ?3`,
  )
    .bind(slug, id, userId)
    .run();

  return getProject(env, userId, id);
}

/** Retire le site de la ligne. Le slug et l instantane sont conserves. */
export async function unpublishProject(env: Env, userId: string, id: string): Promise<Project> {
  const result = await env.DB.prepare(
    'UPDATE Projects SET published_at = NULL WHERE id = ?1 AND user_id = ?2',
  )
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) throw notFound('Projet introuvable.');
  return getProject(env, userId, id);
}

export interface PublishedSite {
  title: string;
  pages: SitePage[];
  publishedAt: number;
}

/**
 * Charge le site publie servi par la route publique.
 * Aucune notion d utilisateur ici : seuls les projets explicitement publies
 * sortent de la base.
 */
export async function getPublishedBySlug(env: Env, slug: string): Promise<PublishedSite> {
  const row = await env.DB.prepare(
    `SELECT title, published_tree, published_at
       FROM Projects
      WHERE slug = ?1 AND published_at IS NOT NULL AND published_tree IS NOT NULL`,
  )
    .bind(slug)
    .first<{ title: string; published_tree: string; published_at: number }>();

  if (!row) throw notFound('Aucun site publie a cette adresse.');

  try {
    const { site } = parseSite(row.published_tree);
    return { title: row.title, pages: site.pages, publishedAt: row.published_at };
  } catch (error) {
    if (error instanceof SchemaError) {
      throw serverError(`Site publie illisible : ${error.message}`, error.issues);
    }
    throw error;
  }
}
