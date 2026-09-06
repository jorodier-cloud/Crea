import type { FormContent, PageTree, AnyBlockNode } from '@crea/schema';

/**
 * Lecture d une soumission de formulaire public.
 *
 * Tout ce qui arrive ici vient d un visiteur inconnu : les champs sont
 * confrontes a ceux que l arbre publie declare, et rien d autre n est retenu.
 * Accepter des champs arbitraires reviendrait a laisser n importe qui remplir
 * la base et les emails de contenu de son choix.
 */

/** Champ cache : un humain ne le voit pas, un robot le remplit. */
export const HONEYPOT_FIELD = '_crea_hp';

/** Nom du champ portant l identifiant du bloc formulaire soumis. */
export const FORM_ID_FIELD = '_crea_form';

export const MAX_FIELD_LENGTH = 4000;

export interface ReadSubmission {
  fields: Array<{ label: string; value: string }>;
  senderName: string | null;
  senderEmail: string | null;
}

/** Parcourt l arbre a la recherche du bloc formulaire portant cet identifiant. */
export function findFormNode(tree: PageTree, formId: string): AnyBlockNode | null {
  const stack: AnyBlockNode[] = [tree.root];
  while (stack.length > 0) {
    const node = stack.pop() as AnyBlockNode;
    if (node.type === 'form' && node.id === formId) return node;
    for (const child of node.children) stack.push(child);
  }
  return null;
}

/** Premier formulaire rencontre, quand la soumission n en designe aucun. */
export function findFirstFormNode(tree: PageTree): AnyBlockNode | null {
  const stack: AnyBlockNode[] = [tree.root];
  while (stack.length > 0) {
    const node = stack.shift() as AnyBlockNode;
    if (node.type === 'form') return node;
    stack.push(...node.children);
  }
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Retient les champs declares par le formulaire, dans l ordre du formulaire.
 *
 * Retourne aussi le nom et l email de l expediteur quand ils sont
 * identifiables : ils servent au sujet du message et au `reply-to`.
 */
export function readSubmission(
  node: AnyBlockNode,
  submitted: Record<string, string>,
): ReadSubmission {
  const content = node.content as FormContent;
  const fields: Array<{ label: string; value: string }> = [];
  let senderName: string | null = null;
  let senderEmail: string | null = null;

  for (const field of content.fields ?? []) {
    const raw = submitted[field.name];
    if (raw === undefined) continue;

    const value = raw.trim().slice(0, MAX_FIELD_LENGTH);
    if (!value) continue;

    fields.push({ label: field.label || field.name, value });

    if (!senderEmail && field.type === 'email' && EMAIL_PATTERN.test(value)) {
      senderEmail = value.toLowerCase();
    }
    if (!senderName && field.type === 'text' && /nom|name/i.test(`${field.name} ${field.label}`)) {
      senderName = value;
    }
  }

  return { fields, senderName, senderEmail };
}

/** Vrai si un champ obligatoire declare par le formulaire est resté vide. */
export function missingRequired(
  node: AnyBlockNode,
  submitted: Record<string, string>,
): string[] {
  const content = node.content as FormContent;
  return (content.fields ?? [])
    .filter((field) => field.required && !(submitted[field.name] ?? '').trim())
    .map((field) => field.label || field.name);
}
