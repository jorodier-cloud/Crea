import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAppOrigins,
  extractAccountId,
  extractWorkerUrl,
  findDatabaseId,
  getTomlValue,
  isAuthenticated,
  isPlaceholderDatabaseId,
  setTomlValue,
} from './wrangler-config.mjs';

const SAMPLE = `name = "crea-api"
main = "src/index.ts"

[vars]
ENVIRONMENT = "development"
APP_ORIGINS = "http://localhost:4321"
R2_ACCOUNT_ID = ""
R2_BUCKET_NAME = "crea-media"
SIGNUP_IA_POINTS = "1000"

[[d1_databases]]
binding = "DB"
database_name = "crea"
database_id = "00000000-0000-0000-0000-000000000000" # remplacer par l id renvoye
`;

test('setTomlValue remplace la valeur sans toucher au reste', () => {
  const out = setTomlValue(SAMPLE, 'ENVIRONMENT', 'production');
  assert.match(out, /^ENVIRONMENT = "production"$/m);
  assert.match(out, /^APP_ORIGINS = "http:\/\/localhost:4321"$/m);
  assert.equal(out.split('\n').length, SAMPLE.split('\n').length);
});

test('le commentaire devenu faux est supprime avec la valeur de gabarit', () => {
  const out = setTomlValue(SAMPLE, 'database_id', 'a1b2c3d4-0000-1111-2222-333344445555');
  assert.match(out, /^database_id = "a1b2c3d4-0000-1111-2222-333344445555"$/m);
  assert.ok(!out.includes('remplacer par l id renvoye'));
});

test('une cle plus longue portant le meme prefixe n est pas confondue', () => {
  const out = setTomlValue(SAMPLE, 'R2_ACCOUNT_ID', 'abc123');
  assert.match(out, /^R2_ACCOUNT_ID = "abc123"$/m);
  assert.match(out, /^R2_BUCKET_NAME = "crea-media"$/m);
});

test('une cle absente ou ambigue fait echouer le patch', () => {
  assert.throws(() => setTomlValue(SAMPLE, 'INEXISTANT', 'x'), /introuvable/);
  const doubled = `${SAMPLE}\n[env.preview.vars]\nENVIRONMENT = "preview"\n`;
  assert.throws(() => setTomlValue(doubled, 'ENVIRONMENT', 'production'), /2 fois/);
});

test('les caracteres speciaux d une valeur sont echappes', () => {
  const out = setTomlValue(SAMPLE, 'APP_ORIGINS', 'https://a.fr,https://b"c.fr');
  assert.match(out, /^APP_ORIGINS = "https:\/\/a\.fr,https:\/\/b\\"c\.fr"$/m);
  assert.equal(getTomlValue(out, 'APP_ORIGINS'), 'https://a.fr,https://b"c.fr');
});

test('getTomlValue relit ce que setTomlValue a ecrit', () => {
  assert.equal(getTomlValue(SAMPLE, 'R2_BUCKET_NAME'), 'crea-media');
  assert.equal(getTomlValue(SAMPLE, 'INEXISTANT'), null);
  const out = setTomlValue(SAMPLE, 'ENVIRONMENT', 'production');
  assert.equal(getTomlValue(out, 'ENVIRONMENT'), 'production');
});

test('un database_id de gabarit est reconnu comme non configure', () => {
  assert.equal(isPlaceholderDatabaseId('00000000-0000-0000-0000-000000000000'), true);
  assert.equal(isPlaceholderDatabaseId(''), true);
  assert.equal(isPlaceholderDatabaseId(null), true);
  assert.equal(isPlaceholderDatabaseId('REMPLACER'), true);
  assert.equal(isPlaceholderDatabaseId('a1b2c3d4-0000-1111-2222-333344445555'), false);
});

test('findDatabaseId supporte les variantes de champs de wrangler', () => {
  const modern = '[{"uuid":"uuid-1","name":"crea"},{"uuid":"uuid-2","name":"autre"}]';
  assert.equal(findDatabaseId(modern, 'crea'), 'uuid-1');

  const wrapped = '{"result":[{"database_id":"uuid-3","database_name":"crea"}]}';
  assert.equal(findDatabaseId(wrapped, 'crea'), 'uuid-3');

  assert.equal(findDatabaseId(modern, 'absente'), null);
  assert.equal(findDatabaseId('pas du json', 'crea'), null);
});

test('extractWorkerUrl retient l URL deployee, pas la premiere venue', () => {
  const output = [
    'Total Upload: 120.45 KiB / gzip: 30.12 KiB',
    'Uploaded crea-api (2.31 sec)',
    'Deployed crea-api triggers (0.89 sec)',
    '  https://crea-api.jino.workers.dev',
    'Current Version ID: 1234',
  ].join('\n');
  assert.equal(extractWorkerUrl(output), 'https://crea-api.jino.workers.dev');
  assert.equal(extractWorkerUrl('aucune url ici'), null);
});

test('la ponctuation de fin de ligne ne pollue pas l URL', () => {
  assert.equal(
    extractWorkerUrl('Deploye sur https://crea-api.jino.workers.dev.'),
    'https://crea-api.jino.workers.dev',
  );
});

test('extractAccountId lit l identifiant de compte', () => {
  const whoami = [
    'Getting User settings...',
    '│ Account Name │ Account ID                       │',
    '│ Jino         │ 0123456789abcdef0123456789abcdef │',
  ].join('\n');
  assert.equal(extractAccountId(whoami), '0123456789abcdef0123456789abcdef');
  assert.equal(extractAccountId('rien'), null);
});

test('isAuthenticated distingue les deux etats de wrangler whoami', () => {
  assert.equal(isAuthenticated('You are not authenticated. Please run `wrangler login`.'), false);
  assert.equal(isAuthenticated('You are logged in with an OAuth Token.'), true);
});

test('buildAppOrigins nettoie, deduplique et garde le poste local', () => {
  assert.equal(
    buildAppOrigins('https://domaine.fr/'),
    'https://domaine.fr,http://localhost:4321',
  );
  assert.equal(
    buildAppOrigins('http://localhost:4321'),
    'http://localhost:4321',
  );
  assert.equal(buildAppOrigins(''), 'http://localhost:4321');
});
