import {
  createId,
  createStarterTree,
  parseTree,
  serializeTree,
  SchemaError,
  type PageTree,
} from '@crea/schema';

import type { Env } from '../env.js';
import { badRequest, notFound, serverError } from '../lib/http.js';

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  json_tree: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectSummary {
  tree: PageTree;
}

const MAX_TREE_BYTES = 900_000; // marge sous la limite de taille d une ligne D1.

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toProject(row: ProjectRow): Project {
  try {
    const { tree } = parseTree(row.json_tree);
    return { ...toSummary(row), tree };
  } catch (error) {
    if (error instanceof SchemaError) {
      throw serverError(`Projet ${row.id} corrompu : ${error.message}`, error.issues);
    }
    throw error;
  }
}

export async function listProjects(env: Env, userId: string): Promise<ProjectSummary[]> {
  // `json_tree` n est jamais charge ici : une liste ne doit pas tirer les AST complets.
  const { results } = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM Projects WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(userId)
    .all<Omit<ProjectRow, 'user_id' | 'json_tree'>>();

  return (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
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
  tree?: PageTree,
): Promise<Project> {
  const id = createId('prj');
  const initialTree = tree ?? createStarterTree(title);
  initialTree.meta.title = initialTree.meta.title || title;
  const json = serializeTree(initialTree);

  await env.DB.prepare(
    'INSERT INTO Projects (id, user_id, title, json_tree) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(id, userId, title, json)
    .run();

  return getProject(env, userId, id);
}

export interface UpdateProjectInput {
  title?: string;
  tree?: PageTree;
}

/** Sauvegarde le titre et/ou l AST. L arbre est deja normalise par l appelant. */
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
  if (input.tree !== undefined) {
    const json = serializeTree(input.tree);
    if (json.length > MAX_TREE_BYTES) {
      throw badRequest(`Arbre trop volumineux (${json.length} octets, max ${MAX_TREE_BYTES}).`);
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
