import type { ArtboardObject, GridSettings, IsoSettings, SnapResult, Vec2 } from './types.ts';
import { geometryBounds, geometryKeypoints, flattenGeometry } from './geometry.ts';
import { isoSnapPoint } from './isometric.ts';

/**
 * Illustrator benzeri akıllı snap sistemi (spesifikasyon 5).
 *
 * Snap adayları:
 *  - grid kesişimleri ve grid çizgileri
 *  - artboard merkezi
 *  - diğer objelerin kenar / merkez / anahtar noktaları
 *
 * `tolerance` artboard birimindedir; ekran toleransı zoom ile bölünerek verilir
 * (6–10 ekran px hedefi).
 */

export interface SnapCandidate {
  point: Vec2;
  kind: 'grid' | 'intersection' | 'center' | 'edge' | 'midpoint' | 'keypoint';
  text: string;
}

export interface SnapContext {
  grid: GridSettings;
  /** İzometrik mod açıksa latis snap'i devreye girer. */
  iso?: IsoSettings;
  artboardSize: number;
  objects: ArtboardObject[];
  /** Snap'ten hariç tutulacak obje id'leri (sürüklenenler). */
  excludeIds: string[];
  /** Ekran px cinsinden snap toleransı (6–10 px hedefi). */
  screenTolerance: number;
}

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

export function gridStep(grid: GridSettings): number {
  return grid.size / Math.max(1, grid.divisions);
}

