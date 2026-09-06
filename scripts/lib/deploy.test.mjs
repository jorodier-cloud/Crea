import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anthropicKeyMissing,
  missingEnvVars,
  planSecrets,
  planUrlUpdates,
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
