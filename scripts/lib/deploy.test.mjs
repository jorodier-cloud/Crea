import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anthropicKeyMissing,
  missingEnvVars,
  planSecrets,
  planUrlUpdates,
  readSubdomainCreation,
  readSubdomainState,
  toValidSubdomain,
} from './deploy.mjs';

const EMPTY_SECRETS = '[]';
const WITH_SESSION = '[{"name":"SESSION_SECRET"}]';
const WITH_BOTH = '[{"name":"SESSION_SECRET"},{"name":"ANTHROPIC_API_KEY"}]';

test('SESSION_SECRET est genere une seule fois', () => {
  const first = planSecrets(EMPTY_SECRETS);
  const session = first.find((entry) => entry.name === 'SESSION_SECRET');
  assert.ok(session, 'SESSION_SECRET aurait du etre planifie');
  assert.ok(session.value.length >= 64, 'valeur trop courte pour 48 octets en base64');

  // Deja pose : ne pas le regenerer, cela deconnecterait tout le monde.
  assert.equal(planSecrets(WITH_SESSION).length, 0);
});

test('deux generations de SESSION_SECRET ne donnent pas la meme valeur', () => {
  const a = planSecrets(EMPTY_SECRETS)[0].value;
  const b = planSecrets(EMPTY_SECRETS)[0].value;
  assert.notEqual(a, b);
});

test('la cle Anthropic est reposee a chaque fois qu une valeur est fournie', () => {
  const plan = planSecrets(WITH_BOTH, { ANTHROPIC_API_KEY: 'sk-ant-nouvelle' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, 'ANTHROPIC_API_KEY');
  assert.equal(plan[0].value, 'sk-ant-nouvelle');
  assert.match(plan[0].reason, /mise a jour/);
});

test('sans valeur fournie, la cle Anthropic deja posee est laissee intacte', () => {
  assert.equal(planSecrets(WITH_BOTH).length, 0);
});

test('anthropicKeyMissing distingue les trois situations', () => {
  assert.equal(anthropicKeyMissing(EMPTY_SECRETS), true);
  assert.equal(anthropicKeyMissing(EMPTY_SECRETS, { ANTHROPIC_API_KEY: 'sk' }), false);
  assert.equal(anthropicKeyMissing(WITH_BOTH), false);
});

const CONFIG = `[vars]
APP_ORIGINS = "http://localhost:4321"
R2_PUBLIC_BASE_URL = "http://localhost:8787/api/media/file"
`;

test('les URL locales sont recalees sur le Worker deploye', () => {
  const updates = planUrlUpdates({
    workerUrl: 'https://crea-api.jino.workers.dev',
    siteUrl: '',
    config: CONFIG,
  });
  assert.equal(
    updates.R2_PUBLIC_BASE_URL,
    'https://crea-api.jino.workers.dev/api/media/file',
  );
  assert.equal(
    updates.APP_ORIGINS,
    'https://crea-api.jino.workers.dev,http://localhost:4321',
  );
});

test('le domaine du builder prend la premiere place dans les origines', () => {
  const updates = planUrlUpdates({
    workerUrl: 'https://crea-api.jino.workers.dev',
    siteUrl: 'https://crea.pages.dev/',
    config: CONFIG,
  });
  assert.equal(updates.APP_ORIGINS, 'https://crea.pages.dev,http://localhost:4321');
});

test('rien n est recale si les valeurs sont deja bonnes', () => {
  const settled = `[vars]
APP_ORIGINS = "https://crea.pages.dev,http://localhost:4321"
R2_PUBLIC_BASE_URL = "https://crea-api.jino.workers.dev/api/media/file"
`;
  const updates = planUrlUpdates({
    workerUrl: 'https://crea-api.jino.workers.dev',
    siteUrl: 'https://crea.pages.dev',
    config: settled,
  });
  assert.deepEqual(updates, {});
});

test('sans URL de Worker, aucun recalage n est tente', () => {
  assert.deepEqual(planUrlUpdates({ workerUrl: null, siteUrl: '', config: CONFIG }), {});
});

test('missingEnvVars signale toutes les variables absentes d un coup', () => {
  const env = { A: 'valeur', B: '', C: '   ' };
  assert.deepEqual(missingEnvVars(env, ['A', 'B', 'C', 'D']), ['B', 'C', 'D']);
  assert.deepEqual(missingEnvVars(env, ['A']), []);
});

/* Sous-domaine workers.dev — meme regle que `toValidSubdomain` de wrangler. */

test('un nom simple traverse sans modification', () => {
  assert.equal(toValidSubdomain('crea'), 'crea');
  assert.equal(toValidSubdomain('rives-ormoy-2026'), 'rives-ormoy-2026');
});

test('majuscules, accents et espaces sont normalises', () => {
  assert.equal(toValidSubdomain('Domaine des Rives'), 'domaine-des-rives');
  assert.equal(toValidSubdomain('Créa'), 'cr-a');
  assert.equal(toValidSubdomain('a.b_c'), 'a-b-c');
});

test('aucun tiret ne subsiste en bordure', () => {
  assert.equal(toValidSubdomain('  --crea--  '), 'crea');
  assert.equal(toValidSubdomain('---'), '');
  assert.equal(toValidSubdomain(''), '');
  assert.equal(toValidSubdomain(undefined), '');
});

test('la troncature a 63 caracteres ne laisse pas de tiret final', () => {
  // 62 caracteres puis un separateur : couper a 63 tomberait sur le tiret.
  const long = `${'a'.repeat(62)} suite`;
  const slug = toValidSubdomain(long);
  assert.ok(slug.length <= 63);
  assert.ok(!slug.endsWith('-'), `termine par un tiret : "${slug}"`);
});

/* Lecture des reponses de l API sous-domaine (formes reelles de Cloudflare). */

test('un sous-domaine deja enregistre est reconnu', () => {
  assert.deepEqual(
    readSubdomainState({ success: true, errors: [], result: { subdomain: 'jino' } }),
    { state: 'registered', subdomain: 'jino' },
  );
});

test('le code 10007 signifie absent, pas en panne', () => {
  const response = {
    success: false,
    errors: [{ code: 10007, message: 'workers.dev subdomain not found' }],
    result: null,
  };
  assert.deepEqual(readSubdomainState(response), { state: 'absent' });
});

test('toute autre erreur laisse l etat indetermine plutot que de bloquer', () => {
  const refus = { success: false, errors: [{ code: 10000, message: 'Authentication error' }] };
  assert.equal(readSubdomainState(refus).state, 'unreadable');
  assert.equal(readSubdomainState(null).state, 'unreadable');
  assert.equal(readSubdomainState({ success: true, result: {} }).state, 'unreadable');
});

test('la creation reussie est distinguee du nom deja pris', () => {
  assert.deepEqual(readSubdomainCreation({ success: true, result: { subdomain: 'crea' } }), {
    state: 'created',
  });
  assert.deepEqual(
    readSubdomainCreation({ success: false, errors: [{ code: 10031, message: 'unavailable' }] }),
    { state: 'taken' },
  );
  assert.equal(
    readSubdomainCreation({ success: false, errors: [{ code: 10000 }] }).state,
    'failed',
  );
});
