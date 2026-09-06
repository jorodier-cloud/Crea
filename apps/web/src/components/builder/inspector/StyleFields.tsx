import type { AnyBlockNode, BlockStyles, DeepPartialStyles } from '@crea/schema';

import {
  BoxField,
  ColorField,
  NumberField,
  Section,
  SelectField,
  TextField,
  type InspectorMode,
} from './Fields.js';

const DISPLAY_OPTIONS = [
  { value: 'block', label: 'Bloc' },
  { value: 'flex', label: 'Flex' },
  { value: 'inline-flex', label: 'Flex en ligne' },
  { value: 'grid', label: 'Grille' },
  { value: 'inline-block', label: 'Bloc en ligne' },
  { value: 'none', label: 'Masque' },
] as const;

const DIRECTION_OPTIONS = [
  { value: 'row', label: 'Ligne' },
  { value: 'column', label: 'Colonne' },
  { value: 'row-reverse', label: 'Ligne inversee' },
  { value: 'column-reverse', label: 'Colonne inversee' },
] as const;

const JUSTIFY_OPTIONS = [
  { value: 'flex-start', label: 'Debut' },
  { value: 'center', label: 'Centre' },
  { value: 'flex-end', label: 'Fin' },
  { value: 'space-between', label: 'Espace entre' },
  { value: 'space-around', label: 'Espace autour' },
  { value: 'space-evenly', label: 'Espace egal' },
] as const;

const ALIGN_OPTIONS = [
  { value: 'flex-start', label: 'Debut' },
  { value: 'center', label: 'Centre' },
  { value: 'flex-end', label: 'Fin' },
  { value: 'stretch', label: 'Etire' },
  { value: 'baseline', label: 'Ligne de base' },
] as const;

