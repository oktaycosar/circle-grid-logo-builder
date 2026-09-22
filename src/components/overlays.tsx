import { memo } from 'react';
import type { ArtboardObject, PenAnchor, Vec2 } from '../core/types.ts';
import { geometryRotatedCorners, geometryKeypoints, geometryToSvgPathData } from '../core/geometry.ts';
import { geometryEditableLoops, nodeRoles, type NodeRef, nodeKey } from '../core/nodes.ts';
import { GUIDE_COLOR } from '../core/factory.ts';
import { isoCubeFaces, type IsoCube } from '../core/isometric.ts';

/**
 * Ekran uzayında çizilen katmanlar (zoom'dan bağımsız piksel boyutları):
 *  - seçim çerçevesi + dönüşüm tutamaçları
 *  - Direct Selection anchor noktaları
 *  - marquee (lastik bant) seçimi
 *  - smart snap kılavuzları ve etiketleri
 *  - pen önizlemesi ve knife çizgisi
 *  - Shape Builder bölge vurguları
 */

export interface ScreenTransform {
  zoom: number;
  pan: Vec2;
}

export function worldToScreen(p: Vec2, t: ScreenTransform): Vec2 {
  return { x: p.x * t.zoom + t.pan.x, y: p.y * t.zoom + t.pan.y };
}

export function screenToWorldSvg(p: Vec2, t: ScreenTransform): Vec2 {
  return { x: (p.x - t.pan.x) / t.zoom, y: (p.y - t.pan.y) / t.zoom };
}

// ---------------------------------------------------------- seçim çerçevesi

export interface SelectionOverlayProps {
  objects: ArtboardObject[];
  t: ScreenTransform;
  /** Sadece çerçeve çizilsin mi (tutamaçlar ayrı bileşende). */
  showHandles: boolean;
}

export const SelectionOverlay = memo(function SelectionOverlay({
  objects,
  t,
  showHandles,
}: SelectionOverlayProps) {
  if (!objects.length) return null;

  return (
    <g pointerEvents="none">
      {objects.map((obj) => {
        const corners = geometryRotatedCorners(obj.geometry, obj.rotation).map((c) => worldToScreen(c, t));
        const points = corners.map((c) => `${c.x},${c.y}`).join(' ');
        return (
          <polygon
            key={obj.id}
            points={points}
            fill="none"
            stroke="#4d8dff"
            strokeWidth={1}
            strokeDasharray={objects.length > 1 ? '4 3' : undefined}
          />
        );
      })}

      {showHandles && objects.length === 1 && (
        <SelectionExtras object={objects[0]} t={t} />
      )}
    </g>
  );
});

function SelectionExtras({ object, t }: { object: ArtboardObject; t: ScreenTransform }) {
  const center = worldToScreen({ x: object.x + object.width / 2, y: object.y + object.height / 2 }, t);
  const keypoints =
    object.geometry.kind === 'circle' || object.geometry.kind === 'ellipse' || object.geometry.kind === 'ring'
      ? geometryKeypoints(object.geometry).map((p) => worldToScreen(p, t))
      : [];

  return (
    <>
      <circle cx={center.x} cy={center.y} r={3} fill="#4d8dff" stroke="#fff" strokeWidth={1} />
      {keypoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#38d9c4" stroke="#1e1e1e" strokeWidth={0.8} />
      ))}
    </>
  );
}

// -------------------------------------------------------------- tutamaçlar

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  rot: 'grab',
};

export interface TransformHandlesProps {
  object: ArtboardObject;
  t: ScreenTransform;
  onHandlePointerDown: (event: React.PointerEvent<SVGRectElement | SVGCircleElement>, handle: HandleId) => void;
}

const SIZE = 7;

