import { cssPropertiesToInline, nodeToCssProperties } from './styles.js';
import type {
  AnyBlockNode,
  BlockAction,
  ButtonContent,
  CalendarContent,
  ContainerContent,
  FormContent,
  MediaContent,
  PageTree,
  TextContent,
} from './types/schema.js';

/**
 * Projection HTML de l AST. Aucune information n existe ici qui ne soit
 * derivable de l arbre : ce module est un pur `tree -> string`.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Les URL sont filtrees pour empecher l injection de `javascript:`. */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#|data:image\/)/i.test(trimmed)) return trimmed;
  return '#';
}

function attributesFromActions(actions: BlockAction[]): string {
  const attributes: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'scrollTo':
        attributes.push(`data-crea-scroll="${escapeAttr(action.anchor)}"`);
        break;
      case 'toggleVisibility':
        attributes.push(`data-crea-toggle="${escapeAttr(action.targetId)}"`);
        break;
      case 'custom':
        attributes.push(`data-crea-handler="${escapeAttr(action.handler)}"`);
        attributes.push(`data-crea-event="${escapeAttr(action.event)}"`);
        break;
      default:
        break;
    }
  }
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
}

function linkFromActions(actions: BlockAction[]): { href: string; target?: string } | null {
  for (const action of actions) {
    if (action.type === 'navigate') {
      return { href: safeUrl(action.href), ...(action.target ? { target: action.target } : {}) };
    }
    if (action.type === 'openUrl') {
      return { href: safeUrl(action.url), target: '_blank' };
    }
    if (action.type === 'scrollTo') {
      return { href: `#${action.anchor}` };
    }
  }
  return null;
}

function styleAttr(node: AnyBlockNode): string {
  const inline = cssPropertiesToInline(nodeToCssProperties(node));
  return inline ? ` style="${escapeAttr(inline)}"` : '';
}

/* -------------------------------------------------------------------------- */
/* Rendu par type                                                             */
/* -------------------------------------------------------------------------- */

function renderContainer(
  node: AnyBlockNode,
  depth: number,
  today: Date,
  formEndpoint: string | null,
): string {
  const content = node.content as ContainerContent;
  const tag = content.tag ?? 'div';
  const anchor = content.anchor ? ` id="${escapeAttr(content.anchor)}"` : ` id="${escapeAttr(node.id)}"`;
  const inner = node.children
    .map((child) => renderNodeToHtml(child, depth + 1, today, formEndpoint))
    .join('');
  return `<${tag}${anchor} data-crea-id="${escapeAttr(node.id)}"${styleAttr(node)}${attributesFromActions(node.actions)}>${inner}</${tag}>`;
}

function renderText(node: AnyBlockNode): string {
  const content = node.content as TextContent;
  const tag = content.tag ?? 'p';
  const text = escapeHtml(content.text ?? '').replace(/\n/g, '<br />');
  return `<${tag} data-crea-id="${escapeAttr(node.id)}"${styleAttr(node)}>${text}</${tag}>`;
}

function renderMedia(node: AnyBlockNode): string {
  const content = node.content as MediaContent;
  const src = safeUrl(content.src ?? '');
  const objectFit = content.objectFit ? `object-fit:${content.objectFit};` : '';
  const style = cssPropertiesToInline(nodeToCssProperties(node));
  const combined = `${objectFit}${style}`;
  const styleAttribute = combined ? ` style="${escapeAttr(combined)}"` : '';

  if (!content.src) {
    return `<div data-crea-id="${escapeAttr(node.id)}"${styleAttribute} data-crea-empty="media"></div>`;
  }
  if (content.kind === 'video') {
    const poster = content.poster ? ` poster="${escapeAttr(safeUrl(content.poster))}"` : '';
    return `<video data-crea-id="${escapeAttr(node.id)}" src="${escapeAttr(src)}"${poster} controls playsinline${styleAttribute}></video>`;
  }
  const loading = content.loading ?? 'lazy';
  return `<img data-crea-id="${escapeAttr(node.id)}" src="${escapeAttr(src)}" alt="${escapeAttr(content.alt ?? '')}" loading="${escapeAttr(loading)}"${styleAttribute} />`;
}

