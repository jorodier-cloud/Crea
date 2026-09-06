#!/usr/bin/env node
/**
 * Deploiement depuis GitHub Actions — aucun terminal requis.
 *
 * Contrairement a `setup-cloudflare.mjs`, ce script ne pose aucune question :
 * tout arrive par variables d environnement, et il s authentifie par jeton d API
 * plutot que par session de navigateur. La base D1 et le bucket R2 sont crees
 * s ils manquent, pour qu aucun passage prealable par le tableau de bord
 * Cloudflare ne soit necessaire.
 *
 * Variables attendues (secrets du depot GitHub) :
 *   CLOUDFLARE_API_TOKEN    lu directement par wrangler
 *   CLOUDFLARE_ACCOUNT_ID   lu directement par wrangler
 *   CREA_D1_DATABASE_ID     optionnel — sinon la base est creee au besoin
 *   CREA_ANTHROPIC_API_KEY  optionnel — sans elle le moteur IA renvoie 503
 *                           (ANTHROPIC_API_KEY est accepte comme repli)
 *   CREA_SITE_URL           optionnel — domaine du builder, pour le CORS
 *   CREA_WORKERS_SUBDOMAIN  optionnel — nom workers.dev du compte (defaut : crea)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  anthropicKeyMissing,
  describeKeySources,
  missingEnvVars,
  resolveAnthropicKey,
  planSecrets,
  planUrlUpdates,
  readSubdomainCreation,
  readSubdomainState,
  toValidSubdomain,
} from './lib/deploy.mjs';
import {
  extractWorkerUrl,
  findDatabaseId,
  getTomlValue,
  setTomlValue,
} from './lib/wrangler-config.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(ROOT, 'apps', 'api');
const CONFIG_PATH = join(API_DIR, 'wrangler.toml');
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');

const REQUIRED = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const DATABASE_NAME = 'crea';
const BUCKET_NAME = 'crea-media';
const DEFAULT_SUBDOMAIN = 'crea';

let stepNumber = 0;
const step = (label) => {
  stepNumber += 1;
  console.log(`\n=== [${stepNumber}] ${label}`);
};
const ok = (message) => console.log(`  OK  ${message}`);
const warn = (message) => console.log(`::warning::${message}`);

function fail(message, hint) {
  console.error(`::error::${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

/**
 * Lance wrangler. La sortie est toujours capturee : un jeton mal filtre dans un
 * message d erreur ne doit pas se retrouver dans les journaux publics par
 * inadvertance, on choisit donc explicitement ce qu on reaffiche.
 */
