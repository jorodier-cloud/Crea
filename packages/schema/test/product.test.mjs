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

test('createNode("product") demarre avec un prix nul et normalisable', () => {
  const node = createNode('product');
  assert.equal(node.type, 'product');
  assert.equal(node.content.price, 0);
  assert.equal(node.content.currency, 'eur');

  const tree = createStarterTree();
  tree.root.children.push(node);
  const { tree: normalized, issues } = normalizeTree(JSON.parse(serializeTree(tree)));
  assert.equal(issues.length, 0);
  assert.equal(normalized.root.children.at(-1).type, 'product');
});

test('un produit rend son prix et son formulaire d achat', () => {
  const tree = createStarterTree();
  const result = applyOperations(tree, [
    {
      op: 'insert',
      parentId: tree.root.id,
      node: createNode('product', {
        content: {
          name: 'Sejour a Bali',
          description: '<script>alert(1)</script>',
          price: 890,
          currency: 'eur',
          buttonLabel: 'Reserver ce voyage',
        },
      }),
    },
  ]);
  const html = renderTreeToHtml(result.tree, { checkoutEndpoint: '/p/agence/checkout' });

  assert.ok(html.includes('class="crea-product"'));
  assert.ok(html.includes('890.00 €'));
  assert.ok(html.includes('action="/p/agence/checkout"'));
  assert.ok(html.includes('Reserver ce voyage'));
  // Le contenu du produit reste du texte, echappe comme n importe quel autre champ.
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('sans adresse de paiement, le bouton d achat est desactive plutot que muet', () => {
  const tree = createStarterTree();
  const result = applyOperations(tree, [
    { op: 'insert', parentId: tree.root.id, node: createNode('product') },
  ]);
  const html = renderTreeToHtml(result.tree);
  assert.ok(html.includes('class="crea-product-buy" disabled'));
  assert.ok(html.includes('action="#"'));
});
