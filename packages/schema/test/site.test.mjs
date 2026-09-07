import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmptySite,
  createStarterTree,
  findPageBySlug,
  normalizePageSlug,
  normalizeSite,
  parseSite,
  serializeSite,
} from '../dist/index.js';

test('normalizeSite accepte la forme historique (un PageTree a la racine)', () => {
  const legacy = createStarterTree('Domaine des Rives d Ormoy');
  const { site, issues } = normalizeSite(JSON.parse(JSON.stringify(legacy)));
  assert.equal(issues.length, 0);
  assert.equal(site.pages.length, 1);
  assert.equal(site.pages[0].slug, '');
  assert.equal(site.pages[0].label, 'Domaine des Rives d Ormoy');
  assert.equal(site.pages[0].tree.root.type, 'container');
});

test('normalizeSite accepte la forme multi-page', () => {
  const home = createStarterTree('Accueil');
  const tarifs = createStarterTree('Tarifs');
  const input = {
    pages: [
      { id: 'home', slug: '', label: 'Accueil', tree: home },
      { id: 'p2', slug: 'tarifs', label: 'Tarifs', tree: tarifs },
    ],
  };
  const { site, issues } = normalizeSite(input);
  assert.equal(issues.length, 0);
  assert.equal(site.pages.length, 2);
  assert.equal(site.pages[1].slug, 'tarifs');
});

test('normalizeSite refuse un site sans aucune page', () => {
  assert.throws(() => normalizeSite({ pages: [] }));
});

test('normalizeSite reattribue une adresse de page dupliquee', () => {
  const input = {
    pages: [
      { id: 'a', slug: 'tarifs', label: 'Tarifs', tree: createStarterTree() },
      { id: 'b', slug: 'tarifs', label: 'Tarifs (2)', tree: createStarterTree() },
    ],
  };
  const { site, issues } = normalizeSite(input);
  assert.equal(site.pages[0].slug, 'tarifs');
  assert.notEqual(site.pages[1].slug, 'tarifs');
  assert.ok(site.pages[1].slug.startsWith('tarifs-'));
  assert.ok(issues.some((issue) => issue.includes('dupliquee')));
});

test('normalizePageSlug nettoie accents et espaces, garde "" pour l accueil', () => {
  assert.equal(normalizePageSlug('Le Domaine !'), 'le-domaine');
  assert.equal(normalizePageSlug('Tarifs Été'), 'tarifs-ete');
  assert.equal(normalizePageSlug(''), '');
  assert.equal(normalizePageSlug(undefined), '');
});

test('createEmptySite produit un site d une page reconnu par normalizeSite', () => {
  const site = createEmptySite('Nouveau site');
  const roundTripped = normalizeSite(JSON.parse(serializeSite(site)));
  assert.equal(roundTripped.site.pages.length, 1);
  assert.equal(roundTripped.site.pages[0].slug, '');
});

test('parseSite refuse un JSON illisible', () => {
  assert.throws(() => parseSite('{ ceci ne va pas'));
});

test('findPageBySlug retrouve la bonne page, "" pour l accueil', () => {
  const site = normalizeSite({
    pages: [
      { id: 'home', slug: '', label: 'Accueil', tree: createStarterTree() },
      { id: 'p2', slug: 'contact', label: 'Contact', tree: createStarterTree() },
    ],
  }).site;
  assert.equal(findPageBySlug(site, '').id, 'home');
  assert.equal(findPageBySlug(site, 'contact').id, 'p2');
  assert.equal(findPageBySlug(site, 'inconnue'), null);
});