function wrangler(args, { input, allowFailure = false } = {}) {
  const result = spawnSync(WRANGLER, args, {
    cwd: API_DIR,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    ...(input !== undefined ? { input } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0 && !allowFailure) {
    console.error(output);
    fail(`la commande \`wrangler ${args[0]} ${args[1] ?? ''}\` a echoue.`);
  }

  return { status: result.status, output };
}

/* -------------------------------------------------------------------------- */

let config = '';

function patch(key, value) {
  if (getTomlValue(config, key) === value) return false;
  config = setTomlValue(config, key, value);
  return true;
}

/**
 * Retourne l identifiant de la base D1, en la creant au besoin.
 *
 * `CREA_D1_DATABASE_ID` n est qu un raccourci facultatif : avec un jeton
 * disposant des droits D1, le workflow se debrouille seul. C est ce qui evite
 * d avoir a passer par le tableau de bord Cloudflare avant le premier
 * deploiement.
 */
function resolveDatabaseId() {
  const provided = process.env.CREA_D1_DATABASE_ID?.trim();
  if (provided) {
    ok(`base D1 fournie par secret (${provided})`);
    return provided;
  }

  const listed = wrangler(['d1', 'list', '--json'], { allowFailure: true });
  let id = findDatabaseId(listed.output, DATABASE_NAME);

  if (id) {
    ok(`base D1 "${DATABASE_NAME}" deja presente (${id})`);
    return id;
  }

  const created = wrangler(['d1', 'create', DATABASE_NAME], { allowFailure: true });
  if (created.status !== 0) {
    console.error(created.output);
    fail(
      `creation de la base "${DATABASE_NAME}" impossible.`,
      'Le jeton API doit porter "D1 : Edit" (Cloudflare > My Profile > API Tokens).',
    );
  }

  id = findDatabaseId(wrangler(['d1', 'list', '--json']).output, DATABASE_NAME);
  if (!id) fail(`base "${DATABASE_NAME}" creee mais introuvable dans la liste.`);

  ok(`base D1 "${DATABASE_NAME}" creee (${id})`);
  return id;
}

/**
 * Cree le bucket R2 s il manque.
 *
 * Un echec n interrompt pas le deploiement : sans droit R2, le jeton ne peut ni
 * creer ni lister, donc on ne peut pas savoir si le bucket existe deja. Or un
 * bucket cree a la main se lie tres bien avec un jeton limite aux Workers.
 * C est `wrangler deploy` qui tranchera — lui saura si la liaison est valide.
 */
function ensureBucket() {
  const created = wrangler(['r2', 'bucket', 'create', BUCKET_NAME], { allowFailure: true });

  if (created.status === 0) {
    ok(`bucket R2 "${BUCKET_NAME}" cree`);
    return;
  }
  if (/already (exists|owned)|10004/i.test(created.output)) {
    ok(`bucket R2 "${BUCKET_NAME}" deja present`);
    return;
  }

  warn(
    `bucket R2 "${BUCKET_NAME}" non cree — ajoutez "Workers R2 Storage : Edit" au ` +
      'jeton API, ou creez le bucket a la main. Le deploiement continue : il ' +
      'echouera plus loin si le bucket manque vraiment.',
  );
  console.log(created.output.trimEnd());
}

/**
 * Enregistre le sous-domaine workers.dev du compte s il n en a pas.
 *
 * Sans lui, Cloudflare accepte l upload du Worker mais refuse de le publier :
 * le code part, rien n est joignable. Le nom est global au compte et durable,
 * d ou la variable `CREA_WORKERS_SUBDOMAIN` pour le choisir explicitement.
 *
 * Endpoints et codes d erreur repris de l implementation de wrangler
 * (`deploy-helpers/src/triggers/subdomain.ts`) : 10007 = aucun sous-domaine,
 * 10031 = nom deja pris par un autre compte.
 */
async function ensureWorkersSubdomain() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const headers = {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN.trim()}`,
    'Content-Type': 'application/json',
  };

  const current = readSubdomainState(
    await fetch(base, { headers }).then((response) => response.json()),
  );

  if (current.state === 'registered') {
    ok(`sous-domaine deja enregistre : ${current.subdomain}.workers.dev`);
    return;
  }

  if (current.state === 'unreadable') {
    // Droit insuffisant pour lire, ou API indisponible : ne pas bloquer,
    // `wrangler deploy` donnera le verdict.
    warn(
      `etat du sous-domaine workers.dev illisible (${JSON.stringify(current.errors)}). ` +
        'Le deploiement continue.',
    );
    return;
  }

  const wanted = toValidSubdomain(process.env.CREA_WORKERS_SUBDOMAIN || DEFAULT_SUBDOMAIN);
  if (!wanted) {
    fail(
      'CREA_WORKERS_SUBDOMAIN ne contient aucun caractere utilisable.',
      'Utilisez des lettres, chiffres et tirets.',
    );
  }

  const created = readSubdomainCreation(
    await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ subdomain: wanted }),
    }).then((response) => response.json()),
  );

  if (created.state === 'created') {
    ok(`sous-domaine "${wanted}.workers.dev" enregistre pour le compte`);
    return;
  }

  if (created.state === 'taken') {
    fail(
      `le sous-domaine "${wanted}" est deja pris par un autre compte Cloudflare.`,
      'Choisissez-en un autre via la variable CREA_WORKERS_SUBDOMAIN ' +
        '(GitHub > Settings > Secrets and variables > Actions > onglet Variables).',
    );
  }

  fail(
    `enregistrement du sous-domaine "${wanted}" impossible : ${JSON.stringify(created.errors)}.`,
    'Le jeton API doit porter "Workers Scripts : Edit".',
  );
}

async function main() {
  console.log('Deploiement Crea vers Cloudflare Workers');

  step('Verification des variables');
  const missing = missingEnvVars(process.env, REQUIRED);
  if (missing.length > 0) {
    fail(
      `variables manquantes : ${missing.join(', ')}.`,
      'A ajouter dans Settings > Secrets and variables > Actions du depot GitHub.',
    );
  }
  if (!existsSync(WRANGLER)) fail('wrangler absent : `npm ci` a-t-il ete lance ?');
  ok(`${REQUIRED.length} variables presentes`);

  step('Ressources Cloudflare');
  const databaseId = resolveDatabaseId();
  ensureBucket();

  step('Configuration');
  config = readFileSync(CONFIG_PATH, 'utf8');
  patch('database_id', databaseId);
  patch('ENVIRONMENT', 'production');
  patch('R2_ACCOUNT_ID', process.env.CLOUDFLARE_ACCOUNT_ID.trim());
  writeFileSync(CONFIG_PATH, config, 'utf8');
  // Le fichier n est jamais recommite : chaque execution repart du depot.
  ok('wrangler.toml prepare pour la production');

  step('Secrets du Worker');
  const listed = wrangler(['secret', 'list'], { allowFailure: true });
  const anthropicKey = resolveAnthropicKey(process.env);
  const plan = planSecrets(listed.output, { ANTHROPIC_API_KEY: anthropicKey });

  for (const secret of plan) {
    wrangler(['secret', 'put', secret.name], { input: `${secret.value}\n` });
    ok(`${secret.name} ${secret.reason}`);
  }
  if (plan.length === 0) ok('rien a poser, secrets deja en place');

  if (anthropicKeyMissing(listed.output, { ANTHROPIC_API_KEY: anthropicKey })) {
    // Nommer les variables consultees evite la chasse au secret mal nomme :
    // le log dit exactement ce que le runner a recu, sans reveler de valeur.
    const seen = describeKeySources(process.env)
      .map(({ name, present }) => `${name}=${present ? 'fournie' : 'vide'}`)
      .join(', ');
    warn(
      `ANTHROPIC_API_KEY absente : le moteur IA repondra 503. Variables lues : ${seen}. ` +
        'Le secret GitHub doit se trouver dans Settings > Secrets and variables > Actions, ' +
        'onglet Secrets, sous l un de ces deux noms.',
    );
  }

  step('Migrations D1');
  const migrated = wrangler(['d1', 'migrations', 'apply', DATABASE_NAME, '--remote']);
  console.log(migrated.output.trimEnd());
  ok('schema distant a jour');

  step('Sous-domaine workers.dev');
  await ensureWorkersSubdomain();

  step('Deploiement');
  const deployed = wrangler(['deploy']);
  console.log(deployed.output.trimEnd());

  const workerUrl = extractWorkerUrl(deployed.output);
  if (!workerUrl) {
    warn('URL du Worker illisible : recalage des URL ignore.');
    return;
  }
  ok(`Worker deploye : ${workerUrl}`);

  step('Recalage des URL');
  const updates = planUrlUpdates({
    workerUrl,
    siteUrl: process.env.CREA_SITE_URL?.trim() ?? '',
    config,
  });

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    ok('URL deja correctes');
  } else {
    for (const [key, value] of Object.entries(updates)) {
      patch(key, value);
      ok(`${key} = ${value}`);
    }
    writeFileSync(CONFIG_PATH, config, 'utf8');
    const second = wrangler(['deploy']);
    console.log(second.output.trimEnd());
    ok('redeploye avec la configuration definitive');
  }

  step('Verification');
  const summary = [`Worker : ${workerUrl}`, `Sites publies : ${workerUrl}/p/<adresse>`];
  console.log(summary.join('\n'));

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Deploiement reussi\n\n- API : ${workerUrl}\n- Sante : ${workerUrl}/api/health\n- Sites publies : \`${workerUrl}/p/<adresse>\`\n`,
      { flag: 'a' },
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
