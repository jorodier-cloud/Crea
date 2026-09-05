import { useState, type SyntheticEvent } from 'react';

import { api, ApiClientError } from '../../lib/api.js';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** Connexion par magic link. En developpement, le lien est affiche directement. */
export function LoginForm(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setStatus('sending');
    setMessage(null);
    setDevLink(null);

    try {
      const result = await api.requestMagicLink(email.trim());
      setStatus('sent');
      setDevLink(result.devLink ?? null);
      setMessage(
        result.devLink
          ? 'Mode developpement : suivez le lien ci-dessous.'
          : 'Lien envoye. Verifiez votre boite mail (valable 15 minutes).',
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof ApiClientError ? error.message : 'Envoi impossible.');
    }
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-3xl text-forest">Connexion</h1>
      <p className="mt-2 text-[14px] text-muted">
        Entrez votre adresse : un lien de connexion a usage unique vous sera transmis.
      </p>

      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-3">
        <label className="block">
          <span className="crea-label">Adresse email</span>
          <input
            className="crea-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vous@domaine.fr"
          />
        </label>

        <button
          type="submit"
          disabled={status === 'sending'}
          className="crea-btn crea-btn-primary w-full"
        >
          {status === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
        </button>
      </form>

      {message && (
        <p
          className={`mt-4 text-[13px] ${status === 'error' ? 'text-[#B4553F]' : 'text-muted'}`}
        >
          {message}
        </p>
      )}

      {devLink && (
        <a
          href={devLink}
          className="mt-2 block truncate rounded-lg border border-line bg-white px-3 py-2 font-mono text-[12px] text-forest hover:border-sage"
        >
          {devLink}
        </a>
      )}
    </div>
  );
}
