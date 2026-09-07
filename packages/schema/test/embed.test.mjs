import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOperations,
  createNode,
  createStarterTree,
  normalizeTree,
  renderTreeToHtml,
  serializeTree,
} from '../dist/index.js';

test('createNode("embed") demarre vide et normalisable', () => {
  const node = createNode('embed');
  assert.equal(node.type, 'embed');
  assert.equal(node.content.html, '');

  const tree = createStarterTree();
  tree.root.children.push(node);
  const { tree: normalized, issues } = normalizeTree(JSON.parse(serializeTree(tree)));
  assert.equal(issues.length, 0);
  assert.equal(normalized.root.children.at(-1).type, 'embed');
});

test('le rendu HTML d un widget n echappe pas son code (contenu du proprietaire, pas d un visiteur)', () => {
  const tree = createStarterTree();
  const result = applyOperations(tree, [
    {
      op: 'insert',
      parentId: tree.root.id,
      node: createNode('embed', {
        content: { html: '<script src="https://widget.lodgify.com/w.js"></script>' },
      }),
    },
  ]);
  const html = renderTreeToHtml(result.tree);
  assert.ok(html.includes('<script src="https://widget.lodgify.com/w.js"></script>'));
  assert.ok(html.includes('class="crea-embed"'));
});

test('un widget vide rend un conteneur vide plutot que d omettre le bloc', () => {
  const tree = createStarterTree();
  const result = applyOperations(tree, [
    { op: 'insert', parentId: tree.root.id, node: createNode('embed', { content: { html: '' } }) },
  ]);
  const html = renderTreeToHtml(result.tree);
  assert.match(html, /<div data-crea-id="[^"]+" class="crea-embed"[^>]*><\/div>/);
});
