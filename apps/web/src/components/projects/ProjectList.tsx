import { useEffect, useState, type SyntheticEvent } from 'react';

import { api, ApiClientError, type ProjectSummary, type PublicUser } from '../../lib/api.js';
import { requireSession } from '../../lib/session.js';

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Tableau de bord : liste des projets et creation. */
export function ProjectList(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requireSession()) return;

    Promise.all([api.listProjects(), api.me()])
      .then(([projectsResult, meResult]) => {
        setProjects(projectsResult.projects);
        setUser(meResult.user);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiClientError ? cause.message : 'Chargement impossible.');
      })
      .finally(() => setLoading(false));
  }, []);

  const create = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(title.trim());
      window.location.href = `/builder?id=${project.id}`;
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Creation impossible.');
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Supprimer definitivement ce projet ?')) return;
    try {
      await api.deleteProject(id);
      setProjects((current) => current.filter((project) => project.id !== id));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Suppression impossible.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-forest">Mes projets</h1>
          {user && (
            <p className="mt-1 text-[13px] text-muted">
              {user.email} — {user.iaPointsBalance.toLocaleString('fr-FR')} points IA
            </p>
          )}
        </div>
        <a href="/" className="text-[13px] text-muted hover:text-forest">
          Accueil
        </a>
      </header>

      <form onSubmit={(event) => void create(event)} className="mb-8 flex gap-2">
        <input
          className="crea-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nom du nouveau site"
          maxLength={120}
        />
        <button type="submit" disabled={busy} className="crea-btn crea-btn-primary shrink-0">
          {busy ? 'Creation…' : 'Creer'}
        </button>
      </form>

      {error && <p className="mb-4 text-[13px] text-[#B4553F]">{error}</p>}

      {loading ? (
        <p className="text-[13px] text-muted">Chargement…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-[14px] text-muted">
          Aucun projet pour l instant. Creez-en un pour ouvrir le builder.
        </p>
      ) : (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3"
            >
              <a href={`/builder?id=${project.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink">
                  {project.title}
                </span>
                <span className="block text-[12px] text-muted">
                  Modifie le {formatDate(project.updatedAt)}
                </span>
              </a>
              <a
                href={`/preview?id=${project.id}`}
                target="_blank"
                rel="noopener"
                className="text-[12px] text-muted hover:text-forest"
              >
                Apercu
              </a>
              <button
                type="button"
                onClick={() => void remove(project.id)}
                className="text-[12px] text-[#B4553F] hover:underline"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
