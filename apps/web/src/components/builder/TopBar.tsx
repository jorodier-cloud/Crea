import { api } from '../../lib/api.js';
import { clearToken } from '../../lib/session.js';
import { useBuilderStore } from '../../store/builderStore.js';
import { PublishButton } from './PublishButton.js';

const VIEWPORTS = [
  { value: 'desktop', label: 'Bureau' },
  { value: 'tablet', label: 'Tablette' },
  { value: 'mobile', label: 'Mobile' },
] as const;

function saveLabel(status: string, dirty: boolean, lastSavedAt: number | null): string {
  if (status === 'saving') return 'Sauvegarde…';
  if (status === 'error') return 'Echec de sauvegarde';
  if (dirty) return 'Modifications non enregistrees';
  if (lastSavedAt) {
    return `Enregistre a ${new Date(lastSavedAt).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
  return 'A jour';
}

export function TopBar(): React.ReactElement {
  const title = useBuilderStore((state) => state.title);
  const setTitle = useBuilderStore((state) => state.setTitle);
  const viewport = useBuilderStore((state) => state.viewport);
  const setViewport = useBuilderStore((state) => state.setViewport);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);
  const past = useBuilderStore((state) => state.past.length);
  const future = useBuilderStore((state) => state.future.length);
  const save = useBuilderStore((state) => state.save);
  const dirty = useBuilderStore((state) => state.dirty);
  const saveStatus = useBuilderStore((state) => state.saveStatus);
  const lastSavedAt = useBuilderStore((state) => state.lastSavedAt);
  const projectId = useBuilderStore((state) => state.projectId);
  const currentPageId = useBuilderStore((state) => state.currentPageId);

  return (
    <header className="crea-panel flex h-14 shrink-0 items-center gap-2 border-b px-3 lg:gap-4 lg:px-4">
      <a
        href="/projects"
        className="hidden font-display text-xl leading-none text-forest sm:block"
      >
        Crea
      </a>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Titre du projet"
        className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-[14px] font-semibold text-ink hover:border-line focus:border-sage focus:outline-none lg:w-56 lg:flex-none"
      />

      {/* Le selecteur de largeur n a pas de sens sur un ecran etroit : le
          canvas y occupe deja toute la place disponible. */}
      <div className="hidden overflow-hidden rounded-full border border-line text-[12px] lg:flex">
        {VIEWPORTS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setViewport(item.value)}
            className={`px-3 py-1 transition-colors ${
              viewport === item.value ? 'bg-forest text-white' : 'text-muted hover:text-forest'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={past === 0}
          title="Annuler (Ctrl+Z)"
          className="crea-btn crea-btn-ghost px-3 disabled:opacity-40"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={future === 0}
          title="Retablir (Ctrl+Maj+Z)"
          className="crea-btn crea-btn-ghost px-3 disabled:opacity-40"
        >
          ↷
        </button>
      </div>

      <span className="ml-auto hidden text-[12px] text-muted lg:inline">
        {saveLabel(saveStatus, dirty, lastSavedAt)}
      </span>

      {/* Faute de place pour la phrase, l ecran etroit recoit une pastille :
          doree tant qu il reste des modifications, sauge une fois ecrites. */}
      <span
        title={saveLabel(saveStatus, dirty, lastSavedAt)}
        aria-label={saveLabel(saveStatus, dirty, lastSavedAt)}
        className={`ml-auto h-2 w-2 shrink-0 rounded-full lg:hidden ${
          saveStatus === 'error' ? 'bg-[#B4553F]' : dirty ? 'bg-gold' : 'bg-sage'
        }`}
      />

      {projectId && (
        <a
          href={`/preview?id=${projectId}&page=${currentPageId}`}
          target="_blank"
          rel="noopener"
          className="crea-btn crea-btn-ghost hidden lg:inline-flex"
        >
          Apercu
        </a>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!dirty || saveStatus === 'saving'}
        title={saveLabel(saveStatus, dirty, lastSavedAt)}
        className="crea-btn crea-btn-ghost hidden shrink-0 lg:inline-flex"
      >
        Enregistrer
      </button>

      <PublishButton />

      <button
        type="button"
        title="Se deconnecter"
        onClick={() => {
          void api.logout().catch(() => undefined);
          clearToken();
          window.location.href = '/login';
        }}
        className="hidden text-[12px] text-muted hover:text-forest lg:inline"
      >
        Quitter
      </button>
    </header>
  );
}
