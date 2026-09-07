import { BLOCK_TYPES, type PageTree, type TreeOperation } from './types/schema.js';
import { outlineTree } from './tree.js';

/**
 * Contrat IA <-> AST.
 *
 * Le modele ne produit jamais de HTML : il repond par une liste d operations
 * appliquees ensuite par `applyOperations`, apres normalisation. Toute sortie
 * mal formee est rejetee cote serveur : le modele n a aucun pouvoir d ecriture
 * direct sur l arbre.
 */

export interface AiResponsePayload {
  /** Reponse en langage naturel affichee dans le chat. */
  message: string;
  operations: TreeOperation[];
}

/**
 * Specification injectee dans le prompt systeme.
 * Elle decrit la grammaire exacte attendue en sortie.
 */
export const AI_OUTPUT_SPEC = `{
  "message": string,                  // 1 a 2 phrases, en francais, ce qui a ete fait
  "operations": [                     // liste ordonnee, peut etre vide
    { "op": "insert", "parentId": string, "index"?: number, "node": BlockNode },
    { "op": "update", "id": string, "name"?: string, "content"?: object, "styles"?: BlockStyles, "actions"?: BlockAction[] },
    { "op": "remove", "id": string },
    { "op": "move", "id": string, "parentId": string, "index": number },
    { "op": "duplicate", "id": string },
    { "op": "setMeta", "title"?: string, "description"?: string, "lang"?: string },
    { "op": "setTheme", "theme": { "colors"?: object, "fontFamilyBody"?: string, "fontFamilyHeading"?: string, "radius"?: string, "maxWidth"?: string } },
    { "op": "replaceRoot", "node": BlockNode }
  ]
}

BlockNode = {
  "id": string,                       // omis => genere par le serveur
  "type": ${BLOCK_TYPES.map((type) => `"${type}"`).join(' | ')},
  "name"?: string,
  "content": <contenu du type, voir ci-dessous>,
  "styles": BlockStyles,
  "actions": BlockAction[],
  "children": BlockNode[]             // uniquement pour "container" et "form"
}

content par type :
  container : { "tag": "div"|"section"|"header"|"footer"|"main"|"article"|"aside"|"nav", "anchor"?: string }
  text      : { "text": string, "tag": "h1"|"h2"|"h3"|"h4"|"h5"|"h6"|"p"|"span"|"blockquote" }
  media     : { "kind": "image"|"video", "src": string, "alt": string, "objectFit"?: "cover"|"contain"|"fill"|"none" }
  button    : { "label": string, "variant": "primary"|"secondary"|"ghost"|"link", "size"?: "sm"|"md"|"lg" }
  calendar  : { "mode": "availability"|"booking", "icalUrls": string[], "monthsVisible": number, "minNights": number, "locale": string, "blockedDates": string[] }
  form      : { "fields": [{ "id": string, "name": string, "label": string, "type": "text"|"email"|"tel"|"textarea"|"number"|"date"|"select"|"checkbox", "required": boolean, "placeholder"?: string, "options"?: string[] }], "submitLabel": string, "endpoint": string, "method": "POST"|"GET", "successMessage": string }
  embed     : { "html": string }      // voir regle 11 : tu ne renseignes jamais ce champ
  product   : { "name": string, "description": string, "price": number, "currency": string, "image": string, "buttonLabel": string }  // voir regle 12

BlockStyles = {
  "layout"?:     { "display"?, "flexDirection"?, "flexWrap"?, "justifyContent"?, "alignItems"?, "gap"?, "gridTemplateColumns"?, "position"?, "zIndex"? },
  "size"?:       { "width"?, "height"?, "minHeight"?, "maxWidth"?, "overflow"? },
  "spacing"?:    { "margin"?: { "top"?, "right"?, "bottom"?, "left"? }, "padding"?: { ... } },
  "typography"?: { "fontFamily"?, "fontSize"?, "fontWeight"?, "lineHeight"?, "letterSpacing"?, "textAlign"?, "textTransform"?, "fontStyle"?, "color"? },
  "background"?: { "color"?, "image"?, "size"?, "position"?, "repeat"? },
  "border"?:     { "width"?, "style"?, "color"?, "radius"? },
  "effects"?:    { "boxShadow"?, "opacity"?, "transition"? },
  "custom"?:     { "<proprieteCssCamelCase>": string }
}

BlockAction =
  { "type": "navigate", "href": string, "target"?: "_self"|"_blank" }
  | { "type": "scrollTo", "anchor": string }
  | { "type": "openUrl", "url": string }
  | { "type": "submitForm", "formId": string }
  | { "type": "toggleVisibility", "targetId": string }
  | { "type": "custom", "event": "click"|"submit"|"change", "handler": string }`;

