/**
 * Gerçek vektör boolean işlemleri (Pathfinder).
 *
 * Yöntem: kesişim tabanlı kenar parçalama + parça seçimi + zincirleme.
 *  1. Her iki kontur setinin kenarları birbirleriyle kesiştirilir.
 *  2. Kenarlar kesişim noktalarından parçalara bölünür.
 *  3. Her parçanın orta noktası "diğer şeklin içinde mi?" diye sınıflandırılır.
 *  4. İşleme göre parçalar seçilir (union / intersect / subtract / exclude).
 *  5. Parçalar uç noktalarından birbirine eklenerek kapalı loop'lar kurulur.
 *
 * Sonuç poligonal bir vektördür; `extraLoops` ile delikler korunur ve
 * render sırasında köşe-duyarlı Catmull-Rom ile yumuşatılır — böylece
 * daire yayları görsel olarak pürüzsüz kalır.
 */

import type { Geometry, SubPath, Vec2 } from './types.ts';
import { distanceToSegment, flattenGeometry, pointInContours } from './geometry.ts';

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';

const EPS = 1e-6;
const DEDUPE = 1e-4;
/** Degenerasyon kırıcı: tam çakışan kenarları gerçek kesişime çevirir. */
const NUDGE = 1e-6;
/** Bu uzunluktan kısa kenar parçaları sayısal gürültü sayılır ve atılır. */
const MIN_FRAGMENT = 1e-3;

export interface BooleanResult {
  /** Sonuç loop'lar. Delik/ayrık parçalar dahil. */
  loops: Vec2[][];
}

// ------------------------------------------------------------------ konturlar

/** Kapalı bir halkadan ardışık tekrar eden noktaları temizler. */
function dedupeRing(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-9
  ) {
    out.pop();
  }
  return out;
}

function signedArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Deterministik mikro-pertürbasyon (degenerasyon kırıcı). */
function perturb(points: Vec2[], seed: number): Vec2[] {
  return points.map((p, i) => {
    const a = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const b = Math.sin((i + 1) * 39.3467 + seed * 11.135) * 24634.6345;
    return { x: p.x + (a - Math.floor(a) - 0.5) * NUDGE, y: p.y + (b - Math.floor(b) - 0.5) * NUDGE };
  });
}

function prepareContours(contours: SubPath[], seed: number): Vec2[][] {
  return contours
    .filter((c) => c.closed && c.points.length >= 3)
    .map((c) => perturb(dedupeRing(c.points), seed))
    .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-6);
}

// ---------------------------------------------------------------- kesişimler

/**
 * İki doğru parçasının kesişimi. Paralel/çakışık kenarlar için null döner;
 * çağıran taraf `NUDGE` pertürbasyonu sayesinde bu durumdan kaçınır.
 */
function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { t: number; u: number; p: Vec2 } | null {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null; // paralel / çakışık
  const qp = { x: b1.x - a1.x, y: b1.y - a1.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, u, p: { x: a1.x + r.x * t, y: a1.y + r.y * t } };
}

// ------------------------------------------------------------- parçalama

interface Fragment {
  a: Vec2;
  b: Vec2;
  mid: Vec2;
  fromA: boolean;
  /** Parça, diğer şeklin sınırı üzerinde mi (çakışan kenar)? */
  coincident?: boolean;
  /** Çakışan parçada iki şeklin iç bölgeleri aynı tarafta mı? */
  sameSide?: boolean;
}

interface SplitOutput {
  fragments: Fragment[];
  intersections: number;
  /** Kesilen kenar sayısı (fragment sayısı > kenar sayısı ise kesişim var). */
  cutEdges: number;
  /** En az bir çakışan (collinear) kenar bulundu mu? */
  collinear: boolean;
}

