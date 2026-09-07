import {
  applyOperations,
  canHaveChildren,
  createId,
  createNode,
  createStarterTree,
  diffChangedNodeIds,
  findLocation,
  findNode,
  nearestContainerId,
  normalizePageSlug,
  type AnyBlockNode,
  type BlockAction,
  type BlockType,
  type DeepPartialStyles,
  type PageTree,
  type SitePage,
  type TreeOperation,
} from '@crea/schema';
import { create } from 'zustand';

import { api, ApiClientError } from '../lib/api.js';

const HISTORY_LIMIT = 60;

/**
 * En dessous du seuil `lg`, une seule zone est visible a la fois (barre du
 * bas). Vit dans le store, pas dans un `useState` de `Builder`, pour qu une
 * action lancee depuis n importe quel panneau (ex. ajouter un bloc depuis la
 * palette) puisse faire basculer la vue sur le resultat.
 */
export type Pane = 'chat' | 'page' | 'reglages';

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
  /** Etat de l arbre juste avant cette reponse — permet d y revenir d un geste. */
  beforeTree?: PageTree;
  /** Blocs touches par cette reponse, pour les faire clignoter dans le canvas. */
  changedIds?: string[];
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BuilderState {
  // Donnees
  projectId: string | null;
  title: string;
  /** Arbre de la page actuellement editee — les AUTRES pages vivent dans `pages`. */
  tree: PageTree;
  /**
   * Toutes les pages du site, y compris la page active : `tree` en est un
   * miroir de travail, resynchronise dans `pages` a la sauvegarde et au
   * changement de page (voir `save` et `switchPage`). Les autres actions ne
   * touchent jamais `pages` directement.
   */
  pages: SitePage[];
  currentPageId: string;
  loading: boolean;
  error: string | null;

  // Selection & interaction
  selectedId: string | null;
  hoveredId: string | null;
  drag: DragState | null;
  dropTarget: DropTarget | null;
  viewport: 'desktop' | 'tablet' | 'mobile';
  activePane: Pane;

  // Historique
  past: PageTree[];
  future: PageTree[];

  // Sauvegarde
  dirty: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;

  // Publication
  slug: string | null;
  publishedAt: number | null;
  publicUrl: string | null;
  publishing: boolean;

  // IA
  points: number;
  pointsCeiling: number;
  chat: ChatMessage[];
  aiPending: boolean;
  /** Blocs a mettre en evidence dans le canvas — la derniere reponse de l IA. */
  highlightedIds: string[];

  // Actions
  loadProject: (id: string) => Promise<void>;
  setTitle: (title: string) => void;
  /** Bascule d edition sur une autre page du site, en sauvegardant la page quittee en memoire. */
  switchPage: (pageId: string) => void;
  addPage: (label: string) => void;
  renamePage: (pageId: string, patch: { label?: string; slug?: string }) => void;
  removePage: (pageId: string) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setViewport: (viewport: BuilderState['viewport']) => void;
  setPane: (pane: Pane) => void;
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
  /** Deplace un bloc d un cran parmi ses freres. Sans glisser-deposer. */
  nudgeBlock: (id: string, direction: -1 | 1) => void;
  dropOn: (target: DropTarget) => void;

  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  publish: (slug?: string) => Promise<void>;
  unpublish: () => Promise<void>;
  sendPrompt: (prompt: string) => Promise<void>;
  /** Restaure l arbre tel qu il etait juste avant la reponse donnee. */
  revertMessage: (id: string) => void;
  setPoints: (points: number) => void;
  dismissError: () => void;
}

function messageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Conversation de depart, la meme au chargement du projet qu au changement de page. */
function freshChat(): ChatMessage[] {
  return [
    {
      id: messageId(),
      role: 'system',
      text: 'Decrivez ce que vous voulez construire ou modifier. Selectionnez un bloc pour cibler la demande.',
      at: Date.now(),
    },
  ];
}

