import type { AnyBlockNode, BlockAction, BlockActionType } from '@crea/schema';

import { Section, SelectField, TextField } from './Fields.js';

const ACTION_TYPES = [
  { value: 'navigate', label: 'Naviguer vers' },
  { value: 'scrollTo', label: 'Defiler vers une ancre' },
  { value: 'openUrl', label: 'Ouvrir un lien externe' },
  { value: 'submitForm', label: 'Soumettre un formulaire' },
  { value: 'toggleVisibility', label: 'Afficher / masquer un bloc' },
  { value: 'custom', label: 'Handler personnalise' },
] as const;

function emptyAction(type: BlockActionType): BlockAction {
  switch (type) {
    case 'navigate':
      return { type: 'navigate', href: '/', target: '_self' };
    case 'scrollTo':
      return { type: 'scrollTo', anchor: '' };
    case 'openUrl':
      return { type: 'openUrl', url: 'https://' };
    case 'submitForm':
      return { type: 'submitForm', formId: '' };
    case 'toggleVisibility':
      return { type: 'toggleVisibility', targetId: '' };
    case 'custom':
    default:
      return { type: 'custom', event: 'click', handler: '' };
  }
}

interface ActionFieldsProps {
  node: AnyBlockNode;
  onChange: (actions: BlockAction[]) => void;
}

/** Edition des actions attachees au bloc. */
export function ActionFields({ node, onChange }: ActionFieldsProps): React.ReactElement {
  const actions = node.actions ?? [];

  const replace = (index: number, action: BlockAction): void => {
    onChange(actions.map((item, position) => (position === index ? action : item)));
  };

  return (
    <Section title="Actions">
      {actions.length === 0 && (
        <p className="text-[12px] text-muted">Aucune action sur ce bloc.</p>
      )}

      {actions.map((action, index) => (
        <div key={`${action.type}-${index}`} className="rounded-lg border border-line p-2.5">
          <SelectField
            label="Type"
            value={action.type}
            options={ACTION_TYPES}
            onChange={(type) => replace(index, emptyAction(type as BlockActionType))}
          />

          {action.type === 'navigate' && (
            <>
              <TextField
                label="Destination"
                value={action.href}
                placeholder="/contact"
                onChange={(href) => replace(index, { ...action, href })}
              />
              <SelectField
                label="Cible"
                value={action.target ?? '_self'}
                options={[
                  { value: '_self', label: 'Meme onglet' },
                  { value: '_blank', label: 'Nouvel onglet' },
                ]}
                onChange={(target) =>
                  replace(index, { ...action, target: target as '_self' | '_blank' })
                }
              />
            </>
          )}

          {action.type === 'scrollTo' && (
            <TextField
              label="Ancre"
              value={action.anchor}
              placeholder="contact"
              onChange={(anchor) => replace(index, { ...action, anchor })}
            />
          )}

          {action.type === 'openUrl' && (
            <TextField
              label="URL"
              value={action.url}
              placeholder="https://…"
              onChange={(url) => replace(index, { ...action, url })}
            />
          )}

          {action.type === 'submitForm' && (
            <TextField
              label="Identifiant du formulaire"
              value={action.formId}
              placeholder="frm_…"
              onChange={(formId) => replace(index, { ...action, formId })}
            />
          )}

          {action.type === 'toggleVisibility' && (
            <TextField
              label="Identifiant du bloc cible"
              value={action.targetId}
              placeholder="con_…"
              onChange={(targetId) => replace(index, { ...action, targetId })}
            />
          )}

          {action.type === 'custom' && (
            <>
              <SelectField
                label="Evenement"
                value={action.event}
                options={[
                  { value: 'click', label: 'Clic' },
                  { value: 'submit', label: 'Soumission' },
                  { value: 'change', label: 'Changement' },
                ]}
                onChange={(event) =>
                  replace(index, { ...action, event: event as 'click' | 'submit' | 'change' })
                }
              />
              <TextField
                label="Nom du handler"
                value={action.handler}
                onChange={(handler) => replace(index, { ...action, handler })}
              />
            </>
          )}

          <button
            type="button"
            className="mt-2 text-[11px] text-[#B4553F] hover:underline"
            onClick={() => onChange(actions.filter((_, position) => position !== index))}
          >
            Retirer cette action
          </button>
        </div>
      ))}

      <button
        type="button"
        className="crea-btn crea-btn-ghost w-full"
        onClick={() => onChange([...actions, emptyAction('navigate')])}
      >
        Ajouter une action
      </button>
    </Section>
  );
}