const TEXT_ALIGN_OPTIONS = [
  { value: 'left', label: 'Gauche' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Droite' },
  { value: 'justify', label: 'Justifie' },
] as const;

const BORDER_STYLE_OPTIONS = [
  { value: 'none', label: 'Aucune' },
  { value: 'solid', label: 'Pleine' },
  { value: 'dashed', label: 'Tirets' },
  { value: 'dotted', label: 'Points' },
] as const;

interface StyleFieldsProps {
  node: AnyBlockNode;
  mode: InspectorMode;
  onChange: (patch: DeepPartialStyles) => void;
}

/**
 * Edition manuelle des styles. En simple : couleurs, taille de texte, arrondi —
 * ce qu on retouche sans reflechir. Le reste (mise en page, dimensions, ombres)
 * est le terrain de l IA ou du mode avance : le vocabulaire CSS brut n aide
 * personne qui ne code pas.
 */
export function StyleFields({ node, mode, onChange }: StyleFieldsProps): React.ReactElement {
  const styles: BlockStyles = node.styles;
  const layout = styles.layout ?? {};
  const size = styles.size ?? {};
  const spacing = styles.spacing ?? {};
  const typography = styles.typography ?? {};
  const background = styles.background ?? {};
  const border = styles.border ?? {};
  const effects = styles.effects ?? {};

  if (mode === 'simple') {
    return (
      <>
        <Section title="Fond">
          <ColorField
            label="Couleur de fond"
            value={background.color}
            onChange={(color) => onChange({ background: { color } })}
          />
        </Section>

        <Section title="Texte">
          <ColorField
            label="Couleur du texte"
            value={typography.color}
            onChange={(color) => onChange({ typography: { color } })}
          />
          <TextField
            label="Taille"
            value={typography.fontSize ?? ''}
            placeholder="17px"
            onChange={(fontSize) => onChange({ typography: { fontSize } })}
          />
          <SelectField
            label="Alignement"
            value={typography.textAlign}
            options={TEXT_ALIGN_OPTIONS}
            onChange={(textAlign) => onChange({ typography: { textAlign } })}
          />
        </Section>

        <Section title="Coins arrondis">
          <TextField
            label="Arrondi"
            value={border.radius ?? ''}
            placeholder="10px"
            onChange={(radius) => onChange({ border: { radius } })}
          />
        </Section>
      </>
    );
  }

  return (
    <>
      <Section title="Espacement">
        <BoxField
          label="Rembourrage interne"
          value={spacing.padding}
          onChange={(padding) => onChange({ spacing: { ...spacing, padding } })}
        />
        <BoxField
          label="Marges externes"
          value={spacing.margin}
          onChange={(margin) => onChange({ spacing: { ...spacing, margin } })}
        />
      </Section>

      <Section title="Mise en page">
        <SelectField
          label="Affichage"
          value={layout.display}
          options={DISPLAY_OPTIONS}
          onChange={(display) => onChange({ layout: { display } })}
        />
        {(layout.display === 'flex' || layout.display === 'inline-flex') && (
          <>
            <SelectField
              label="Direction"
              value={layout.flexDirection}
              options={DIRECTION_OPTIONS}
              onChange={(flexDirection) => onChange({ layout: { flexDirection } })}
            />
            <SelectField
              label="Justification"
              value={layout.justifyContent}
              options={JUSTIFY_OPTIONS}
              onChange={(justifyContent) => onChange({ layout: { justifyContent } })}
            />
            <SelectField
              label="Alignement"
              value={layout.alignItems}
              options={ALIGN_OPTIONS}
              onChange={(alignItems) => onChange({ layout: { alignItems } })}
            />
          </>
        )}
        {layout.display === 'grid' && (
          <TextField
            label="Colonnes"
            value={layout.gridTemplateColumns ?? ''}
            placeholder="repeat(3, 1fr)"
            onChange={(gridTemplateColumns) => onChange({ layout: { gridTemplateColumns } })}
          />
        )}
        <TextField
          label="Ecart (gap)"
          value={layout.gap ?? ''}
          placeholder="24px"
          onChange={(gap) => onChange({ layout: { gap } })}
        />
      </Section>

      <Section title="Dimensions">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Largeur"
            value={size.width ?? ''}
            placeholder="100%"
            onChange={(width) => onChange({ size: { width } })}
          />
          <TextField
            label="Largeur max"
            value={size.maxWidth ?? ''}
            placeholder="1180px"
            onChange={(maxWidth) => onChange({ size: { maxWidth } })}
          />
          <TextField
            label="Hauteur"
            value={size.height ?? ''}
            placeholder="auto"
            onChange={(height) => onChange({ size: { height } })}
          />
          <TextField
            label="Hauteur min"
            value={size.minHeight ?? ''}
            placeholder="480px"
            onChange={(minHeight) => onChange({ size: { minHeight } })}
          />
        </div>
      </Section>

      <Section title="Typographie">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Taille"
            value={typography.fontSize ?? ''}
            placeholder="17px"
            onChange={(fontSize) => onChange({ typography: { fontSize } })}
          />
          <NumberField
            label="Graisse"
            value={typography.fontWeight}
            min={100}
            max={900}
            step={100}
            onChange={(fontWeight) => onChange({ typography: { fontWeight } })}
          />
          <TextField
            label="Interligne"
            value={typography.lineHeight ?? ''}
            placeholder="1.6"
            onChange={(lineHeight) => onChange({ typography: { lineHeight } })}
          />
          <TextField
            label="Interlettrage"
            value={typography.letterSpacing ?? ''}
            placeholder="0.02em"
            onChange={(letterSpacing) => onChange({ typography: { letterSpacing } })}
          />
        </div>
        <SelectField
          label="Alignement du texte"
          value={typography.textAlign}
          options={TEXT_ALIGN_OPTIONS}
          onChange={(textAlign) => onChange({ typography: { textAlign } })}
        />
        <TextField
          label="Police"
          value={typography.fontFamily ?? ''}
          placeholder="'Cormorant Garamond', serif"
          onChange={(fontFamily) => onChange({ typography: { fontFamily } })}
        />
        <ColorField
          label="Couleur du texte"
          value={typography.color}
          onChange={(color) => onChange({ typography: { color } })}
        />
      </Section>

      <Section title="Fond">
        <ColorField
          label="Couleur de fond"
          value={background.color}
          onChange={(color) => onChange({ background: { color } })}
        />
        <TextField
          label="Image de fond (URL)"
          value={background.image ?? ''}
          placeholder="https://…"
          onChange={(image) => onChange({ background: { image } })}
        />
      </Section>

      <Section title="Bordure">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Epaisseur"
            value={border.width ?? ''}
            placeholder="1px"
            onChange={(width) => onChange({ border: { width } })}
          />
          <TextField
            label="Arrondi"
            value={border.radius ?? ''}
            placeholder="10px"
            onChange={(radius) => onChange({ border: { radius } })}
          />
        </div>
        <SelectField
          label="Style"
          value={border.style}
          options={BORDER_STYLE_OPTIONS}
          onChange={(style) => onChange({ border: { style } })}
        />
        <ColorField
          label="Couleur"
          value={border.color}
          onChange={(color) => onChange({ border: { color } })}
        />
      </Section>

      <Section title="Effets">
        <TextField
          label="Ombre"
          value={effects.boxShadow ?? ''}
          placeholder="0 18px 40px -24px rgba(0,0,0,.4)"
          onChange={(boxShadow) => onChange({ effects: { boxShadow } })}
        />
        <NumberField
          label="Opacite"
          value={effects.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => onChange({ effects: { opacity } })}
        />
      </Section>
    </>
  );
}
