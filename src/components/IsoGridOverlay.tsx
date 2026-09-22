import { memo, useMemo } from 'react';
import type { IsoSettings } from '../core/types.ts';
import { isoGridPaths } from '../core/isometric.ts';

/**
 * İzometrik ızgara (spesifikasyon §İkinci video).
 *
 * Üç çizgi ailesi çizilir ve her aile TEK bir `<path>` olarak üretilir:
 *   - `alongU` : sağ-aşağı (+30°) çizgiler
 *   - `alongV` : sol-aşağı (−30°) çizgiler
 *   - `vertical`: dikey (z ekseni) çizgiler
 *
 * Böylece pan/zoom sırasında DOM düğüm sayısı sabit kalır.
 * Çizgiler `vector-effect: non-scaling-stroke` ile ekranda 1 px kalır.
 */

export interface IsoGridOverlayProps {
  iso: IsoSettings;
  artboardSize: number;
}

export const IsoGridOverlay = memo(function IsoGridOverlay({ iso, artboardSize }: IsoGridOverlayProps) {
  const paths = useMemo(() => {
    if (!iso.enabled) return null;
    return isoGridPaths(iso, artboardSize);
  }, [iso.enabled, iso.cell, iso.origin.x, iso.origin.y, iso.showVerticals, artboardSize]);

  if (!paths) return null;

  const opacity = Math.max(0, Math.min(1, iso.opacity));

  return (
    <g pointerEvents="none" opacity={opacity}>
      <path
        d={paths.alongV}
        fill="none"
        stroke="#7f8ea3"
        strokeWidth={1}
        strokeOpacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={paths.alongU}
        fill="none"
        stroke="#7f8ea3"
        strokeWidth={1}
        strokeOpacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      {iso.showVerticals && (
        <path
          d={paths.vertical}
          fill="none"
          stroke="#9a86ff"
          strokeWidth={1}
          strokeOpacity={0.4}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
});