export function TransformHandles({ object, t, onHandlePointerDown }: TransformHandlesProps) {
  const corners = geometryRotatedCorners(object.geometry, object.rotation).map((c) => worldToScreen(c, t));
  const [tl, tr, br, bl] = corners;
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const spots: { id: HandleId; p: Vec2 }[] = [
    { id: 'nw', p: tl },
    { id: 'n', p: mid(tl, tr) },
    { id: 'ne', p: tr },
    { id: 'e', p: mid(tr, br) },
    { id: 'se', p: br },
    { id: 's', p: mid(br, bl) },
    { id: 'sw', p: bl },
    { id: 'w', p: mid(bl, tl) },
  ];

  // Rotasyon tutamacı: üst kenarın ortasından yukarı doğru
  const topMid = mid(tl, tr);
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
  const dx = topMid.x - center.x;
  const dy = topMid.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const rotPos = { x: topMid.x + (dx / len) * 24, y: topMid.y + (dy / len) * 24 };

  return (
    <g>
      <path
        d={`M ${topMid.x} ${topMid.y} L ${rotPos.x} ${rotPos.y}`}
        stroke="#4d8dff"
        strokeWidth={1}
        pointerEvents="none"
      />
      <circle
        cx={rotPos.x}
        cy={rotPos.y}
        r={5}
        fill="#1e1e1e"
        stroke="#4d8dff"
        strokeWidth={1.4}
        style={{ cursor: HANDLE_CURSORS.rot }}
        onPointerDown={(e) => onHandlePointerDown(e, 'rot')}
      />
      {spots.map((s) => (
        <rect
          key={s.id}
          x={s.p.x - SIZE / 2}
          y={s.p.y - SIZE / 2}
          width={SIZE}
          height={SIZE}
          fill="#ffffff"
          stroke="#0f6fd8"
          strokeWidth={1.2}
          style={{ cursor: HANDLE_CURSORS[s.id] }}
          onPointerDown={(e) => onHandlePointerDown(e, s.id)}
        />
      ))}
    </g>
  );
}

// -------------------------------------------------------- direct selection

export interface AnchorOverlayProps {
  objects: ArtboardObject[];
  t: ScreenTransform;
  selectedNodes: string[];
  onAnchorPointerDown: (event: React.PointerEvent<SVGCircleElement>, ref: NodeRef) => void;
  onSegmentDoubleClick: (objectId: string, loop: number, segment: number, point: Vec2) => void;
}

