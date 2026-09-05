import { DEFAULT_BLOCK_LABEL, type AnyBlockNode } from '@crea/schema';

import { useBuilderStore } from '../../store/builderStore.js';

function labelOf(node: AnyBlockNode): string {
  if (node.type === 'text') {
    const text = (node.content as { text: string }).text;
    return text.slice(0, 32) || DEFAULT_BLOCK_LABEL.text;
  }
  if (node.type === 'button') return (node.content as { label: string }).label;
  return node.name ?? DEFAULT_BLOCK_LABEL[node.type];
}

function Row({ node, depth }: { node: AnyBlockNode; depth: number }): React.ReactElement {
  const selectedId = useBuilderStore((state) => state.selectedId);
  const select = useBuilderStore((state) => state.select);
  const hover = useBuilderStore((state) => state.hover);

  return (
    <li>
      <button
        type="button"
        onClick={() => select(node.id)}
        onMouseEnter={() => hover(node.id)}
        onMouseLeave={() => hover(null)}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={`flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left text-[12px] transition-colors ${
          selectedId === node.id ? 'bg-linen text-forest' : 'text-muted hover:bg-offwhite'
        }`}
      >
        <span className="w-14 shrink-0 text-[10px] tracking-wide uppercase opacity-60">
          {node.type}
        </span>
        <span className="truncate">{labelOf(node)}</span>
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Row key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Arborescence de l AST : lecture directe de la source de verite. */
export function LayerTree(): React.ReactElement {
  const tree = useBuilderStore((state) => state.tree);

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <ul>
        <Row node={tree.root} depth={0} />
      </ul>
    </div>
  );
}