function splitIntoFragments(rings: Vec2[][], other: Vec2[][], fromA: boolean): SplitOutput {
  const fragments: Fragment[] = [];
  let intersections = 0;
  let cutEdges = 0;
  let collinear = false;

  for (const ring of rings) {
    for (let ei = 0; ei < ring.length; ei++) {
      const a1 = ring[ei];
      const a2 = ring[(ei + 1) % ring.length];
      const ts: { t: number; p: Vec2 }[] = [];
      for (const oRing of other) {
        for (let ej = 0; ej < oRing.length; ej++) {
          const b1 = oRing[ej];
          const b2 = oRing[(ej + 1) % oRing.length];

          // ÇAKIŞAN KENARLAR ÖNCE KONTROL EDİLİR.
          // Neredeyse çakışan (paralel) kenarlarda `segmentIntersection`
          // sayısal gürültüden dolayı sahte kesişimler üretebilir; bu da
          // kenarların rastgele noktalardan bölünmesine ve iç içe şekillerde
          // deliğin kaybolmasına yol açar. Çakışıksa kesişim aramayız.
          if (nearlyCollinear(a1, a2, b1, b2)) {
            collinear = true;
            for (const t of collinearOverlapParams(a1, a2, b1, b2)) {
              if (t > 1e-9 && t < 1 - 1e-9) {
                ts.push({
                  t,
                  p: { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t },
                });
              }
            }
            continue;
          }

          const hit = segmentIntersection(a1, a2, b1, b2);
          // Sadece kenarın İÇ kısmındaki kesişimler kenarı böler.
          if (hit && hit.t > 1e-9 && hit.t < 1 - 1e-9) {
            ts.push({ t: hit.t, p: hit.p });
          }
        }
      }
      ts.sort((x, y) => x.t - y.t);
      const edgeLength = Math.hypot(a2.x - a1.x, a2.y - a1.y);
      // Kenarın uçlarına çakışan (dolayısıyla sıfır uzunlukta parça üretecek)
      // bölme noktaları atılır; aksi halde sayısal gürültü zincirlemeyi bozar.
      const minParam = edgeLength > 0 ? MIN_FRAGMENT / edgeLength : 0;

      const uniqueTs: { t: number; p: Vec2 }[] = [];
      for (const s of ts) {
        if (s.t <= minParam || s.t >= 1 - minParam) continue;
        if (uniqueTs.some((u) => Math.hypot(u.p.x - s.p.x, u.p.y - s.p.y) < DEDUPE)) continue;
        uniqueTs.push(s);
      }

      if (uniqueTs.length) {
        cutEdges++;
        intersections += uniqueTs.length;
      }
      let prev = { t: 0, p: a1 };
      const nodes = [...uniqueTs, { t: 1, p: a2 }];
      for (const node of nodes) {
        if (node.t - prev.t > 1e-12) {
          const a = prev.p;
          const b = node.p;
          if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_FRAGMENT) {
            fragments.push({
              a,
              b,
              mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
              fromA,
            });
          }
        }
        prev = node;
      }
    }
  }
  return { fragments, intersections, cutEdges, collinear };
}

/**
 * İki kenar birbirine yeterince paralel ve aynı doğru üzerinde mi?
 * Eşik mutlak (artboard birimi): boolean girdileri `NUDGE` ile
 * mikro-pertürbe edildiğinden tasarımda çakışan kenarlar pratikte ~1e-6
 * birim kayar; 1e-3 eşiği bunu yakalar ama gerçekten farklı geometriyi
 * etkilemez (1000 birimlik artboard'da binde bir birim).
 */
const COLLINEAR_EPS = 1e-3;

function nearlyCollinear(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const sideB1 = Math.abs(dy * (b1.x - a1.x) - dx * (b1.y - a1.y)) / len;
  const sideB2 = Math.abs(dy * (b2.x - a1.x) - dx * (b2.y - a1.y)) / len;
  return sideB1 <= COLLINEAR_EPS && sideB2 <= COLLINEAR_EPS;
}

/**
 * `segment (a1,a2)` ile `segment (b1,b2)` çakışıyorsa, çakışma aralığının
 * uçlarının `a1a2` üzerindeki parametrelerini döndürür.
 */
function collinearOverlapParams(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number[] {
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];

  const lenSq = len * len;
  const t1 = ((b1.x - a1.x) * dx + (b1.y - a1.y) * dy) / lenSq;
  const t2 = ((b2.x - a1.x) * dx + (b2.y - a1.y) * dy) / lenSq;
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (hi <= 0 || lo >= 1) return [];

  const out: number[] = [];
  if (lo > 0 && lo < 1) out.push(lo);
  if (hi > 0 && hi < 1) out.push(hi);
  return out;
}

// -------------------------------------------------------------- zincirleme

function keyOf(p: Vec2): string {
  return `${Math.round(p.x * 1e4)}|${Math.round(p.y * 1e4)}`;
}

