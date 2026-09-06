import { useBuilderStore } from '../../store/builderStore.js';
import { CanvasNode } from './CanvasNode.js';

const VIEWPORT_WIDTH: Record<string, string> = {
  desktop: '100%',
  tablet: '834px',
  mobile: '390px',
};

/**
 * Zone centrale : projection React de l AST.
 * Aucun HTML n est stocke — ce rendu est recalcule a chaque changement du store.
 */
export function Canvas(): React.ReactElement {
  const tree = useBuilderStore((state) => state.tree);
  const viewport = useBuilderStore((state) => state.viewport);
  const select = useBuilderStore((state) => state.select);
  const drag = useBuilderStore((state) => state.drag);
  const setDropTarget = useBuilderStore((state) => state.setDropTarget);
  const dropOn = useBuilderStore((state) => state.dropOn);

  return (
    <div
      className="crea-canvas-frame min-w-0 flex-1 overflow-auto bg-[#EDE9DF] p-3 lg:p-6"
      onClick={() => select(null)}
      onDragOver={(event) => {
        if (!drag) return;
        event.preventDefault();
        setDropTarget({ nodeId: tree.root.id, position: 'inside' });
      }}
      onDrop={(event) => {
        if (!drag) return;
        event.preventDefault();
        dropOn({ nodeId: tree.root.id, position: 'inside' });
      }}
    >
      <div
        className="mx-auto bg-white shadow-[0_18px_50px_-24px_rgba(31,36,32,0.45)] transition-[width] duration-200"
        style={{ width: VIEWPORT_WIDTH[viewport], maxWidth: '100%' }}
      >
        <CanvasNode node={tree.root} isRoot />
      </div>
    </div>
  );
}