/** Objenin local uzayındaki bir noktayı artboard (dünya) uzayına taşır. */
export function objectPointToWorld(obj: ArtboardObject, p: Vec2): Vec2 {
  if (!obj.rotation) return p;
  const b = geometryBounds(obj.geometry);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rad = (obj.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Bir noktayı grid'e oturtur (en yakın alt bölme kesişimi). */
export function snapToGrid(p: Vec2, grid: GridSettings): Vec2 {
  const step = gridStep(grid);
  return { x: round(Math.round(p.x / step) * step), y: round(Math.round(p.y / step) * step) };
}

function lineSnap(value: number, grid: GridSettings, artboardSize: number): { value: number; kind: 'grid' | 'center' | 'edge' } {
  const step = gridStep(grid);
  const gridValue = Math.round(value / step) * step;
  const center = artboardSize / 2;
  const centerDist = Math.abs(value - center);
  const gridDist = Math.abs(value - gridValue);
  if (centerDist <= gridDist) return { value: center, kind: 'center' };
  return { value: round(gridValue), kind: 'grid' };
}

function nearestGridLine(value: number, grid: GridSettings): number {
  const step = gridStep(grid);
  return round(Math.round(value / step) * step);
}

export function gridLines(grid: GridSettings, artboardSize: number): { x: number[]; y: number[] } {
  const step = gridStep(grid);
  const xs: number[] = [];
  const ys: number[] = [];
  const center = artboardSize / 2;
  let i = 0;
  // Merkezden dışa doğru simetrik üretim — grid artboard merkezine göre simetrik.
  while (center + i * step <= artboardSize + 1e-6) {
    xs.push(round(center + i * step));
    ys.push(round(center + i * step));
    if (i !== 0) {
      xs.push(round(center - i * step));
      ys.push(round(center - i * step));
    }
    i += 1;
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return { x: dedupe(xs), y: dedupe(ys) };
}

function dedupe(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!out.length || Math.abs(out[out.length - 1] - v) > 1e-6) out.push(v);
  }
  return out;
}

/** Objenin snap aday noktaları (artboard/dünya uzayında, rotasyon uygulanmış). */
export function objectSnapPoints(obj: ArtboardObject): { point: Vec2; kind: SnapCandidate['kind']; text: string }[] {
  const out: { point: Vec2; kind: SnapCandidate['kind']; text: string }[] = [];
  const b = geometryBounds(obj.geometry);
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const world = (p: Vec2) => objectPointToWorld(obj, p);

  const corners: Vec2[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
  corners.forEach((c, i) => out.push({ point: world(c), kind: 'edge', text: `köşe ${i + 1}` }));
  out.push({ point: world({ x: center.x, y: b.y }), kind: 'midpoint', text: 'üst orta' });
  out.push({ point: world({ x: center.x, y: b.y + b.height }), kind: 'midpoint', text: 'alt orta' });
  out.push({ point: world({ x: b.x, y: center.y }), kind: 'midpoint', text: 'sol orta' });
  out.push({ point: world({ x: b.x + b.width, y: center.y }), kind: 'midpoint', text: 'sağ orta' });
  out.push({ point: world(center), kind: 'center', text: 'merkez' });

  const seen = new Set<string>();
  for (const kp of geometryKeypoints(obj.geometry)) {
    const w = world(kp);
    const key = `${Math.round(w.x * 10)}|${Math.round(w.y * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ point: w, kind: 'keypoint', text: 'anchor' });
  }
  return out;
}

export interface SnapRequest {
  /** Sürüklenen referans noktaları (hareket öncesi, dünya uzayı). */
  probes: Vec2[];
  /** Uygulanmak istenen ham hareket. */
  delta: Vec2;
  context: SnapContext;
}

export interface SnapOutcome {
  /** Snap uygulanmış nihai hareket. */
  delta: Vec2;
  /** Snap sonrası birincil referans noktasının konumu. */
  point: Vec2;
  result: SnapResult;
}

/**
 * Sürükleme için snap çözümü.
 *
 * Snap, X ve Y EKSENLERİNDEN BAĞIMSIZ çözülür. Bu Illustrator davranışıdır ve
 * çok daha öngörülebilirdir: bir kutunun sol kenarı bir grid çizgisine
 * otururken merkezi dikeyde artboard merkezine kilitlenebilir. Önceki
 * "en yakın nokta" yaklaşımı tek eksende hizalamayı engelliyordu.
 *
 * Aday sınıfları (aynı sınıf içinde en yakın kazanır):
 *   0 — grid çizgisi ve artboard merkez çizgisi (güçlü referanslar)
 *   1 — diğer objelerin kenar / merkez / anchor koordinatları
 *
 * Her iki eksen de grid çizgisine oturduğunda sonuç kendiliğinden bir grid
 * KESİŞİMİ olur; ayrı bir "kesişim" adayına gerek yoktur.
 */
export function resolveSnap(request: SnapRequest): SnapOutcome {
  const { probes, delta, context } = request;
  const { grid, objects, artboardSize, excludeIds, screenTolerance } = context;
  const iso = context.iso;
  const isoActive = Boolean(iso?.enabled && iso.snap);
  const excluded = new Set(excludeIds);
  const gridOn = grid.enabled && grid.snap && !isoActive;
  const lines = gridOn ? gridLines(grid, artboardSize) : { x: [], y: [] };
  const center = artboardSize / 2;
  const tolerance = Math.max(screenTolerance, 0.5);

  const applied = probes.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
  const primary = applied[0] ?? { x: 0, y: 0 };

  // Diğer objelerin hizalanabilir X / Y değerleri (kenar, merkez, anchor).
  const axisX: { value: number; text: string }[] = [];
  const axisY: { value: number; text: string }[] = [];
  if (!excluded.size || objects.length) {
    for (const obj of objects) {
      if (excluded.has(obj.id) || !obj.visible) continue;
      axisX.push({ value: obj.x, text: `${obj.name} sol` });
      axisX.push({ value: obj.x + obj.width / 2, text: `${obj.name} merkez` });
      axisX.push({ value: obj.x + obj.width, text: `${obj.name} sağ` });
      axisY.push({ value: obj.y, text: `${obj.name} üst` });
      axisY.push({ value: obj.y + obj.height / 2, text: `${obj.name} merkez` });
      axisY.push({ value: obj.y + obj.height, text: `${obj.name} alt` });
    }
  }

  interface AxisHit {
    probeValue: number;
    target: number;
    text: string;
    tier: number;
    distance: number;
  }

  const bestOnAxis = (axis: 'x' | 'y'): AxisHit | null => {
    let best: AxisHit | null = null;
    const consider = (probeValue: number, target: number, text: string, tier: number) => {
      const distance = Math.abs(target - probeValue);
      if (distance > tolerance) return;
      if (!best || tier < best.tier || (tier === best.tier && distance < best.distance)) {
        best = { probeValue, target, text, tier, distance };
      }
    };

    const gridAxisLines = axis === 'x' ? lines.x : lines.y;
    const objectAxis = axis === 'x' ? axisX : axisY;

    for (const p of applied) {
      const v = axis === 'x' ? p.x : p.y;

      if (gridOn) {
        const line = nearestWithin(v, gridAxisLines, tolerance);
        if (line !== null) consider(v, line, 'grid', 0);
      }
      if (Math.abs(v - center) <= tolerance) consider(v, center, 'center', 0);

      for (const cand of objectAxis) {
        consider(v, cand.value, cand.text, 1);
      }
    }
    return best;
  };

  const hitX = bestOnAxis('x');
  const hitY = bestOnAxis('y');

  // İzometrik latis snap'i: üç yönlü ızgaranın düğüm noktalarına oturtur.
  // Latis, düz grid'in yerini alır; obje hizalamaları eksen bazında hâlâ
  // daha yakınsa onlar kazanır.
  let isoHit: { probe: Vec2; point: Vec2; distance: number } | null = null;
  if (isoActive && iso) {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const p of applied) {
      const snapped = isoSnapPoint(p, iso);
      if (snapped.distance < bestDistance) {
        bestDistance = snapped.distance;
        isoHit = { probe: p, point: snapped.point, distance: snapped.distance };
      }
    }
    if (bestDistance > tolerance) isoHit = null;
  }

  if (!hitX && !hitY && !isoHit) {
    return { delta, point: primary, result: { point: primary, labels: [], guides: [] } };
  }

  const isoShiftX = isoHit ? isoHit.point.x - isoHit.probe.x : null;
  const isoShiftY = isoHit ? isoHit.point.y - isoHit.probe.y : null;

  const pickAxis = (axisHit: typeof hitX, isoShift: number | null): number | null => {
    const objectShift = axisHit ? axisHit.target - axisHit.probeValue : null;
    if (isoShift === null) return objectShift;
    if (objectShift === null) return isoShift;
    return Math.abs(objectShift) < Math.abs(isoShift) ? objectShift : isoShift;
  };

  const shiftX = pickAxis(hitX, isoShiftX);
  const shiftY = pickAxis(hitY, isoShiftY);

  if (shiftX === null && shiftY === null) {
    return { delta, point: primary, result: { point: primary, labels: [], guides: [] } };
  }

  const snappedDelta = { x: delta.x + (shiftX ?? 0), y: delta.y + (shiftY ?? 0) };
  const snappedPrimary = { x: primary.x + (shiftX ?? 0), y: primary.y + (shiftY ?? 0) };

  const labels: SnapResult['labels'] = [];
  const guides: SnapResult['guides'] = [];

  if (shiftX !== null) {
    const fromIso = isoShiftX !== null && shiftX === isoShiftX;
    labels.push({ x: snappedPrimary.x, y: snappedPrimary.y, text: fromIso ? 'iso grid' : (hitX?.text ?? 'grid') });
    guides.push({ x1: snappedPrimary.x, y1: 0, x2: snappedPrimary.x, y2: artboardSize });
  }
  if (shiftY !== null) {
    const fromIso = isoShiftY !== null && shiftY === isoShiftY;
    labels.push({ x: snappedPrimary.x, y: snappedPrimary.y, text: fromIso ? 'iso grid' : (hitY?.text ?? 'grid') });
    guides.push({ x1: 0, y1: snappedPrimary.y, x2: artboardSize, y2: snappedPrimary.y });
  }

  return {
    delta: snappedDelta,
    point: snappedPrimary,
    result: { point: snappedPrimary, labels, guides },
  };
}

function nearestWithin(value: number, lines: number[], tolerance: number): number | null {
  let best: number | null = null;
  let bestDist = tolerance;
  for (const l of lines) {
    const d = Math.abs(value - l);
    if (d < bestDist) {
      bestDist = d;
      best = l;
    }
  }
  return best;
}

/** Çizim sırasında bir noktayı grid'e oturtur (rect/line/pen). */
export function snapRect(p: Vec2, grid: GridSettings): Vec2 {
  return grid.snap ? snapToGrid(p, grid) : p;
}

export function snapLineCoord(value: number, grid: GridSettings): number {
  return grid.snap ? nearestGridLine(value, grid) : value;
}

export function snapValue(value: number, grid: GridSettings, artboardSize: number): number {
  return grid.snap ? lineSnap(value, grid, artboardSize).value : value;
}

/** Bir kutunun snap referans noktaları: merkez + 4 köşe (rotasyon uygulanmış). */
export function bboxProbes(box: { x: number; y: number; width: number; height: number }, rotation = 0): Vec2[] {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const raw = [
    { x: cx, y: cy },
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  if (!rotation) return raw;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return raw.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

export { flattenGeometry };
