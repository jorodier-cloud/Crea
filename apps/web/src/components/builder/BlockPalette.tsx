import { BLOCK_TYPES, DEFAULT_BLOCK_LABEL, type BlockType } from '@crea/schema';

import { useBuilderStore } from '../../store/builderStore.js';

const DESCRIPTIONS: Record<BlockType, string> = {
  container: 'Regroupe plusieurs blocs',
  text: 'Titre, paragraphe, citation',
  media: 'Image ou video',
  button: 'Appel a l action',
  calendar: 'Disponibilites et reservation',
  form: 'Contact, demande de devis',
  embed: 'Widget de reservation, carte, reseau social',
};

const ICONS: Record<BlockType, string> = {
  container: '▤',
  text: 'T',
  media: '🖼',
  button: '⬭',
  calendar: '▦',
  form: '✎',
  embed: '</>',
};

/** Palette : touche ou clic pour inserer, glisser-deposer pour placer precisement. */
export function BlockPalette(): React.ReactElement {
  const addBlock = useBuilderStore((state) => state.addBlock);
  const beginDrag = useBuilderStore((state) => state.beginDrag);

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <p className="mb-2 px-1 text-[11px] text-muted">
        Touchez un bloc pour l ajouter apres la selection — vous basculez aussitot sur la
        page pour le voir. Sur ordinateur, glissez-le sur le canvas pour le placer
        precisement.
      </p>
      <ul className="space-y-1.5">
        {BLOCK_TYPES.map((type) => (
          <li key={type}>
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('text/plain', type);
                beginDrag({ kind: 'new', blockType: type });
              }}
              onDragEnd={() => beginDrag(null)}
              onClick={() => addBlock(type)}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-sage active:cursor-grabbing"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-linen text-[13px] text-forest">
                {ICONS[type]}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">
                  {DEFAULT_BLOCK_LABEL[type]}
                </span>
                <span className="block truncate text-[11px] text-muted">{DESCRIPTIONS[type]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