/** Adresse de page libre : reprend celle demandee, ou en derive une disponible. */
function freePageSlug(candidate: string, taken: ReadonlySet<string>): string {
  const base = normalizePageSlug(candidate);
  if (base && !taken.has(base)) return base;
  const suffix = createId('p').split('_')[1]!.slice(0, 4);
  return `${base || 'page'}-${suffix}`;
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
  pages: [],
  currentPageId: '',
  loading: false,
  error: null,

  selectedId: null,
  hoveredId: null,
  drag: null,
  dropTarget: null,
  viewport: 'desktop',
  activePane: 'page',

  past: [],
  future: [],

  dirty: false,
  saveStatus: 'idle',
  lastSavedAt: null,

  slug: null,
  publishedAt: null,
  publicUrl: null,
  publishing: false,

  points: 0,
  pointsCeiling: 1000,
  chat: [],
  aiPending: false,
  highlightedIds: [],

  async loadProject(id) {
    set({ loading: true, error: null });
    try {
      const [{ project, publicUrl }, { user }] = await Promise.all([
        api.getProject(id),
        api.me(),
      ]);
      const homePage = project.pages[0]!;
      set({
        projectId: project.id,
        title: project.title,
        tree: homePage.tree,
        pages: project.pages,
        currentPageId: homePage.id,
        slug: project.slug,
        publishedAt: project.publishedAt,
        publicUrl,
        points: user.iaPointsBalance,
        pointsCeiling: Math.max(1000, user.iaPointsBalance),
        past: [],
        future: [],
        dirty: false,
        loading: false,
        lastSavedAt: project.updatedAt * 1000,
        selectedId: null,
        highlightedIds: [],
        chat: freshChat(),
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

  /**
   * Bascule sur une autre page. L historique (annuler/retablir), la selection
   * et la conversation sont propres a chaque page : les garder d une page a
   * l autre exposerait par ex. un "Revenir a avant" qui restaurerait l arbre
   * d une AUTRE page dans `tree`.
   */
  switchPage(pageId) {
    const { pages, currentPageId, tree } = get();
    if (pageId === currentPageId) return;
    const target = pages.find((page) => page.id === pageId);
    if (!target) return;

    set({
      // La page quittee garde son etat exact : rien n est perdu en changeant
      // d onglet sans avoir clique sur Enregistrer.
      pages: pages.map((page) => (page.id === currentPageId ? { ...page, tree } : page)),
      currentPageId: pageId,
      tree: target.tree,
      selectedId: null,
      hoveredId: null,
      past: [],
      future: [],
      highlightedIds: [],
      chat: freshChat(),
    });
  },

  addPage(label) {
    const { pages, tree, currentPageId } = get();
    const trimmed = label.trim() || 'Nouvelle page';
    const slug = freePageSlug(trimmed, new Set(pages.map((page) => page.slug)));

    const newPage: SitePage = {
      id: createId('page'),
      slug,
      label: trimmed,
      tree: createStarterTree(trimmed),
    };

    set({
      pages: [
        ...pages.map((page) => (page.id === currentPageId ? { ...page, tree } : page)),
        newPage,
      ],
      currentPageId: newPage.id,
      tree: newPage.tree,
      selectedId: null,
      past: [],
      future: [],
      highlightedIds: [],
      dirty: true,
      chat: freshChat(),
    });
  },

  renamePage(pageId, patch) {
    set((state) => ({
      pages: state.pages.map((page) => {
        if (page.id !== pageId) return page;
        const label = patch.label !== undefined ? patch.label.trim() || page.label : page.label;

        // L accueil garde toujours l adresse racine ('') ; les autres pages ne
        // peuvent jamais la reprendre, deja tenue par elle.
        let slug = page.slug;
        if (patch.slug !== undefined && page.slug !== '') {
          const normalized = normalizePageSlug(patch.slug);
          const taken = state.pages.some((other) => other.id !== pageId && other.slug === normalized);
          if (normalized && !taken) slug = normalized;
        }

        return { ...page, label, slug };
      }),
      dirty: true,
    }));
  },

  removePage(pageId) {
    const { pages, currentPageId } = get();
    if (pages.length <= 1) return;
    const target = pages.find((page) => page.id === pageId);
    // L accueil ne se supprime pas : /p/<adresse> doit toujours resoudre a une page.
    if (!target || target.slug === '') return;

    const remaining = pages.filter((page) => page.id !== pageId);
    const isCurrent = pageId === currentPageId;
    const nextCurrent = isCurrent
      ? remaining[0]!
      : remaining.find((page) => page.id === currentPageId)!;

    set({
      pages: remaining,
      currentPageId: nextCurrent.id,
      dirty: true,
      ...(isCurrent
        ? {
            tree: nextCurrent.tree,
            selectedId: null,
            past: [],
            future: [],
            highlightedIds: [],
            chat: freshChat(),
          }
        : {}),
    });
  },

  select(id) {
    set({ selectedId: id });
  },

  hover(id) {
    set({ hoveredId: id });
  },

  setPane(pane) {
    set({ activePane: pane });
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
    // Sur telephone, la palette et la page ne sont jamais visibles ensemble :
    // sans ce basculement, toucher un bloc ne montre aucun resultat et rien
    // ne distingue "ajoute mais invisible" de "n a rien fait".
    if (errors.length === 0) {
      set({ selectedId: node.id, activePane: 'page', highlightedIds: [node.id] });
      setTimeout(() => {
        set((state) => (state.highlightedIds.includes(node.id) ? { highlightedIds: [] } : {}));
      }, 1600);
    }
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

  /**
   * Monte ou descend un bloc d un cran parmi ses freres.
   *
   * Le glisser-deposer HTML5 n existe pas sur ecran tactile : sans cette
   * action, reorganiser une page depuis un telephone serait impossible.
   */
  nudgeBlock(id, direction) {
    const { tree } = get();
    const location = findLocation(tree.root, id);
    if (!location?.parent) return;

    const index = location.index + direction;
    if (index < 0 || index >= location.parent.children.length) return;

    const errors = get().runOperations([
      { op: 'move', id, parentId: location.parent.id, index },
    ]);
    if (errors.length === 0) set({ selectedId: id });
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
    const { projectId, tree, pages, currentPageId, title, dirty, saveStatus } = get();
    if (!projectId || !dirty || saveStatus === 'saving') return;

    // `tree` est la copie de travail de la page active ; les autres pages
    // sont deja a jour dans `pages` (voir `switchPage`/`addPage`/`removePage`).
    const upToDatePages = pages.map((page) => (page.id === currentPageId ? { ...page, tree } : page));

    set({ saveStatus: 'saving' });
    try {
      await api.saveProject(projectId, { title, pages: upToDatePages });
      set({ saveStatus: 'saved', dirty: false, lastSavedAt: Date.now(), pages: upToDatePages });
    } catch (error) {
      set({
        saveStatus: 'error',
        error: error instanceof ApiClientError ? error.message : 'Sauvegarde impossible.',
      });
    }
  },

  /**
   * Met le site en ligne.
   *
   * La publication fige ce qui est EN BASE : on force donc la sauvegarde avant,
   * sinon les dernieres retouches ne partiraient pas en ligne.
   */
  async publish(slug) {
    const { projectId, publishing, dirty } = get();
    if (!projectId || publishing) return;

    set({ publishing: true, error: null });
    try {
      if (dirty) await get().save();
      const result = await api.publishProject(projectId, slug);
      set({
        publishing: false,
        slug: result.project.slug,
        publishedAt: result.project.publishedAt,
        publicUrl: result.publicUrl,
      });
    } catch (error) {
      set({
        publishing: false,
        error: error instanceof ApiClientError ? error.message : 'Publication impossible.',
      });
    }
  },

  async unpublish() {
    const { projectId, publishing } = get();
    if (!projectId || publishing) return;

    set({ publishing: true, error: null });
    try {
      const result = await api.unpublishProject(projectId);
      set({
        publishing: false,
        slug: result.project.slug,
        publishedAt: null,
        publicUrl: null,
      });
    } catch (error) {
      set({
        publishing: false,
        error: error instanceof ApiClientError ? error.message : 'Retrait impossible.',
      });
    }
  },

  /**
   * Envoie l etat courant de l AST au moteur IA et adopte l arbre retourne.
   * Le serveur a deja valide et sauvegarde : ici on ne fait qu afficher.
   */
  async sendPrompt(prompt) {
    const { projectId, currentPageId, tree, selectedId, chat, aiPending } = get();
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
        pageId: currentPageId,
        prompt: prompt.trim(),
        tree,
        selectedNodeId: selectedId,
      });

      // Blocs touches par cette reponse : sert au clignotement dans le canvas
      // et n a de sens qu en comparaison de l arbre d avant, capture ci-dessus.
      const changedIds = diffChangedNodeIds(tree.root, result.tree.root);

      set((state) => ({
        tree: result.tree,
        past: [...state.past, tree].slice(-HISTORY_LIMIT),
        future: [],
        dirty: !result.saved,
        lastSavedAt: result.saved ? Date.now() : state.lastSavedAt,
        points: result.points.balance,
        aiPending: false,
        highlightedIds: changedIds,
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
            beforeTree: tree,
            changedIds,
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

      // Le clignotement s eteint de lui-meme ; une reponse plus recente qui en
      // aurait deja pose un autre n est jamais effacee par erreur (comparaison
      // par reference du tableau).
      if (changedIds.length > 0) {
        setTimeout(() => {
          set((state) => (state.highlightedIds === changedIds ? { highlightedIds: [] } : {}));
        }, 1600);
      }
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

  /**
   * Restaure l arbre tel qu il etait juste avant une reponse donnee de l IA.
   *
   * Un geste visible dans la conversation, plutot que le seul Ctrl+Z : quand
   * on ne pense pas en raccourcis clavier, un bouton sous le message est ce
   * qu on cherche d instinct pour revenir en arriere.
   */
  revertMessage(id) {
    const message = get().chat.find((entry) => entry.id === id);
    if (!message?.beforeTree) return;
    const beforeTree = message.beforeTree;

    set((state) => ({
      tree: beforeTree,
      past: [...state.past, state.tree].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      selectedId: null,
      highlightedIds: [],
    }));
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
