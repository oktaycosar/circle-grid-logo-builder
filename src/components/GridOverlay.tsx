import { memo, useMemo } from 'react';
import type { GridSettings } from '../core/types.ts';

/**
 * Grid, tek bir `<pattern>` ile çizilir (spesifikasyon 32). Yüzlerce ayrı
 * çizgi elemanı yerine iki pattern (alt bölme + ana çizgi) kullanılır; zoom
 * ve pan sırasında DOM değişmez, bu yüzden performans yüksektir.
 *
 * Çizgiler artboard merkezine göre SİMETRİK hizalanır: pattern fazı merkeze
 * göre kaydırılır.
 */

export interface GridOverlayProps {
  grid: GridSettings;
  artboardSize: number;
  /** Ekran pikseli cinsinden sabit kalınlık için gerekli. */
  zoom: number;
}

export const GridOverlay = memo(function GridOverlay({ grid, artboardSize, zoom }: GridOverlayProps) {
  const center = artboardSize / 2;

  const patterns = useMemo(() => {
    if (!grid.enabled) return null;
    const divisions = Math.max(1, Math.floor(grid.divisions));
    const minor = grid.size / divisions;
    const major = grid.size;

    // Merkeze göre simetrik faz: bir çizgi tam olarak merkezden geçer.
    const minorPhase = ((center % minor) + minor) % minor;
    const majorPhase = ((center % major) + major) % major;

    return { minor, major, minorPhase, majorPhase };
  }, [grid.enabled, grid.divisions, grid.size, center]);

  if (!patterns) return null;

  const { minor, major, minorPhase, majorPhase } = patterns;
  const opacity = Math.max(0, Math.min(1, grid.opacity));
  // Çizgiler ekranda sabit ~1px görünsün: dünya birimi = 1/zoom.
  const safeZoom = zoom > 0 ? zoom : 1;
  const hairline = 1 / safeZoom;

  return (
    <g pointerEvents="none" opacity={opacity}>
      <defs>
        <pattern
          id="grid-minor"
          patternUnits="userSpaceOnUse"
          width={minor}
          height={minor}
          patternTransform={`translate(${minorPhase} ${minorPhase})`}
        >
          <path
            d={`M ${minor} 0 L 0 0 0 ${minor}`}
            fill="none"
            stroke="#6f7f95"
            strokeWidth={hairline * 0.8}
            shapeRendering="crispEdges"
          />
        </pattern>
        <pattern
          id="grid-major"
          patternUnits="userSpaceOnUse"
          width={major}
          height={major}
          patternTransform={`translate(${majorPhase} ${majorPhase})`}
        >
          <path
            d={`M ${major} 0 L 0 0 0 ${major}`}
            fill="none"
            stroke="#4c6d94"
            strokeWidth={hairline * 1.35}
            shapeRendering="crispEdges"
          />
        </pattern>
      </defs>

      {grid.divisions > 1 && (
        <rect x={0} y={0} width={artboardSize} height={artboardSize} fill="url(#grid-minor)" />
      )}
      <rect x={0} y={0} width={artboardSize} height={artboardSize} fill="url(#grid-major)" />

      {/* Merkez vurgusu */}
      <path
        d={`M ${center} 0 L ${center} ${artboardSize} M 0 ${center} L ${artboardSize} ${center}`}
        stroke="#9a86ff"
        strokeWidth={hairline * 1.2}
        strokeDasharray={`${6 / safeZoom} ${5 / safeZoom}`}
        fill="none"
        opacity={0.9}
      />
    </g>
  );
});
