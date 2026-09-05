import { useEffect } from 'react';

import { requireSession } from '../../lib/session.js';
import { useBuilderStore } from '../../store/builderStore.js';
import { Canvas } from './Canvas.js';
import { LeftPanel } from './LeftPanel.js';
import { RightInspector } from './RightInspector.js';
import { TopBar } from './TopBar.js';

const AUTOSAVE_DELAY_MS = 2500;

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
    <div className="flex h-screen flex-col overflow-hidden">
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
        <LeftPanel />
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
            Chargement du projet…
          </div>
        ) : (
          <Canvas />
        )}
        <RightInspector />
      </div>
    </div>
  );
}
