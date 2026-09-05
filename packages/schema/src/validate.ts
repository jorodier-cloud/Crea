import { createNode, DEFAULT_THEME } from './defaults.js';
import { createId } from './ids.js';
import { canHaveChildren } from './tree.js';
import {
  AST_VERSION,
  BLOCK_TYPES,
  type AnyBlockNode,
  type BlockAction,
  type BlockNode,
  type BlockStyles,
  type BlockType,
  type PageTree,
} from './types/schema.js';

export class SchemaError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

const MAX_NODES = 2000;
const MAX_DEPTH = 24;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

const ACTION_TYPES = new Set([
  'navigate',
  'scrollTo',
  'openUrl',
  'submitForm',
  'toggleVisibility',
  'custom',
]);

function sanitizeActions(value: unknown, issues: string[]): BlockAction[] {
  if (!Array.isArray(value)) return [];
  const actions: BlockAction[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || typeof raw['type'] !== 'string') continue;
    if (!ACTION_TYPES.has(raw['type'])) {
      issues.push(`Action inconnue ignoree : ${String(raw['type'])}`);
      continue;
    }
    actions.push(raw as unknown as BlockAction);
  }
  return actions;
}

const STYLE_GROUPS = [
  'layout',
  'size',
  'spacing',
  'typography',
  'background',
  'border',
  'effects',
] as const;

function sanitizeStyles(value: unknown): BlockStyles {
  if (!isPlainObject(value)) return {};
  const styles: BlockStyles = {};
  for (const group of STYLE_GROUPS) {
    const raw = value[group];
    if (isPlainObject(raw)) {
      // Les valeurs sont des primitives CSS : on filtre tout le reste.
      const clean: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(raw)) {
        if (
          typeof item === 'string' ||
          typeof item === 'number' ||
          isPlainObject(item)
        ) {
          clean[key] = item;
        }
      }
      (styles as Record<string, unknown>)[group] = clean;
    }
  }
  if (isPlainObject(value['custom'])) {
    const custom: Record<string, string> = {};
    for (const [key, item] of Object.entries(value['custom'])) {
      if (typeof item === 'string') custom[key] = item;
    }
    styles.custom = custom;
  }
  return styles;
}

/**
 * Normalise un noeud venant d'une source non fiable (D1, IA, import).
 * Les champs manquants sont completes par les valeurs par defaut du type,
 * les champs inconnus sont supprimes, les ids dupliques sont reattribues.
 */
export function normalizeNode(
  input: unknown,
  seen: Set<string>,
  issues: string[],
  depth = 0,
): AnyBlockNode {
  if (depth > MAX_DEPTH) {
    throw new SchemaError(`Profondeur maximale depassee (${MAX_DEPTH}).`, issues);
  }
  if (!isPlainObject(input)) {
    throw new SchemaError('Noeud invalide : objet attendu.', issues);
  }

  const type = isBlockType(input['type']) ? input['type'] : null;
  if (!type) {
    throw new SchemaError(`Type de bloc inconnu : ${String(input['type'])}`, issues);
  }

  let id = typeof input['id'] === 'string' && input['id'].length > 0 ? input['id'] : createId(type.slice(0, 3));
  if (seen.has(id)) {
    issues.push(`Identifiant duplique reattribue : ${id}`);
    id = createId(type.slice(0, 3));
  }
  seen.add(id);

  const template = createNode(type, { id });
  const content = isPlainObject(input['content'])
    ? { ...(template.content as unknown as Record<string, unknown>), ...input['content'] }
    : template.content;

  const childrenInput = Array.isArray(input['children']) ? input['children'] : [];
  const children: AnyBlockNode[] = [];
  if (childrenInput.length > 0 && !canHaveChildren(type)) {
    issues.push(`Le bloc "${type}" ne peut pas contenir d enfants ; ${childrenInput.length} ignore(s).`);
  } else {
    for (const child of childrenInput) {
      children.push(normalizeNode(child, seen, issues, depth + 1));
    }
  }

  const node: AnyBlockNode = {
    id,
    type,
    name: typeof input['name'] === 'string' ? input['name'] : template.name,
    content: content as AnyBlockNode['content'],
    styles: sanitizeStyles(input['styles']),
    actions: sanitizeActions(input['actions'], issues),
    children,
  };

  if (isPlainObject(input['meta'])) {
    node.meta = {
      locked: input['meta']['locked'] === true,
      hidden: input['meta']['hidden'] === true,
      ...(typeof input['meta']['aiOrigin'] === 'string'
        ? { aiOrigin: input['meta']['aiOrigin'] }
        : {}),
    };
  }

  return node;
}

export interface NormalizeTreeResult {
  tree: PageTree;
  issues: string[];
}

/** Normalise un arbre complet. Leve `SchemaError` si la racine est inexploitable. */
export function normalizeTree(input: unknown): NormalizeTreeResult {
  const issues: string[] = [];
  if (!isPlainObject(input)) {
    throw new SchemaError('Arbre invalide : objet attendu.');
  }

  const seen = new Set<string>();
  const root = normalizeNode(input['root'], seen, issues);
  if (root.type !== 'container') {
    throw new SchemaError('La racine de l arbre doit etre un bloc "container".', issues);
  }
  if (seen.size > MAX_NODES) {
    throw new SchemaError(`Arbre trop volumineux (${seen.size} noeuds, max ${MAX_NODES}).`, issues);
  }

  const metaInput = isPlainObject(input['meta']) ? input['meta'] : {};
  const themeInput = isPlainObject(input['theme']) ? input['theme'] : {};

  const tree: PageTree = {
    version: typeof input['version'] === 'number' ? input['version'] : AST_VERSION,
    meta: {
      title: typeof metaInput['title'] === 'string' ? metaInput['title'] : 'Sans titre',
      description: typeof metaInput['description'] === 'string' ? metaInput['description'] : '',
      lang: typeof metaInput['lang'] === 'string' ? metaInput['lang'] : 'fr',
      ...(typeof metaInput['favicon'] === 'string' ? { favicon: metaInput['favicon'] } : {}),
    },
    theme: {
      colors: isPlainObject(themeInput['colors'])
        ? (themeInput['colors'] as Record<string, string>)
        : DEFAULT_THEME.colors,
      fontFamilyBody:
        typeof themeInput['fontFamilyBody'] === 'string'
          ? themeInput['fontFamilyBody']
          : DEFAULT_THEME.fontFamilyBody,
      fontFamilyHeading:
        typeof themeInput['fontFamilyHeading'] === 'string'
          ? themeInput['fontFamilyHeading']
          : DEFAULT_THEME.fontFamilyHeading,
      radius: typeof themeInput['radius'] === 'string' ? themeInput['radius'] : DEFAULT_THEME.radius,
      maxWidth:
        typeof themeInput['maxWidth'] === 'string' ? themeInput['maxWidth'] : DEFAULT_THEME.maxWidth,
    },
    root: root as BlockNode<'container'>,
  };

  return { tree, issues };
}

/** Parse le champ `json_tree` stocke en D1. */
export function parseTree(json: string): NormalizeTreeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SchemaError('json_tree illisible : JSON invalide.');
  }
  return normalizeTree(raw);
}

export function serializeTree(tree: PageTree): string {
  return JSON.stringify(tree);
}
