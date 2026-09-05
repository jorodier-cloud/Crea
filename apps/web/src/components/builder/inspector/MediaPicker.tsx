import { useEffect, useState } from 'react';

import { api, ApiClientError, type Media } from '../../../lib/api.js';

interface MediaPickerProps {
  onSelect: (media: Media) => void;
}

/** Bibliotheque de medias : upload direct vers R2 puis synchronisation D1. */
export function MediaPicker({ onSelect }: MediaPickerProps): React.ReactElement {
  const [medias, setMedias] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listMedias()
      .then(({ medias: list }) => {
        if (active) setMedias(list);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof ApiClientError ? cause.message : 'Bibliotheque indisponible.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const media = await api.uploadMedia(file);
      setMedias((current) => [media, ...current.filter((item) => item.id !== media.id)]);
      onSelect(media);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="crea-label">Bibliotheque</span>

      <label className="mb-2 block cursor-pointer rounded-lg border border-dashed border-line px-3 py-3 text-center text-[12px] text-muted transition-colors hover:border-sage">
        {busy ? 'Envoi en cours…' : 'Deposer ou choisir un fichier'}
        <input
          type="file"
          accept="image/*,video/mp4,video/webm"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </label>

      {error && <p className="mb-2 text-[11px] text-[#B4553F]">{error}</p>}

      {medias.length > 0 && (
        <ul className="grid max-h-40 grid-cols-3 gap-1.5 overflow-y-auto">
          {medias.map((media) => (
            <li key={media.id}>
              <button
                type="button"
                onClick={() => onSelect(media)}
                title={media.originalName}
                className="block aspect-square w-full overflow-hidden rounded border border-line bg-linen transition-colors hover:border-sage"
              >
                {media.contentType?.startsWith('video/') ? (
                  <span className="flex h-full w-full items-center justify-center text-[11px] text-muted">
                    video
                  </span>
                ) : (
                  <img
                    src={media.url}
                    alt={media.originalName}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
