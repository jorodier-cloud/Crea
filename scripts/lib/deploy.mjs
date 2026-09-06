import { randomBytes } from 'node:crypto';

import { buildAppOrigins, getTomlValue } from './wrangler-config.mjs';

/**
 * Decisions partagees par l installation interactive et le deploiement CI.
 *
 * Pures et testables : ce sont elles qui determinent si un secret est ecrase
 * ou si une URL est recalee, deux endroits ou une erreur coute cher.
 */

/**
 * Secrets fournis par l utilisateur, et les noms d environnement acceptes pour
 * chacun, par ordre de priorite.
 *
 * Le prefixe `CREA_` evite toute collision avec les variables que lisent les
 * SDK, mais rien n empeche de nommer le secret GitHub sans lui : un
 * deploiement qui reste muet parce que le secret porte l autre nom coute une
 * demi-heure de recherche pour rien. Chaque entree dit aussi ce qui cesse de
 * fonctionner sans elle — c est ce que lira l utilisateur dans le journal.
 */
export const OPTIONAL_SECRETS = {
  ANTHROPIC_API_KEY: {
    sources: ['CREA_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
    label: 'Cle API Anthropic — console.anthropic.com',
    consequence: 'le moteur IA repondra 503',
  },
  RESEND_API_KEY: {
    sources: ['CREA_RESEND_API_KEY', 'RESEND_API_KEY'],
    label: 'Cle API Resend — resend.com > API Keys',
    consequence: 'aucun lien de connexion ne partira, donc aucune connexion possible',
  },
};

/**
 * Determine les secrets a poser.
 *
 * `SESSION_SECRET` n est genere que s il manque : le regenerer a chaque
 * deploiement deconnecterait tout le monde. Les cles fournies sont au contraire
 * reposees des qu une valeur arrive, pour qu une rotation prenne effet au
 * deploiement suivant.
 */
export function planSecrets(existingSecretsOutput, available = {}) {
  const listing = String(existingSecretsOutput ?? '');
  const has = (name) => new RegExp(`\\b${name}\\b`).test(listing);
  const plan = [];

  if (!has('SESSION_SECRET')) {
    plan.push({
      name: 'SESSION_SECRET',
      value: randomBytes(48).toString('base64'),
      reason: 'genere (48 octets aleatoires)',
    });
  }

  for (const name of Object.keys(OPTIONAL_SECRETS)) {
    const value = String(available[name] ?? '').trim();
    if (!value) continue;
    plan.push({ name, value, reason: has(name) ? 'mise a jour' : 'posee' });
  }

  return plan;
}

/**
 * Retourne la premiere valeur reellement fournie pour un secret, ou une chaine
 * vide. Les valeurs blanches comptent comme absentes : un secret GitHub qui n
 * existe pas arrive comme une chaine vide, pas comme `undefined`.
 */
export function resolveSecret(name, env = {}) {
  for (const source of OPTIONAL_SECRETS[name]?.sources ?? []) {
    const value = String(env[source] ?? '').trim();
    if (value) return value;
  }
  return '';
}

/** Toutes les cles fournies, pretes pour `planSecrets`. */
export function resolveSecrets(env = {}) {
  const found = {};
  for (const name of Object.keys(OPTIONAL_SECRETS)) {
    const value = resolveSecret(name, env);
    if (value) found[name] = value;
  }
  return found;
}

/**
 * Nomme les variables consultees et celles qui portaient une valeur.
 * Sert au diagnostic : jamais la valeur, uniquement le nom.
 */
export function describeKeySources(env = {}) {
  return Object.values(OPTIONAL_SECRETS)
    .flatMap((entry) => entry.sources)
    .map((name) => ({
      name,
      present: String(env[name] ?? '').trim().length > 0,
    }));
}

/**
 * Secrets qui resteront absents apres ce deploiement, avec ce que chacun
 * empeche de fonctionner. Un secret deja pose sur le Worker n a pas besoin d
 * etre refourni.
 */
export function missingOptionalSecrets(existingSecretsOutput, available = {}) {
  const listing = String(existingSecretsOutput ?? '');
  return Object.entries(OPTIONAL_SECRETS)
    .filter(([name]) => {
      if (String(available[name] ?? '').trim()) return false;
      return !new RegExp(`\\b${name}\\b`).test(listing);
    })
    .map(([name, entry]) => ({ name, consequence: entry.consequence }));
}

/**
 * URL publique d un Worker sur son sous-domaine workers.dev.
 *
 * Sert a configurer le CORS *avant* le premier deploiement plutot qu apres.
 * Recaler ensuite laissait, a chaque mise a jour, une dizaine de secondes
 * pendant lesquelles l API en ligne n autorisait que `localhost` : toute
 * requete du builder etait alors rejetee, sans reponse exploitable cote
 * navigateur. La prediction reste verifiee apres coup contre l URL reelle.
 */
export function predictWorkerUrl(name, subdomain) {
  const clean = String(subdomain ?? '').trim();
  if (!clean || !String(name ?? '').trim()) return '';
  return `https://${String(name).trim()}.${clean}.workers.dev`;
}

/**
 * Calcule les valeurs a recaler une fois l URL du Worker connue.
 * Ne renvoie que ce qui change reellement.
 */
export function planUrlUpdates({ workerUrl, siteUrl, config }) {
  const updates = {};
  if (!workerUrl) return updates;

  const mediaBase = `${workerUrl.replace(/\/+$/, '')}/api/media/file`;
  if (getTomlValue(config, 'R2_PUBLIC_BASE_URL') !== mediaBase) {
    updates.R2_PUBLIC_BASE_URL = mediaBase;
  }

  const origins = buildAppOrigins(siteUrl || workerUrl);
  if (getTomlValue(config, 'APP_ORIGINS') !== origins) {
    updates.APP_ORIGINS = origins;
  }

  return updates;
}

/**
 * Choisit l origine a autoriser dans le CORS.
 *
 * Un domaine fixe (`CREA_SITE_URL`) l emporte toujours : s il est defini, c est
 * que le builder est servi ailleurs que sur son URL workers.dev par defaut.
 * Sinon on prend celle du site qu on vient de deployer.
 */
export function resolveSiteUrl({ configured, deployed } = {}) {
  const clean = (value) =>
    String(value ?? '')
      .trim()
      .replace(/\/+$/, '');
  return clean(configured) || clean(deployed) || '';
}

/**
 * Verifie qu une variable d environnement obligatoire est presente.
 * Retourne la liste des manquantes plutot que d echouer sur la premiere :
 * l utilisateur les ajoute toutes en une fois.
 */
export function missingEnvVars(env, required) {
  return required.filter((name) => !String(env[name] ?? '').trim());
}

/**
 * Normalise un nom de sous-domaine workers.dev.
 *
 * Reprend la regle de wrangler (`toValidSubdomain`) : minuscules, tout
 * caractere hors [a-z0-9-] devient un tiret, pas de tiret en bordure, 63
 * caracteres au maximum. Un nom refuse par Cloudflare ferait echouer le
 * deploiement au pire moment, apres l upload.
 */
/**
 * Interprete la reponse de `GET /accounts/{id}/workers/subdomain`.
 *
 * Le code 10007 signifie « aucun sous-domaine enregistre » — c est un etat
 * normal, pas une panne. Toute autre erreur veut dire qu on ne sait pas, et
 * mieux vaut alors laisser `wrangler deploy` trancher que bloquer a tort.
 */
export function readSubdomainState(response) {
  if (response?.success && response.result?.subdomain) {
    return { state: 'registered', subdomain: response.result.subdomain };
  }

  const codes = (response?.errors ?? []).map((error) => error?.code);
  if (codes.includes(10007)) return { state: 'absent' };

  return { state: 'unreadable', errors: response?.errors ?? null };
}

/**
 * Interprete la reponse de `PUT /accounts/{id}/workers/subdomain`.
 * Le code 10031 signale un nom deja pris par un autre compte Cloudflare.
 */
export function readSubdomainCreation(response) {
  if (response?.success) return { state: 'created' };

  const codes = (response?.errors ?? []).map((error) => error?.code);
  if (codes.includes(10031)) return { state: 'taken' };

  return { state: 'failed', errors: response?.errors ?? null };
}

export function toValidSubdomain(input) {
  return (
    String(input ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 63)
      .replace(/-+$/, '') || ''
  );
}
