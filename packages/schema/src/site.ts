import { createStarterTree } from './defaults.js';
import { createId } from './ids.js';
import { normalizeTree, SchemaError } from './validate.js';
import type { PageTree } from './types/schema.js';

export interface SitePage {
  id: string;
  /** '' reservee a la page d accueil, servie a la racine de l adresse publiee. */
  slug: string;
  /** Nom affiche dans le commutateur de pages du builder. */
  label: string;
  tree: PageTree;
}

export interface Site {
  pages: SitePage[];
}

export interface NormalizeSiteResult {
  site: Site;
  issues: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PAGE_SLUG_MAX_LENGTH = 60;

/**
 * Adresse de page : minuscules, ascii, tirets. '' (accueil) reste '' telle
 * quelle. Meme algorithme que `slugify` (cote API, pour l adresse du site) —
 * duplique plutot que partage pour ne pas faire dependre `packages/schema`
 * de `apps/api`.
 */
export function normalizePageSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAGE_SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

function normalizePage(input: unknown, seenSlugs: Set<string>, issues: string[]): SitePage {
  if (!isPlainObject(input)) {
    throw new SchemaError('Page invalide : objet attendu.');
  }

  const { tree, issues: treeIssues } = normalizeTree(input['tree']);
  issues.push(...treeIssues);

  const id = typeof input['id'] === 'string' && input['id'].length > 0 ? input['id'] : createId('page');

  let slug = normalizePageSlug(input['slug']);
  if (seenSlugs.has(slug)) {
    const original = slug;
    const suffix = createId('p').split('_')[1]!.slice(0, 4);
    slug = `${slug || 'page'}-${suffix}`;
    issues.push(`Adresse de page dupliquee reattribuee : "${original}" -> "${slug}"`);
  }
  seenSlugs.add(slug);

  const label =
    typeof input['label'] === 'string' && input['label'].trim().length > 0
      ? input['label'].trim()
      : tree.meta.title || 'Page';

  return { id, slug, label, tree };
}

/**
 * Normalise le contenu de `json_tree` / `published_tree`.
 *
 * Accepte deux formes : la forme multi-page (`{ pages: [...] }`) et la forme
 * historique — un `PageTree` unique stocke directement a la racine, telle que
 * l ecrivaient toutes les versions avant l introduction des pages multiples.
 * Une forme historique devient un site d une seule page ("accueil", adresse
 * racine) : aucune migration necessaire, aucune perte — le prochain
 * enregistrement ecrit directement la forme multi-page.
 */
export function normalizeSite(input: unknown): NormalizeSiteResult {
  const issues: string[] = [];
  if (!isPlainObject(input)) {
    throw new SchemaError('Site invalide : objet attendu.');
  }

  if (Array.isArray(input['pages'])) {
    if (input['pages'].length === 0) {
      throw new SchemaError('Un site doit comporter au moins une page.');
    }
    const seenSlugs = new Set<string>();
    const pages = input['pages'].map((page) => normalizePage(page, seenSlugs, issues));
    return { site: { pages }, issues };
  }

  // Forme historique : un PageTree directement a la racine de l objet.
  const { tree, issues: treeIssues } = normalizeTree(input);
  issues.push(...treeIssues);
  return {
    site: { pages: [{ id: 'home', slug: '', label: tree.meta.title || 'Accueil', tree }] },
    issues,
  };
}

export function parseSite(json: string): NormalizeSiteResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SchemaError('json_tree illisible : JSON invalide.');
  }
  return normalizeSite(raw);
}

export function serializeSite(site: Site): string {
  return JSON.stringify(site);
}

/** Site de depart pour un nouveau projet : une page d accueil. */
export function createEmptySite(title = 'Nouveau site'): Site {
  return { pages: [{ id: 'home', slug: '', label: 'Accueil', tree: createStarterTree(title) }] };
}

/** Trouve une page par son adresse ('' = accueil). */
export function findPageBySlug(site: Site, slug: string): SitePage | null {
  return site.pages.find((page) => page.slug === slug) ?? null;
}
