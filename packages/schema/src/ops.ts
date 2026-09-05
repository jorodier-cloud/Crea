import {
  canHaveChildren,
  cloneTree,
  findLocation,
  findNode,
  insertChild,
  isDescendant,
  reassignIds,
  removeNode,
} from './tree.js';
import { normalizeNode, type NormalizeTreeResult } from './validate.js';
import { collectIds } from './tree.js';
import type {
  AnyBlockNode,
  BlockNode,
  BlockStyles,
  DeepPartialStyles,
  OperationResult,
  PageTree,
  TreeOperation,
} from './types/schema.js';

const STYLE_GROUPS: (keyof DeepPartialStyles)[] = [
  'layout',
  'size',
  'spacing',
  'typography',
  'background',
  'border',
  'effects',
  'custom',
];

/**
 * Fusion superficielle par famille de styles : `styles.spacing.padding` remplace
 * l ancien padding, mais `styles.typography` reste intact si non fourni.
 */
export function mergeStyles(base: BlockStyles, patch: DeepPartialStyles): BlockStyles {
  const next: BlockStyles = { ...base };
  for (const group of STYLE_GROUPS) {
    const incoming = patch[group];
    if (incoming === undefined) continue;
    const current = (base as Record<string, unknown>)[group];
    (next as Record<string, unknown>)[group] = {
      ...(typeof current === 'object' && current !== null ? current : {}),
      ...incoming,
    };
  }
  return next;
}

function applyOne(tree: PageTree, operation: TreeOperation, issues: string[]): void {
  switch (operation.op) {
    case 'insert': {
      const parent = findNode(tree.root, operation.parentId);
      if (!parent) throw new Error(`Parent introuvable : ${operation.parentId}`);
      if (!canHaveChildren(parent.type)) {
        throw new Error(`Le bloc "${parent.type}" (${parent.id}) n accepte pas d enfants.`);
      }
      const seen = collectIds(tree.root);
      const node = normalizeNode(operation.node, seen, issues);
      insertChild(parent, node, operation.index);
      break;
    }

    case 'update': {
      const node = findNode(tree.root, operation.id);
      if (!node) throw new Error(`Noeud introuvable : ${operation.id}`);
      if (operation.name !== undefined) node.name = operation.name;
      if (operation.content !== undefined) {
        node.content = {
          ...(node.content as unknown as Record<string, unknown>),
          ...operation.content,
        } as unknown as AnyBlockNode['content'];
      }
      if (operation.styles !== undefined) {
        node.styles = mergeStyles(node.styles, operation.styles);
      }
      if (operation.actions !== undefined) node.actions = operation.actions;
      if (operation.meta !== undefined) node.meta = { ...node.meta, ...operation.meta };
      break;
    }

    case 'remove': {
      if (operation.id === tree.root.id) throw new Error('La racine ne peut pas etre supprimee.');
      const removed = removeNode(tree.root, operation.id);
      if (!removed) throw new Error(`Noeud introuvable : ${operation.id}`);
      break;
    }

    case 'move': {
      if (operation.id === tree.root.id) throw new Error('La racine ne peut pas etre deplacee.');
      if (operation.id === operation.parentId) throw new Error('Un noeud ne peut pas etre son propre parent.');
      if (isDescendant(tree.root, operation.id, operation.parentId)) {
        throw new Error('Deplacement impossible : le parent cible est un descendant du noeud.');
      }
      const parent = findNode(tree.root, operation.parentId);
      if (!parent) throw new Error(`Parent introuvable : ${operation.parentId}`);
      if (!canHaveChildren(parent.type)) {
        throw new Error(`Le bloc "${parent.type}" (${parent.id}) n accepte pas d enfants.`);
      }
      const node = removeNode(tree.root, operation.id);
      if (!node) throw new Error(`Noeud introuvable : ${operation.id}`);
      insertChild(parent, node, operation.index);
      break;
    }

    case 'duplicate': {
      const location = findLocation(tree.root, operation.id);
      if (!location || !location.parent) throw new Error(`Noeud dupliquable introuvable : ${operation.id}`);
      const copy = reassignIds(location.node);
      copy.name = `${copy.name ?? location.node.type} (copie)`;
      insertChild(location.parent, copy, location.index + 1);
      break;
    }

    case 'setMeta': {
      if (operation.title !== undefined) tree.meta.title = operation.title;
      if (operation.description !== undefined) tree.meta.description = operation.description;
      if (operation.lang !== undefined) tree.meta.lang = operation.lang;
      break;
    }

    case 'setTheme': {
      tree.theme = {
        ...tree.theme,
        ...operation.theme,
        colors: { ...tree.theme.colors, ...(operation.theme.colors ?? {}) },
      };
      break;
    }

    case 'replaceRoot': {
      const node = normalizeNode(operation.node, new Set<string>(), issues);
      if (node.type !== 'container') throw new Error('La racine doit etre un bloc "container".');
      tree.root = node as BlockNode<'container'>;
      break;
    }

    default: {
      const never: never = operation;
      throw new Error(`Operation inconnue : ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Applique une liste d operations de facon transactionnelle par operation :
 * une operation invalide est ignoree et signalee, les autres passent.
 * L arbre d entree n est jamais mute.
 */
export function applyOperations(tree: PageTree, operations: TreeOperation[]): OperationResult {
  const next = cloneTree(tree);
  const applied: TreeOperation[] = [];
  const errors: string[] = [];

  for (const operation of operations) {
    const snapshot = cloneTree(next);
    try {
      applyOne(next, operation, errors);
      applied.push(operation);
    } catch (error) {
      // Rollback de cette operation uniquement.
      next.root = snapshot.root;
      next.meta = snapshot.meta;
      next.theme = snapshot.theme;
      errors.push(
        `[${operation.op}] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { tree: next, applied, errors };
}

export type { NormalizeTreeResult };
