import { renderTreeToHtml } from '@crea/schema';
import { useEffect, useState } from 'react';

import { api, ApiClientError } from '../../lib/api.js';
import { requireSession } from '../../lib/session.js';

/**
 * Apercu : le HTML est projete depuis l AST cote navigateur, avec exactement
 * la meme fonction que celle utilisee par l API pour la publication.
 */
export function PreviewFrame(): React.ReactElement {
  const [html, setHtml] = useState<string | null>(null);
  const [title, setTitle] = useState('Apercu');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requireSession()) return;

    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      setError('Aucun projet indique.');
      return;
    }

    api
      .getProject(id)
      .then(({ project }) => {
        setTitle(project.title);
        setHtml(renderTreeToHtml(project.tree));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiClientError ? cause.message : 'Apercu indisponible.');
      });
  }, []);

  const download = (): void => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[^\w-]+/g, '-').toLowerCase() || 'site'}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[14px] text-[#B4553F]">{error}</p>
        <a href="/projects" className="crea-btn crea-btn-ghost">
          Retour aux projets
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="crea-panel flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <span className="font-display text-lg text-forest">{title}</span>
        <span className="text-[12px] text-muted">projection HTML</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={download} disabled={!html} className="crea-btn crea-btn-ghost">
            Telecharger le HTML
          </button>
          <a href="/projects" className="crea-btn crea-btn-ghost">
            Projets
          </a>
        </div>
      </header>

      {html ? (
        <iframe title={title} srcDoc={html} className="flex-1 border-0 bg-white" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          Generation de l apercu…
        </div>
      )}
    </div>
  );
}
