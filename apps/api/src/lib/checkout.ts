import type { AnyBlockNode, PageTree, ProductContent, SitePage } from '@crea/schema';

/** Nom du champ cache portant l identifiant du produit achete (voir render.ts). */
export const PRODUCT_ID_FIELD = '_crea_product';

function search(tree: PageTree, id: string): AnyBlockNode | null {
  const stack: AnyBlockNode[] = [tree.root];
  while (stack.length > 0) {
    const node = stack.pop() as AnyBlockNode;
    if (node.type === 'product' && node.id === id) return node;
    for (const child of node.children) stack.push(child);
  }
  return null;
}

/** Cherche un produit par id sur l ensemble des pages du site. */
export function findProductNode(pages: SitePage[], productId: string): AnyBlockNode | null {
  for (const page of pages) {
    const node = search(page.tree, productId);
    if (node) return node;
  }
  return null;
}

export function productContent(node: AnyBlockNode): ProductContent {
  return node.content as ProductContent;
}
