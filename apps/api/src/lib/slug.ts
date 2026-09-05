export const SLUG_MAX_LENGTH = 60;

/**
 * Transforme un titre en identifiant d URL.
 * "Rives d'Ormoy — Été 2026" -> "rives-d-ormoy-ete-2026"
 *
 * Sans dependance : le meme algorithme est reproduit cote navigateur pour
 * l apercu de saisie (`PublishButton`).
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}
