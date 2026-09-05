import { DEFAULT_BLOCK_LABEL } from '@crea/schema';
import { useState } from 'react';

import { useBuilderStore, useSelectedNode } from '../../store/builderStore.js';
import { ActionFields } from './inspector/ActionFields.js';
import { ContentFields } from './inspector/ContentFields.js';
import { Section, TextField } from './inspector/Fields.js';
import { StyleFields } from './inspector/StyleFields.js';

type Tab = 'contenu' | 'style' | 'actions';

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
  const rootId = useBuilderStore((state) => state.tree.root.id);

  const [tab, setTab] = useState<Tab>('contenu');

  if (!node) {
    return (
      <aside className="crea-panel w-[320px] shrink-0 border-l p-6">
        <p className="text-[13px] leading-relaxed text-muted">
          Selectionnez un bloc dans le canvas pour en modifier le contenu, le style et les
          actions.
        </p>
      </aside>
    );
  }

  const isRoot = node.id === rootId;

  return (
    <aside className="crea-panel flex w-[320px] shrink-0 flex-col border-l">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-linen px-2 py-0.5 text-[11px] font-semibold text-forest">
            {DEFAULT_BLOCK_LABEL[node.type]}
          </span>
          <span className="truncate font-mono text-[11px] text-muted" title={node.id}>
            {node.id}
          </span>
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
            <ContentFields node={node} onChange={(patch) => updateContent(node.id, patch)} />
          </>
        )}

        {tab === 'style' && (
          <StyleFields node={node} onChange={(patch) => updateStyles(node.id, patch)} />
        )}

        {tab === 'actions' && (
          <ActionFields node={node} onChange={(actions) => updateActions(node.id, actions)} />
        )}
      </div>

      {!isRoot && (
        <footer className="flex gap-2 border-t border-line p-3">
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
        </footer>
      )}
    </aside>
  );
}
