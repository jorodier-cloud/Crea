#!/usr/bin/env node
/**
 * Installation Cloudflare de bout en bout.
 *
 *   npx wrangler login          <- a faire une fois, dans votre navigateur
 *   npm run setup:cloudflare
 *
 * Le script cree la base D1 et le bucket R2 s ils manquent, reporte les
 * identifiants dans wrangler.toml, pose les secrets, applique les migrations,
 * deploie le Worker, puis recale les URL et redeploie.
 *
 * Il est ecrit pour etre relance sans risque : chaque etape verifie d abord si
 * le travail est deja fait.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAppOrigins,
  extractAccountId,
  extractWorkerUrl,
  findDatabaseId,
  getTomlValue,
  isAuthenticated,
  isPlaceholderDatabaseId,
  setTomlValue,
} from './lib/wrangler-config.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_DIR = join(ROOT, 'apps', 'api');
const CONFIG_PATH = join(API_DIR, 'wrangler.toml');
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');

const DATABASE_NAME = 'crea';
const BUCKET_NAME = 'crea-media';

const args = process.argv.slice(2);
const AUTO_YES = args.includes('--yes') || args.includes('-y');
const SITE_URL = (args.find((arg) => arg.startsWith('--site-url=')) ?? '').split('=').slice(1).join('=');

/* -------------------------------------------------------------------------- */
/* Affichage                                                                  */
/* -------------------------------------------------------------------------- */

const color = process.stdout.isTTY
  ? {
      dim: (s) => `\u001b[2m${s}\u001b[0m`,
      bold: (s) => `\u001b[1m${s}\u001b[0m`,
      green: (s) => `\u001b[32m${s}\u001b[0m`,
      amber: (s) => `\u001b[33m${s}\u001b[0m`,
      red: (s) => `\u001b[31m${s}\u001b[0m`,
    }
  : { dim: (s) => s, bold: (s) => s, green: (s) => s, amber: (s) => s, red: (s) => s };

let stepNumber = 0;
const step = (label) => {
  stepNumber += 1;
  console.log(`\n${color.bold(`[${stepNumber}] ${label}`)}`);
};
const ok = (message) => console.log(`  ${color.green('OK')}  ${message}`);
const info = (message) => console.log(`  ${color.dim('--')}  ${message}`);
const warn = (message) => console.log(`  ${color.amber('!!')}  ${message}`);

function fail(message, hint) {
  console.error(`\n${color.red('Echec')} : ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Execution de wrangler                                                      */
/* -------------------------------------------------------------------------- */

/** Lance wrangler dans apps/api. `capture` renvoie la sortie au lieu de l afficher. */
function wrangler(wranglerArgs, { capture = false, input, allowFailure = false } = {}) {
  const result = spawnSync(WRANGLER, wranglerArgs, {
    cwd: API_DIR,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    ...(input !== undefined ? { input } : {}),
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0 && !allowFailure) {
    if (capture || input !== undefined) console.error(output);
    fail(`la commande \`wrangler ${wranglerArgs.join(' ')}\` a echoue.`);
  }

  return { status: result.status, output };
}

/* -------------------------------------------------------------------------- */
/* Saisie                                                                     */
/* -------------------------------------------------------------------------- */

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Saisie masquee : une cle API ne doit pas rester lisible a l ecran. */
function askSecret(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function confirm(question) {
  if (AUTO_YES) return true;
  const answer = await ask(`${question} ${color.dim('[o/N]')} `);
  return /^(o|oui|y|yes)$/i.test(answer);
}

/* -------------------------------------------------------------------------- */
/* Etat de wrangler.toml                                                      */
/* -------------------------------------------------------------------------- */

let config = '';
let configOnDisk = '';

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) fail(`wrangler.toml introuvable a ${CONFIG_PATH}.`);
  config = readFileSync(CONFIG_PATH, 'utf8');
  configOnDisk = config;
}

function patch(key, value) {
  const current = getTomlValue(config, key);
  if (current === value) return false;
  config = setTomlValue(config, key, value);
  return true;
}

