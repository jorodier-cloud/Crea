import assert from 'node:assert/strict';
import test from 'node:test';

import { slugify, SLUG_MAX_LENGTH } from '../dist-test/lib/slug.js';

test('les accents et la ponctuation sont normalises', () => {
  assert.equal(slugify("Rives d'Ormoy — Été 2026"), 'rives-d-ormoy-ete-2026');
  assert.equal(slugify('Suite Moorea · Piscine chauffée'), 'suite-moorea-piscine-chauffee');
  assert.equal(slugify('Château  de   Fontainebleau'), 'chateau-de-fontainebleau');
});

test('aucun tiret ne subsiste en bordure', () => {
  assert.equal(slugify('  --- Domaine ---  '), 'domaine');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(''), '');
});

test('la troncature ne laisse jamais de tiret final', () => {
  // 58 caracteres puis un separateur : la coupe a 60 tomberait sur un tiret.
  const long = `${'a'.repeat(58)} suite moorea`;
  const slug = slugify(long);
  assert.ok(slug.length <= SLUG_MAX_LENGTH);
  assert.ok(!slug.endsWith('-'), `slug termine par un tiret : "${slug}"`);
});

test('le resultat respecte toujours le motif de la route publique', () => {
  const pattern = /^[a-z0-9][a-z0-9-]{1,59}$/;
  for (const title of [
    'Domaine des Rives d Ormoy',
    'Gîte 4 suites — 16 couchages',
    'ÉTÉ 2026 !!! Réservez',
    '2 nuits minimum',
  ]) {
    assert.match(slugify(title), pattern, `titre rejete : ${title}`);
  }
});

test('un slug deja propre est laisse intact', () => {
  assert.equal(slugify('rives-d-ormoy-ete-2026'), 'rives-d-ormoy-ete-2026');
});
