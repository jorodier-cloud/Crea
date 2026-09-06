import { useEffect } from 'react';

import { requireSession } from '../../lib/session.js';
import { useBuilderStore, type Pane } from '../../store/builderStore.js';
import { Canvas } from './Canvas.js';
import { LeftPanel } from './LeftPanel.js';
import { RightInspector } from './RightInspector.js';
import { TopBar } from './TopBar.js';

const AUTOSAVE_DELAY_MS = 2500;

/**
 * Sous le seuil `lg`, les trois zones ne tiennent pas cote a cote : 340 + 320
 * pixels de panneaux ne laissent rien au canvas sur un telephone. Une seule est
 * alors visible, choisie par la barre du bas. Au-dessus du seuil, rien ne
 * change — les trois colonnes restent affichees ensemble.
 */
const PANES: ReadonlyArray<{ value: Pane; label: string; icon: string }> = [
  { value: 'chat', label: 'Chat IA', icon: '✦' },
  { value: 'page', label: 'Page', icon: '▤' },
  { value: 'reglages', label: 'Reglages', icon: '⚙' },
];

/**
 * Classes d une zone. Sur mobile elle occupe tout l espace ou disparait ; sur
 * grand ecran les trois sont visibles, et seul le canvas s etire.
 *
 * `grow` est un parametre plutot qu une classe ajoutee par l appelant :
 * `lg:flex-1` et `lg:flex-none` ont la meme specificite, et la feuille de
 * style — non l ordre d ecriture — trancherait entre les deux.
 */
function paneClasses(active: boolean, grow = false): string {
  return [
    active ? 'flex' : 'hidden',
    'min-h-0 min-w-0 flex-1 lg:flex',
    grow ? 'lg:flex-1' : 'lg:flex-none',
  ].join(' ');
}

interface BuilderProps {
  projectId: string;
}

/** Assemble les trois zones et pilote chargement, autosave et raccourcis. */
export function Builder({ projectId }: BuilderProps): React.ReactElement {
  const loadProject = useBuilderStore((state) => state.loadProject);
  const loading = useBuilderStore((state) => state.loading);
  const error = useBuilderStore((state) => state.error);
  const dismissError = useBuilderStore((state) => state.dismissError);
  const dirty = useBuilderStore((state) => state.dirty);
  const tree = useBuilderStore((state) => state.tree);
  const selectedId = useBuilderStore((state) => state.selectedId);
  const pane = useBuilderStore((state) => state.activePane);
  const setPane = useBuilderStore((state) => state.setPane);

  useEffect(() => {
    if (!requireSession()) return;
    void loadProject(projectId);
  }, [projectId, loadProject]);

  // Autosave : une pause de 2,5 s sans modification declenche l ecriture en D1.
  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      void useBuilderStore.getState().save();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, tree]);

  // Avertit avant de fermer un onglet avec des modifications non enregistrees.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!useBuilderStore.getState().dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const store = useBuilderStore.getState();
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.save();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace') && store.selectedId) {
        if (store.selectedId === store.tree.root.id) return;
        event.preventDefault();
        store.removeBlock(store.selectedId);
        return;
      }
      if (event.key === 'Escape') store.select(null);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    // `dvh` plutot que `vh` : sur mobile, la barre d adresse retractable fausse
    // `100vh` et fait deborder la page sous l ecran.
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar />

      {error && (
        <div className="flex items-center justify-between gap-4 border-b border-[#E0C4BB] bg-[#FBEFEC] px-4 py-2 text-[12px] text-[#8C3F2C]">
          <span>{error}</span>
          <button type="button" onClick={dismissError} className="font-semibold">
            Fermer
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={paneClasses(pane === 'chat')}>
          <LeftPanel />
        </div>

        <div className={paneClasses(pane === 'page', true)}>
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
              Chargement du projet…
            </div>
          ) : (
            <Canvas />
          )}
        </div>

        <div className={paneClasses(pane === 'reglages')}>
          <RightInspector />
        </div>
      </div>

      {/* Barre de navigation tactile. `pb-safe` degage la barre systeme iOS. */}
      <nav className="crea-panel flex shrink-0 border-t pb-[env(safe-area-inset-bottom)] lg:hidden">
        {PANES.map((item) => {
          const active = pane === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setPane(item.value)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                active ? 'text-forest' : 'text-muted'
              }`}
            >
              <span aria-hidden="true" className="text-[15px] leading-none">
                {item.icon}
              </span>
              {item.label}
              {/* Un bloc selectionne a des reglages a voir : on le signale. */}
              {item.value === 'reglages' && selectedId && !active && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-[28%] h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