/**
 * Parçaları uç noktalarından birbirine ekleyerek kapalı loop'lar kurar.
 *
 * Zincirleme YÖNSÜZDÜR: bir parça, ucundan bağlanıyorsa ters yönde de
 * kullanılabilir. Bu, karışık yönlü parça listelerinde (ör. bir deliğin
 * sınırı ile gövdenin sınırının birleştiği durumlarda) doğru loop üretir.
 * Aynı noktadan birden fazla seçenek varsa en düz devam tercih edilir.
 */
function chainFragments(fragments: Fragment[]): Vec2[][] {
  const byPoint = new Map<string, number[]>();
  const add = (key: string, index: number) => {
    const list = byPoint.get(key);
    if (list) list.push(index);
    else byPoint.set(key, [index]);
  };
  fragments.forEach((f, i) => {
    add(keyOf(f.a), i);
    add(keyOf(f.b), i);
  });

  const used = new Array<boolean>(fragments.length).fill(false);
  const loops: Vec2[][] = [];

  const pickNext = (endKey: string, current: Vec2, incomingAngle: number): number => {
    const candidates = byPoint.get(endKey);
    if (!candidates) return -1;
    let best = -1;
    let bestScore = -Infinity;
    for (const index of candidates) {
      if (used[index]) continue;
      const f = fragments[index];
      const fromA = keyOf(f.a) === endKey;
      const other = fromA ? f.b : f.a;
      const outAngle = Math.atan2(other.y - current.y, other.x - current.x);
      // 0 = düz devam
      let delta = Math.abs(((outAngle - incomingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      delta = Math.PI - delta;
      const score = -delta;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    return best;
  };

  for (let seed = 0; seed < fragments.length; seed++) {
    if (used[seed]) continue;
    const first = fragments[seed];
    used[seed] = true;

    const loop: Vec2[] = [{ ...first.a }, { ...first.b }];
    const startKey = keyOf(first.a);
    let endKey = keyOf(first.b);
    let current = first.b;
    let angle = Math.atan2(first.b.y - first.a.y, first.b.x - first.a.x);
    let guard = 0;

    while (endKey !== startKey && guard++ < fragments.length * 4) {
      const next = pickNext(endKey, current, angle);
      if (next === -1) break;
      used[next] = true;
      const f = fragments[next];
      const other = keyOf(f.a) === endKey ? f.b : f.a;
      angle = Math.atan2(other.y - current.y, other.x - current.x);
      loop.push({ ...other });
      current = other;
      endKey = keyOf(other);
    }

    if (loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-6) loops.push(loop);
  }

  return loops;
}

// -------------------------------------------------------- sadeleştirme

/** Douglas-Peucker — gereksiz noktaları atar, eğri toleransı korur. */
export function simplifyLoop(points: Vec2[], tolerance = 0.12): Vec2[] {
  if (points.length <= 3) return points;
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
  return points.filter((_, i) => keep[i]);
}

function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

// ------------------------------------------------------------------- API

export interface BooleanPairResult {
  loops: Vec2[][];
}

/**
 * İki geometri arasında gerçek boolean işlemi.
 * Sonuç loop listesi döner (ilk loop birincil, kalanlar delik/ayrık parça).
 */
export function booleanGeometry(a: Geometry, b: Geometry, op: BooleanOp): Vec2[][] {
  const rawA = flattenGeometry(a);
  const rawB = flattenGeometry(b);
  const A = prepareContours(rawA, 1.7);
  const B = prepareContours(rawB, 3.9);

  if (op === 'divide') {
    const both = booleanRings(A, B, 'intersect');
    const onlyA = booleanRings(A, B, 'subtract');
    const onlyB = booleanRings(B, A, 'subtract');
    return [...both, ...onlyA, ...onlyB];
  }

  if (op === 'exclude') {
    const aMinusB = booleanRings(A, B, 'subtract');
    const bMinusA = booleanRings(B, A, 'subtract');
    return [...aMinusB, ...bMinusA];
  }

  return booleanRings(A, B, op as 'unite' | 'subtract' | 'intersect');
}

function booleanRings(A: Vec2[][], B: Vec2[][], op: 'unite' | 'subtract' | 'intersect'): Vec2[][] {
  if (!A.length) {
    if (op === 'unite') return B.map((r) => r.map((p) => ({ ...p })));
    if (op === 'subtract') return [];
    return []; // intersect
  }
  if (!B.length) {
    if (op === 'intersect') return [];
    return A.map((r) => r.map((p) => ({ ...p })));
  }

  const splitA = splitIntoFragments(A, B, true);
  const splitB = splitIntoFragments(B, A, false);
  const fragA = splitA.fragments;
  const fragB = splitB.fragments;

  const anyInteraction =
    splitA.intersections > 0 || splitB.intersections > 0 || splitA.collinear || splitB.collinear;
  if (!anyInteraction) {
    return noIntersectionFallback(A, B, op);
  }

  const inB = (p: Vec2) => pointInContours(toSubPaths(B), p);
  const inA = (p: Vec2) => pointInContours(toSubPaths(A), p);

  // Çakışan kenar parçalarını sınıflandır.
  for (const f of fragA) {
    if (!liesOnBoundary(B, f)) {
      f.coincident = false;
      continue;
    }
    f.coincident = true;
    f.sameSide = interiorsOnSameSide(f, inA, inB);
  }
  for (const f of fragB) {
    if (!liesOnBoundary(A, f)) {
      f.coincident = false;
      continue;
    }
    f.coincident = true;
    f.sameSide = interiorsOnSameSide(f, inA, inB);
  }

  // Çakışan kenarların seçimi:
  //   karşı taraf (şekiller bitişik)  → unite/intersect'te iç duvardır (atılır),
  //                                     subtract'te A'nın sınırıdır (korunur)
  //   aynı taraf  (sınırlar örtüşür)  → unite/intersect'te bir kez alınır,
  //                                     subtract'te tamamen atılır
  const sharedSame = fragA.filter((f) => f.coincident && f.sameSide);
  const sharedOpposite = fragA.filter((f) => f.coincident && !f.sameSide);

  let selected: Fragment[];
  switch (op) {
    case 'unite':
      selected = [
        ...sharedSame,
        ...fragA.filter((f) => !f.coincident && !safeInside(inB, f)),
        ...fragB.filter((f) => !f.coincident && !safeInside(inA, f)),
      ];
      break;
    case 'intersect':
      selected = [
        ...sharedSame,
        ...fragA.filter((f) => !f.coincident && safeInside(inB, f)),
        ...fragB.filter((f) => !f.coincident && safeInside(inA, f)),
      ];
      break;
    case 'subtract':
      // A'nın B dışında kalan parçaları + B'nin A içinde kalan parçalarının tersi
      selected = [
        ...sharedOpposite,
        ...fragA.filter((f) => !f.coincident && !safeInside(inB, f)),
        ...fragB
          .filter((f) => !f.coincident && safeInside(inA, f))
          .map((f) => ({ ...f, a: f.b, b: f.a })),
      ];
      break;
  }

  // Etkileşim varken boş seçim, gerçekten boş bir sonuç demektir
  // (ör. bitişik şekillerin kesişimi ya da aynı sınırların farkı).
  if (!selected.length) return [];

  const loops = chainFragments(selected)
    .map((loop) => simplifyLoop(loop))
    .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-6);
  if (loops.length) return loops;

  // Parçalar kapalı loop oluşturamadıysa (sayısal uç durum) içerme ilişkisine düş.
  return noIntersectionFallback(A, B, op);
}

/**
 * Çakışan bir kenar parçasında iki şeklin İÇ bölgeleri aynı tarafta mı?
 *
 * Aynı taraf  → sınırlar üst üste (şekiller aynı yöne bakıyor)
 * Karşı taraf → şekiller bitişik; kenar iç duvardır
 */
function interiorsOnSameSide(frag: Fragment, inA: (p: Vec2) => boolean, inB: (p: Vec2) => boolean): boolean {
  const dx = frag.b.x - frag.a.x;
  const dy = frag.b.y - frag.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = Math.max(0.05, Math.min(0.5, len * 0.25));

  const plus = { x: frag.mid.x + nx * offset, y: frag.mid.y + ny * offset };
  const minus = { x: frag.mid.x - nx * offset, y: frag.mid.y - ny * offset };

  return (inA(plus) && inB(plus)) || (inA(minus) && inB(minus));
}

/** Parça tamamen `rings` sınırı üzerinde mi? */
function liesOnBoundary(rings: Vec2[][], frag: Fragment): boolean {
  const onBoundary = (p: Vec2): boolean => {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (distanceToSegment(p, a, b) <= COLLINEAR_EPS * 2) return true;
      }
    }
    return false;
  };
  return onBoundary(frag.a) && onBoundary(frag.b) && onBoundary(frag.mid);
}

function toSubPaths(rings: Vec2[][]): SubPath[] {
  return rings.map((r) => ({ points: r, closed: true }));
}

/**
 * Parça orta noktasının sınır üzerinde kalması ihtimaline karşı birkaç aday
 * nokta dener; hiçbiri kesin sonuç vermezse normal yönünde çok küçük
 * kaydırmayla tekrar dener. Çakışan kenar parçaları buraya gelmez
 * (bkz. `liesOnBoundary`), bu yüzden sonuç kararlıdır.
 */
function safeInside(test: (p: Vec2) => boolean, frag: Fragment): boolean {
  if (test(frag.mid)) return true;

  const dx = frag.b.x - frag.a.x;
  const dy = frag.b.y - frag.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  // Orta nokta tam sınır üzerindeyse normal yönünde iki tarafa da bak:
  // "bir taraf içeride" yeterlidir (parça sınıra teğet demektir).
  for (const off of [1e-3, -1e-3, 1e-2, -1e-2]) {
    if (test({ x: frag.mid.x + nx * off, y: frag.mid.y + ny * off })) return true;
  }
  return false;
}

/**
 * Hiç KESİŞİM bulunamadığında doğru sonucu üretir.
 *
 * İçerme testi tek bir örnek nokta ile yapılamaz: örneğin A'nın sınır kutusu
 * merkezi B'nin içinde olabilir ama A, B'nin içinde olmayabilir. Bu yüzden
 * "tüm köşeler içeride mi?" testi kullanılır. Ayrıca B'nin bir kenarı A'nın
 * kenarıyla tam çakışıyorsa (klasik D harfi göbeği durumu) kesişim algoritması
 * hiç kesişim bulamaz; köşe tabanlı test bu durumda da doğru karar verir.
 */
function noIntersectionFallback(A: Vec2[][], B: Vec2[][], op: 'unite' | 'subtract' | 'intersect'): Vec2[][] {
  const bInsideA = B.length > 0 && A.length > 0 && allVerticesInside(B, A);
  const aInsideB = A.length > 0 && B.length > 0 && allVerticesInside(A, B);

  const clone = (rings: Vec2[][]) => rings.map((r) => r.map((p) => ({ ...p })));
  const reversed = (rings: Vec2[][]) => rings.map((r) => [...r].reverse().map((p) => ({ ...p })));

  // Sınırları çakışan (pratikte aynı) şekiller
  if (aInsideB && bInsideA) {
    switch (op) {
      case 'unite':
      case 'intersect':
        return clone(A);
      case 'subtract':
        return [];
    }
  }

  if (bInsideA) {
    switch (op) {
      case 'unite':
        return clone(A);
      case 'intersect':
        return clone(B);
      case 'subtract':
        // A'nın içinden B oyulur: gerçek delik
        return [...clone(A), ...reversed(B)];
    }
  }

  if (aInsideB) {
    switch (op) {
      case 'unite':
        return clone(B);
      case 'intersect':
        return clone(A);
      case 'subtract':
        return [...clone(B), ...reversed(A)];
    }
  }

  // Ayrık şekiller
  switch (op) {
    case 'unite':
      return [...clone(A), ...clone(B)];
    case 'intersect':
      return [];
    case 'subtract':
      return clone(A);
  }
}

/** `inner` halkalarının TÜM köşeleri `outer` halkalarının içinde mi? */
function allVerticesInside(inner: Vec2[][], outer: Vec2[][]): boolean {
  const contours = toSubPaths(outer);
  for (const ring of inner) {
    for (const p of ring) {
      if (!pointInContours(contours, p)) return false;
    }
  }
  return true;
}

/** Birden fazla geometriyi tek sonuçta birleştirir (Unite). */
export function uniteAll(geometries: Geometry[]): Vec2[][] {
  if (geometries.length === 0) return [];
  let acc = flattenGeometry(geometries[0])
    .filter((c) => c.closed)
    .map((c) => c.points.map((p) => ({ ...p })));
  for (let i = 1; i < geometries.length; i++) {
    const next = flattenGeometry(geometries[i])
      .filter((c) => c.closed)
      .map((c) => c.points.map((p) => ({ ...p })));
    acc = booleanRings(acc, next, 'unite');
  }
  return acc;
}

/** Path verisini boolean sonuç loop'larına çevirir. */
export function loopsToPolygonGeometry(loops: Vec2[][]): Geometry {
  const cleaned = loops
    .map((loop) => simplifyLoop(loop))
    .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-6);
  return {
    kind: 'polygon',
    keypoints: cleaned[0] ?? [],
    extraLoops: cleaned.length > 1 ? cleaned.slice(1) : undefined,
  };
}
