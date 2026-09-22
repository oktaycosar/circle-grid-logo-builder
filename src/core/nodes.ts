import type { Geometry, Vec2 } from './types.ts';
import { geometryBounds, geometryKeypoints } from './geometry.ts';

/**
 * Direct Selection (node editing) için birleşik erişim katmanı.
 *
 * Parametrik şekiller (rect / circle / ellipse / ring / line) için anahtar
 * noktalar şeklin PARAMETRELERİNİ düzenler; polygon/path için ise noktalar
 * serbestçe taşınır. Böylece hem gerçek düzenleme olur hem de daire gibi
 * şekiller matematiksel olarak daire kalır.
 */

export interface NodeRef {
  objectId: string;
  /** 0 = birincil loop, >0 = ek loop / alt yol. */
  loop: number;
  index: number;
}

export function nodeKey(ref: NodeRef): string {
  return `${ref.objectId}:${ref.loop}:${ref.index}`;
}

export function parseNodeKey(key: string): NodeRef | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const loop = Number(parts[1]);
  const index = Number(parts[2]);
  if (Number.isNaN(loop) || Number.isNaN(index)) return null;
  return { objectId: parts[0], loop, index };
}

/** Objenin düzenlenebilir loop'ları. */
export function geometryEditableLoops(g: Geometry): { points: Vec2[]; closed: boolean }[] {
  if (g.kind === 'path') {
    return g.subpaths.map((sp) => ({ points: sp.points, closed: sp.closed }));
  }
  if (g.kind === 'polygon') {
    return [
      { points: g.keypoints, closed: g.keypoints.length > 2 },
      ...(g.extraLoops ?? []).map((loop) => ({ points: loop, closed: true })),
    ];
  }
  // Parametrik şekiller: anahtar noktalar (rect köşeleri, daire merkez+4 nokta…)
  return [{ points: geometryKeypoints(g), closed: true }];
}

/** Anahtar noktaların anlamı — UI'da ipucu göstermek için. */
export function nodeRoles(g: Geometry, index: number): string {
  switch (g.kind) {
    case 'circle':
    case 'ellipse':
      return index === 0 ? 'merkez' : 'yarıçap';
    case 'ring':
      return index === 0 ? 'merkez' : 'yarıçap';
    case 'rect':
      return 'köşe';
    case 'line':
      return index === 0 ? 'başlangıç' : 'bitiş';
    default:
      return 'anchor';
  }
}

/**
 * Bir anahtar noktayı yeni konuma taşır. Geometri local uzayda kaldığı için
 * döndürülmüş objelerde nokta önce local uzaya çevrilmelidir.
 *
 * `loop` 0 ise birincil loop; >0 ise `extraLoops[loop-1]` (polygon) veya
 * `subpaths[loop]` (path).
 */