export const AI_SYSTEM_PROMPT = `Tu es le moteur de generation de Crea, un constructeur de site web dont la source de verite est un arbre JSON (AST). Tu ne produis JAMAIS de HTML, de CSS brut ni de code.

REGLES ABSOLUES
1. Ta reponse est un unique objet JSON, sans texte autour, sans bloc de code markdown.
2. Cet objet respecte exactement la grammaire fournie plus bas.
3. Tu modifies l arbre uniquement par operations ciblees. Tu utilises "update" quand un noeud existe deja ; "replaceRoot" est reserve a une refonte totale explicitement demandee.
4. Tu ne referencies que des identifiants presents dans l arbre courant fourni. N invente jamais un id existant.
5. Pour un nouveau noeud, omets "id" : le serveur en attribue un.
6. Les seuls types autorises sont : ${BLOCK_TYPES.join(', ')}. Aucun autre type n existe.
7. Seuls "container" et "form" acceptent des enfants.
8. Les valeurs de style sont des chaines CSS valides ("24px", "1.5rem", "#2F4132", "100%").
9. Si la demande est ambigue ou hors perimetre, renvoie "operations": [] et explique en une phrase dans "message".
10. Reste sobre : produis le minimum d operations necessaires. Pas de refonte non demandee.
11. Pour un bloc "embed", ne renseigne JAMAIS "content.html" toi-meme — ce champ recoit un code tiers (widget de reservation, carte...) colle a la main par le proprietaire du site. Tu peux inserer un bloc "embed" vide, le deplacer, le styler ou le supprimer, jamais generer ou modifier son contenu.
12. Pour un bloc "product", "price" est un nombre strictement positif exprime dans l unite majeure de la devise (149.90 pour 149,90 EUR, jamais en centimes) et "currency" un code ISO 4217 en minuscules ("eur", "usd"...). C est ce montant exact qui sera facture au visiteur : ne l invente pas si l utilisateur ne l a pas donne, demande-le plutot dans "message" et renvoie "operations": [].

STYLE EDITORIAL PAR DEFAUT
- Francais, ton elegant et sobre.
- Hierarchie typographique claire, respiration genereuse (padding vertical >= 48px pour une section).
- Contraste suffisant entre texte et fond.

GRAMMAIRE DE SORTIE
${AI_OUTPUT_SPEC}`;

export interface BuildUserMessageInput {
  tree: PageTree;
  prompt: string;
  /** Bloc actuellement selectionne dans le canvas, s il y en a un. */
  selectedNodeId?: string | null;
}

/** Message utilisateur : etat courant de l AST + demande. */
export function buildUserMessage({ tree, prompt, selectedNodeId }: BuildUserMessageInput): string {
  const outline = outlineTree(tree.root);
  const selection = selectedNodeId
    ? `\n\nBLOC SELECTIONNE PAR L UTILISATEUR : ${selectedNodeId}\nSauf indication contraire, applique la demande a ce bloc ou a ses enfants.`
    : '';

  return `ARBRE COURANT (JSON complet) :
${JSON.stringify(tree)}

ARBORESCENCE LISIBLE :
${outline}${selection}

DEMANDE DE L UTILISATEUR :
${prompt}`;
}

/**
 * Extrait l objet JSON d une reponse modele.
 * Tolere un bloc de code markdown ou du texte parasite autour de l objet.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Reponse IA illisible : aucun objet JSON trouve.');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

const KNOWN_OPS = new Set([
  'insert',
  'update',
  'remove',
  'move',
  'duplicate',
  'setMeta',
  'setTheme',
  'replaceRoot',
]);

/** Parse et filtre la reponse du modele. Les operations inconnues sont ecartees. */
export function parseAiResponse(raw: string): { payload: AiResponsePayload; rejected: string[] } {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Reponse IA invalide : objet attendu.');
  }

  const record = parsed as Record<string, unknown>;
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  const rejected: string[] = [];
  const operations: TreeOperation[] = [];

  if (Array.isArray(record['operations'])) {
    for (const item of record['operations']) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        rejected.push('Operation ignoree : format invalide.');
        continue;
      }
      const op = (item as Record<string, unknown>)['op'];
      if (typeof op !== 'string' || !KNOWN_OPS.has(op)) {
        rejected.push(`Operation ignoree : "${String(op)}" inconnue.`);
        continue;
      }
      operations.push(item as unknown as TreeOperation);
    }
  }

  return { payload: { message, operations }, rejected };
}
