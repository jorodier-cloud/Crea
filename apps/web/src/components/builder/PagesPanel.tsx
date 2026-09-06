import { useState } from 'react';

import { useBuilderStore } from '../../store/builderStore.js';

/**
 * Commutateur de pages : chaque page est un site independant (voir le store),
 * mais partage le meme projet. Edition du nom/adresse repliee dans la ligne
 * pour ne pas doubler la liste d une seconde vue au clic — plus simple a
 * suivre sur un ecran etroit qu une navigation a deux niveaux.
 */
export function PagesPanel(): React.ReactElement {
  const pages = useBuilderStore((state) => state.pages);
  const currentPageId = useBuilderStore((state) => state.currentPageId);
  const switchPage = useBuilderStore((state) => state.switchPage);
  const addPage = useBuilderStore((state) => state.addPage);
  const renamePage = useBuilderStore((state) => state.renamePage);
  const removePage = useBuilderStore((state) => state.removePage);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftSlug, setDraftSlug] = useState('');
  const [newPageLabel, setNewPageLabel] = useState('');

  const startEditing = (id: string, label: string, slug: string): void => {
    setEditingId(id);
    setDraftLabel(label);
    setDraftSlug(slug);
  };

  const saveEditing = (): void => {
    if (!editingId) return;
    renamePage(editingId, { label: draftLabel, slug: draftSlug });
    setEditingId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <p className="mb-2 px-1 text-[11px] text-muted">
        Chaque page a son propre contenu et sa propre adresse. L accueil reste toujours a la
        racine du site.
      </p>

      <ul className="space-y-1.5">
        {pages.map((page) => {
          const isHome = page.slug === '';
          const isActive = page.id === currentPageId;
          const isEditing = editingId === page.id;

          return (
            <li key={page.id} className="rounded-lg border border-line bg-white">
              <button
                type="button"
                onClick={() => switchPage(page.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-linen' : 'hover:bg-offwhite'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {page.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {isHome ? 'Accueil — /' : `/${page.slug}`}
                  </span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    startEditing(page.id, page.label, page.slug);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.stopPropagation();
                    startEditing(page.id, page.label, page.slug);
                  }}
                  className="shrink-0 rounded-full px-2 py-1 text-[13px] text-muted hover:text-forest"
                  aria-label={`Modifier la page ${page.label}`}
                >
                  ✎
                </span>
              </button>

              {isEditing && (
                <div className="space-y-2 border-t border-line p-3">
                  <label className="block">
                    <span className="crea-label">Nom de la page</span>
                    <input
                      value={draftLabel}
                      onChange={(event) => setDraftLabel(event.target.value)}
                      className="crea-input"
                    />
                  </label>
                  {!isHome && (
                    <label className="block">
                      <span className="crea-label">Adresse</span>
                      <input
                        value={draftSlug}
                        onChange={(event) => setDraftSlug(event.target.value)}
                        placeholder="tarifs"
                        className="crea-input"
                      />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveEditing}
                      className="crea-btn crea-btn-primary flex-1"
                    >
                      Valider
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="crea-btn crea-btn-ghost flex-1"
                    >
                      Annuler
                    </button>
                  </div>
                  {!isHome && (
                    <button
                      type="button"
                      onClick={() => {
                        removePage(page.id);
                        setEditingId(null);
                      }}
                      className="w-full text-[11px] font-semibold text-[#B4553F] hover:underline"
                    >
                      Supprimer cette page
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newPageLabel.trim()) return;
          addPage(newPageLabel);
          setNewPageLabel('');
        }}
      >
        <input
          value={newPageLabel}
          onChange={(event) => setNewPageLabel(event.target.value)}
          placeholder="Nom de la nouvelle page"
          className="crea-input"
        />
        <button type="submit" className="crea-btn crea-btn-ghost shrink-0">
          Ajouter
        </button>
      </form>
    </div>
  );
}
