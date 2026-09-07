import {
  DEFAULT_BLOCK_LABEL,
  type AnyBlockNode,
  type ButtonContent,
  type TextContent,
} from '@crea/schema';

/**
 * Suggestions de chat selon ce qui est selectionne.
 *
 * Quatre phrases figees, toujours les memes qu on ait selectionne un bouton ou
 * rien du tout, n aident personne a comprendre ce que l IA peut faire sur CE
 * bloc precis. Ce module n a pas d etat : facile a verifier a l oeil, aucun
 * harnais de test necessaire pour de la copie.
 */
export function suggestionsFor(node: AnyBlockNode | null): string[] {
  if (!node) {
    return [
      'Decris ton domaine, je cree la page d accueil',
      'Ajoute une section presentation',
      'Passe la palette en vert sauge et beige lin',
      'Ajoute un formulaire de contact',
    ];
  }

  switch (node.type) {
    case 'text':
      return [
        'Reformule ce texte',
        'Raccourcis ce texte',
        'Rends ce texte plus elegant',
        'Traduis ce texte en anglais',
      ];
    case 'button':
      return [
        'Change le texte du bouton',
        'Change la couleur du bouton',
        'Fais pointer ce bouton vers le formulaire de contact',
      ];
    case 'media':
      return [
        'Change la description de cette image',
        'Recadre cette image en plein cadre',
        'Ajoute une legende sous cette photo',
      ];
    case 'calendar':
      return [
        'Passe le sejour minimum a 3 nuits',
        'Affiche un mois de plus',
        'Ajoute mes dates deja reservees',
      ];
    case 'form':
      return [
        'Ajoute un champ telephone',
        'Change le texte du bouton d envoi',
        'Change le message affiche apres l envoi',
      ];
    case 'embed':
      return [
        'Agrandis cet espace',
        'Ajoute une bordure arrondie autour du widget',
        'Deplace ce widget plus haut',
      ];
    case 'container':
    default:
      return [
        'Ajoute un bloc dans cette section',
        'Passe cette section sur deux colonnes',
        'Change la couleur de fond de cette section',
        'Supprime cette section',
      ];
  }
}

/**
 * Decrit un bloc pour l affichage — jamais son identifiant technique.
 * Un extrait du contenu vaut mieux qu un nom generique quand il existe : on
 * distingue ainsi deux textes du meme type sans lire d id.
 */
export function describeSelection(node: AnyBlockNode): string {
  const label = DEFAULT_BLOCK_LABEL[node.type];

  if (node.type === 'text') {
    const text = (node.content as TextContent).text?.trim();
    return text ? `${label} « ${truncate(text, 32)} »` : label;
  }
  if (node.type === 'button') {
    const buttonLabel = (node.content as ButtonContent).label?.trim();
    return buttonLabel ? `${label} « ${truncate(buttonLabel, 32)} »` : label;
  }
  if (node.name && node.name !== label) return node.name;
  return label;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
