import {
  createId,
  type AnyBlockNode,
  type ButtonContent,
  type CalendarContent,
  type ContainerContent,
  type EmbedContent,
  type FormContent,
  type FormField,
  type FormFieldType,
  type MediaContent,
  type TextContent,
} from '@crea/schema';

import { NumberField, Section, SelectField, TextField, type InspectorMode } from './Fields.js';
import { MediaPicker } from './MediaPicker.js';

const CONTAINER_TAGS = [
  { value: 'section', label: 'section' },
  { value: 'div', label: 'div' },
  { value: 'header', label: 'header' },
  { value: 'footer', label: 'footer' },
  { value: 'main', label: 'main' },
  { value: 'article', label: 'article' },
  { value: 'aside', label: 'aside' },
  { value: 'nav', label: 'nav' },
] as const;

const TEXT_TAGS = [
  { value: 'h1', label: 'Titre 1' },
  { value: 'h2', label: 'Titre 2' },
  { value: 'h3', label: 'Titre 3' },
  { value: 'h4', label: 'Titre 4' },
  { value: 'h5', label: 'Titre 5' },
  { value: 'h6', label: 'Titre 6' },
  { value: 'p', label: 'Paragraphe' },
  { value: 'span', label: 'Texte en ligne' },
  { value: 'blockquote', label: 'Citation' },
] as const;

