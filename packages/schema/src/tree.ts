import { createId } from './ids.js';
import {
  CONTAINER_TYPES,
  type AnyBlockNode,
  type BlockType,
  type PageTree,
} from './types/schema.js';

export interface NodeLocation {
  node: AnyBlockNode;
  parent: AnyBlockNode | null;
  index: number;
  depth: number;
}

export function canHaveChildren(type: BlockType): boolean {
  return CONTAINER_TYPES.includes(type);
}

/** Copie profonde, sans dependance externe (les noeuds sont du JSON pur). */
export function cloneNode<T extends AnyBlockNode>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

export function cloneTree(tree: PageTree): PageTree {
  return JSON.parse(JSON.stringify(tree)) as PageTree;
}

/** Parcours prefixe de l'arbre. Retourner `false` coupe la descente. */
export function walk(
  root: AnyBlockNode,
  visit: (location: NodeLocation) => void | false,
): void {
  const stack: NodeLocation[] = [{ node: root, parent: null, index: 0, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visit(current) === false) continue;
    const children = current.node.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: children[i]!,
        parent: current.node,
        index: i,
        depth: current.depth + 1,
      });
    }
  }
}

export function findLocation(root: AnyBlockNode, id: string): NodeLocation | null {
  const stack: NodeLocation[] = [{ node: root, parent: null, index: 0, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node.id === id) return current;
    const children = current.node.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: children[i]!,
        parent: current.node,
        index: i,
        depth: current.depth + 1,
      });
    }
  }
  return null;
}

export function findNode(root: AnyBlockNode, id: string): AnyBlockNode | null {
  return findLocation(root, id)?.node ?? null;
}

export function getAncestors(root: AnyBlockNode, id: string): AnyBlockNode[] {
  const path: AnyBlockNode[] = [];

  const dive = (node: AnyBlockNode): boolean => {
    if (node.id === id) return true;
    for (const child of node.children) {
      path.push(node);
      if (dive(child)) return true;
      path.pop();
    }
    return false;
  };

  return dive(root) ? path : [];
}

export function isDescendant(root: AnyBlockNode, ancestorId: string, candidateId: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (!ancestor) return false;
  return findNode(ancestor, candidateId) !== null && ancestorId !== candidateId;
}

export function collectIds(root: AnyBlockNode): Set<string> {
  const ids = new Set<string>();
  walk(root, ({ node }) => {
    ids.add(node.id);
  });
  return ids;
}

export function countNodes(root: AnyBlockNode): number {
  let total = 0;
  walk(root, () => {
    total += 1;
  });
  return total;
}

/** Reattribue des identifiants frais a un sous-arbre (duplication, copier-coller). */
export function reassignIds<T extends AnyBlockNode>(node: T): T {
  const copy = cloneNode(node);
  walk(copy, ({ node: current }) => {
    current.id = createId(current.type.slice(0, 3));
  });
  return copy;
}

export function insertChild(
  parent: AnyBlockNode,
  node: AnyBlockNode,
  index?: number,
): void {
  const target = index === undefined ? parent.children.length : index;
  const safeIndex = Math.max(0, Math.min(target, parent.children.length));
  parent.children.splice(safeIndex, 0, node);
}

export function removeNode(root: AnyBlockNode, id: string): AnyBlockNode | null {
  const location = findLocation(root, id);
  if (!location || !location.parent) return null;
  const [removed] = location.parent.children.splice(location.index, 1);
  return removed ?? null;
}

/** Retourne l'id du parent le plus proche pouvant accueillir des enfants. */
export function nearestContainerId(root: AnyBlockNode, id: string): string {
  const node = findNode(root, id);
  if (node && canHaveChildren(node.type)) return node.id;
  const ancestors = getAncestors(root, id);
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const candidate = ancestors[i]!;
    if (canHaveChildren(candidate.type)) return candidate.id;
  }
  return root.id;
}

/**
 * Identifiants des blocs qui different entre deux arbres — nouveaux ou
 * modifies. Sert a mettre en evidence dans le canvas ce que l IA vient de
 * changer : sans repere visuel, une reponse qui deplace trois blocs dans un
 * arbre de cinquante noeuds est illisible.
 *
 * Un bloc supprime n a pas d id a signaler : il n existe plus a montrer.
 * `children` est exclu de la comparaison de contenu — un conteneur ne doit pas
 * paraitre modifie seulement parce qu un descendant l est.
 */
export function diffChangedNodeIds(before: AnyBlockNode, after: AnyBlockNode): string[] {
  const beforeById = new Map<string, AnyBlockNode>();
  walk(before, ({ node }) => {
    beforeById.set(node.id, node);
  });

  const changed: string[] = [];
  walk(after, ({ node }) => {
    const previous = beforeById.get(node.id);
    if (!previous) {
      changed.push(node.id);
      return;
    }
    const ownFields = (n: AnyBlockNode) => ({
      name: n.name,
      content: n.content,
      styles: n.styles,
      actions: n.actions,
    });
    if (JSON.stringify(ownFields(previous)) !== JSON.stringify(ownFields(node))) {
      changed.push(node.id);
    }
  });
  return changed;
}

/** Resume compact de l'arbre, injecte dans le prompt systeme de l'IA. */
export function outlineTree(root: AnyBlockNode, maxDepth = 6): string {
  const lines: string[] = [];
  walk(root, ({ node, depth }) => {
    if (depth > maxDepth) return false;
    const indent = '  '.repeat(depth);
    let label = '';
    if (node.type === 'text') {
      const text = (node.content as { text: string }).text;
      label = ` "${text.slice(0, 60)}"`;
    } else if (node.type === 'button') {
      label = ` "${(node.content as { label: string }).label}"`;
    }
    lines.push(`${indent}- ${node.type}#${node.id}${label}`);
    return undefined;
  });
  return lines.join('\n');
}