export function moveKeypoint(g: Geometry, index: number, target: Vec2, loop = 0): Geometry {
  if (loop > 0) {
    if (g.kind === 'polygon') {
      const extraLoops = (g.extraLoops ?? []).map((l, i) => {
        if (i !== loop - 1) return l;
        const next = l.map((p) => ({ ...p }));
        if (index < 0 || index >= next.length) return l;
        next[index] = target;
        return next;
      });
      return { ...g, extraLoops };
    }
    if (g.kind === 'path') {
      const subpaths = g.subpaths.map((sp, i) => {
        if (i !== loop) return sp;
        const points = sp.points.map((p) => ({ ...p }));
        if (index < 0 || index >= points.length) return sp;
        points[index] = target;
        return { points, closed: sp.closed };
      });
      return { ...g, subpaths };
    }
    return g;
  }

  switch (g.kind) {
    case 'rect': {
      const corners = [
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x + g.width, y: g.y + g.height },
        { x: g.x, y: g.y + g.height },
      ];
      const opposite = corners[(index + 2) % 4];
      const x = Math.min(opposite.x, target.x);
      const y = Math.min(opposite.y, target.y);
      return {
        kind: 'rect',
        x,
        y,
        width: Math.abs(target.x - opposite.x),
        height: Math.abs(target.y - opposite.y),
      };
    }
    case 'circle': {
      if (index === 0) return { ...g, cx: target.x, cy: target.y };
      const r = Math.hypot(target.x - g.cx, target.y - g.cy);
      return { ...g, r };
    }
    case 'ellipse': {
      if (index === 0) return { ...g, cx: target.x, cy: target.y };
      return { ...g, rx: Math.abs(target.x - g.cx) || g.rx, ry: Math.abs(target.y - g.cy) || g.ry };
    }
    case 'ring': {
      if (index === 0) return { ...g, cx: target.x, cy: target.y };
      const outerRadius = Math.max(Math.hypot(target.x - g.cx, target.y - g.cy), g.thickness + 1);
      return { ...g, outerRadius };
    }
    case 'line': {
      if (index === 0) return { ...g, x1: target.x, y1: target.y };
      return { ...g, x2: target.x, y2: target.y };
    }
    case 'polygon': {
      const points = g.keypoints.map((p) => ({ ...p }));
      if (index < 0 || index >= points.length) return g;
      points[index] = target;
      return { ...g, keypoints: points };
    }
    case 'path': {
      const subpaths = g.subpaths.map((sp) => ({ points: sp.points.map((p) => ({ ...p })), closed: sp.closed }));
      const sp = subpaths[0];
      if (!sp || index >= sp.points.length) return g;
      sp.points[index] = target;
      return { ...g, subpaths };
    }
  }
}

/** Loop içindeki bir noktayı siler (polygon/path). */
export function deleteKeypoint(g: Geometry, loop: number, index: number): Geometry {
  if (g.kind === 'polygon') {
    if (loop === 0) {
      if (g.keypoints.length <= 3) return g;
      return { ...g, keypoints: g.keypoints.filter((_, i) => i !== index) };
    }
    const extraLoops = (g.extraLoops ?? []).map((l) => l.filter((_, i) => i !== index)).filter((l) => l.length >= 3);
    return { ...g, extraLoops: extraLoops.length ? extraLoops : undefined };
  }
  if (g.kind === 'path') {
    const subpaths = g.subpaths
      .map((sp, i) =>
        i === loop ? { points: sp.points.filter((_, j) => j !== index), closed: sp.closed } : sp,
      )
      .filter((sp) => sp.points.length >= 2);
    return { ...g, subpaths };
  }
  return g;
}

/**
 * Path segmentine nokta ekler. `t` verilen segment üzerindeki konumdur (0..1).
 */
export function insertKeypoint(g: Geometry, loop: number, segment: number, t: number): Geometry {
  const lerp = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  if (g.kind === 'polygon') {
    if (loop === 0) {
      const pts = g.keypoints;
      if (pts.length < 2) return g;
      const a = pts[segment];
      const b = pts[(segment + 1) % pts.length];
      const next = [...pts];
      next.splice(segment + 1, 0, lerp(a, b));
      return { ...g, keypoints: next };
    }
    const extraLoops = (g.extraLoops ?? []).map((l, i) => {
      if (i !== loop - 1) return l;
      const a = l[segment];
      const b = l[(segment + 1) % l.length];
      const next = [...l];
      next.splice(segment + 1, 0, lerp(a, b));
      return next;
    });
    return { ...g, extraLoops };
  }

  if (g.kind === 'path') {
    const subpaths = g.subpaths.map((sp, i) => {
      if (i !== loop) return sp;
      const a = sp.points[segment];
      const b = sp.points[segment + 1];
      if (!b) return sp;
      const next = [...sp.points];
      next.splice(segment + 1, 0, lerp(a, b));
      return { points: next, closed: sp.closed };
    });
    return { ...g, subpaths };
  }

  return g;
}

/** Objenin local uzayında geometri sınırları ile x/y/width/height senkronu. */
export function syncObjectBox(g: Geometry): { x: number; y: number; width: number; height: number } {
  const b = geometryBounds(g);
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