export function AnchorOverlay({
  objects,
  t,
  selectedNodes,
  onAnchorPointerDown,
  onSegmentDoubleClick,
}: AnchorOverlayProps) {
  const selected = new Set(selectedNodes);  return (
    <g>
      {objects.map((obj) => {
        const loops = geometryEditableLoops(obj.geometry);
        const cos = Math.cos((obj.rotation * Math.PI) / 180);
        const sin = Math.sin((obj.rotation * Math.PI) / 180);
        const ox = obj.x + obj.width / 2;
        const oy = obj.y + obj.height / 2;
        const toWorld = (p: Vec2): Vec2 =>
          obj.rotation
            ? { x: ox + (p.x - ox) * cos - (p.y - oy) * sin, y: oy + (p.x - ox) * sin + (p.y - oy) * cos }
            : p;

        return (
          <g key={obj.id}>
            {loops.map((loop, loopIndex) => {
              const screen = loop.points.map((p) => worldToScreen(toWorld(p), t));
              const d = screen.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (loop.closed ? ' Z' : '');
              return (
                <g key={loopIndex}>
                  <path
                    d={d}
                    fill="none"
                    stroke="#8b7cf6"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    pointerEvents="stroke"
                    style={{ cursor: 'pointer' }}
                    onDoubleClick={(e) => {
                      const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                      const wp = screenToWorldLocal(sp, screen, loop.points, toWorld);
                      if (wp) onSegmentDoubleClick(obj.id, loopIndex, wp.segment, wp.point);
                    }}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Seçili objelerin anchor'ları en üstte */}
      {objects.map((obj) => {
        const loops = geometryEditableLoops(obj.geometry);
        const cos = Math.cos((obj.rotation * Math.PI) / 180);
        const sin = Math.sin((obj.rotation * Math.PI) / 180);
        const ox = obj.x + obj.width / 2;
        const oy = obj.y + obj.height / 2;
        const toWorld = (p: Vec2): Vec2 =>
          obj.rotation
            ? { x: ox + (p.x - ox) * cos - (p.y - oy) * sin, y: oy + (p.x - ox) * sin + (p.y - oy) * cos }
            : p;

        return loops.map((loop, loopIndex) =>
          loop.points.map((p, index) => {
            const ref: NodeRef = { objectId: obj.id, loop: loopIndex, index };
            const screen = worldToScreen(toWorld(p), t);
            const isSelected = selected.has(nodeKey(ref));
            const roundAnchor = obj.geometry.kind === 'circle' || obj.geometry.kind === 'ellipse' || obj.geometry.kind === 'ring';
            return (
              <g key={nodeKey(ref)}>
                <circle
                  cx={screen.x}
                  cy={screen.y}
                  r={5}
                  fill={isSelected ? '#4d8dff' : roundAnchor ? '#38d9c4' : '#ffffff'}
                  stroke="#0f6fd8"
                  strokeWidth={1.2}
                  style={{ cursor: 'move' }}
                  onPointerDown={(e) => onAnchorPointerDown(e, ref)}
                >
                  <title>{`${obj.name} · ${nodeRoles(obj.geometry, index)} (${index + 1})`}</title>
                </circle>
              </g>
            );
          }),
        );
      })}
    </g>
  );
}

/** Tıklanan ekran noktasını en yakın path segmentine eşler. */
function screenToWorldLocal(
  screenPoint: Vec2,
  screenPoints: Vec2[],
  localPoints: Vec2[],
  toWorld: (p: Vec2) => Vec2,
): { segment: number; point: Vec2 } | null {
  if (screenPoints.length < 2) return null;
  let bestIndex = -1;
  let bestDist = 10;
  let bestT = 0;
  for (let i = 0; i < screenPoints.length; i++) {
    const a = screenPoints[i];
    const b = screenPoints[(i + 1) % screenPoints.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) continue;
    let t = ((screenPoint.x - a.x) * dx + (screenPoint.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(screenPoint.x - (a.x + t * dx), screenPoint.y - (a.y + t * dy));
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
      bestT = t;
    }
  }
  if (bestIndex === -1) return null;
  const a = localPoints[bestIndex];
  const b = localPoints[(bestIndex + 1) % localPoints.length];
  const point = { x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT };
  void toWorld;
  return { segment: bestIndex, point };
}

// ------------------------------------------------------------- pen önizleme

export interface PenOverlayProps {
  /** Ekran uzayına dönüştürülmüş çapalar. */
  anchors: PenAnchor[];
  cursor: Vec2 | null;
  previewPathData: string;
}

export function PenOverlay({ anchors, cursor, previewPathData }: PenOverlayProps) {
  if (!anchors.length) return null;
  return (
    <g pointerEvents="none">
      {previewPathData && (
        <path d={previewPathData} fill="none" stroke="#0f6fd8" strokeWidth={1.2} strokeDasharray="4 3" />
      )}
      {anchors.map((a, i) => (
        <g key={i}>
          {a.h && (
            <>
              <path d={`M ${a.p.x} ${a.p.y} L ${a.h.x} ${a.h.y}`} stroke="#8b7cf6" strokeWidth={1} />
              <circle cx={a.h.x} cy={a.h.y} r={3} fill="none" stroke="#8b7cf6" strokeWidth={1.2} />
            </>
          )}
          <circle
            cx={a.p.x}
            cy={a.p.y}
            r={4}
            fill={i === 0 ? '#38d9c4' : '#ffffff'}
            stroke="#0f6fd8"
            strokeWidth={1.2}
          />
        </g>
      ))}
      {cursor && <circle cx={cursor.x} cy={cursor.y} r={2} fill="#0f6fd8" />}
    </g>
  );
}

// ------------------------------------------------------ rehber ve snap çizgileri

export interface GuideOverlayProps {
  show: boolean;
  objects: ArtboardObject[];
}

export function GuideOverlay({ show, objects }: GuideOverlayProps) {
  if (!show) return null;
  const guides = objects.filter((o) => o.isGuide && o.visible);
  if (!guides.length) return null;
  return (
    <g pointerEvents="none" opacity={0.9}>
      {guides.map((g) => (
        <path
          key={g.id}
          d={geometryToSvgPathData(g.geometry)}
          fill="none"
          stroke={GUIDE_COLOR}
          strokeWidth={1.4}
          strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

export interface SnapOverlayProps {
  guides: { x1: number; y1: number; x2: number; y2: number }[];
  labels: { x: number; y: number; text: string }[];
  t: ScreenTransform;
}

export function SnapOverlay({ guides, labels, t }: SnapOverlayProps) {
  if (!guides.length && !labels.length) return null;
  return (
    <g pointerEvents="none">
      {guides.map((g, i) => {
        const a = worldToScreen({ x: g.x1, y: g.y1 }, t);
        const b = worldToScreen({ x: g.x2, y: g.y2 }, t);
        return (
          <path
            key={i}
            d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
            stroke="#38d9c4"
            strokeWidth={1}
            strokeDasharray="5 4"
            opacity={0.95}
          />
        );
      })}
      {labels.map((l, i) => {
        const p = worldToScreen({ x: l.x, y: l.y }, t);
        const width = l.text.length * 6 + 10;
        return (
          <g key={i} transform={`translate(${p.x + 8} ${p.y - 20})`}>
            <rect x={0} y={0} width={width} height={16} rx={3} fill="#0f6fd8" opacity={0.92} />
            <text x={width / 2} y={11} textAnchor="middle" fontSize={10} fill="#fff">
              {l.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface MarqueeOverlayProps {
  rect: { x: number; y: number; width: number; height: number } | null;
  t: ScreenTransform;
}

export function MarqueeOverlay({ rect, t }: MarqueeOverlayProps) {
  if (!rect) return null;
  const a = worldToScreen({ x: rect.x, y: rect.y }, t);
  const b = worldToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, t);
  return (
    <rect
      x={Math.min(a.x, b.x)}
      y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)}
      height={Math.abs(b.y - a.y)}
      fill="rgba(77,141,255,0.13)"
      stroke="#4d8dff"
      strokeWidth={1}
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  );
}

export interface DrawPreviewProps {
  kind: 'rectangle' | 'circle' | 'ring' | 'ellipse' | 'line' | 'knife';
  from: Vec2;
  to: Vec2;
  thickness?: number;
  t: ScreenTransform;
}

export function DrawPreview({ kind, from, to, thickness = 0, t }: DrawPreviewProps) {
  const a = worldToScreen(from, t);
  const b = worldToScreen(to, t);
  const common = {
    fill: 'rgba(77,141,255,0.12)',
    stroke: '#4d8dff',
    strokeWidth: 1,
    strokeDasharray: '4 3',
    pointerEvents: 'none' as const,
  };

  if (kind === 'line' || kind === 'knife') {
    return <path d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} {...common} fill="none" stroke={kind === 'knife' ? '#ff7a5c' : '#4d8dff'} />;
  }

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;

  if (kind === 'circle') {
    const r = Math.min(rx, ry);
    return <ellipse cx={cx} cy={cy} rx={r} ry={r} {...common} />;
  }
  if (kind === 'ellipse') {
    return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} />;
  }
  if (kind === 'ring') {
    const r = Math.min(rx, ry);
    const inner = Math.max(0, r - thickness * t.zoom);
    return (
      <g {...common} fill="rgba(77,141,255,0.12)">
        <ellipse cx={cx} cy={cy} rx={r} ry={r} fill="none" />
        {inner > 0 && <ellipse cx={cx} cy={cy} rx={inner} ry={inner} fill="none" strokeDasharray="2 2" />}
      </g>
    );
  }

  return (
    <rect
      x={Math.min(a.x, b.x)}
      y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)}
      height={Math.abs(b.y - a.y)}
      {...common}
    />
  );
}

/**
 * İzometrik küp önizlemesi: üç yüz de dünya uzayında çizilir, çünkü küp
 * geometrisi zaten izdüşürülmüş olarak üretilir.
 */
export function IsoCubePreview({ cube }: { cube: IsoCube }) {
  const faces = isoCubeFaces(cube);
  const order: ('left' | 'right' | 'top')[] = ['left', 'right', 'top'];
  return (
    <g pointerEvents="none">
      {order.map((face) => {
        const pts = faces[face];
        if (!pts || pts.length < 3) return null;
        const d = `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
        return (
          <path
            key={face}
            d={d}
            fill="rgba(77,141,255,0.16)"
            stroke="#4d8dff"
            strokeWidth={1}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

export interface ShapeBuilderOverlayProps {
  regions: { key: string; pathData: string; label: string }[];  hoveredKey: string | null;
  selectedKeys: string[];
  onHover: (key: string | null) => void;
  onClick: (key: string, remove: boolean) => void;
}

export function ShapeBuilderOverlay({
  regions,
  hoveredKey,
  selectedKeys,
  onHover,
  onClick,
}: ShapeBuilderOverlayProps) {
  const selected = new Set(selectedKeys);
  return (
    <g>
      {regions.map((r) => {
        const isHover = hoveredKey === r.key;
        const isSelected = selected.has(r.key);
        return (
          <path
            key={r.key}
            d={r.pathData}
            fillRule="evenodd"
            fill={isSelected ? 'rgba(56,217,196,0.45)' : isHover ? 'rgba(77,141,255,0.38)' : 'rgba(77,141,255,0.14)'}
            stroke={isSelected ? '#38d9c4' : '#4d8dff'}
            strokeWidth={1}
            onPointerEnter={() => onHover(r.key)}
            onPointerLeave={() => onHover(null)}
            onPointerDown={(e) => {
              e.stopPropagation();
              onClick(r.key, e.altKey);
            }}
          >
            <title>{r.label}</title>
          </path>
        );
      })}
    </g>
  );
}
