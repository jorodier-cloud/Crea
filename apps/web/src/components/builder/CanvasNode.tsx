import {
  canHaveChildren,
  nodeToCssProperties,
  type AnyBlockNode,
  type ButtonContent,
  type CalendarContent,
  type ContainerContent,
  type EmbedContent,
  type FormContent,
  type MediaContent,
  type ProductContent,
  type TextContent,
} from '@crea/schema';
import { createElement, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';

import { useBuilderStore, type DropPosition } from '../../store/builderStore.js';
import { CalendarPreview, EmbedPreview, FormPreview, ProductPreview } from './NodePreviews.js';

const GOLD = '#C2A15A';
const SAGE = '#9CAF88';

interface CanvasNodeProps {
  node: AnyBlockNode;
  isRoot?: boolean;
}

/** Surbrillance de selection, de survol, clignotement IA et indicateur de depot. */
function decorate(
  base: CSSProperties,
  flags: { selected: boolean; hovered: boolean; highlighted: boolean; drop: DropPosition | null },
): CSSProperties {
  const style: CSSProperties = { ...base };

  if (flags.selected) {
    style.outline = `2px solid ${GOLD}`;
    style.outlineOffset = '1px';
  } else if (flags.hovered) {
    style.outline = `1px dashed ${SAGE}`;
    style.outlineOffset = '1px';
  }

  // Le geste de l IA doit se voir sans lire le message : un halo dore qui
  // s attenue, distinct du contour de selection.
  if (flags.highlighted) {
    style.animation = 'crea-ai-flash 1.6s ease-out';
  }

  if (flags.drop === 'inside') {
    style.outline = `2px dashed ${GOLD}`;
    style.outlineOffset = '-2px';
  } else if (flags.drop === 'before') {
    style.boxShadow = `inset 0 3px 0 0 ${GOLD}`;
  } else if (flags.drop === 'after') {
    style.boxShadow = `inset 0 -3px 0 0 ${GOLD}`;
  }

  return style;
}

export function CanvasNode({ node, isRoot = false }: CanvasNodeProps): ReactNode {
  const selectedId = useBuilderStore((state) => state.selectedId);
  const hoveredId = useBuilderStore((state) => state.hoveredId);
  const highlighted = useBuilderStore((state) => state.highlightedIds.includes(node.id));
  const drag = useBuilderStore((state) => state.drag);
  const dropTarget = useBuilderStore((state) => state.dropTarget);
  const select = useBuilderStore((state) => state.select);
  const hover = useBuilderStore((state) => state.hover);
  const beginDrag = useBuilderStore((state) => state.beginDrag);
  const setDropTarget = useBuilderStore((state) => state.setDropTarget);
  const dropOn = useBuilderStore((state) => state.dropOn);
  const updateContent = useBuilderStore((state) => state.updateContent);

  const [editing, setEditing] = useState(false);

  const accepts = canHaveChildren(node.type);
  const dropPosition = dropTarget?.nodeId === node.id ? dropTarget.position : null;

  const style = decorate(nodeToCssProperties(node) as CSSProperties, {
    selected: selectedId === node.id,
    hovered: hoveredId === node.id && selectedId !== node.id,
    highlighted,
    drop: dropPosition,
  });

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;

    let position: DropPosition;
    if (isRoot) {
      position = 'inside';
    } else if (accepts && ratio > 0.3 && ratio < 0.7) {
      position = 'inside';
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }

    if (dropTarget?.nodeId !== node.id || dropTarget.position !== position) {
      setDropTarget({ nodeId: node.id, position });
    }
  };

  const handlers = {
    'data-node-id': node.id,
    style,
    onClick: (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      select(node.id);
    },
    onMouseOver: (event: React.MouseEvent) => {
      event.stopPropagation();
      hover(node.id);
    },
    onMouseOut: () => hover(null),
    draggable: !isRoot && !node.meta?.locked && !editing,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
      beginDrag({ kind: 'move', nodeId: node.id });
    },
    onDragEnd: () => beginDrag(null),
    onDragOver: handleDragOver,
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      if (dropTarget?.nodeId === node.id) setDropTarget(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dropOn({ nodeId: node.id, position: dropPosition ?? (accepts ? 'inside' : 'after') });
    },
  };

  const children = node.children.map((child) => <CanvasNode key={child.id} node={child} />);

  switch (node.type) {
    case 'container': {
      const content = node.content as ContainerContent;
      return createElement(
        content.tag ?? 'div',
        handlers,
        children.length > 0 ? (
          children
        ) : (
          <span
            style={{
              display: 'block',
              padding: '28px 16px',
              border: `1px dashed ${SAGE}`,
              borderRadius: 8,
              color: '#8A907F',
              fontSize: 13,
              textAlign: 'center',
              width: '100%',
            }}
          >
            Section vide — deposez un bloc ici
          </span>
        ),
      );
    }

    case 'text': {
      const content = node.content as TextContent;
      return createElement(content.tag ?? 'p', {
        ...handlers,
        contentEditable: editing,
        suppressContentEditableWarning: true,
        onDoubleClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          setEditing(true);
        },
        onBlur: (event: React.FocusEvent<HTMLElement>) => {
          if (!editing) return;
          setEditing(false);
          const text = event.currentTarget.innerText;
          if (text !== content.text) updateContent(node.id, { text });
        },
        children: content.text,
      });
    }

    case 'media': {
      const content = node.content as MediaContent;
      if (!content.src) {
        return (
          <div
            {...handlers}
            style={{
              ...style,
              minHeight: 160,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#EFE8DA',
              color: '#8A907F',
              fontSize: 13,
              border: `1px dashed ${SAGE}`,
            }}
          >
            Image vide — choisir un fichier dans l inspecteur
          </div>
        );
      }
      if (content.kind === 'video') {
        return <video {...handlers} src={content.src} controls playsInline />;
      }
      return <img {...handlers} src={content.src} alt={content.alt ?? ''} />;
    }

    case 'button': {
      const content = node.content as ButtonContent;
      return (
        <button {...handlers} type="button">
          {content.label}
        </button>
      );
    }

    case 'calendar':
      return (
        <div {...handlers}>
          <CalendarPreview content={node.content as CalendarContent} />
        </div>
      );

    case 'form':
      return (
        <div {...handlers}>
          <FormPreview content={node.content as FormContent} />
          {children}
        </div>
      );

    case 'embed':
      return (
        <div {...handlers}>
          <EmbedPreview content={node.content as EmbedContent} />
        </div>
      );

    case 'product':
      return (
        <div {...handlers}>
          <ProductPreview content={node.content as ProductContent} />
        </div>
      );

    default:
      return null;
  }
}
