import { createId } from './ids.js';
import {
  AST_VERSION,
  type AnyBlockNode,
  type BlockNode,
  type BlockStyles,
  type BlockType,
  type ContentByType,
  type PageTree,
  type ThemeTokens,
} from './types/schema.js';

/** Palette par defaut : vert sauge, beige lin, vert fonce, blanc casse, or. */
export const DEFAULT_THEME: ThemeTokens = {
  colors: {
    sage: '#9CAF88',
    linen: '#EFE8DA',
    forest: '#2F4132',
    offwhite: '#FAF7F0',
    gold: '#C2A15A',
    ink: '#1F2420',
    muted: '#6B7169',
  },
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyHeading: "'Cormorant Garamond', Georgia, serif",
  radius: '10px',
  maxWidth: '1180px',
};

const BASE_CONTENT: { [K in BlockType]: () => ContentByType[K] } = {
  container: () => ({ tag: 'section' }),
  text: () => ({ text: 'Nouveau texte', tag: 'p' }),
  media: () => ({
    kind: 'image',
    src: '',
    alt: '',
    objectFit: 'cover',
    loading: 'lazy',
  }),
  button: () => ({ label: 'En savoir plus', variant: 'primary', size: 'md' }),
  calendar: () => ({
    mode: 'availability',
    icalUrls: [],
    monthsVisible: 2,
    minNights: 2,
    locale: 'fr-FR',
    blockedDates: [],
  }),
  form: () => ({
    fields: [
      {
        id: createId('f'),
        name: 'nom',
        label: 'Nom',
        type: 'text',
        required: true,
      },
      {
        id: createId('f'),
        name: 'email',
        label: 'Email',
        type: 'email',
        required: true,
      },
      {
        id: createId('f'),
        name: 'message',
        label: 'Message',
        type: 'textarea',
        required: false,
      },
    ],
    submitLabel: 'Envoyer',
    // A brancher sur le service de reception du client (Formspree, Worker dedie...).
    endpoint: '#',
    method: 'POST',
    successMessage: 'Merci, votre message est bien parti.',
  }),
};

const BASE_STYLES: { [K in BlockType]: () => BlockStyles } = {
  container: () => ({
    layout: { display: 'flex', flexDirection: 'column', gap: '24px' },
    spacing: { padding: { top: '48px', right: '24px', bottom: '48px', left: '24px' } },
  }),
  text: () => ({
    typography: { fontSize: '17px', lineHeight: '1.7', color: DEFAULT_THEME.colors.ink },
  }),
  media: () => ({
    size: { width: '100%' },
    border: { radius: DEFAULT_THEME.radius },
  }),
  button: () => ({
    spacing: { padding: { top: '12px', right: '26px', bottom: '12px', left: '26px' } },
    background: { color: DEFAULT_THEME.colors.forest },
    typography: { color: '#FFFFFF', fontSize: '15px', fontWeight: 600 },
    border: { radius: '999px', style: 'none' },
  }),
  calendar: () => ({
    background: { color: '#FFFFFF' },
    border: { width: '1px', style: 'solid', color: '#E3DED2', radius: DEFAULT_THEME.radius },
    spacing: { padding: { top: '20px', right: '20px', bottom: '20px', left: '20px' } },
  }),
  form: () => ({
    layout: { display: 'flex', flexDirection: 'column', gap: '14px' },
    size: { maxWidth: '520px' },
  }),
};

export const DEFAULT_BLOCK_LABEL: Record<BlockType, string> = {
  container: 'Conteneur',
  text: 'Texte',
  media: 'Media',
  button: 'Bouton',
  calendar: 'Calendrier',
  form: 'Formulaire',
};

