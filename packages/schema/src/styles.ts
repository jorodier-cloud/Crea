import type { AnyBlockNode, BlockStyles, BoxSpacing } from './types/schema.js';

/** Proprietes CSS en camelCase, directement utilisables par React (`style={...}`). */
export type CssProperties = Record<string, string | number>;

function box(value: BoxSpacing | undefined): string | undefined {
  if (!value) return undefined;
  const { top = '0', right = '0', bottom = '0', left = '0' } = value;
  if ([top, right, bottom, left].every((side) => side === '0')) return undefined;
  return `${top} ${right} ${bottom} ${left}`;
}

/** Traduit les styles structures de l AST en proprietes CSS. */
export function stylesToCssProperties(styles: BlockStyles): CssProperties {
  const css: CssProperties = {};
  const set = (key: string, value: string | number | undefined): void => {
    if (value === undefined || value === '') return;
    css[key] = value;
  };

  const { layout, size, spacing, typography, background, border, effects, custom } = styles;

  if (layout) {
    set('display', layout.display);
    set('flexDirection', layout.flexDirection);
    set('flexWrap', layout.flexWrap);
    set('justifyContent', layout.justifyContent);
    set('alignItems', layout.alignItems);
    set('gap', layout.gap);
    set('gridTemplateColumns', layout.gridTemplateColumns);
    set('position', layout.position);
    set('zIndex', layout.zIndex);
  }

  if (size) {
    set('width', size.width);
    set('height', size.height);
    set('minHeight', size.minHeight);
    set('maxWidth', size.maxWidth);
    set('overflow', size.overflow);
  }

  if (spacing) {
    set('margin', box(spacing.margin));
    set('padding', box(spacing.padding));
  }

  if (typography) {
    set('fontFamily', typography.fontFamily);
    set('fontSize', typography.fontSize);
    set('fontWeight', typography.fontWeight);
    set('lineHeight', typography.lineHeight);
    set('letterSpacing', typography.letterSpacing);
    set('textAlign', typography.textAlign);
    set('textTransform', typography.textTransform);
    set('fontStyle', typography.fontStyle);
    set('color', typography.color);
  }

  if (background) {
    set('backgroundColor', background.color);
    if (background.image) set('backgroundImage', `url(${background.image})`);
    set('backgroundSize', background.size);
    set('backgroundPosition', background.position);
    set('backgroundRepeat', background.repeat);
  }

  if (border) {
    if (border.width && border.style && border.style !== 'none') {
      set('border', `${border.width} ${border.style} ${border.color ?? 'currentColor'}`);
    } else if (border.style === 'none') {
      set('border', 'none');
    }
    set('borderRadius', border.radius);
  }

  if (effects) {
    set('boxShadow', effects.boxShadow);
    set('opacity', effects.opacity);
    set('transition', effects.transition);
  }

  if (custom) {
    for (const [key, value] of Object.entries(custom)) set(key, value);
  }

  return css;
}

export function nodeToCssProperties(node: AnyBlockNode): CssProperties {
  const css = stylesToCssProperties(node.styles);
  if (node.meta?.hidden) css['display'] = 'none';
  return css;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink']);

/** Serialise des proprietes CSS camelCase en declaration inline. */
export function cssPropertiesToInline(css: CssProperties): string {
  return Object.entries(css)
    .map(([key, value]) => {
      const rendered =
        typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value);
      return `${kebab(key)}:${rendered}`;
    })
    .join(';');
}
