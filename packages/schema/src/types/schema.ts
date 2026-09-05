/**
 * Dictionnaire de donnees de l'AST Crea.
 *
 * REGLE ARCHITECTURALE ABSOLUE
 * ---------------------------
 * La source de verite n'est jamais du HTML. C'est l'arbre JSON decrit ici.
 * L'editeur visuel et le moteur IA lisent et modifient uniquement cette
 * structure ; le HTML produit par `renderTreeToHtml` n'est qu'une projection.
 *
 * Structure universelle d'un noeud :
 *   { id, type, content, styles, actions, children[] }
 */

/* -------------------------------------------------------------------------- */
/* Types de blocs                                                             */
/* -------------------------------------------------------------------------- */

export const BLOCK_TYPES = [
  'container',
  'text',
  'media',
  'button',
  'calendar',
  'form',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** Blocs pouvant accueillir des enfants. Les autres sont des feuilles. */
export const CONTAINER_TYPES: readonly BlockType[] = ['container', 'form'];

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

/** Valeur CSS libre exprimee en chaine ("16px", "1.5rem", "auto", "50%"). */
export type CssLength = string;

export interface BoxSpacing {
  top?: CssLength;
  right?: CssLength;
  bottom?: CssLength;
  left?: CssLength;
}

export interface LayoutStyles {
  display?: 'block' | 'flex' | 'inline-flex' | 'grid' | 'inline-block' | 'none';
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  gap?: CssLength;
  gridTemplateColumns?: string;
  position?: 'static' | 'relative' | 'absolute' | 'sticky';
  zIndex?: number;
}

export interface SizeStyles {
  width?: CssLength;
  height?: CssLength;
  minHeight?: CssLength;
  maxWidth?: CssLength;
  overflow?: 'visible' | 'hidden' | 'auto';
}

export interface SpacingStyles {
  margin?: BoxSpacing;
  padding?: BoxSpacing;
}

export interface TypographyStyles {
  fontFamily?: string;
  fontSize?: CssLength;
  fontWeight?: number;
  lineHeight?: string;
  letterSpacing?: CssLength;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  fontStyle?: 'normal' | 'italic';
  color?: string;
}

export interface BackgroundStyles {
  color?: string;
  image?: string;
  size?: 'cover' | 'contain' | 'auto';
  position?: string;
  repeat?: 'no-repeat' | 'repeat';
}

export interface BorderStyles {
  width?: CssLength;
  style?: 'none' | 'solid' | 'dashed' | 'dotted';
  color?: string;
  radius?: CssLength;
}

export interface EffectStyles {
  boxShadow?: string;
  opacity?: number;
  transition?: string;
}

/**
 * Styles d'un noeud, regroupes par famille pour piloter l'inspecteur.
 * `custom` est l'echappatoire : paires CSS camelCase -> valeur.
 */
export interface BlockStyles {
  layout?: LayoutStyles;
  size?: SizeStyles;
  spacing?: SpacingStyles;
  typography?: TypographyStyles;
  background?: BackgroundStyles;
  border?: BorderStyles;
  effects?: EffectStyles;
  custom?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Contenus par type de bloc                                                  */
/* -------------------------------------------------------------------------- */

export type ContainerTag =
  | 'div'
  | 'section'
  | 'header'
  | 'footer'
  | 'main'
  | 'article'
  | 'aside'
  | 'nav';

export interface ContainerContent {
  tag: ContainerTag;
  /** Ancre HTML facultative, cible des actions `scrollTo`. */
  anchor?: string;
}

export type TextTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'blockquote';

export interface TextContent {
  /** Texte brut. Le rendu echappe systematiquement le HTML. */
  text: string;
  tag: TextTag;
}

export interface MediaContent {
  kind: 'image' | 'video';
  /** URL publique (R2 ou externe). */
  src: string;
  alt: string;
  /** Identifiant de la ligne `Medias` quand le fichier vient de la bibliotheque. */
  mediaId?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';
  loading?: 'lazy' | 'eager';
  poster?: string;
}

export interface ButtonContent {
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
}

export interface CalendarContent {
  /** `availability` = affichage seul, `booking` = selection de dates. */
  mode: 'availability' | 'booking';
  /** Flux iCal a agreger (Lodgify, Airbnb, Booking...). */
  icalUrls: string[];
  monthsVisible: number;
  minNights: number;
  locale: string;
  /** Dates ISO (YYYY-MM-DD) bloquees manuellement. */
  blockedDates: string[];
}

export type FormFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox';

export interface FormField {
  id: string;
  name: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  required: boolean;
  options?: string[];
}

export interface FormContent {
  fields: FormField[];
  submitLabel: string;
  /** Endpoint POST recevant le formulaire. */
  endpoint: string;
  method: 'POST' | 'GET';
  successMessage: string;
}

export interface ContentByType {
  container: ContainerContent;
  text: TextContent;
  media: MediaContent;
  button: ButtonContent;
  calendar: CalendarContent;
  form: FormContent;
}

export type BlockContent = ContentByType[BlockType];

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

export type BlockAction =
  | { type: 'navigate'; href: string; target?: '_self' | '_blank' }
  | { type: 'scrollTo'; anchor: string }
  | { type: 'openUrl'; url: string }
  | { type: 'submitForm'; formId: string }
  | { type: 'toggleVisibility'; targetId: string }
  | { type: 'custom'; event: 'click' | 'submit' | 'change'; handler: string };

export type BlockActionType = BlockAction['type'];

/* -------------------------------------------------------------------------- */
/* Noeud                                                                      */
/* -------------------------------------------------------------------------- */

export interface NodeMeta {
  /** Verrouille le noeud : ni deplacement ni suppression depuis le canvas. */
  locked?: boolean;
  hidden?: boolean;
  /** Trace de la derniere generation IA ayant touche le noeud. */
  aiOrigin?: string;
}

/** Structure universelle de l'AST. */
export interface BlockNode<T extends BlockType = BlockType> {
  id: string;
  type: T;
  /** Nom lisible affiche dans l'arborescence de l'editeur. */
  name?: string;
  content: ContentByType[T];
  styles: BlockStyles;
  actions: BlockAction[];
  children: BlockNode[];
  meta?: NodeMeta;
}

export type AnyBlockNode = BlockNode<BlockType>;

/* -------------------------------------------------------------------------- */
/* Arbre de page                                                              */
/* -------------------------------------------------------------------------- */

export interface ThemeTokens {
  colors: Record<string, string>;
  fontFamilyBody: string;
  fontFamilyHeading: string;
  radius: CssLength;
  maxWidth: CssLength;
}

export interface PageMeta {
  title: string;
  description: string;
  lang: string;
  favicon?: string;
}

export const AST_VERSION = 1 as const;

export interface PageTree {
  version: number;
  meta: PageMeta;
  theme: ThemeTokens;
  root: BlockNode<'container'>;
}

/* -------------------------------------------------------------------------- */
/* Operations de mutation (langage commun editeur <-> IA)                     */
/* -------------------------------------------------------------------------- */

export interface DeepPartialStyles {
  layout?: Partial<LayoutStyles>;
  size?: Partial<SizeStyles>;
  spacing?: Partial<SpacingStyles>;
  typography?: Partial<TypographyStyles>;
  background?: Partial<BackgroundStyles>;
  border?: Partial<BorderStyles>;
  effects?: Partial<EffectStyles>;
  custom?: Record<string, string>;
}

export type TreeOperation =
  | { op: 'insert'; parentId: string; index?: number; node: AnyBlockNode }
  | {
      op: 'update';
      id: string;
      name?: string;
      content?: Record<string, unknown>;
      styles?: DeepPartialStyles;
      actions?: BlockAction[];
      meta?: NodeMeta;
    }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; parentId: string; index: number }
  | { op: 'duplicate'; id: string }
  | { op: 'setMeta'; title?: string; description?: string; lang?: string }
  | { op: 'setTheme'; theme: Partial<ThemeTokens> }
  | { op: 'replaceRoot'; node: BlockNode<'container'> };

export type TreeOperationType = TreeOperation['op'];

export interface OperationResult {
  tree: PageTree;
  applied: TreeOperation[];
  errors: string[];
}