/** N ecrit que si quelque chose a change, pour ne pas salir le diff git. */
function flushConfig() {
  if (config === configOnDisk) return false;
  writeFileSync(CONFIG_PATH, config, 'utf8');
  configOnDisk = config;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Etapes                                                                     */
/* -------------------------------------------------------------------------- */

function checkAuth() {
  step('Verification de la session Cloudflare');
  if (!existsSync(WRANGLER)) {
    fail('wrangler est absent.', 'Lancez `npm install` a la racine du depot, puis reessayez.');
  }

  const { output } = wrangler(['whoami'], { capture: true, allowFailure: true });
  if (!isAuthenticated(output)) {
    fail(
      'aucune session Cloudflare.',
      `Lancez d abord :\n\n  npx wrangler login\n\npuis relancez ${color.bold('npm run setup:cloudflare')}.`,
    );
  }

  const accountId = extractAccountId(output);
  ok(accountId ? `connecte (compte ${accountId})` : 'connecte');
  return accountId;
}

function setupDatabase() {
  step('Base de donnees D1');

  const current = getTomlValue(config, 'database_id');
  if (!isPlaceholderDatabaseId(current)) {
    ok(`deja configuree (${current})`);
    return;
  }

  const listed = wrangler(['d1', 'list', '--json'], { capture: true, allowFailure: true });
  let databaseId = findDatabaseId(listed.output, DATABASE_NAME);

  if (databaseId) {
    info(`base "${DATABASE_NAME}" deja presente sur le compte`);
  } else {
    info(`creation de la base "${DATABASE_NAME}"`);
    wrangler(['d1', 'create', DATABASE_NAME], { capture: true });
    const relisted = wrangler(['d1', 'list', '--json'], { capture: true });
    databaseId = findDatabaseId(relisted.output, DATABASE_NAME);
  }

  if (!databaseId) {
    fail(
      `impossible de retrouver l identifiant de la base "${DATABASE_NAME}".`,
      'Recuperez-le avec `npx wrangler d1 list` et collez-le dans apps/api/wrangler.toml.',
    );
  }

  patch('database_id', databaseId);
  ok(`database_id ecrit dans wrangler.toml (${databaseId})`);
}

function setupBucket() {
  step('Bucket R2');

  const { status, output } = wrangler(['r2', 'bucket', 'create', BUCKET_NAME], {
    capture: true,
    allowFailure: true,
  });

  if (status === 0) {
    ok(`bucket "${BUCKET_NAME}" cree`);
    return;
  }
  if (/already (exists|owned)|10004/i.test(output)) {
    ok(`bucket "${BUCKET_NAME}" deja present`);
    return;
  }

  console.error(output);
  fail(`creation du bucket "${BUCKET_NAME}" impossible.`);
}

async function setupSecrets() {
  step('Secrets du Worker');

  const listed = wrangler(['secret', 'list'], { capture: true, allowFailure: true });
  const existing = listed.output;

  if (/SESSION_SECRET/.test(existing)) {
    ok('SESSION_SECRET deja pose');
  } else {
    const secret = randomBytes(48).toString('base64');
    wrangler(['secret', 'put', 'SESSION_SECRET'], { input: `${secret}\n` });
    ok('SESSION_SECRET genere (48 octets aleatoires) et pose');
  }

  if (/ANTHROPIC_API_KEY/.test(existing)) {
    ok('ANTHROPIC_API_KEY deja posee');
    return;
  }

  const fromEnv = process.env.ANTHROPIC_API_KEY;
  let key = fromEnv ?? '';

  if (!key && process.stdin.isTTY) {
    console.log(`  ${color.dim('Cle API Anthropic — console.anthropic.com. Saisie masquee.')}`);
    key = await askSecret('  Cle (Entree pour passer) : ');
  }

  if (!key) {
    warn('ANTHROPIC_API_KEY non posee : le moteur IA repondra 503.');
    warn('A poser plus tard : npx wrangler secret put ANTHROPIC_API_KEY');
    return;
  }

  wrangler(['secret', 'put', 'ANTHROPIC_API_KEY'], { input: `${key}\n` });
  ok('ANTHROPIC_API_KEY posee');
}

function applyMigrations() {
  step('Migrations D1 distantes');
  wrangler(['d1', 'migrations', 'apply', DATABASE_NAME, '--remote']);
  ok('schema a jour sur la base distante');
}

function deploy(label) {
  step(label);
  const { output } = wrangler(['deploy'], { capture: true });
  console.log(color.dim(output.trimEnd()));

  const url = extractWorkerUrl(output);
  if (!url) {
    warn('URL du Worker illisible dans la sortie — recalage des URL a faire a la main.');
    return null;
  }
  ok(`Worker en ligne : ${url}`);
  return url;
}

async function main() {
  console.log(color.bold('\nInstallation Cloudflare de Crea'));
  console.log(color.dim(`Depot : ${ROOT}`));

  loadConfig();
  const accountId = checkAuth();

  console.log(`\n${color.bold('Ce script va, sur votre compte Cloudflare :')}`);
  console.log('  - creer la base D1 "crea" et le bucket R2 "crea-media" si absents');
  console.log('  - poser les secrets SESSION_SECRET et ANTHROPIC_API_KEY');
  console.log('  - appliquer les migrations sur la base distante');
  console.log('  - deployer le Worker (il devient accessible publiquement)');
  console.log('  - modifier apps/api/wrangler.toml (a commiter ensuite)');

  if (!(await confirm('\nContinuer ?'))) {
    console.log('\nAbandon, rien n a ete modifie.');
    process.exit(0);
  }

  setupDatabase();
  setupBucket();

  step('Configuration de production');
  if (patch('ENVIRONMENT', 'production')) {
    ok('ENVIRONMENT = "production" (le magic link cesse d etre renvoye en clair)');
  } else {
    ok('ENVIRONMENT deja en production');
  }
  if (accountId && !getTomlValue(config, 'R2_ACCOUNT_ID')) {
    patch('R2_ACCOUNT_ID', accountId);
    ok('R2_ACCOUNT_ID renseigne');
  }
  flushConfig();

  await setupSecrets();
  applyMigrations();

  const workerUrl = deploy('Premier deploiement');

  if (workerUrl) {
    step('Recalage des URL');
    const siteUrl = SITE_URL || workerUrl;
    const changedMedia = patch('R2_PUBLIC_BASE_URL', `${workerUrl}/api/media/file`);
    const changedOrigins = patch('APP_ORIGINS', buildAppOrigins(siteUrl));

    if (changedMedia || changedOrigins) {
      flushConfig();
      ok('wrangler.toml recale sur les URL reelles');
      deploy('Redeploiement avec la configuration definitive');
    } else {
      ok('URL deja correctes, pas de redeploiement');
    }

    step('Verification');
    try {
      const response = await fetch(`${workerUrl}/api/health`);
      const health = await response.json();
      const checks = health?.checks ?? {};
      for (const [name, passing] of Object.entries(checks)) {
        console.log(`  ${passing ? color.green('OK') : color.amber('--')}  ${name}`);
      }
      if (!checks.anthropic) warn('moteur IA inactif tant que ANTHROPIC_API_KEY n est pas posee.');
    } catch (error) {
      warn(`/api/health injoignable : ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${color.bold('Termine.')}`);
  console.log('\nIl reste a faire, une seule fois :');
  console.log('  1. commiter apps/api/wrangler.toml');
  console.log('  2. deployer le builder :');
  console.log(
    `       PUBLIC_API_URL=${workerUrl ?? '<url du worker>'} npm run build --workspace @crea/web`,
  );
  console.log('       npx wrangler deploy --cwd apps/web');
  console.log('  3. relancer ce script avec --site-url=<url du builder> pour ouvrir le CORS');
  console.log('');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
