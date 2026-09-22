import type { PenAnchor, SubPath, Vec2 } from './types.ts';

/**
 * Pen tool: çapa noktaları + dış kontrol tutamaçlarından gerçek bezier
 * geometrisi üretir. Sürükleme yapılmadan yerleştirilen çapalar düz çizgi
 * olur; sürüklenen çapalar yumuşak eğri oluşturur.
 */

export function penAnchorsToSubPaths(anchors: PenAnchor[], closed: boolean, samplesPerSegment = 24): SubPath[] {
  if (anchors.length < 2) return [];
  const points: Vec2[] = [{ ...anchors[0].p }];
  const total = closed ? anchors.length : anchors.length - 1;

  for (let i = 0; i < total; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];

    const c1 = a.h ? { ...a.h } : { ...a.p };
    const c2 = b.h ? { x: 2 * b.p.x - b.h.x, y: 2 * b.p.y - b.h.y } : { ...b.p };

    const flat = Math.hypot(c1.x - a.p.x, c1.y - a.p.y) < 1e-6 && Math.hypot(c2.x - b.p.x, c2.y - b.p.y) < 1e-6;
    if (flat) {
      points.push({ ...b.p });
      continue;
    }

    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const mt = 1 - t;
      points.push({
        x: mt ** 3 * a.p.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * b.p.x,
        y: mt ** 3 * a.p.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * b.p.y,
      });
    }
  }

  return [{ points, closed }];
}

/** Pen önizlemesi için ekrandaki geçici path verisi. */
export function penPreviewPathData(anchors: PenAnchor[], cursor: Vec2 | null, closed: boolean): string {
  if (!anchors.length) return '';
  const parts: string[] = [`M ${anchors[0].p.x} ${anchors[0].p.y}`];
  for (let i = 1; i < anchors.length; i++) {
    parts.push(`L ${anchors[i].p.x} ${anchors[i].p.y}`);
  }
  if (cursor && !closed) parts.push(`L ${cursor.x} ${cursor.y}`);
  if (closed) parts.push('Z');
  return parts.join(' ');
}
