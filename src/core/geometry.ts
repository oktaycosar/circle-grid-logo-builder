import type {
  Geometry,
  Matrix,
  PathCommand,
  Rect,
  SubPath,
  Vec2,
} from './types.ts';
import { applyMatrix, invert, rectOfPoints, round } from './matrix.ts';

// --------------------------------------------------------------- yardımcılar

const KAPPA = 0.5522847498307936; // dairesel yay -> kübik bezier sabiti

function flattenArcPoints(cx: number, cy: number, rx: number, ry: number, segments: number, reverse = false): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const a = reverse ? -t : t;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

function arcSegments(rx: number, ry: number): number {
  const m = Math.max(Math.abs(rx), Math.abs(ry));
  return Math.max(48, Math.min(512, Math.ceil(m / 1.5)));
}

/** Geometriyi poligon/alt-yol temsiline indirger (boolean ve hit-test için). */
export function flattenGeometry(g: Geometry): SubPath[] {
  switch (g.kind) {
    case 'circle': {
      const r = Math.abs(g.r);
      return [{ points: flattenArcPoints(g.cx, g.cy, r, r, arcSegments(r, r)), closed: true }];
    }
    case 'ellipse': {
      return [
        {
          points: flattenArcPoints(g.cx, g.cy, Math.abs(g.rx), Math.abs(g.ry), arcSegments(g.rx, g.ry)),
          closed: true,
        },
      ];
    }
    case 'ring': {
      const outer = Math.abs(g.outerRadius);
      const inner = Math.max(0, outer - Math.abs(g.thickness));
      const outerRing: SubPath = {
        points: flattenArcPoints(g.cx, g.cy, outer, outer, arcSegments(outer, outer)),
        closed: true,
      };
      if (inner <= 0.001) return [outerRing];
      const innerRing: SubPath = {
        points: flattenArcPoints(g.cx, g.cy, inner, inner, arcSegments(inner, inner), true),
        closed: true,
      };
      return [outerRing, innerRing];
    }
    case 'rect': {
      const { x, y, width, height } = g;
      return [
        {
          points: [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
          closed: true,
        },
      ];
    }
    case 'line':
      return [
        {
          points: [
            { x: g.x1, y: g.y1 },
            { x: g.x2, y: g.y2 },
          ],
          closed: false,
        },
      ];
    case 'polygon': {
      const primary: SubPath = {
        points: g.keypoints.map((p) => ({ ...p })),
        closed: g.keypoints.length > 2,
      };
      const extras: SubPath[] = (g.extraLoops ?? []).map((loop) => ({
        points: loop.map((p) => ({ ...p })),
        closed: true,
      }));
      return [primary, ...extras];
    }
    case 'path':
      return g.subpaths.map((sp) => ({ points: sp.points.map((p) => ({ ...p })), closed: sp.closed }));
  }
}

/** Geometrinin düzenlenebilir köşe/anahtar noktaları. */
export function geometryKeypoints(g: Geometry): Vec2[] {
  switch (g.kind) {
    case 'circle':
      return circleCardinalPoints(g.cx, g.cy, Math.abs(g.r));
    case 'ellipse':
      return circleCardinalPoints(g.cx, g.cy, Math.abs(g.rx));
    case 'ring': {
      const outer = Math.abs(g.outerRadius);
      return outer <= 0.001 ? [] : circleCardinalPoints(g.cx, g.cy, outer);
    }
    case 'rect':
      return geometryKeypointsOfRect(g);
    case 'line':
      return [
        { x: g.x1, y: g.y1 },
        { x: g.x2, y: g.y2 },
      ];
    case 'polygon':
      return g.keypoints;
    case 'path':
      return g.subpaths.flatMap((sp) => sp.points);
  }
}

export function circleCardinalPoints(cx: number, cy: number, r: number): Vec2[] {
  return [
    { x: cx, y: cy },
    { x: cx + r, y: cy },
    { x: cx - r, y: cy },
    { x: cx, y: cy + r },
    { x: cx, y: cy - r },
  ];
}

function geometryKeypointsOfRect(g: { x: number; y: number; width: number; height: number }): Vec2[] {
  return [
    { x: g.x, y: g.y },
    { x: g.x + g.width, y: g.y },
    { x: g.x + g.width, y: g.y + g.height },
    { x: g.x, y: g.y + g.height },
  ];
}

export function geometryBounds(g: Geometry): Rect {
  switch (g.kind) {
    case 'circle': {
      const r = Math.abs(g.r);
      return { x: g.cx - r, y: g.cy - r, width: r * 2, height: r * 2 };
    }
    case 'ellipse': {
      const rx = Math.abs(g.rx);
      const ry = Math.abs(g.ry);
      return { x: g.cx - rx, y: g.cy - ry, width: rx * 2, height: ry * 2 };
    }
    case 'ring': {
      const outer = Math.abs(g.outerRadius);
      return { x: g.cx - outer, y: g.cy - outer, width: outer * 2, height: outer * 2 };
    }
    case 'rect':
      return { x: g.x, y: g.y, width: g.width, height: g.height };
    case 'line':
      return rectOfPoints([
        { x: g.x1, y: g.y1 },
        { x: g.x2, y: g.y2 },
      ]);
    case 'polygon':
      return rectOfPoints([...g.keypoints, ...(g.extraLoops ?? []).flat()]);
    case 'path':
      return rectOfPoints(g.subpaths.flatMap((sp) => sp.points));
  }
}

// ------------------------------------------------------------ dönüşümler

/** Geometrinin tüm tanımlayıcı noktalarını verilen fonksiyonla eşler. */
export function mapGeometryPoints(g: Geometry, fn: (p: Vec2) => Vec2): Geometry {
  switch (g.kind) {
    case 'circle': {
      const c = fn({ x: g.cx, y: g.cy });
      return { kind: 'circle', cx: c.x, cy: c.y, r: g.r };
    }
    case 'ellipse': {
      const c = fn({ x: g.cx, y: g.cy });
      return { kind: 'ellipse', cx: c.x, cy: c.y, rx: g.rx, ry: g.ry };
    }
    case 'ring': {
      const c = fn({ x: g.cx, y: g.cy });
      return { ...g, cx: c.x, cy: c.y };
    }
    case 'rect': {
      const c = fn({ x: g.x, y: g.y });
      return { ...g, x: c.x, y: c.y };
    }
    case 'line': {
      const a = fn({ x: g.x1, y: g.y1 });
      const b = fn({ x: g.x2, y: g.y2 });
      return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'polygon':
      return {
        kind: 'polygon',
        keypoints: g.keypoints.map(fn),
        extraLoops: g.extraLoops?.map((loop) => loop.map(fn)),
      };
    case 'path':
      return {
        kind: 'path',
        subpaths: g.subpaths.map((sp) => ({ points: sp.points.map(fn), closed: sp.closed })),
        connectors: g.connectors,
      };
  }
}

export function translateGeometry(g: Geometry, dx: number, dy: number): Geometry {
  return mapGeometryPoints(g, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Geometriyi fromRect'ten toRect'e doğrusal olarak yeniden eşler.
 * Geometri her zaman obje local space'inde eksen-hizalı tutulur; rotasyon
 * obje seviyesinde ayrı taşınır.
 */
export function remapGeometry(g: Geometry, fromRect: Rect, toRect: Rect): Geometry {
  const sx = fromRect.width === 0 ? 1 : toRect.width / fromRect.width;
  const sy = fromRect.height === 0 ? 1 : toRect.height / fromRect.height;
  const uniform = Math.sqrt(Math.abs(sx * sy)) || 1;
  const mapPoint = (p: Vec2): Vec2 => ({
    x: toRect.x + (p.x - fromRect.x) * sx,
    y: toRect.y + (p.y - fromRect.y) * sy,
  });

  switch (g.kind) {
    case 'circle': {
      const c = mapPoint({ x: g.cx, y: g.cy });
      return { kind: 'circle', cx: c.x, cy: c.y, r: Math.abs(g.r) * uniform };
    }
    case 'ellipse': {
      const c = mapPoint({ x: g.cx, y: g.cy });
      return { kind: 'ellipse', cx: c.x, cy: c.y, rx: Math.abs(g.rx) * Math.abs(sx), ry: Math.abs(g.ry) * Math.abs(sy) };
    }
    case 'ring': {
      const c = mapPoint({ x: g.cx, y: g.cy });
      return {
        kind: 'ring',
        cx: c.x,
        cy: c.y,
        outerRadius: Math.abs(g.outerRadius) * uniform,
        thickness: Math.abs(g.thickness) * uniform,
      };
    }
    case 'rect': {
      const a = mapPoint({ x: g.x, y: g.y });
      const b = mapPoint({ x: g.x + g.width, y: g.y + g.height });
      return {
        kind: 'rect',
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      };
    }
    case 'line': {
      const a = mapPoint({ x: g.x1, y: g.y1 });
      const b = mapPoint({ x: g.x2, y: g.y2 });
      return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'polygon':
      return {
        kind: 'polygon',
        keypoints: g.keypoints.map(mapPoint),
        extraLoops: g.extraLoops?.map((loop) => loop.map(mapPoint)),
      };
    case 'path':
      return {
        kind: 'path',
        subpaths: g.subpaths.map((sp) => ({ points: sp.points.map(mapPoint), closed: sp.closed })),
        connectors: g.connectors?.map((sp) => ({ points: sp.points.map(mapPoint), closed: sp.closed })),
      };
  }
}

/** Bir matrisi geometriye uygular. */
export function transformGeometry(g: Geometry, m: Matrix): Geometry {
  return mapGeometryPoints(g, (p) => applyMatrix(m, p));
}

// ------------------------------------------------------------ hit testing

export function pointInContours(contours: SubPath[], p: Vec2): boolean {
  let inside = false;
  for (const c of contours) {
    if (!c.closed || c.points.length < 3) continue;
    let winding = 0;
    for (let i = 0; i < c.points.length; i++) {
      const a = c.points[i];
      const b = c.points[(i + 1) % c.points.length];
      if (a.y <= p.y) {
        if (b.y > p.y && cross(a, b, p) > 0) winding++;
      } else if (b.y <= p.y && cross(a, b, p) < 0) {
        winding--;
      }
    }
    if (winding !== 0) inside = !inside; // even-odd: iç içe konturlar delik açar
  }
  return inside;
}

function cross(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

export function pointInGeometry(g: Geometry, p: Vec2, tolerance = 0): boolean {
  if (g.kind === 'circle') {
    const r = Math.abs(g.r) + tolerance;
    return (p.x - g.cx) ** 2 + (p.y - g.cy) ** 2 <= r * r;
  }
  if (g.kind === 'ellipse') {
    const rx = Math.abs(g.rx) + tolerance;
    const ry = Math.abs(g.ry) + tolerance;
    if (rx === 0 || ry === 0) return false;
    return ((p.x - g.cx) / rx) ** 2 + ((p.y - g.cy) / ry) ** 2 <= 1;
  }
  if (g.kind === 'ring') {
    const outer = Math.abs(g.outerRadius) + tolerance;
    const inner = Math.max(0, Math.abs(g.outerRadius) - Math.abs(g.thickness));
    const d = Math.hypot(p.x - g.cx, p.y - g.cy);
    return d <= outer && d >= inner;
  }
  if (g.kind === 'rect') {
    const b = geometryBounds(g);
    return (
      p.x >= b.x - tolerance &&
      p.x <= b.x + b.width + tolerance &&
      p.y >= b.y - tolerance &&
      p.y <= b.y + b.height + tolerance
    );
  }
  return pointInContours(flattenGeometry(g), p);
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Geometri konturuna en kısa mesafe (stroke hit-test / tolerant fill hit-test). */
export function distanceToGeometryOutline(g: Geometry, p: Vec2): number {
  const contours = flattenGeometry(g);
  let best = Infinity;
  for (const c of contours) {
    const pts = c.points;
    const n = c.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const d = distanceToSegment(p, pts[i], pts[(i + 1) % pts.length]);
      if (d < best) best = d;
    }
  }
  return best;
}

export function geometryHitTest(g: Geometry, p: Vec2, hasFill: boolean, strokeWidth: number): boolean {
  if (hasFill && pointInGeometry(g, p)) return true;
  const tol = Math.max(strokeWidth / 2, 4);
  return distanceToGeometryOutline(g, p) <= tol;
}

/** Geometriyi kapsayan rotate edilmiş dörtgen (marquee testi için). */
export function geometryRotatedCorners(g: Geometry, rotation: number): Vec2[] {
  const b = geometryBounds(g);
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  }));
}

// ------------------------------------------------------- SVG path üretimi

function num(n: number): string {
  return String(round(n, 3));
}

/**
 * Geometriyi TAM vektör SVG path verisine çevirir (kayıpsız).
 * circle/ellipse gerçek bezier yaylarıyla, ring çift yayla (delik) üretilir.
 */
export function geometryToSvgPathData(g: Geometry): string {
  switch (g.kind) {
    case 'circle':
      return ellipsePathData(g.cx, g.cy, Math.abs(g.r), Math.abs(g.r));
    case 'ellipse':
      return ellipsePathData(g.cx, g.cy, Math.abs(g.rx), Math.abs(g.ry));
    case 'ring': {
      const outer = Math.abs(g.outerRadius);
      const inner = Math.max(0, outer - Math.abs(g.thickness));
      const outerPath = ellipsePathData(g.cx, g.cy, outer, outer);
      if (inner <= 0.001) return outerPath;
      return `${outerPath} ${ellipsePathData(g.cx, g.cy, inner, inner)}`;
    }
    case 'rect':
      return `M ${num(g.x)} ${num(g.y)} L ${num(g.x + g.width)} ${num(g.y)} L ${num(g.x + g.width)} ${num(
        g.y + g.height,
      )} L ${num(g.x)} ${num(g.y + g.height)} Z`;
    case 'line':
      return `M ${num(g.x1)} ${num(g.y1)} L ${num(g.x2)} ${num(g.y2)}`;
    case 'polygon':
      return [g.keypoints, ...(g.extraLoops ?? [])]
        .map((loop) => smoothPolygonPathData(loop))
        .filter(Boolean)
        .join(' ');
    case 'path':
      return g.subpaths.map(subPathToPathData).filter(Boolean).join(' ');
  }
}

function ellipsePathData(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    `M ${num(cx - rx)} ${num(cy)}`,
    `C ${num(cx - rx)} ${num(cy - ky)} ${num(cx - kx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)}`,
    `C ${num(cx + kx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ky)} ${num(cx + rx)} ${num(cy)}`,
    `C ${num(cx + rx)} ${num(cy + ky)} ${num(cx + kx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)}`,
    `C ${num(cx - kx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ky)} ${num(cx - rx)} ${num(cy)}`,
    'Z',
  ].join(' ');
}

function subPathToPathData(sp: SubPath): string {
  if (sp.points.length === 0) return '';
  if (sp.points.length === 1) return `M ${num(sp.points[0].x)} ${num(sp.points[0].y)}`;
  const parts = [`M ${num(sp.points[0].x)} ${num(sp.points[0].y)}`];
  for (let i = 1; i < sp.points.length; i++) {
    parts.push(`L ${num(sp.points[i].x)} ${num(sp.points[i].y)}`);
  }
  if (sp.closed) parts.push('Z');
  return parts.join(' ');
}

// ---------------------------------------------- poligon -> yumuşak path

export interface SmoothOptions {
  /** Bu açıdan (derece) büyük dönüşler keskin köşe sayılır. */
  cornerAngle?: number;
  /** Eğri toleransı (artboard birimi). Nokta sadeleştirmede kullanılır. */
  tolerance?: number;
  /** Catmull-Rom teğet ölçeği. */
  tension?: number;
}

/**
 * Poligonu, eğrisel bölgeleri takip eden yumuşak bir path'e çevirir.
 *
 * İki aşamalı:
 *  1. Noktalar Douglas-Peucker ile sadeleştirilir — düz kenarlardaki yüzlerce
 *     fazla nokta atılır, eğriler `tolerance` kadar korunur.
 *  2. Ardışık nokta çiftleri için Catmull-Rom kübik üretilir; ancak kontrol
 *     tutamaçları doğru parçası üzerinde kalıyorsa daha kompakt olan `L`
 *     komutu yazılır. Böylece dikdörtgen gibi şekiller "M...L...Z" olur,
 *     daire yayları ise pürüzsüz bezier'larla temsil edilir.
 *
 * `cornerAngle` eşiğini geçen keskin dönüşler köşe olarak işaretlenir ve
 * yumuşatılmaz — logo konstrüksiyonundaki dik açılar bozulmaz.
 */
export function smoothPolygonPathData(keypoints: Vec2[], options: SmoothOptions = {}): string {
  const { cornerAngle = 32, tolerance = 0.12, tension = 1 } = options;

  const closed = keypoints.length > 2;
  if (keypoints.length < 2) return '';
  if (keypoints.length === 2) {
    return `M ${num(keypoints[0].x)} ${num(keypoints[0].y)} L ${num(keypoints[1].x)} ${num(keypoints[1].y)}`;
  }

  const pts = simplifyPolyline(keypoints, tolerance, closed);
  const n = pts.length;

  if (n < 3) {
    if (n === 2) {
      return `M ${num(pts[0].x)} ${num(pts[0].y)} L ${num(pts[1].x)} ${num(pts[1].y)}${closed ? ' Z' : ''}`;
    }
    return `M ${num(pts[0].x)} ${num(pts[0].y)}`;
  }

  const at = (i: number) => pts[((i % n) + n) % n];
  const isCorner: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      isCorner[i] = true;
      continue;
    }
    const prev = at(i - 1);
    const cur = at(i);
    const next = at(i + 1);
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    const turn = Math.abs(((a2 - a1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    isCorner[i] = (turn * 180) / Math.PI > cornerAngle;
  }

  const parts: string[] = [`M ${num(pts[0].x)} ${num(pts[0].y)}`];
  const segments = closed ? n : n - 1;

  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const c1 = isCorner[i]
      ? { ...p1 }
      : { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
    const c2 = isCorner[(i + 1) % n]
      ? { ...p2 }
      : { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };

    // Tutamaçlar doğru parçası üzerindeyse segment zaten düz: L daha kompakt.
    if (perpendicularDistance(c1, p1, p2) < 0.02 && perpendicularDistance(c2, p1, p2) < 0.02) {
      parts.push(`L ${num(p2.x)} ${num(p2.y)}`);
    } else {
      parts.push(`C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(p2.x)} ${num(p2.y)}`);
    }
  }

  if (closed) {
    // Kapanış Zaten `Z` ile çizilir: başlangıca dönen düz bir `L`
    // komutu varsa gereksizdir, atılır. Eğriyle kapanan yollar korunur.
    const last = parts[parts.length - 1];
    if (last.startsWith('L ')) {
      const coords = last.slice(2).split(' ').map(Number);
      if (close(coords[0], pts[0].x, 1e-6) && close(coords[1], pts[0].y, 1e-6)) {
        parts.pop();
      }
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

function close(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Kapalı/açık poligon sadeleştirme (Douglas-Peucker).
 * Kapalı loop'larda tohum kirişi en uzak iki nokta arasından seçilir; böylece
 * hiçbir bölge keyfi olarak "düz" sayılmaz.
 */
export function simplifyPolyline(points: Vec2[], tolerance: number, closed: boolean): Vec2[] {
  if (points.length <= 3) return points.map((p) => ({ ...p }));
  if (tolerance <= 0) return points.map((p) => ({ ...p }));

  if (!closed) {
    const keep = douglasPeucker(points, tolerance);
    return keep;
  }

  // Kapalı loop: en uzak iki noktayı bul, iki yayı ayrı ayrı sadeleştir.
  let bestA = 0;
  let bestB = 0;
  let bestDist = -1;
  const step = Math.max(1, Math.floor(points.length / 64));
  for (let i = 0; i < points.length; i += step) {
    for (let j = i + step; j < points.length; j += step) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > bestDist) {
        bestDist = d;
        bestA = i;
        bestB = j;
      }
    }
  }

  const arc1: Vec2[] = [];
  for (let i = bestA; i <= bestB; i++) arc1.push(points[i]);
  const arc2: Vec2[] = [];
  for (let i = bestB; i < points.length; i++) arc2.push(points[i]);
  for (let i = 0; i <= bestA; i++) arc2.push(points[i]);

  const simplified1 = douglasPeucker(arc1, tolerance);
  const simplified2 = douglasPeucker(arc2, tolerance);

  const result = [...simplified1.slice(0, -1), ...simplified2.slice(0, -1)];
  return result.length >= 3 ? result : points.map((p) => ({ ...p }));
}

function douglasPeucker(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}

// ------------------------------------------------------------ path komutları

export function pathDataToCommands(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokens = d.match(/[MLCQAHVZmlcqahvz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return commands;
  let i = 0;
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  const readNumber = (): number => Number(tokens[i++]);
  const readPoint = (base: Vec2): Vec2 => {
    const x = readNumber();
    const y = readNumber();
    return { x: x + base.x, y: y + base.y };
  };

  while (i < tokens.length) {
    const token = tokens[i++];
    const upper = token.toUpperCase();
    const relative = token !== upper;
    const base = relative ? current : { x: 0, y: 0 };

    switch (upper) {
      case 'M': {
        const p = readPoint(base);
        current = p;
        subpathStart = { ...p };
        commands.push({ cmd: 'M', x: p.x, y: p.y });
        break;
      }
      case 'L': {
        const p = readPoint(base);
        current = p;
        commands.push({ cmd: 'L', x: p.x, y: p.y });
        break;
      }
      case 'H': {
        const x = readNumber() + base.x;
        current = { x, y: current.y };
        commands.push({ cmd: 'L', x, y: current.y });
        break;
      }
      case 'V': {
        const y = readNumber() + base.y;
        current = { x: current.x, y };
        commands.push({ cmd: 'L', x: current.x, y });
        break;
      }
      case 'C': {
        const c1 = readPoint(base);
        const c2 = readPoint(base);
        const p = readPoint(base);
        current = p;
        commands.push({ cmd: 'C', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: p.x, y: p.y });
        break;
      }
      case 'Q': {
        const c1 = readPoint(base);
        const p = readPoint(base);
        current = p;
        commands.push({ cmd: 'Q', c1x: c1.x, c1y: c1.y, x: p.x, y: p.y });
        break;
      }
      case 'A': {
        const rx = readNumber();
        const ry = readNumber();
        const rotation = readNumber();
        const largeArc = readNumber() !== 0;
        const sweep = readNumber() !== 0;
        const p = readPoint(base);
        const start = { ...current };
        current = p;
        for (const cubic of arcToCubics(start, rx, ry, rotation, largeArc, sweep, p)) {
          commands.push(cubic);
        }
        break;
      }
      case 'Z':
        commands.push({ cmd: 'Z' });
        current = { ...subpathStart };
        break;
      default:
        break;
    }
  }
  return commands;
}

/**
 * SVG "A" komutunu kübik bezier'lere çevirir (endpoint -> center
 * parametrizasyonu, her parça en fazla 90°).
 */
function arcToCubics(
  start: Vec2,
  rxIn: number,
  ryIn: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  end: Vec2,
): PathCommand[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ cmd: 'L', x: end.x, y: end.y }];
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return [];

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (start.x - end.x) / 2;
  const dy2 = (start.y - end.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Yarıçaplar çok küçükse ölçekle
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && deltaTheta > 0) deltaTheta -= Math.PI * 2;
  if (sweep && deltaTheta < 0) deltaTheta += Math.PI * 2;

  const segments = Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2));
  const delta = deltaTheta / segments;
  const t = ((4 / 3) * Math.tan(delta / 4));

  const out: PathCommand[] = [];
  let theta = theta1;
  let px = start.x;
  let py = start.y;

  for (let s = 0; s < segments; s++) {
    const thetaNext = theta + delta;
    const cosT1 = Math.cos(theta);
    const sinT1 = Math.sin(theta);
    const cosT2 = Math.cos(thetaNext);
    const sinT2 = Math.sin(thetaNext);

    const x2 = cx + cosPhi * rx * cosT2 - sinPhi * ry * sinT2;
    const y2 = cy + sinPhi * rx * cosT2 + cosPhi * ry * sinT2;

    const d1x = -rx * cosPhi * sinT1 - ry * sinPhi * cosT1;
    const d1y = -rx * sinPhi * sinT1 + ry * cosPhi * cosT1;
    const d2x = -rx * cosPhi * sinT2 - ry * sinPhi * cosT2;
    const d2y = -rx * sinPhi * sinT2 + ry * cosPhi * cosT2;

    out.push({
      cmd: 'C',
      c1x: px + t * d1x,
      c1y: py + t * d1y,
      c2x: x2 - t * d2x,
      c2y: y2 - t * d2y,
      x: x2,
      y: y2,
    });

    theta = thetaNext;
    px = x2;
    py = y2;
  }

  return out;
}

/**
 * Path komutlarını alt yollara ayırır (import + node editing için).
 *
 * Eğriler, yaklaşık yay uzunluğuna göre UYARLAMALI örneklenir: kısa
 * segmentler az, uzun/eğri segmentler çok nokta alır. Böylece hem büyük
 * dairelerde görsel kayıp olmaz hem de nokta sayısı makul kalır.
 */
export function commandsToSubPaths(commands: PathCommand[]): SubPath[] {
  const subpaths: SubPath[] = [];
  let current: SubPath | null = null;
  const last = { x: 0, y: 0 };
  const push = (p: Vec2) => {
    if (!current) {
      current = { points: [], closed: false };
      subpaths.push(current);
    }
    current.points.push(p);
    last.x = p.x;
    last.y = p.y;
  };

  /** Yaklaşık uzunluktan örnek sayısı: ~3 birim/nokta, 8–96 arası. */
  const stepsFor = (approxLength: number): number =>
    Math.max(8, Math.min(96, Math.ceil(approxLength / 3)));

  const cubicAt = (
    start: Vec2,
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    end: Vec2,
    t: number,
  ): Vec2 => {
    const mt = 1 - t;
    return {
      x: mt ** 3 * start.x + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * end.x,
      y: mt ** 3 * start.y + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * end.y,
    };
  };

  const quadAt = (start: Vec2, c1x: number, c1y: number, end: Vec2, t: number): Vec2 => {
    const mt = 1 - t;
    return {
      x: mt ** 2 * start.x + 2 * mt * t * c1x + t ** 2 * end.x,
      y: mt ** 2 * start.y + 2 * mt * t * c1y + t ** 2 * end.y,
    };
  };

  const controlPolygonLength = (...pts: Vec2[]): number => {
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    return len;
  };

  for (const c of commands) {
    switch (c.cmd) {
      case 'M':
        current = { points: [{ x: c.x, y: c.y }], closed: false };
        subpaths.push(current);
        last.x = c.x;
        last.y = c.y;
        break;
      case 'L':
        push({ x: c.x, y: c.y });
        break;
      case 'C': {
        const start = { x: last.x, y: last.y };
        const end = { x: c.x, y: c.y };
        const steps = stepsFor(
          controlPolygonLength(start, { x: c.c1x, y: c.c1y }, { x: c.c2x, y: c.c2y }, end),
        );
        for (let s = 1; s <= steps; s++) push(cubicAt(start, c.c1x, c.c1y, c.c2x, c.c2y, end, s / steps));
        break;
      }
      case 'Q': {
        const start = { x: last.x, y: last.y };
        const end = { x: c.x, y: c.y };
        const steps = stepsFor(controlPolygonLength(start, { x: c.c1x, y: c.c1y }, end));
        for (let s = 1; s <= steps; s++) push(quadAt(start, c.c1x, c.c1y, end, s / steps));
        break;
      }
      case 'Z':
        if (current) current.closed = true;
        break;
    }
  }
  return subpaths.filter((sp) => sp.points.length > 1);
}

/** SVG dönüşüm metnini matrise çevirir (import için). */
export function parseSvgTransform(value: string | null): Matrix {
  if (!value) return [1, 0, 0, 1, 0, 0];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const name = match[1].toLowerCase();
    const args = match[2]
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => !Number.isNaN(n));
    let next: Matrix = [1, 0, 0, 1, 0, 0];
    if (name === 'matrix' && args.length >= 6) {
      next = args.slice(0, 6) as Matrix;
    } else if (name === 'translate') {
      next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    } else if (name === 'scale') {
      next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    } else if (name === 'rotate') {
      const rad = ((args[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      next = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    }
    m = multiplyRaw(m, next);
  }
  return m;
}

function multiplyRaw(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export { invert, KAPPA };
