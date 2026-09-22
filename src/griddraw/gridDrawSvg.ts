/**
 * Grid Draw — temiz SVG çıktısı.
 *
 * Kurallar:
 *   - Kılavuzlar (grid çizgileri, daireler, çaprazlar, merkez artısı) ÇIKTIYA
 *     GİRMEZ. Yalnızca doldurulmuş bölgeler kalır.
 *   - Varsayılan olarak dolu gözler BİRLEŞTİRİLİR: komşu gözler tek silüet
 *     olur, aradaki paylaşılan kenar tamamen kaybolur. Böylece ne anti-alias
 *     dikişi (boşluk) ne de gereksiz iç kenar kalır — Illustrator'daki
 *     Pathfinder → Unite çıktısı.
 *   - Birleştirme kapalıysa her göz ayrı `<path>` olur ve komşu dolgular
 *     arasındaki dikişi kapatmak için aynı renkte ince bir kontur verilir.
 */

import type { GridDrawPlan, MergedShape } from './regions.ts';
import { DEFAULT_GRID_DRAW, guideGeometry } from './regions.ts';
import type { Vec2 } from '../core/types.ts';

export interface GridDrawStyle {
  /** Logo rengi (dolu bölgeler). */
  color: string;
  /** Zemin rengi. */
  background: string;
  /** Şeffaf zemin (SVG'ye arka plan dikdörtgeni eklenmez). */
  transparent: boolean;
  /** Bölge konturu çizilsin mi. */
  outline: boolean;
  outlineWidth: number;
  outlineColor: string;
  /**
   * Dolu gözleri tek silüete indir. Boşlukları ve iç kenarları kökten
   * çözdüğü için varsayılan olarak açıktır.
   */
  merge: boolean;
  /** Birleştirme kapalıyken komşu dolgular arasındaki dikişi kapat. */
  seamFix: boolean;
}

export const DEFAULT_GRID_DRAW_STYLE: GridDrawStyle = {
  color: '#17191d',
  background: '#f7f3eb',
  transparent: false,
  outline: false,
  outlineWidth: 8,
  outlineColor: '#17191d',
  merge: true,
  seamFix: true,
};

function n2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Doldurulmuş bölgelerden temiz (kılavuzsuz) SVG üretir.
 *
 * @param merged `mergeFilledRegions` çıktısı. `style.merge` açıkken kullanılır.
 */
export function buildGridDrawSvg(
  plan: GridDrawPlan,
  fills: ReadonlySet<number>,
  style: GridDrawStyle,
  merged: MergedShape | null = null,
): string {
  const { width, height } = plan;

  const mergedPath = style.merge && merged ? merged.pathData : '';
  const paths = mergedPath
    ? [mergedPath]
    : [...fills]
        .map((id) => plan.byId[id])
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .sort((a, b) => a.id - b.id)
        .map((r) => r.pathData);

  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(width)} ${n2(height)}" width="${n2(width)}" height="${n2(height)}">`;

  const background = style.transparent
    ? ''
    : `\n  <rect width="${n2(width)}" height="${n2(height)}" fill="${style.background}"/>`;

  let body = '';
  if (paths.length) {
    // Dikiş düzeltmesi yalnızca birleştirme kapalıyken gerekir; birleşik
    // silüette paylaşılan kenar diye bir şey yoktur.
    const seam =
      style.seamFix && !style.outline && !mergedPath
        ? ` stroke="${style.color}" stroke-width="0.9" stroke-linejoin="round"`
        : '';
    body += `\n  <g fill="${style.color}" fill-rule="evenodd"${seam}>`;
    body += paths.map((d) => `\n    <path d="${d}"/>`).join('');
    body += `\n  </g>`;

    if (style.outline) {
      body += `\n  <g fill="none" stroke="${style.outlineColor}" stroke-width="${n2(style.outlineWidth)}" stroke-linejoin="round" stroke-linecap="round">`;
      body += paths.map((d) => `\n    <path d="${d}"/>`).join('');
      body += `\n  </g>`;
    }
  }

  return `${head}${background}${body}\n</svg>\n`;
}

// ------------------------------------------------------------------- kılavuz

export interface GuideRenderData {
  size: number;
  grid: number;
  cell: number;
  gridPath: string;
  circles: { key: string; cx: number; cy: number; r: number }[];
  lines: { key: string; a: Vec2; b: Vec2 }[];
}

/** Kılavuzları çizime hazır hale getirir (grid ailesi tek path). */
export function guideRenderData(settings = DEFAULT_GRID_DRAW): GuideRenderData {
  const g = guideGeometry(settings);
  const parts: string[] = [];

  for (let i = 0; i <= g.cols; i++) {
    const x = n2(i * g.cellW);
    parts.push(`M ${x} 0 L ${x} ${g.size}`);
  }
  for (let j = 0; j <= g.rows; j++) {
    const y = n2(j * g.cellH);
    parts.push(`M 0 ${y} L ${g.size} ${y}`);
  }

  return {
    size: g.size,
    grid: g.grid,
    cell: g.cell,
    gridPath: parts.join(' '),
    circles: g.circles.map((c) => ({ key: `c${c.index}`, cx: c.cx, cy: c.cy, r: c.r })),
    lines: g.lines.map((l) => ({ key: `l${l.index}`, a: l.a, b: l.b })),
  };
}