const FIELD_TYPES = [
  { value: 'text', label: 'Texte' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Telephone' },
  { value: 'textarea', label: 'Message' },
  { value: 'number', label: 'Nombre' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Liste' },
  { value: 'checkbox', label: 'Case a cocher' },
] as const;

interface ContentFieldsProps {
  node: AnyBlockNode;
  mode: InspectorMode;
  onChange: (patch: Record<string, unknown>) => void;
}

/** Edition du contenu, adaptee au type de bloc selectionne. */
export function ContentFields({ node, mode, onChange }: ContentFieldsProps): React.ReactElement {
  switch (node.type) {
    case 'container': {
      const content = node.content as ContainerContent;
      return (
        <Section title="Section">
          {mode === 'avance' && (
            <SelectField
              label="Balise HTML"
              value={content.tag}
              options={CONTAINER_TAGS}
              onChange={(tag) => onChange({ tag })}
            />
          )}
          <TextField
            label="Ancre (cible de defilement)"
            value={content.anchor ?? ''}
            placeholder="contact"
            onChange={(anchor) => onChange({ anchor })}
          />
        </Section>
      );
    }

    case 'text': {
      const content = node.content as TextContent;
      return (
        <Section title="Texte">
          <TextField
            label="Contenu"
            value={content.text}
            multiline
            onChange={(text) => onChange({ text })}
          />
          <SelectField
            label="Niveau"
            value={content.tag}
            options={TEXT_TAGS}
            onChange={(tag) => onChange({ tag })}
          />
        </Section>
      );
    }

    case 'media': {
      const content = node.content as MediaContent;
      return (
        <Section title="Image ou video">
          <MediaPicker
            onSelect={(media) =>
              onChange({
                src: media.url,
                mediaId: media.id,
                kind: media.contentType?.startsWith('video/') ? 'video' : 'image',
                alt: content.alt || media.originalName,
              })
            }
          />
          <TextField
            label="URL"
            value={content.src}
            placeholder="https://…"
            onChange={(src) => onChange({ src })}
          />
          <TextField
            label="Texte alternatif"
            value={content.alt}
            placeholder="Description de l image"
            onChange={(alt) => onChange({ alt })}
          />
          <SelectField
            label="Type"
            value={content.kind}
            options={[
              { value: 'image', label: 'Image' },
              { value: 'video', label: 'Video' },
            ]}
            onChange={(kind) => onChange({ kind })}
          />
          <SelectField
            label="Cadrage"
            value={content.objectFit}
            options={[
              { value: 'cover', label: 'Remplir (cover)' },
              { value: 'contain', label: 'Contenir' },
              { value: 'fill', label: 'Etirer' },
              { value: 'none', label: 'Aucun' },
            ]}
            onChange={(objectFit) => onChange({ objectFit })}
          />
        </Section>
      );
    }

    case 'button': {
      const content = node.content as ButtonContent;
      return (
        <Section title="Bouton">
          <TextField
            label="Libelle"
            value={content.label}
            onChange={(label) => onChange({ label })}
          />
          <SelectField
            label="Variante"
            value={content.variant}
            options={[
              { value: 'primary', label: 'Principale' },
              { value: 'secondary', label: 'Secondaire' },
              { value: 'ghost', label: 'Discrete' },
              { value: 'link', label: 'Lien' },
            ]}
            onChange={(variant) => onChange({ variant })}
          />
        </Section>
      );
    }

    case 'calendar': {
      const content = node.content as CalendarContent;
      return (
        <Section title="Calendrier">
          <SelectField
            label="Mode"
            value={content.mode}
            options={[
              { value: 'availability', label: 'Disponibilites' },
              { value: 'booking', label: 'Reservation' },
            ]}
            onChange={(mode) => onChange({ mode })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Mois affiches"
              value={content.monthsVisible}
              min={1}
              max={12}
              onChange={(monthsVisible) => onChange({ monthsVisible })}
            />
            <NumberField
              label="Nuits minimum"
              value={content.minNights}
              min={1}
              max={30}
              onChange={(minNights) => onChange({ minNights })}
            />
          </div>
          <TextField
            label="Langue"
            value={content.locale}
            placeholder="fr-FR"
            onChange={(locale) => onChange({ locale })}
          />
          <TextField
            label="Flux iCal (un par ligne)"
            value={(content.icalUrls ?? []).join('\n')}
            multiline
            placeholder={'https://…/calendar.ics'}
            onChange={(value) =>
              onChange({
                icalUrls: value
                  .split('\n')
                  .map((url) => url.trim())
                  .filter(Boolean),
              })
            }
          />
          <TextField
            label="Dates bloquees (AAAA-MM-JJ, une par ligne)"
            value={(content.blockedDates ?? []).join('\n')}
            multiline
            onChange={(value) =>
              onChange({
                blockedDates: value
                  .split('\n')
                  .map((date) => date.trim())
                  .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
              })
            }
          />
        </Section>
      );
    }

    case 'form': {
      const content = node.content as FormContent;
      const fields = content.fields ?? [];

      const patchField = (index: number, patch: Partial<FormField>): void => {
        onChange({
          fields: fields.map((field, position) =>
            position === index ? { ...field, ...patch } : field,
          ),
        });
      };

      return (
        <>
          <Section title="Formulaire">
            <TextField
              label="Libelle du bouton"
              value={content.submitLabel}
              onChange={(submitLabel) => onChange({ submitLabel })}
            />
            <TextField
              label="Endpoint"
              value={content.endpoint}
              placeholder="https://…"
              onChange={(endpoint) => onChange({ endpoint })}
            />
            <TextField
              label="Message de confirmation"
              value={content.successMessage}
              onChange={(successMessage) => onChange({ successMessage })}
            />
          </Section>

          <Section title="Champs">
            {fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border border-line p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <TextField
                    label="Libelle"
                    value={field.label}
                    onChange={(label) => patchField(index, { label })}
                  />
                  <TextField
                    label="Nom technique"
                    value={field.name}
                    onChange={(name) => patchField(index, { name })}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <SelectField
                    label="Type"
                    value={field.type}
                    options={FIELD_TYPES}
                    onChange={(type) => patchField(index, { type: type as FormFieldType })}
                  />
                  <label className="flex items-end gap-2 pb-2 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => patchField(index, { required: event.target.checked })}
                    />
                    Obligatoire
                  </label>
                </div>
                <button
                  type="button"
                  className="mt-2 text-[11px] text-[#B4553F] hover:underline"
                  onClick={() =>
                    onChange({ fields: fields.filter((_, position) => position !== index) })
                  }
                >
                  Supprimer ce champ
                </button>
              </div>
            ))}

            <button
              type="button"
              className="crea-btn crea-btn-ghost w-full"
              onClick={() =>
                onChange({
                  fields: [
                    ...fields,
                    {
                      id: createId('f'),
                      name: `champ_${fields.length + 1}`,
                      label: 'Nouveau champ',
                      type: 'text' as FormFieldType,
                      required: false,
                    },
                  ],
                })
              }
            >
              Ajouter un champ
            </button>
          </Section>
        </>
      );
    }

    case 'embed': {
      const content = node.content as EmbedContent;
      return (
        <Section title="Widget">
          <p className="mb-1 text-[11px] leading-relaxed text-muted">
            Collez ici le code fourni par le service externe (reservation Lodgify, carte,
            reseau social...). Affiche tel quel sur le site publie ; sans effet dans cet
            apercu.
          </p>
          <TextField
            label="Code du widget"
            value={content.html}
            multiline
            placeholder="<script>…</script> ou <iframe>…</iframe>"
            onChange={(html) => onChange({ html })}
          />
        </Section>
      );
    }

    default:
      return <Section title="Contenu">Type de bloc non reconnu.</Section>;
  }
}
