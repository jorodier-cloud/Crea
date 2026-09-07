import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeKeySources,
  missingEnvVars,
  missingOptionalSecrets,
  planSecrets,
  planUrlUpdates,
  predictWorkerUrl,
  readSubdomainCreation,
  readSubdomainState,
  resolveSecret,
  resolveSecrets,
  resolveSiteUrl,
  toValidSubdomain,
} from './deploy.mjs';

const EMPTY_SECRETS = '[]';
// Les deux cles internes (jamais fournies par l utilisateur, generees au
// premier deploiement) sont deja posees dans ces fixtures : le test porte
// sur les cles externes, pas sur elles.
const WITH_SESSION = '[{"name":"SESSION_SECRET"},{"name":"PAYMENTS_ENCRYPTION_KEY"}]';
const WITH_BOTH =
  '[{"name":"SESSION_SECRET"},{"name":"PAYMENTS_ENCRYPTION_KEY"},{"name":"ANTHROPIC_API_KEY"}]';
const WITH_ALL =
  '[{"name":"SESSION_SECRET"},{"name":"PAYMENTS_ENCRYPTION_KEY"},{"name":"ANTHROPIC_API_KEY"},{"name":"RESEND_API_KEY"}]';

test('SESSION_SECRET est genere une seule fois', () => {
  const first = planSecrets(EMPTY_SECRETS);
  const session = first.find((entry) => entry.name === 'SESSION_SECRET');
  assert.ok(session, 'SESSION_SECRET aurait du etre planifie');
  assert.ok(session.value.length >= 64, 'valeur trop courte pour 48 octets en base64');

  // Deja pose : ne pas le regenerer, cela deconnecterait tout le monde.
  assert.equal(planSecrets(WITH_SESSION).length, 0);
});

test('PAYMENTS_ENCRYPTION_KEY est generee une seule fois', () => {
  const first = planSecrets(EMPTY_SECRETS);
  const key = first.find((entry) => entry.name === 'PAYMENTS_ENCRYPTION_KEY');
  assert.ok(key, 'PAYMENTS_ENCRYPTION_KEY aurait du etre planifiee');
  assert.ok(key.value.length >= 40, 'valeur trop courte pour 32 octets en base64');

  // Deja posee : la regenerer rendrait illisibles les cles Stripe deja chiffrees.
  assert.equal(planSecrets(WITH_SESSION).length, 0);
});

test('les deux cles fournies sont posees dans le meme passage', () => {
  const plan = planSecrets(WITH_SESSION, {
    ANTHROPIC_API_KEY: 'sk-ant',
    RESEND_API_KEY: 're_abc',
  });
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['ANTHROPIC_API_KEY', 'RESEND_API_KEY'],
  );
  assert.ok(plan.every((entry) => entry.reason === 'posee'));
});

