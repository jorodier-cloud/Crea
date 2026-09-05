import { useEffect, useState } from 'react';

import { Builder } from './Builder.js';

/**
 * Le builder est une SPA : l identifiant du projet est lu dans l URL cote
 * client, ce qui evite tout rendu serveur pour une interface purement editoriale.
 */
export function BuilderPage(): React.ReactElement {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setProjectId(id);
    else setMissing(true);
  }, []);

  if (missing) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[14px] text-muted">Aucun projet indique dans l URL.</p>
        <a href="/projects" className="crea-btn crea-btn-primary">
          Choisir un projet
        </a>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex h-screen items-center justify-center text-[13px] text-muted">
        Ouverture du builder…
      </div>
    );
  }

  return <Builder projectId={projectId} />;
}
