import { DEFAULT_BLOCK_LABEL, findLocation } from '@crea/schema';
import { useState } from 'react';

import { useBuilderStore, useSelectedNode } from '../../store/builderStore.js';
import { ActionFields } from './inspector/ActionFields.js';
import { ContentFields } from './inspector/ContentFields.js';
import { Section, TextField, type InspectorMode } from './inspector/Fields.js';
import { StyleFields } from './inspector/StyleFields.js';

type Tab = 'contenu' | 'style' | 'actions';

const MODE_STORAGE_KEY = 'crea.inspectorMode';

function readStoredMode(): InspectorMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'avance' ? 'avance' : 'simple';
  } catch {
    return 'simple';
  }
}

/**
 * Zone droite : edition manuelle du bloc selectionne, sans passer par l IA.
 * Chaque champ ecrit une operation `update` sur l AST.
 */
export function RightInspector(): React.ReactElement {
  const node = useSelectedNode();
  const updateContent = useBuilderStore((state) => state.updateContent);
  const updateStyles = useBuilderStore((state) => state.updateStyles);
  const updateActions = useBuilderStore((state) => state.updateActions);
  const renameBlock = useBuilderStore((state) => state.renameBlock);
  const removeBlock = useBuilderStore((state) => state.removeBlock);
  const duplicateBlock = useBuilderStore((state) => state.duplicateBlock);
  const nudgeBlock = useBuilderStore((state) => state.nudgeBlock);
  const treeRoot = useBuilderStore((state) => state.tree.root);
  const rootId = treeRoot.id;

  const [tab, setTab] = useState<Tab>('contenu');
  const [mode, setMode] = useState<InspectorMode>(readStoredMode);

  const setModeAndPersist = (next: InspectorMode): void => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Stockage indisponible (navigation privee) : le choix reste valable pour la session.
    }
  };

  if (!node) {
    return (
      <aside className="crea-panel w-full min-w-0 border-l p-6 lg:w-[320px] lg:shrink-0">
        <p className="text-[13px] leading-relaxed text-muted">
          Selectionnez un bloc dans le canvas pour en modifier le contenu, le style et les
          actions.
        </p>
      </aside>
    );
  }

  const isRoot = node.id === rootId;

  return (
    <aside className="crea-panel flex w-full min-w-0 flex-col border-l lg:w-[320px] lg:shrink-0">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-linen px-2 py-0.5 text-[11px] font-semibold text-forest">
            {DEFAULT_BLOCK_LABEL[node.type]}
          </span>
          {/* Simple cache le vocabulaire CSS ; avance montre tous les reglages.
              Persiste : on ne redecide pas a chaque bloc selectionne. */}
          <div className="flex overflow-hidden rounded-full border border-line text-[11px] font-semibold">
            {(['simple', 'avance'] as InspectorMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setModeAndPersist(item)}
                className={`px-2.5 py-1 capitalize transition-colors ${
                  mode === item ? 'bg-forest text-white' : 'bg-white text-muted hover:text-forest'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav className="flex border-b border-line text-[12px] font-semibold">
        {(['contenu', 'style', 'actions'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`flex-1 px-2 py-2.5 capitalize transition-colors ${
              tab === item ? 'border-b-2 border-forest text-forest' : 'text-muted hover:text-forest'
            }`}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'contenu' && (
          <>
            <Section title="Identification">
              <TextField
                label="Nom du bloc"
                value={node.name ?? ''}
                onChange={(name) => renameBlock(node.id, name)}
              />
            </Section>
            <ContentFields
              node={node}
              mode={mode}
              onChange={(patch) => updateContent(node.id, patch)}
            />
          </>
        )}

        {tab === 'style' && (
          <StyleFields node={node} mode={mode} onChange={(patch) => updateStyles(node.id, patch)} />
        )}

        {tab === 'actions' && (
          <ActionFields node={node} onChange={(actions) => updateActions(node.id, actions)} />
        )}
      </div>

      {!isRoot && (
        <footer className="space-y-2 border-t border-line p-3">
          {/* Le glisser-deposer HTML5 n existe pas au doigt : sans ces deux
              boutons, reorganiser une page depuis un telephone serait
              impossible. Ils servent aussi au clavier.
              Le deplacement se voit sur le canvas, pas ici : sans le repere
              de position et la desactivation aux bornes, rien ne prouve que
              le clic a fait quoi que ce soit tant qu on reste sur cet onglet. */}
          {(() => {
            const location = findLocation(treeRoot, node.id);
            const position = location ? location.index + 1 : 1;
            const total = location?.parent?.children.length ?? 1;
            return (
              <>
                <p className="text-center text-[11px] text-muted">
                  Position {position} sur {total}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="crea-btn crea-btn-ghost flex-1"
                    disabled={position <= 1}
                    onClick={() => nudgeBlock(node.id, -1)}
                  >
                    ↑ Monter
                  </button>
                  <button
                    type="button"
                    className="crea-btn crea-btn-ghost flex-1"
                    disabled={position >= total}
                    onClick={() => nudgeBlock(node.id, 1)}
                  >
                    ↓ Descendre
                  </button>
                </div>
              </>
            );
          })()}

          <div className="flex gap-2">
          <button
            type="button"
            className="crea-btn crea-btn-ghost flex-1"
            onClick={() => duplicateBlock(node.id)}
          >
            Dupliquer
          </button>
          <button
            type="button"
            className="crea-btn flex-1 border border-[#E0C4BB] bg-[#FBEFEC] text-[#B4553F]"
            onClick={() => removeBlock(node.id)}
          >
            Supprimer
          </button>
          </div>
        </footer>
      )}
    </aside>
  );
}
