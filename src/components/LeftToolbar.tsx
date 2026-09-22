import type { ReactNode } from 'react';
import type { ToolId } from '../core/types.ts';
import {
  IconCircle,
  IconDirectSelect,
  IconEllipse,
  IconHand,
  IconIsoCube,
  IconKnife,
  IconLine,
  IconPen,
  IconRectangle,
  IconRing,
  IconSelect,
  IconShapeBuilder,
  IconZoom,
} from './icons.tsx';

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: ReactNode;
  divider?: boolean;
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'select', label: 'Select Tool', shortcut: 'V', icon: <IconSelect /> },
  { id: 'direct-select', label: 'Direct Selection Tool', shortcut: 'A', icon: <IconDirectSelect /> },
  { id: 'rectangle', label: 'Rectangle Tool', shortcut: 'R', icon: <IconRectangle />, divider: true },
  { id: 'circle', label: 'Circle Tool', shortcut: 'E', icon: <IconCircle /> },
  { id: 'ellipse', label: 'Ellipse Tool', shortcut: 'Shift+E', icon: <IconEllipse /> },
  { id: 'ring', label: 'Circle Ring Tool', shortcut: 'Shift+R', icon: <IconRing /> },
  { id: 'line', label: 'Line Tool', shortcut: 'L', icon: <IconLine />, divider: true },
  { id: 'pen', label: 'Pen Tool', shortcut: 'P', icon: <IconPen /> },
  { id: 'shape-builder', label: 'Shape Builder Tool', shortcut: 'B', icon: <IconShapeBuilder /> },
  { id: 'knife', label: 'Knife / Trim Tool', shortcut: 'C', icon: <IconKnife /> },
  { id: 'iso-cube', label: 'Isometric Cube Tool', shortcut: 'I', icon: <IconIsoCube />, divider: true },
  { id: 'hand', label: 'Hand Tool', shortcut: 'H', icon: <IconHand />, divider: true },
  { id: 'zoom', label: 'Zoom Tool', shortcut: 'Z', icon: <IconZoom /> },
];

export interface LeftToolbarProps {
  tool: ToolId;
  onSelect: (tool: ToolId) => void;
}

export function LeftToolbar({ tool, onSelect }: LeftToolbarProps) {
  return (
    <nav className="lefttoolbar" aria-label="Araçlar">
      {TOOL_DEFS.map((def) => (
        <div key={def.id} style={{ display: 'contents' }}>
          {def.divider && <div className="lefttoolbar__divider" />}
          <button
            type="button"
            className={`lefttoolbar__btn${tool === def.id ? ' lefttoolbar__btn--active' : ''}`}
            onClick={() => onSelect(def.id)}
            title={`${def.label} (${def.shortcut})`}
            aria-pressed={tool === def.id}
          >
            {def.icon}
          </button>
        </div>
      ))}
    </nav>
  );
}
