import { memo } from 'react';
import type { ArtboardObject, DocumentSettings, FillStyle, Vec2 } from '../core/types.ts';
import { geometryToSvgPathData, geometryRotatedCorners } from '../core/geometry.ts';
import { GUIDE_COLOR, hasFill } from '../core/factory.ts';

/**
 * Tek bir artwork objesini SVG'ye çizer. Geometri her zaman gerçek vektör
 * path olarak üretilir (raster yok). Rotasyon obje merkezi etrafında uygulanır.
 */

export interface ObjectRendererProps {
  object: ArtboardObject;
  doc: DocumentSettings;
  zoom: number;
  isSelected: boolean;
  interactive?: boolean;
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, object: ArtboardObject) => void;
}

function fillValue(fill: FillStyle): string {
  switch (fill.type) {
    case 'none':
      return 'none';
    case 'solid':
      return fill.color;
    case 'linear':
      return 'none';
  }
}

function linearGradientDef(fill: Extract<FillStyle, { type: 'linear' }>, id: string) {
  const rad = (fill.angle * Math.PI) / 180;
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;
  return (
    <linearGradient
      id={id}
      gradientUnits="objectBoundingBox"
      x1={0.5 - dx}
      y1={0.5 - dy}
      x2={0.5 + dx}
      y2={0.5 + dy}
    >
      {fill.stops.map((s) => (
        <stop key={s.offset} offset={s.offset} stopColor={s.color} />
      ))}
    </linearGradient>
  );
}

export const ObjectRenderer = memo(function ObjectRenderer({
  object,
  doc,
  zoom,
  isSelected,
  interactive = true,
  onPointerDown,
}: ObjectRendererProps) {
  if (!object.visible) return null;

  const d = geometryToSvgPathData(object.geometry);
  if (!d) return null;

  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;
  const transform = object.rotation ? `rotate(${object.rotation} ${cx} ${cy})` : undefined;

  const isGuide = Boolean(object.isGuide);
  const outline = doc.outlineMode;
  const filled = hasFill(object) && object.fill.type !== 'none';

  let fill = outline ? 'none' : fillValue(object.fill);
  let gradientId: string | null = null;

  if (!outline && object.fill.type === 'linear') {
    gradientId = `fill-${object.id}`;
    fill = `url(#${gradientId})`;
  }

  let stroke = object.stroke;
  let strokeWidth = object.strokeWidth;

  if (isGuide) {
    stroke = GUIDE_COLOR;
    strokeWidth = Math.max(1, 1.2 / zoom);
    fill = 'none';
  } else if (outline) {
    stroke = isSelected ? '#4d8dff' : '#b9b9b9';
    strokeWidth = Math.max(0.4, 1 / zoom);
  }

  const showStroke = stroke !== 'none' && strokeWidth > 0;
  const hitWidth = Math.max(strokeWidth, 10 / zoom);

  return (
    <g transform={transform} opacity={object.locked ? 0.85 : 1}>
      {gradientId && object.fill.type === 'linear' && (
        <defs>{linearGradientDef(object.fill, gradientId)}</defs>
      )}

      {/* Görünür çizim */}
      <path
        d={d}
        fill={fill}
        fillRule="evenodd"
        stroke={showStroke ? stroke : 'none'}
        strokeWidth={showStroke ? strokeWidth : 0}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={isGuide ? `${4 / zoom} ${3 / zoom}` : undefined}
        pointerEvents="none"
      />

      {/* Şeffaf tıklama alanı: stroke-only şekillerde ve düşük zoom'da tutmayı kolaylaştırır */}
      {interactive && (
        <path
          d={d}
          fill={filled ? 'none' : 'none'}
          stroke="transparent"
          strokeWidth={hitWidth}
          fillRule="evenodd"
          style={{ cursor: 'inherit' }}
          onPointerDown={(e) => onPointerDown?.(e, object)}
        />
      )}
    </g>
  );
});

/** Objeleri katman/z-sırasına göre artan sırada döndürür. */
export function sortByRenderOrder(objects: ArtboardObject[]): ArtboardObject[] {
  return objects
    .map((o, index) => ({ o, index }))
    .sort((a, b) => (a.o.layerIndex - b.o.layerIndex) || (a.index - b.index))
    .map((e) => e.o);
}

/** Seçim kutusu için rotasyonlu köşeler (hit test yardımcısı). */
export function objectCorners(object: ArtboardObject): Vec2[] {
  return geometryRotatedCorners(object.geometry, object.rotation);
}
