/**
 * Fonctions pures manipulant `wrangler.toml` et les sorties de la CLI wrangler.
 *
 * Isolees ici pour etre testables sans compte Cloudflare : c est la partie du
 * script d installation ou une erreur silencieuse ferait le plus de degats
 * (une cle ecrite au mauvais endroit, une URL mal lue).
 */

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remplace la valeur d une cle TOML, en conservant l indentation.
 *
 * La cle doit apparaitre exactement une fois : mieux vaut echouer bruyamment
 * que patcher la mauvaise ligne dans un fichier qui a evolue.
 * Un commentaire de fin de ligne est supprime — il devient faux une fois la
 * valeur reelle en place ("remplacer par l id renvoye par...").
 */
export function setTomlValue(source, key, value) {
  const pattern = new RegExp(
    `^([ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*)("(?:[^"\\\\]|\\\\.)*"|[^\\s#]+)([ \\t]*(?:#.*)?)$`,
    'gm',
  );

  const matches = [...source.matchAll(pattern)];
  if (matches.length === 0) {
    throw new Error(`Cle "${key}" introuvable dans wrangler.toml.`);
  }
  if (matches.length > 1) {
    throw new Error(`Cle "${key}" presente ${matches.length} fois : patch ambigu, abandon.`);
  }

  return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
}

/** Lit la valeur actuelle d une cle TOML, ou `null` si absente. */
export function getTomlValue(source, key) {
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*("(?:[^"\\\\]|\\\\.)*"|[^\\s#]+)`,
    'm',
  );
  const match = pattern.exec(source);
  if (!match) return null;
  const raw = match[1];
  return raw.startsWith('"') ? JSON.parse(raw) : raw;
}

/** Un `database_id` encore a sa valeur de gabarit ne pointe sur aucune base. */
export function isPlaceholderDatabaseId(value) {
  if (!value) return true;
  return /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value) || !/^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Retrouve l UUID de la base dans la sortie JSON de `wrangler d1 list --json`.
 * Le nom des champs a change au fil des versions : on accepte les variantes.
 */
export function findDatabaseId(listJson, name) {
  let parsed;
  try {
    parsed = typeof listJson === 'string' ? JSON.parse(listJson) : listJson;
  } catch {
    return null;
  }

  const rows = Array.isArray(parsed) ? parsed : (parsed?.result ?? []);
  if (!Array.isArray(rows)) return null;

  const row = rows.find((item) => (item?.name ?? item?.database_name) === name);
  if (!row) return null;

  return row.uuid ?? row.database_id ?? row.id ?? null;
}

/**
 * Extrait l URL du Worker de la sortie de `wrangler deploy`.
 * On prend la derniere URL annoncee : wrangler liste d abord les routes
 * eventuelles, puis l URL effectivement deployee.
 */
export function extractWorkerUrl(output) {
  const matches = [...String(output).matchAll(/https:\/\/[^\s"'()]+\.workers\.dev\b[^\s"'()]*/g)];
  if (matches.length === 0) return null;
  const url = matches[matches.length - 1][0].replace(/[.,]+$/, '');
  return url;
}

/** Recupere l identifiant de compte (32 hexa) dans la sortie de `wrangler whoami`. */
export function extractAccountId(output) {
  const match = /\b[0-9a-f]{32}\b/i.exec(String(output));
  return match ? match[0] : null;
}

/** `wrangler whoami` n imprime pas de code d erreur : on lit son texte. */
export function isAuthenticated(whoamiOutput) {
  return !/not authenticated/i.test(String(whoamiOutput));
}

/**
 * Origines autorisees par le CORS : le site public plus le poste de
 * developpement, sans doublon ni valeur vide.
 */
export function buildAppOrigins(siteUrl, extra = ['http://localhost:4321']) {
  const clean = (value) => String(value ?? '').trim().replace(/\/+$/, '');
  const origins = [clean(siteUrl), ...extra.map(clean)].filter(Boolean);
  return [...new Set(origins)].join(',');
}
