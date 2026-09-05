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

  return (
    <header className="crea-panel flex h-14 shrink-0 items-center gap-4 border-b px-4">
      <a href="/projects" className="font-display text-xl leading-none text-forest">
        Crea
      </a>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Titre du projet"
        className="w-56 rounded border border-transparent px-2 py-1 text-[14px] font-semibold text-ink hover:border-line focus:border-sage focus:outline-none"
      />

      <div className="flex overflow-hidden rounded-full border border-line text-[12px]">
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

      <div className="flex gap-1">
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

      <span className="ml-auto text-[12px] text-muted">
        {saveLabel(saveStatus, dirty, lastSavedAt)}
      </span>

      {projectId && (
        <a
          href={`/preview?id=${projectId}`}
          target="_blank"
          rel="noopener"
          className="crea-btn crea-btn-ghost"
        >
          Apercu
        </a>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!dirty || saveStatus === 'saving'}
        className="crea-btn crea-btn-ghost"
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
        className="text-[12px] text-muted hover:text-forest"
      >
        Quitter
      </button>
    </header>
  );
}