/** Fabrique un noeud complet et valide pour un type donne. */
export function createNode<T extends BlockType>(
  type: T,
  overrides: Partial<Omit<BlockNode<T>, 'type'>> = {},
): BlockNode<T> {
  const node: BlockNode<T> = {
    id: overrides.id ?? createId(type.slice(0, 3)),
    type,
    name: overrides.name ?? DEFAULT_BLOCK_LABEL[type],
    content: { ...(BASE_CONTENT[type]() as ContentByType[T]), ...(overrides.content ?? {}) },
    styles: overrides.styles ?? BASE_STYLES[type](),
    actions: overrides.actions ?? [],
    children: (overrides.children ?? []) as AnyBlockNode[],
  };
  if (overrides.meta) node.meta = overrides.meta;
  return node;
}

/** Racine minimale d'un nouveau projet. */
export function createEmptyTree(title = 'Nouveau site'): PageTree {
  const root = createNode('container', {
    name: 'Page',
    content: { tag: 'main' },
    styles: {
      layout: { display: 'flex', flexDirection: 'column', gap: '0px' },
      background: { color: DEFAULT_THEME.colors.offwhite },
      typography: { fontFamily: DEFAULT_THEME.fontFamilyBody, color: DEFAULT_THEME.colors.ink },
      size: { minHeight: '100vh' },
      spacing: { padding: { top: '0px', right: '0px', bottom: '0px', left: '0px' } },
    },
  });

  return {
    version: AST_VERSION,
    meta: { title, description: '', lang: 'fr' },
    theme: DEFAULT_THEME,
    root,
  };
}

/** Arbre de demarrage : hero + presentation, pour ne jamais afficher un canvas vide. */
export function createStarterTree(title = 'Nouveau site'): PageTree {
  const tree = createEmptyTree(title);

  const hero = createNode('container', {
    name: 'Hero',
    content: { tag: 'header', anchor: 'accueil' },
    styles: {
      layout: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '20px',
      },
      size: { minHeight: '520px' },
      spacing: { padding: { top: '96px', right: '24px', bottom: '96px', left: '24px' } },
      background: { color: DEFAULT_THEME.colors.linen },
      typography: { textAlign: 'center' },
    },
    children: [
      createNode('text', {
        name: 'Titre',
        content: { text: title, tag: 'h1' },
        styles: {
          typography: {
            fontFamily: DEFAULT_THEME.fontFamilyHeading,
            fontSize: '56px',
            fontWeight: 500,
            lineHeight: '1.1',
            color: DEFAULT_THEME.colors.forest,
          },
        },
      }),
      createNode('text', {
        name: 'Accroche',
        content: { text: 'Une phrase pour poser le decor.', tag: 'p' },
        styles: {
          typography: { fontSize: '19px', lineHeight: '1.6', color: DEFAULT_THEME.colors.muted },
          size: { maxWidth: '620px' },
        },
      }),
      createNode('button', {
        name: 'Appel a l action',
        content: { label: 'Reserver', variant: 'primary' },
        actions: [{ type: 'scrollTo', anchor: 'contact' }],
      }),
    ],
  });

  const section = createNode('container', {
    name: 'Presentation',
    content: { tag: 'section', anchor: 'presentation' },
    styles: {
      layout: { display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'center' },
      spacing: { padding: { top: '72px', right: '24px', bottom: '72px', left: '24px' } },
    },
    children: [
      createNode('text', {
        name: 'Titre de section',
        content: { text: 'Le lieu', tag: 'h2' },
        styles: {
          typography: {
            fontFamily: DEFAULT_THEME.fontFamilyHeading,
            fontSize: '36px',
            fontWeight: 500,
            color: DEFAULT_THEME.colors.forest,
          },
        },
      }),
      createNode('text', {
        name: 'Paragraphe',
        content: {
          text: 'Decrivez ici ce qui rend l endroit unique.',
          tag: 'p',
        },
        styles: {
          typography: { fontSize: '17px', lineHeight: '1.8', textAlign: 'center' },
          size: { maxWidth: '680px' },
        },
      }),
    ],
  });

  tree.root.children = [hero, section];
  return tree;
}
