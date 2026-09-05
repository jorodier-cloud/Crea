import { useEffect, useRef, useState } from 'react';

import { useBuilderStore } from '../../store/builderStore.js';

/**
 * Assainit la saisie sans couper le tiret final : sinon, taper un espace entre
 * deux mots effacerait le separateur a peine ecrit.
 */
function normalizeSlugInput(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60);
}

/** Forme definitive envoyee au serveur, alignee sur `slugify`. */
function finalizeSlug(value: string): string {
  return value.replace(/-+$/, '');
}

/**
 * Mise en ligne du site.
 *
 * Le site publie est un instantane : tant qu on ne republie pas, les visiteurs
 * voient la derniere version mise en ligne, pas le brouillon en cours.
 */
export function PublishButton(): React.ReactElement {
  const title = useBuilderStore((state) => state.title);
  const slug = useBuilderStore((state) => state.slug);
  const publishedAt = useBuilderStore((state) => state.publishedAt);
  const publicUrl = useBuilderStore((state) => state.publicUrl);
  const publishing = useBuilderStore((state) => state.publishing);
  const dirty = useBuilderStore((state) => state.dirty);
  const lastSavedAt = useBuilderStore((state) => state.lastSavedAt);
  const publish = useBuilderStore((state) => state.publish);
  const unpublish = useBuilderStore((state) => state.unpublish);

  const [open, setOpen] = useState(false);
  const [draftSlug, setDraftSlug] = useState('');
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isLive = publishedAt !== null;
  const hasPendingChanges =
    isLive && (dirty || (lastSavedAt !== null && lastSavedAt > publishedAt * 1000));

  useEffect(() => {
    setDraftSlug(slug ?? finalizeSlug(normalizeSlugInput(title)));
  }, [slug, title]);

  // Fermeture au clic exterieur : le panneau ne doit pas rester ouvert
  // pendant qu on manipule le canvas.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const copy = async (): Promise<void> => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const label = publishing ? 'Publication…' : hasPendingChanges ? 'Republier' : isLive ? 'En ligne' : 'Publier';

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`crea-btn ${
          isLive && !hasPendingChanges
            ? 'border border-sage bg-white text-forest'
            : 'crea-btn-primary'
        }`}
      >
        {isLive && (
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              hasPendingChanges ? 'bg-gold' : 'bg-sage'
            }`}
          />
        )}
        {label}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[340px] rounded-xl border border-line bg-white p-4 shadow-[0_18px_50px_-24px_rgba(31,36,32,0.5)]">
          <h3 className="font-display text-lg text-forest">
            {isLive ? 'Site en ligne' : 'Mettre le site en ligne'}
          </h3>

          {isLive && publicUrl ? (
            <>
              <p className="mt-1 text-[12px] text-muted">
                {hasPendingChanges
                  ? 'Des modifications ne sont pas encore en ligne.'
                  : 'La version en ligne est a jour.'}
              </p>

              <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-offwhite px-3 py-2">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener"
                  className="min-w-0 flex-1 truncate font-mono text-[12px] text-forest hover:underline"
                >
                  {publicUrl.replace(/^https?:\/\//, '')}
                </a>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="shrink-0 text-[11px] font-semibold text-muted hover:text-forest"
                >
                  {copied ? 'Copie' : 'Copier'}
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => void publish()}
                  className="crea-btn crea-btn-primary flex-1"
                >
                  {publishing ? 'Publication…' : 'Republier'}
                </button>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => void unpublish()}
                  className="crea-btn crea-btn-ghost"
                >
                  Retirer
                </button>
              </div>

              <p className="mt-2 text-[11px] text-muted">
                En ligne depuis le{' '}
                {new Date(publishedAt * 1000).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                . L adresse reste reservee si vous retirez le site.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[12px] text-muted">
                Le site devient accessible a cette adresse, sans compte ni connexion.
              </p>

              <label className="mt-3 block">
                <span className="crea-label">Adresse publique</span>
                <input
                  className="crea-input font-mono"
                  value={draftSlug}
                  onChange={(event) => setDraftSlug(normalizeSlugInput(event.target.value))}
                  placeholder="domaine-des-rives"
                  maxLength={60}
                />
              </label>

              <p className="mt-1 truncate font-mono text-[11px] text-muted">
                …/p/{finalizeSlug(draftSlug) || 'adresse'}
              </p>

              <button
                type="button"
                disabled={publishing || finalizeSlug(draftSlug).length < 3}
                onClick={() => void publish(finalizeSlug(draftSlug))}
                className="crea-btn crea-btn-primary mt-3 w-full"
              >
                {publishing ? 'Publication…' : 'Mettre en ligne'}
              </button>

              {draftSlug.length > 0 && finalizeSlug(draftSlug).length < 3 && (
                <p className="mt-1.5 text-[11px] text-[#B4553F]">
                  Trois caracteres minimum.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
