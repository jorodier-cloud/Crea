import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOperations,
  createNode,
  createStarterTree,
  findNode,
  normalizeTree,
  parseAiResponse,
  renderTreeToHtml,
  serializeTree,
  parseTree,
  countNodes,
} from '../dist/index.js';

test('createStarterTree produit un arbre valide et normalisable', () => {
  const tree = createStarterTree('Domaine');
  const { tree: normalized, issues } = normalizeTree(JSON.parse(serializeTree(tree)));
  assert.equal(issues.length, 0);
  assert.equal(normalized.root.type, 'container');
  assert.equal(countNodes(normalized.root), countNodes(tree.root));
});

test('insert refuse un parent qui n accepte pas d enfants', () => {
  const tree = createStarterTree();
  const text = tree.root.children[0].children[0];
  const result = applyOperations(tree, [
    { op: 'insert', parentId: text.id, node: createNode('button') },
  ]);
  assert.equal(result.applied.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /n accepte pas d enfants/);
});

test('update fusionne les styles par famille sans ecraser le reste', () => {
  const tree = createStarterTree();
  const title = tree.root.children[0].children[0];
  const result = applyOperations(tree, [
    { op: 'update', id: title.id, styles: { typography: { color: '#C2A15A' } } },
  ]);
  const updated = findNode(result.tree.root, title.id);
  assert.equal(updated.styles.typography.color, '#C2A15A');
  assert.equal(updated.styles.typography.fontSize, '56px');
  // L arbre d origine n est pas mute.
  assert.notEqual(findNode(tree.root, title.id).styles.typography.color, '#C2A15A');
});

test('move refuse de deplacer un noeud dans son propre descendant', () => {
  const tree = createStarterTree();
  const hero = tree.root.children[0];
  const child = hero.children[0];
  const result = applyOperations(tree, [
    { op: 'move', id: hero.id, parentId: child.id, index: 0 },
  ]);
  assert.equal(result.applied.length, 0);
  assert.equal(result.errors.length, 1);
});

test('duplicate reattribue des identifiants frais', () => {
  const tree = createStarterTree();
  const hero = tree.root.children[0];
  const result = applyOperations(tree, [{ op: 'duplicate', id: hero.id }]);
  assert.equal(result.tree.root.children.length, 3);
  const copy = result.tree.root.children[1];
  assert.notEqual(copy.id, hero.id);
  assert.notEqual(copy.children[0].id, hero.children[0].id);
});

test('normalizeTree reattribue les identifiants dupliques', () => {
  const tree = createStarterTree();
  tree.root.children[1].id = tree.root.children[0].id;
  const { tree: normalized, issues } = normalizeTree(JSON.parse(JSON.stringify(tree)));
  assert.equal(issues.length, 1);
  assert.notEqual(normalized.root.children[0].id, normalized.root.children[1].id);
});

test('normalizeTree rejette un type de bloc inconnu', () => {
  const tree = createStarterTree();
  tree.root.children[0].type = 'carousel';
  assert.throws(() => normalizeTree(JSON.parse(JSON.stringify(tree))), /Type de bloc inconnu/);
});

test('parseTree rejette un json_tree illisible', () => {
  assert.throws(() => parseTree('{ pas du json'), /illisible/);
});

test('parseAiResponse tolere un bloc de code et filtre les operations inconnues', () => {
  const raw = '```json\n{"message":"ok","operations":[{"op":"remove","id":"a"},{"op":"nuke"}]}\n```';
  const { payload, rejected } = parseAiResponse(raw);
  assert.equal(payload.message, 'ok');
  assert.equal(payload.operations.length, 1);
  assert.equal(rejected.length, 1);
});

test('le rendu HTML echappe le contenu utilisateur', () => {
  const tree = createStarterTree();
  const result = applyOperations(tree, [
    {
      op: 'update',
      id: tree.root.children[0].children[0].id,
      content: { text: '<script>alert(1)</script>' },
    },
  ]);
  const html = renderTreeToHtml(result.tree, { today: new Date('2026-01-15T00:00:00Z') });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('le rendu HTML neutralise les URL javascript:', () => {
  const tree = createStarterTree();
  const button = tree.root.children[0].children[2];
  const result = applyOperations(tree, [
    { op: 'update', id: button.id, actions: [{ type: 'navigate', href: 'javascript:alert(1)' }] },
  ]);
  const html = renderTreeToHtml(result.tree);
  assert.ok(!html.includes('javascript:alert(1)'));
  assert.ok(html.includes('href="#"'));
});

test('le rendu HTML est deterministe pour une date donnee', () => {
  const tree = createStarterTree();
  const withCalendar = applyOperations(tree, [
    {
      op: 'insert',
      parentId: tree.root.id,
      node: createNode('calendar', { content: { monthsVisible: 1, blockedDates: ['2026-01-20'] } }),
    },
  ]);
  const today = new Date('2026-01-15T00:00:00Z');
  const a = renderTreeToHtml(withCalendar.tree, { today });
  const b = renderTreeToHtml(withCalendar.tree, { today });
  assert.equal(a, b);
  assert.ok(a.includes('data-date="2026-01-20"'));
  assert.ok(a.includes('is-blocked'));
});
