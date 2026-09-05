import { useEffect, useRef, useState } from 'react';

import { useBuilderStore } from '../../store/builderStore.js';
import { BlockPalette } from './BlockPalette.js';
import { LayerTree } from './LayerTree.js';
import { PointsGauge } from './PointsGauge.js';

const SUGGESTIONS = [
  'Ajoute une section galerie avec trois photos',
  'Rends le titre plus grand et centre',
  'Ajoute un formulaire de contact sous le hero',
  'Passe la palette en vert sauge et beige lin',
];

type Tab = 'chat' | 'blocs' | 'calques';

/** Zone gauche : chat IA, jauge de points, palette de blocs, arborescence. */
export function LeftPanel(): React.ReactElement {
  const chat = useBuilderStore((state) => state.chat);
  const aiPending = useBuilderStore((state) => state.aiPending);
  const points = useBuilderStore((state) => state.points);
  const selectedId = useBuilderStore((state) => state.selectedId);
  const sendPrompt = useBuilderStore((state) => state.sendPrompt);

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
    <aside className="crea-panel flex w-[340px] shrink-0 flex-col border-r">
      <PointsGauge />

      <nav className="flex border-b border-line text-[12px] font-semibold">
        {(['chat', 'blocs', 'calques'] as Tab[]).map((item) => (
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
                {message.role === 'assistant' && message.cost !== undefined && (
                  <p className="mt-1.5 text-[11px] text-forest-soft/80">
                    {message.applied ?? 0} operation(s) — {message.cost} pt
                    {message.cost > 1 ? 's' : ''}
                  </p>
                )}
              </article>
            ))}

            {aiPending && (
              <p className="mr-6 animate-pulse rounded-xl bg-linen px-3 py-2 text-[13px] text-muted">
                Le moteur travaille sur l arbre…
              </p>
            )}

            {chat.length <= 1 && (
              <div className="space-y-1.5 pt-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => submit(suggestion)}
                    className="w-full rounded-lg border border-line px-3 py-2 text-left text-[12px] text-muted transition-colors hover:border-sage hover:text-forest"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            {selectedId && (
              <p className="mb-1.5 truncate text-[11px] text-muted">
                Cible : <span className="font-mono text-forest">{selectedId}</span>
              </p>
            )}
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
              <span className="text-[11px] text-muted">Ctrl + Entree</span>
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
