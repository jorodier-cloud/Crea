import {
  applyOperations,
  canHaveChildren,
  createNode,
  createStarterTree,
  findLocation,
  findNode,
  nearestContainerId,
  type AnyBlockNode,
  type BlockAction,
  type BlockType,
  type DeepPartialStyles,
  type PageTree,
  type TreeOperation,
} from '@crea/schema';
import { create } from 'zustand';

import { api, ApiClientError } from '../lib/api.js';

const HISTORY_LIMIT = 60;

export type DropPosition = 'before' | 'after' | 'inside';

export interface DragState {
  kind: 'move' | 'new';
  nodeId?: string;
  blockType?: BlockType;
}

export interface DropTarget {
  nodeId: string;
  position: DropPosition;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: number;
  cost?: number;
  applied?: number;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BuilderState {
  // Donnees
  projectId: string | null;
  title: string;
  tree: PageTree;
  loading: boolean;
  error: string | null;

  // Selection & interaction
  selectedId: string | null;
  hoveredId: string | null;
  drag: DragState | null;
  dropTarget: DropTarget | null;
  viewport: 'desktop' | 'tablet' | 'mobile';

  // Historique
  past: PageTree[];
  future: PageTree[];

  // Sauvegarde
  dirty: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;

  // IA
  points: number;
  pointsCeiling: number;
  chat: ChatMessage[];
  aiPending: boolean;

  // Actions
  loadProject: (id: string) => Promise<void>;
  setTitle: (title: string) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setViewport: (viewport: BuilderState['viewport']) => void;
  beginDrag: (drag: DragState | null) => void;
  setDropTarget: (target: DropTarget | null) => void;

  runOperations: (operations: TreeOperation[]) => string[];
  addBlock: (type: BlockType, target?: { parentId: string; index?: number }) => void;
  updateContent: (id: string, patch: Record<string, unknown>) => void;
  updateStyles: (id: string, patch: DeepPartialStyles) => void;
  updateActions: (id: string, actions: BlockAction[]) => void;
  renameBlock: (id: string, name: string) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  dropOn: (target: DropTarget) => void;

  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  sendPrompt: (prompt: string) => Promise<void>;
  setPoints: (points: number) => void;
  dismissError: () => void;
}

function messageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Convertit une cible de depot en couple (parent, index) exploitable. */
function resolveDrop(
  tree: PageTree,
  target: DropTarget,
): { parentId: string; index: number } | null {
  const location = findLocation(tree.root, target.nodeId);
  if (!location) return null;

  if (target.position === 'inside') {
    const parentId = canHaveChildren(location.node.type)
      ? location.node.id
      : nearestContainerId(tree.root, location.node.id);
    const parent = findNode(tree.root, parentId);
    return { parentId, index: parent ? parent.children.length : 0 };
  }

  if (!location.parent) {
    // Sans parent (racine), on retombe sur un ajout en fin de racine.
    return { parentId: tree.root.id, index: tree.root.children.length };
  }

  return {
    parentId: location.parent.id,
    index: target.position === 'before' ? location.index : location.index + 1,
  };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  projectId: null,
  title: 'Nouveau site',
  tree: createStarterTree('Nouveau site'),
  loading: false,
  error: null,

  selectedId: null,
  hoveredId: null,
  drag: null,
  dropTarget: null,
  viewport: 'desktop',

  past: [],
  future: [],

  dirty: false,
  saveStatus: 'idle',
  lastSavedAt: null,

  points: 0,
  pointsCeiling: 1000,
  chat: [],
  aiPending: false,

  async loadProject(id) {
    set({ loading: true, error: null });
    try {
      const [{ project }, { user }] = await Promise.all([api.getProject(id), api.me()]);
      set({
        projectId: project.id,
        title: project.title,
        tree: project.tree,
        points: user.iaPointsBalance,
        pointsCeiling: Math.max(1000, user.iaPointsBalance),
        past: [],
        future: [],
        dirty: false,
        loading: false,
        lastSavedAt: project.updatedAt * 1000,
        selectedId: null,
        chat: [
          {
            id: messageId(),
            role: 'system',
            text: 'Decrivez ce que vous voulez construire ou modifier. Selectionnez un bloc pour cibler la demande.',
            at: Date.now(),
          },
        ],
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof ApiClientError ? error.message : 'Chargement impossible.',
      });
    }
  },

  setTitle(title) {
    set((state) => ({
      title,
      tree: { ...state.tree, meta: { ...state.tree.meta, title } },
      dirty: true,
    }));
  },

  select(id) {
    set({ selectedId: id });
  },

  hover(id) {
    set({ hoveredId: id });
  },

  setViewport(viewport) {
    set({ viewport });
  },

  beginDrag(drag) {
    set({ drag, dropTarget: drag ? get().dropTarget : null });
  },

  setDropTarget(target) {
    set({ dropTarget: target });
  },

  /**
   * Point d entree unique de toute mutation de l AST : editeur manuel comme IA
   * passent par ici, ce qui garantit un historique et une validation communs.
   */
  runOperations(operations) {
    if (operations.length === 0) return [];
    const { tree, past } = get();
    const result = applyOperations(tree, operations);

    if (result.applied.length === 0) {
      if (result.errors.length > 0) set({ error: result.errors.join(' ') });
      return result.errors;
    }

    set({
      tree: result.tree,
      past: [...past, tree].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      saveStatus: 'idle',
      ...(result.errors.length > 0 ? { error: result.errors.join(' ') } : {}),
    });

    return result.errors;
  },

  addBlock(type, target) {
    const { tree, selectedId } = get();
    const node = createNode(type);

    let parentId = target?.parentId;
    let index = target?.index;

    if (!parentId) {
      const anchor = selectedId ?? tree.root.id;
      const location = findLocation(tree.root, anchor);
      if (location && location.parent && !canHaveChildren(location.node.type)) {
        parentId = location.parent.id;
        index = location.index + 1;
      } else {
        parentId = nearestContainerId(tree.root, anchor);
      }
    }

    const errors = get().runOperations([
      { op: 'insert', parentId, ...(index !== undefined ? { index } : {}), node },
    ]);
    if (errors.length === 0) set({ selectedId: node.id });
  },

  updateContent(id, patch) {
    get().runOperations([{ op: 'update', id, content: patch }]);
  },

  updateStyles(id, patch) {
    get().runOperations([{ op: 'update', id, styles: patch }]);
  },

  updateActions(id, actions) {
    get().runOperations([{ op: 'update', id, actions }]);
  },

  renameBlock(id, name) {
    get().runOperations([{ op: 'update', id, name }]);
  },

  removeBlock(id) {
    const { tree, selectedId } = get();
    const location = findLocation(tree.root, id);
    const errors = get().runOperations([{ op: 'remove', id }]);
    if (errors.length === 0 && selectedId === id) {
      set({ selectedId: location?.parent?.id ?? null });
    }
  },

  duplicateBlock(id) {
    get().runOperations([{ op: 'duplicate', id }]);
  },

  dropOn(target) {
    const { drag, tree } = get();
    if (!drag) return;

    const resolved = resolveDrop(tree, target);
    set({ drag: null, dropTarget: null });
    if (!resolved) return;

    if (drag.kind === 'new' && drag.blockType) {
      get().addBlock(drag.blockType, resolved);
      return;
    }

    if (drag.kind === 'move' && drag.nodeId) {
      if (drag.nodeId === resolved.parentId) return;
      const location = findLocation(tree.root, drag.nodeId);
      // Un deplacement au sein du meme parent decale l index apres retrait.
      let index = resolved.index;
      if (location?.parent?.id === resolved.parentId && location.index < resolved.index) {
        index -= 1;
      }
      const errors = get().runOperations([
        { op: 'move', id: drag.nodeId, parentId: resolved.parentId, index },
      ]);
      if (errors.length === 0) set({ selectedId: drag.nodeId });
    }
  },

  undo() {
    const { past, future, tree } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set({
      tree: previous,
      past: past.slice(0, -1),
      future: [tree, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo() {
    const { past, future, tree } = get();
    const next = future[0];
    if (!next) return;
    set({
      tree: next,
      past: [...past, tree].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
    });
  },

  async save() {
    const { projectId, tree, title, dirty, saveStatus } = get();
    if (!projectId || !dirty || saveStatus === 'saving') return;

    set({ saveStatus: 'saving' });
    try {
      await api.saveProject(projectId, { title, tree });
      set({ saveStatus: 'saved', dirty: false, lastSavedAt: Date.now() });
    } catch (error) {
      set({
        saveStatus: 'error',
        error: error instanceof ApiClientError ? error.message : 'Sauvegarde impossible.',
      });
    }
  },

  /**
   * Envoie l etat courant de l AST au moteur IA et adopte l arbre retourne.
   * Le serveur a deja valide et sauvegarde : ici on ne fait qu afficher.
   */
  async sendPrompt(prompt) {
    const { projectId, tree, selectedId, chat, aiPending } = get();
    if (!projectId || aiPending || prompt.trim().length === 0) return;

    const userMessage: ChatMessage = {
      id: messageId(),
      role: 'user',
      text: prompt.trim(),
      at: Date.now(),
    };
    set({ chat: [...chat, userMessage], aiPending: true, error: null });

    try {
      const result = await api.aiPrompt({
        projectId,
        prompt: prompt.trim(),
        tree,
        selectedNodeId: selectedId,
      });

      set((state) => ({
        tree: result.tree,
        past: [...state.past, tree].slice(-HISTORY_LIMIT),
        future: [],
        dirty: !result.saved,
        lastSavedAt: result.saved ? Date.now() : state.lastSavedAt,
        points: result.points.balance,
        aiPending: false,
        chat: [
          ...state.chat,
          {
            id: messageId(),
            role: 'assistant',
            text:
              result.message ||
              (result.applied > 0 ? 'Modifications appliquees.' : 'Aucune modification.'),
            at: Date.now(),
            cost: result.points.spent,
            applied: result.applied,
          },
          ...(result.errors.length > 0
            ? [
                {
                  id: messageId(),
                  role: 'system' as const,
                  text: `Operations ignorees : ${result.errors.join(' ')}`,
                  at: Date.now(),
                },
              ]
            : []),
        ],
      }));
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Le moteur IA n a pas repondu.';
      set((state) => ({
        aiPending: false,
        chat: [
          ...state.chat,
          { id: messageId(), role: 'system', text: message, at: Date.now() },
        ],
      }));
    }
  },

  setPoints(points) {
    set({ points });
  },

  dismissError() {
    set({ error: null });
  },
}));

/** Selecteur : noeud actuellement selectionne. */
export function useSelectedNode(): AnyBlockNode | null {
  return useBuilderStore((state) =>
    state.selectedId ? findNode(state.tree.root, state.selectedId) : null,
  );
}
