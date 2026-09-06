import { randomBytes } from 'node:crypto';

import { buildAppOrigins, getTomlValue } from './wrangler-config.mjs';

/**
 * Decisions partagees par l installation interactive et le deploiement CI.
 *
 * Pures et testables : ce sont elles qui determinent si un secret est ecrase
 * ou si une URL est recalee, deux endroits ou une erreur coute cher.
 */

/**
 * Determine les secrets a poser.
 *
 * `SESSION_SECRET` n est genere que s il manque : le regenerer a chaque
 * deploiement deconnecterait tout le monde. `ANTHROPIC_API_KEY` est au
 * contraire repose des qu une valeur est fournie, pour qu une rotation de cle
 * prenne effet au deploiement suivant.
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

  if (available.ANTHROPIC_API_KEY) {
    plan.push({
      name: 'ANTHROPIC_API_KEY',
      value: available.ANTHROPIC_API_KEY,
      reason: has('ANTHROPIC_API_KEY') ? 'mise a jour' : 'posee',
    });
  }

  return plan;
}

/** Vrai si le moteur IA restera inactif faute de cle. */
export function anthropicKeyMissing(existingSecretsOutput, available = {}) {
  if (available.ANTHROPIC_API_KEY) return false;
  return !/\bANTHROPIC_API_KEY\b/.test(String(existingSecretsOutput ?? ''));
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
 * Verifie qu une variable d environnement obligatoire est presente.
 * Retourne la liste des manquantes plutot que d echouer sur la premiere :
 * l utilisateur les ajoute toutes en une fois.
 */
export function missingEnvVars(env, required) {
  return required.filter((name) => !String(env[name] ?? '').trim());
}
