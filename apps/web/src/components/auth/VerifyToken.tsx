import { useEffect, useState } from 'react';

import { api, ApiClientError } from '../../lib/api.js';
import { setToken } from '../../lib/session.js';

/** Echange le jeton du magic link contre une session, puis redirige. */
export function VerifyToken(): React.ReactElement {
  const [message, setMessage] = useState('Verification du lien…');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setMessage('Lien incomplet : aucun jeton fourni.');
      setFailed(true);
      return;
    }

    api
      .verifyMagicLink(token)
      .then(({ token: session }) => {
        setToken(session);
        setMessage('Connexion reussie, redirection…');
        window.location.href = params.get('next') ?? '/projects';
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(
          error instanceof ApiClientError ? error.message : 'Lien invalide ou expire.',
        );
      });
  }, []);

  return (
    <div className="w-full max-w-sm text-center">
      <h1 className="font-display text-3xl text-forest">Connexion</h1>
      <p className={`mt-3 text-[14px] ${failed ? 'text-[#B4553F]' : 'text-muted'}`}>{message}</p>
      {failed && (
        <a href="/login" className="crea-btn crea-btn-ghost mt-5 inline-flex">
          Demander un nouveau lien
        </a>
      )}
    </div>
  );
}