function renderButton(node: AnyBlockNode): string {
  const content = node.content as ButtonContent;
  const label = escapeHtml(content.label ?? '');
  const link = linkFromActions(node.actions);
  const actionAttributes = attributesFromActions(node.actions);
  const variant = ` data-crea-variant="${escapeAttr(content.variant ?? 'primary')}"`;

  if (link) {
    const target = link.target ? ` target="${escapeAttr(link.target)}" rel="noopener"` : '';
    return `<a data-crea-id="${escapeAttr(node.id)}" href="${escapeAttr(link.href)}"${target}${variant}${styleAttr(node)}${actionAttributes}>${label}</a>`;
  }
  const submits = node.actions.some((action) => action.type === 'submitForm');
  return `<button type="${submits ? 'submit' : 'button'}" data-crea-id="${escapeAttr(node.id)}"${variant}${styleAttr(node)}${actionAttributes}>${label}</button>`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function renderCalendar(node: AnyBlockNode, today: Date): string {
  const content = node.content as CalendarContent;
  const months = Math.max(1, Math.min(content.monthsVisible ?? 2, 12));
  const blocked = new Set(content.blockedDates ?? []);
  const locale = content.locale ?? 'fr-FR';
  const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  const grids: string[] = [];
  for (let offset = 0; offset < months; offset += 1) {
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const label = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(cursor);
    const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells: string[] = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push('<span class="crea-cal-cell"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
      const isBlocked = blocked.has(iso);
      cells.push(
        `<button type="button" class="crea-cal-day${isBlocked ? ' is-blocked' : ''}" data-date="${iso}"${isBlocked ? ' disabled' : ''}>${day}</button>`,
      );
    }

    grids.push(
      `<div class="crea-cal-month"><p class="crea-cal-label">${escapeHtml(label)}</p>` +
        `<div class="crea-cal-grid">${weekdays
          .map((weekday) => `<span class="crea-cal-weekday">${weekday}</span>`)
          .join('')}${cells.join('')}</div></div>`,
    );
  }

  return (
    `<div data-crea-id="${escapeAttr(node.id)}" class="crea-calendar" data-mode="${escapeAttr(content.mode ?? 'availability')}" ` +
    `data-min-nights="${content.minNights ?? 1}"${styleAttr(node)}>${grids.join('')}` +
    `<p class="crea-cal-legend">Sejour minimum : ${content.minNights ?? 1} nuits</p></div>`
  );
}

/** Champ cache : un humain ne le voit pas, un robot le remplit. */
const HONEYPOT_FIELD = '_crea_hp';
const FORM_ID_FIELD = '_crea_form';

function renderForm(
  node: AnyBlockNode,
  depth: number,
  today: Date,
  formEndpoint: string | null,
): string {
  const content = node.content as FormContent;
  const fields = (content.fields ?? [])
    .map((field) => {
      const id = `${node.id}-${field.name}`;
      const required = field.required ? ' required' : '';
      const placeholder = field.placeholder ? ` placeholder="${escapeAttr(field.placeholder)}"` : '';
      const label = `<label class="crea-field-label" for="${escapeAttr(id)}">${escapeHtml(field.label)}</label>`;

      let control: string;
      if (field.type === 'textarea') {
        control = `<textarea class="crea-field-control" id="${escapeAttr(id)}" name="${escapeAttr(field.name)}" rows="4"${placeholder}${required}></textarea>`;
      } else if (field.type === 'select') {
        const options = (field.options ?? [])
          .map((option) => `<option value="${escapeAttr(option)}">${escapeHtml(option)}</option>`)
          .join('');
        control = `<select class="crea-field-control" id="${escapeAttr(id)}" name="${escapeAttr(field.name)}"${required}>${options}</select>`;
      } else {
        control = `<input class="crea-field-control" id="${escapeAttr(id)}" type="${escapeAttr(field.type)}" name="${escapeAttr(field.name)}"${placeholder}${required} />`;
      }
      return `<div class="crea-field">${label}${control}</div>`;
    })
    .join('');

  const children = node.children
    .map((child) => renderNodeToHtml(child, depth + 1, today, formEndpoint))
    .join('');
  const submit = `<button type="submit" class="crea-submit">${escapeHtml(content.submitLabel ?? 'Envoyer')}</button>`;

  // Un `endpoint` saisi a la main l emporte — il peut viser un service tiers.
  // Sinon on vise la reception integree, quand l appelant en fournit l adresse.
  const authored = (content.endpoint ?? '').trim();
  const action = authored && authored !== '#' ? safeUrl(authored) : (formEndpoint ?? '#');
  const method = authored ? (content.method ?? 'POST') : 'POST';

  // `aria-hidden` et `tabindex` gardent le piege hors de portee des lecteurs
  // d ecran et du parcours au clavier : seul un robot le remplira.
  const honeypot =
    `<input type="text" name="${HONEYPOT_FIELD}" value="" tabindex="-1" autocomplete="off" ` +
    `aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />`;
  const marker = `<input type="hidden" name="${FORM_ID_FIELD}" value="${escapeAttr(node.id)}" />`;

  return (
    `<form data-crea-id="${escapeAttr(node.id)}" class="crea-form" method="${escapeAttr(method)}" ` +
    `action="${escapeAttr(action)}" data-success="${escapeAttr(content.successMessage ?? '')}"${styleAttr(node)}>` +
    `${marker}${honeypot}${fields}${children}${submit}</form>`
  );
}

/** Rendu d un noeud et de sa descendance. */
export function renderNodeToHtml(
  node: AnyBlockNode,
  depth = 0,
  today = new Date(),
  formEndpoint: string | null = null,
): string {
  if (depth > 64) return '';
  switch (node.type) {
    case 'container':
      return renderContainer(node, depth, today, formEndpoint);
    case 'text':
      return renderText(node);
    case 'media':
      return renderMedia(node);
    case 'button':
      return renderButton(node);
    case 'calendar':
      return renderCalendar(node, today);
    case 'form':
      return renderForm(node, depth, today, formEndpoint);
    default:
      return '';
  }
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
body{margin:0}
img,video{max-width:100%;display:block}
a{text-decoration:none;color:inherit}
button{font:inherit;cursor:pointer;border:none;background:none}
.crea-calendar{display:flex;flex-wrap:wrap;gap:24px}
.crea-cal-month{min-width:240px}
.crea-cal-label{margin:0 0 10px;font-weight:600;text-transform:capitalize}
.crea-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.crea-cal-weekday{font-size:12px;opacity:.6;text-align:center}
.crea-cal-day{padding:8px 0;border-radius:6px;text-align:center;background:transparent}
.crea-cal-day:hover:not(:disabled){background:rgba(0,0,0,.06)}
.crea-cal-day.is-blocked{opacity:.3;text-decoration:line-through;cursor:not-allowed}
.crea-cal-day.is-selected{background:#2F4132;color:#fff}
.crea-cal-legend{margin:12px 0 0;font-size:13px;opacity:.7}
.crea-form{display:flex;flex-direction:column;gap:14px}
.crea-field{display:flex;flex-direction:column;gap:6px}
.crea-field-label{font-size:13px;font-weight:600}
.crea-field-control{padding:11px 13px;border:1px solid #DDD6C7;border-radius:8px;font:inherit;background:#fff}
.crea-submit{align-self:flex-start;padding:12px 26px;border-radius:999px;background:#2F4132;color:#fff;font-weight:600}`;

const RUNTIME_JS = `(function(){
  document.addEventListener('click', function(event){
    var scroller = event.target.closest('[data-crea-scroll]');
    if (scroller) {
      var target = document.getElementById(scroller.getAttribute('data-crea-scroll'));
      if (target) { event.preventDefault(); target.scrollIntoView({behavior:'smooth'}); }
    }
    var toggler = event.target.closest('[data-crea-toggle]');
    if (toggler) {
      var panel = document.querySelector('[data-crea-id="' + toggler.getAttribute('data-crea-toggle') + '"]');
      if (panel) panel.hidden = !panel.hidden;
    }
    var day = event.target.closest('.crea-cal-day');
    if (day && !day.disabled) {
      var calendar = day.closest('.crea-calendar');
      if (calendar && calendar.getAttribute('data-mode') === 'booking') {
        var selected = calendar.querySelectorAll('.crea-cal-day.is-selected');
        if (selected.length >= 2) selected.forEach(function(el){ el.classList.remove('is-selected'); });
        day.classList.add('is-selected');
      }
    }
  });
})();`;

export interface RenderOptions {
  /** Injecte le CSS de base et le petit runtime (ancres, calendrier). */
  includeRuntime?: boolean;
  /** Date de reference pour les calendriers (tests deterministes). */
  today?: Date;
  /**
   * Adresse recevant les formulaires qui n en declarent pas.
   *
   * Elle depend du site servi — `/p/<adresse>/contact` — donc de l appelant :
   * le rendu ne peut pas la deviner, et sans elle un formulaire ne mene nulle
   * part. C est le seul endroit ou cette dependance entre.
   */
  formEndpoint?: string | null;
}

/** Projection complete : document HTML autonome. */
export function renderTreeToHtml(tree: PageTree, options: RenderOptions = {}): string {
  const { includeRuntime = true, today = new Date(), formEndpoint = null } = options;
  const body = renderNodeToHtml(tree.root, 0, today, formEndpoint);
  const themeVariables = Object.entries(tree.theme.colors)
    .map(([name, value]) => `--crea-${name}:${value}`)
    .join(';');

  return `<!doctype html>
<html lang="${escapeAttr(tree.meta.lang || 'fr')}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(tree.meta.title)}</title>
<meta name="description" content="${escapeAttr(tree.meta.description)}" />
${tree.meta.favicon ? `<link rel="icon" href="${escapeAttr(safeUrl(tree.meta.favicon))}" />` : ''}
<style>:root{${themeVariables};font-family:${escapeHtml(tree.theme.fontFamilyBody)}}
${includeRuntime ? BASE_CSS : ''}</style>
</head>
<body>
${body}
${includeRuntime ? `<script>${RUNTIME_JS}</script>` : ''}
</body>
</html>`;
}