test('une valeur blanche ne declenche pas de pose inutile', () => {
  assert.equal(planSecrets(WITH_SESSION, { RESEND_API_KEY: '   ' }).length, 0);
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

test('les secrets manquants sont nommes avec ce qu ils empechent', () => {
  const absents = missingOptionalSecrets(EMPTY_SECRETS);
  assert.deepEqual(
    absents.map((entry) => entry.name),
    ['ANTHROPIC_API_KEY', 'RESEND_API_KEY'],
  );
  assert.match(absents[1].consequence, /aucune connexion possible/);
});

test('un secret deja pose sur le Worker n a pas besoin d etre refourni', () => {
  assert.deepEqual(missingOptionalSecrets(WITH_ALL), []);
  // Deja pose pour l un, fourni maintenant pour l autre : plus rien ne manque.
  assert.deepEqual(missingOptionalSecrets(WITH_BOTH, { RESEND_API_KEY: 're_abc' }), []);
  assert.deepEqual(
    missingOptionalSecrets(WITH_BOTH).map((entry) => entry.name),
    ['RESEND_API_KEY'],
  );
});

test('chaque cle est acceptee sous ses deux noms', () => {
  assert.equal(
    resolveSecret('ANTHROPIC_API_KEY', { CREA_ANTHROPIC_API_KEY: 'sk-prefixe' }),
    'sk-prefixe',
  );
  assert.equal(resolveSecret('RESEND_API_KEY', { RESEND_API_KEY: 're_simple' }), 're_simple');

  // Le nom prefixe l emporte : c est celui que documente le depot.
  assert.equal(
    resolveSecret('ANTHROPIC_API_KEY', {
      CREA_ANTHROPIC_API_KEY: 'sk-prefixe',
      ANTHROPIC_API_KEY: 'sk-simple',
    }),
    'sk-prefixe',
  );
});

test('un secret vide ou blanc compte comme absent', () => {
  // GitHub transmet une chaine vide, pas `undefined`, quand le secret n existe pas.
  assert.equal(
    resolveSecret('ANTHROPIC_API_KEY', { CREA_ANTHROPIC_API_KEY: '', ANTHROPIC_API_KEY: '  ' }),
    '',
  );
  assert.equal(resolveSecret('ANTHROPIC_API_KEY', {}), '');
  assert.equal(resolveSecret('INCONNU', { INCONNU: 'x' }), '');

  // Le nom vide ne masque pas l autre.
  assert.equal(
    resolveSecret('RESEND_API_KEY', { CREA_RESEND_API_KEY: '   ', RESEND_API_KEY: 're_simple' }),
    're_simple',
  );
});

test('resolveSecrets ne retient que ce qui porte une valeur', () => {
  assert.deepEqual(
    resolveSecrets({ ANTHROPIC_API_KEY: 'sk-simple', CREA_RESEND_API_KEY: '  ' }),
    { ANTHROPIC_API_KEY: 'sk-simple' },
  );
  assert.deepEqual(resolveSecrets({}), {});
});

test('le diagnostic nomme les variables sans reveler les valeurs', () => {
  const sources = describeKeySources({ ANTHROPIC_API_KEY: 'sk-secrete' });
  assert.deepEqual(sources, [
    { name: 'CREA_ANTHROPIC_API_KEY', present: false },
    { name: 'ANTHROPIC_API_KEY', present: true },
    { name: 'CREA_RESEND_API_KEY', present: false },
    { name: 'RESEND_API_KEY', present: false },
  ]);
  assert.ok(!JSON.stringify(sources).includes('sk-secrete'));
});

test('l URL d un Worker se deduit de son nom et du sous-domaine', () => {
  assert.equal(
    predictWorkerUrl('crea-api', 'jinogui'),
    'https://crea-api.jinogui.workers.dev',
  );
  assert.equal(predictWorkerUrl('crea-web', ' jinogui '), 'https://crea-web.jinogui.workers.dev');
});

test('sans sous-domaine connu, aucune URL n est inventee', () => {
  // Une URL fausse posee dans APP_ORIGINS fermerait le CORS a la vraie origine.
  assert.equal(predictWorkerUrl('crea-api', ''), '');
  assert.equal(predictWorkerUrl('crea-api', null), '');
  assert.equal(predictWorkerUrl('crea-api', '   '), '');
  assert.equal(predictWorkerUrl('', 'jinogui'), '');
});

test('une URL prevue exacte ne declenche aucun redeploiement', () => {
  // C est la garantie recherchee : la configuration publiee avant deploiement
  // est deja la bonne, donc la verification qui suit ne trouve rien a changer.
  const subdomain = 'jinogui';
  const workerUrl = predictWorkerUrl('crea-api', subdomain);
  const siteUrl = predictWorkerUrl('crea-web', subdomain);

  const settled = `[vars]
APP_ORIGINS = "${siteUrl},http://localhost:4321"
R2_PUBLIC_BASE_URL = "${workerUrl}/api/media/file"
`;
  assert.deepEqual(planUrlUpdates({ workerUrl, siteUrl, config: settled }), {});
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

test('un domaine configure a la main prime sur le site deploye', () => {
  assert.equal(
    resolveSiteUrl({
      configured: 'https://crea.mondomaine.fr/',
      deployed: 'https://crea-web.jino.workers.dev',
    }),
    'https://crea.mondomaine.fr',
  );
});

test('a defaut, l origine du CORS est celle du builder qu on vient de deployer', () => {
  assert.equal(
    resolveSiteUrl({ configured: '  ', deployed: 'https://crea-web.jino.workers.dev' }),
    'https://crea-web.jino.workers.dev',
  );
});

test('sans builder deploye, aucune origine n est imposee', () => {
  // `planUrlUpdates` retombera alors sur l URL du Worker : mieux vaut une
  // origine inutile qu une chaine vide qui fermerait le CORS.
  assert.equal(resolveSiteUrl({ configured: '', deployed: null }), '');
  assert.equal(resolveSiteUrl(), '');
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
