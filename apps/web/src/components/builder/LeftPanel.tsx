import { useEffect, useRef, useState } from 'react';

import { useBuilderStore, useSelectedNode } from '../../store/builderStore.js';
import { BlockPalette } from './BlockPalette.js';
import { LayerTree } from './LayerTree.js';
import { PagesPanel } from './PagesPanel.js';
import { PointsGauge } from './PointsGauge.js';
import { describeSelection, suggestionsFor } from './suggestions.js';

type Tab = 'chat' | 'blocs' | 'calques' | 'pages';

/** Zone gauche : chat IA, jauge de points, palette de blocs, arborescence. */
export function LeftPanel(): React.ReactElement {
  const chat = useBuilderStore((state) => state.chat);
  const aiPending = useBuilderStore((state) => state.aiPending);
  const points = useBuilderStore((state) => state.points);
  const sendPrompt = useBuilderStore((state) => state.sendPrompt);
  const revertMessage = useBuilderStore((state) => state.revertMessage);
  const selectedNode = useSelectedNode();

  const [tab, setTab] = useState<Tab>('chat');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, aiPending]);

  const submit = (text: string): void => {
    if (!text.trim() || aiPending || points <= 0) return;
    setDraft('');
    void sendPrompt(text);
  };

  return (
    <aside className="crea-panel flex w-full min-w-0 flex-col border-r lg:w-[340px] lg:shrink-0">
      <PointsGauge />

      <nav className="flex border-b border-line text-[12px] font-semibold">
        {(['chat', 'blocs', 'calques', 'pages'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`flex-1 px-3 py-2.5 capitalize transition-colors ${
              tab === item
                ? 'border-b-2 border-forest text-forest'
                : 'text-muted hover:text-forest'
            }`}
          >
            {item === 'chat' ? 'Chat IA' : item}
          </button>
        ))}
      </nav>

      {tab === 'blocs' && <BlockPalette />}
      {tab === 'calques' && <LayerTree />}
      {tab === 'pages' && <PagesPanel />}

      {tab === 'chat' && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {chat.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-6 rounded-xl rounded-br-sm bg-forest px-3 py-2 text-[13px] leading-relaxed text-white'
                    : message.role === 'assistant'
                      ? 'mr-6 rounded-xl rounded-bl-sm bg-linen px-3 py-2 text-[13px] leading-relaxed text-ink'
                      : 'rounded-lg border border-line bg-offwhite px-3 py-2 text-[12px] leading-relaxed text-muted'
                }
              >
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.role === 'assistant' && (
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    {message.cost !== undefined && (
                      <span className="text-[11px] text-forest-soft/70">
                        {message.cost} pt{message.cost > 1 ? 's' : ''}
                      </span>
                    )}
                    {(message.applied ?? 0) > 0 && message.beforeTree && (
                      <button
                        type="button"
                        onClick={() => revertMessage(message.id)}
                        className="text-[11px] font-semibold text-forest-soft/70 underline decoration-dotted hover:text-forest"
                      >
                        ↺ Revenir a avant
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}

            {aiPending && (
              <p className="mr-6 animate-pulse rounded-xl bg-linen px-3 py-2 text-[13px] text-muted">
                Le moteur travaille sur l arbre…
              </p>
            )}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            {/* Change avec la selection : ce que l IA propose de faire suit ce
                sur quoi on vient de cliquer, plutot que quatre phrases figees.
                Le fondu a droite signale qu il y a plus a voir en glissant. */}
            <div
              className="mb-2 flex gap-1.5 overflow-x-auto pb-1"
              style={{ maskImage: 'linear-gradient(to right, black calc(100% - 20px), transparent)' }}
            >
              {suggestionsFor(selectedNode).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  disabled={aiPending || points <= 0}
                  className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-[11.5px] whitespace-nowrap text-muted transition-colors hover:border-sage hover:text-forest disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <p className="mb-1.5 truncate text-[11px] text-muted">
              {selectedNode ? (
                <>
                  Cible : <span className="font-semibold text-forest">{describeSelection(selectedNode)}</span>
                </>
              ) : (
                'Aucun bloc selectionne — la demande visera toute la page.'
              )}
            </p>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              rows={3}
              placeholder={
                points > 0
                  ? 'Decrivez la modification souhaitee…'
                  : 'Solde de points epuise.'
              }
              disabled={points <= 0}
              className="crea-input resize-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="hidden text-[11px] text-muted lg:inline">Ctrl + Entree</span>
              <button
                type="submit"
                disabled={aiPending || points <= 0 || draft.trim().length === 0}
                className="crea-btn crea-btn-primary"
              >
                {aiPending ? 'Generation…' : 'Envoyer'}
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
