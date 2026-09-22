import type { Geometry, IsoFace, IsoSettings, Rect, Vec2 } from './types.ts';
import { uniteAll, loopsToPolygonGeometry } from './boolean.ts';
import { flattenGeometry, simplifyPolyline } from './geometry.ts';
import { objectFromGeometry } from './factory.ts';

/**
 * İZOMETRİK MOD
 * =============
 *
 * Referans videodaki ("isometric cube grid" yöntemi) çalışma biçiminin
 * parametrik karşılığı: 3 yönlü izometrik ızgara, küp konstrüksiyonu, yüzey
 * renklendirme, extrude ve bir şekli küp yüzeyine projekte etme.
 *
 * Projeksiyon (gerçek izometrik, 30°):
 *   X̂ = ( cos30,  sin30)   → sağ-aşağı  (+u)
 *   Ŷ = (-cos30,  sin30)   → sol-aşağı  (+v)
 *   Ẑ = ( 0,     -1     )   → yukarı     (+z)
 *
 *   screen = origin + (u - v)·cos30 , (u + v)·sin30 − z
 *
 * Izgara üç aileden oluşur ve üçü de artboard genelinde eşit aralıklıdır:
 *   +30° çizgiler (u yönü) — dikeyde `a` aralıkla
 *   -30° çizgiler (v yönü) — dikeyde `a` aralıkla
 *   dikey çizgiler (z yönü) — yatayda `a·cos30` aralıkla
 * Bu üç ailenin kesişimleri tam olarak izometrik latis noktalarıdır.
 */

export const ISO_COS = Math.cos(Math.PI / 6); // ≈ 0.8660254
export const ISO_SIN = 0.5;

/** X̂ birim vektörü (sağ-aşağı). */
export const ISO_X: Vec2 = { x: ISO_COS, y: ISO_SIN };
/** Ŷ birim vektörü (sol-aşağı). */
export const ISO_Y: Vec2 = { x: -ISO_COS, y: ISO_SIN };
/** Ẑ birim vektörü (yukarı). */
export const ISO_Z: Vec2 = { x: 0, y: -1 };

export const DEFAULT_ISO: IsoSettings = {
  enabled: false,
  cell: 50,
  snap: true,
  showVerticals: true,
  axisLock: true,
  opacity: 0.5,
  origin: { x: 500, y: 500 },
  faceColors: {
    top: '#1a1a1a',
    right: '#4d4d4d',
    left: '#848484',
  },
  cubeEdgeCells: 6,
  cubeHeightCells: 6,
};

// ------------------------------------------------------------- projeksiyon

/** İzometrik (u, v, z) → ekran/artboard koordinatı. */
export function isoProject(u: number, v: number, z = 0, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  return {
    x: origin.x + (u - v) * ISO_COS,
    y: origin.y + (u + v) * ISO_SIN - z,
  };
}

/**
 * Ekran koordinatı → (u, v). `z` verilmezse nokta zemin düzleminde (z=0)
 * kabul edilir.
 */
export function isoUnproject(p: Vec2, origin: Vec2 = { x: 0, y: 0 }, z = 0): { u: number; v: number } {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y + z;
  const a = dx / ISO_COS; // u - v
  const b = dy / ISO_SIN; // u + v
  return { u: (a + b) / 2, v: (b - a) / 2 };
}

// ------------------------------------------------------------------ ızgara

export interface IsoGridPaths {
  /** u yönündeki (sağ-aşağı, +30°) çizgiler. */
  alongU: string;
  /** v yönündeki (sol-aşağı, −30°) çizgiler. */
  alongV: string;
  /** Dikey (z) çizgiler. */
  vertical: string;
  lineCount: number;
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Artboard'u kaplayan üç çizgi ailesini üretir. Her aile TEK bir path
 * verisine dönüşür; böylece zoom/pan sırasında DOM değişmez.
 */
export function isoGridPaths(settings: IsoSettings, artboardSize: number): IsoGridPaths {
  const a = Math.max(2, settings.cell);
  const origin = settings.origin;

  // Artboard köşelerini (u,v) uzayına çevirip kapsama aralığını bul.
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: artboardSize, y: 0 },
    { x: 0, y: artboardSize },
    { x: artboardSize, y: artboardSize },
  ];
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const c of corners) {
    const { u, v } = isoUnproject(c, origin, 0);
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }

  const margin = a * 2;
  const iMin = Math.floor((uMin - margin) / a);
  const iMax = Math.ceil((uMax + margin) / a);
  const jMin = Math.floor((vMin - margin) / a);
  const jMax = Math.ceil((vMax + margin) / a);

  const alongU: string[] = [];
  for (let j = jMin; j <= jMax; j++) {
    const p1 = isoProject(iMin * a, j * a, 0, origin);
    const p2 = isoProject(iMax * a, j * a, 0, origin);
    alongU.push(`M ${num(p1.x)} ${num(p1.y)} L ${num(p2.x)} ${num(p2.y)}`);
  }

  const alongV: string[] = [];
  for (let i = iMin; i <= iMax; i++) {
    const p1 = isoProject(i * a, jMin * a, 0, origin);
    const p2 = isoProject(i * a, jMax * a, 0, origin);
    alongV.push(`M ${num(p1.x)} ${num(p1.y)} L ${num(p2.x)} ${num(p2.y)}`);
  }

  const vertical: string[] = [];
  if (settings.showVerticals) {
    // Dikey aile, latis noktalarının x konumlarında: x = origin.x + a·cos30·k
    const stepX = a * ISO_COS;
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const kMin = Math.floor((minX - origin.x) / stepX) - 1;
    const kMax = Math.ceil((maxX - origin.x) / stepX) + 1;
    const top = Math.min(...corners.map((c) => c.y));
    const bottom = Math.max(...corners.map((c) => c.y));
    for (let k = kMin; k <= kMax; k++) {
      const x = origin.x + k * stepX;
      vertical.push(`M ${num(x)} ${num(top)} L ${num(x)} ${num(bottom)}`);
    }
  }

  return {
    alongU: alongU.join(' '),
    alongV: alongV.join(' '),
    vertical: vertical.join(' '),
    lineCount: alongU.length + alongV.length + vertical.length,
  };
}

// --------------------------------------------------------------- iso snap

export interface IsoSnapResult {
  point: Vec2;
  /**
   * Ekran latis indeksleri (m, n): x = origin.x + a·cos30·m,
   * y = origin.y + a·0.5·n ve m ≡ n (mod 2).
   */
  m: number;
  n: number;
  /** Ekran latis indekslerinden türetilen (u, v) hücre indeksleri. */
  u: number;
  v: number;
  distance: number;
}

/**
 * Bir noktayı izometrik latisin en yakın düğümüne oturtur.
 *
 * 3B latis ((i,j,k) ∈ ℤ³, adım `a`) izdüşümde şu kümeye iner:
 *   x = origin.x + a·cos30·m ,  y = origin.y + a·0.5·n ,  m ≡ n (mod 2)
 * (k serbest olduğundan dikey konum parite kısıtını değiştirmez.)
 */
export function isoSnapPoint(p: Vec2, settings: IsoSettings): IsoSnapResult {
  const a = Math.max(2, settings.cell);
  const origin = settings.origin;

  const stepX = a * ISO_COS;
  const stepY = a * ISO_SIN;

  const mRaw = (p.x - origin.x) / stepX;
  const nRaw = (p.y - origin.y) / stepY;

  const m0 = Math.round(mRaw);
  const n0 = Math.round(nRaw);

  const candidate = (m: number, n: number): { m: number; n: number; point: Vec2; distance: number } => {
    const point = { x: origin.x + m * stepX, y: origin.y + n * stepY };
    return { m, n, point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
  };

  const options: { m: number; n: number; point: Vec2; distance: number }[] = [];
  if ((((m0 % 2) + 2) % 2) === (((n0 % 2) + 2) % 2)) {
    options.push(candidate(m0, n0));
  }
  options.push(candidate(m0 + 1, n0));
  options.push(candidate(m0 - 1, n0));
  options.push(candidate(m0, n0 + 1));
  options.push(candidate(m0, n0 - 1));

  // Parite uyanları tercih et
  const valid = options.filter((o) => (((o.m % 2) + 2) % 2) === (((o.n % 2) + 2) % 2));
  const pool = valid.length ? valid : options;
  pool.sort((x, y) => x.distance - y.distance);
  const best = pool[0];

  // m = u − v ve n = u + v olduğundan ters çevirimi: u = (m+n)/2, v = (n−m)/2.
  return {
    point: best.point,
    m: best.m,
    n: best.n,
    u: (best.m + best.n) / 2,
    v: (best.n - best.m) / 2,
    distance: best.distance,
  };
}

/**
 * İzometrik eksen kilidi: verilen hareketi en yakın izometrik eksene indirger.
 * Shift ile sürüklerken kullanılır.
 */
export function isoAxisLock(delta: Vec2, allowVertical = true): Vec2 {
  const axes: Vec2[] = allowVertical ? [ISO_X, ISO_Y, { x: 0, y: 1 }, { x: 0, y: -1 }] : [ISO_X, ISO_Y];
  let best = { x: 0, y: 0 };
  let bestLen = 0;
  for (const axis of axes) {
    const proj = delta.x * axis.x + delta.y * axis.y;
    const len = Math.abs(proj);
    if (len > bestLen) {
      bestLen = len;
      best = { x: axis.x * proj, y: axis.y * proj };
    }
  }
  return best;
}

/** İzometrik eksene kilitli bir çizgi için iki ucu hesaplar (çizim araçları). */
export function isoLockedSegment(start: Vec2, current: Vec2): Vec2 {
  const locked = isoAxisLock({ x: current.x - start.x, y: current.y - start.y }, false);
  if (Math.hypot(locked.x, locked.y) < 1e-6) return current;
  return { x: start.x + locked.x, y: start.y + locked.y };
}

// ------------------------------------------------------------------- küp

export interface IsoCube {
  /** Taban köşesinin (u,v) hücre konumu. */
  u: number;
  v: number;
  /** Kenar uzunluğu (hücre). */
  edge: number;
  /** Yükseklik (hücre). */
  height: number;
  /** Hücre = artboard birimi. */
  cell: number;
  origin: Vec2;
  faceColors: Record<IsoFace, string>;
}

export const DEFAULT_CUBE: Omit<IsoCube, 'cell' | 'origin' | 'faceColors'> = {
  u: 0,
  v: 0,
  edge: 6,
  height: 6,
};

/** Küpün görünen üç yüzünün köşe noktaları (artboard koordinatı). */
export function isoCubeFaces(cube: IsoCube): Record<IsoFace, Vec2[]> {
  const a = cube.cell;
  const u0 = cube.u * a;
  const v0 = cube.v * a;
  const u1 = (cube.u + cube.edge) * a;
  const v1 = (cube.v + cube.edge) * a;
  const zTop = cube.height * a;

  const P = (u: number, v: number, z: number): Vec2 => isoProject(u, v, z, cube.origin);

  return {
    // Üst yüz: z = height düzlemindeki eşkenar dörtgen
    top: [P(u0, v0, zTop), P(u1, v0, zTop), P(u1, v1, zTop), P(u0, v1, zTop)],
    // Sağ yüz: yakın dikey kenardan +u kenarına
    right: [P(u0, v0, zTop), P(u1, v0, zTop), P(u1, v0, 0), P(u0, v0, 0)],
    // Sol yüz: yakın dikey kenardan +v kenarına
    left: [P(u0, v0, zTop), P(u0, v1, zTop), P(u0, v1, 0), P(u0, v0, 0)],
  };
}

/** Dolu küpü üç yüz objesi olarak üretir (üst / sağ / sol). */
export function buildIsoCube(cube: IsoCube, layerIndex: number): ReturnType<typeof objectFromGeometry>[] {
  const faces = isoCubeFaces(cube);
  const names: Record<IsoFace, string> = { top: 'Cube · Top', right: 'Cube · Right', left: 'Cube · Left' };
  const order: IsoFace[] = ['right', 'left', 'top'];
  return order.map((face) =>
    objectFromGeometry(
      { kind: 'polygon', keypoints: faces[face] },
      {
        name: names[face],
        layerIndex,
        fill: { type: 'solid', color: cube.faceColors[face] },
        stroke: 'none',
        strokeWidth: 0,
        type: 'polygon',
      },
    ),
  ).map((obj, i) => ({ ...obj, isoFace: order[i] }));
}

// --------------------------------------------------------- extrude / hacim

/**
 * Bir şekli (dx, dy) yönünde extrude eder ve yanal yüzeyi üretir.
 *
 * Yöntem: her sınır kenarı için süpürülen dörtgen oluşturulur ve hepsi
 * birleştirilir. Birleşim, üst ve alt sınır arasındaki bandı verir — yani
 * gerçek hacim yüzeyi. Dışbükey şekillerde arka kenarlar kendiliğinden
 * birleşip kaybolur; içbükey şekillerde de doğru silueti üretir.
 */
export function extrudeGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  if (Math.hypot(dx, dy) < 0.5) return { kind: 'polygon', keypoints: [] };

  const contours = flattenGeometry(geometry).filter((c) => c.closed && c.points.length >= 3);
  const quads: Geometry[] = [];

  for (const contour of contours) {
    // Çok noktalı eğrilerde (daire gibi) noktaları seyrelterek birleşimi hızlandır.
    const pts =
      contour.points.length > 48
        ? simplifyPolyline(contour.points, Math.max(0.4, Math.max(Math.abs(dx), Math.abs(dy)) * 0.02), true)
        : contour.points;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      // Süpürme yönüne paralel (yani ekranda kenar üstü kalan) kenarlar
      // sıfır alanlı bir dörtgen üretir; bunlar boolean birleşimini
      // bozduğu için atlanır.
      const cross = (b.x - a.x) * dy - (b.y - a.y) * dx;
      if (Math.abs(cross) < 1e-6) continue;
      quads.push({
        kind: 'polygon',
        keypoints: [a, b, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }],
      });
    }
  }

  if (!quads.length) return { kind: 'polygon', keypoints: [] };
  return loopsToPolygonGeometry(uniteAll(quads));
}

/**
 * İzometrik yükseklik (hücre) → ekran kayması.
 *
 * İzometride z ekseni ekranda tam dikeydir: +z yukarı (−y), −z aşağıdır (+y).
 * Extrude, seçili şekli "üst yüz" kabul edip gövdeyi −z yönünde (ekranda
 * aşağı) süpürür.
 */
export function isoDepthOffset(cells: number, cell: number): Vec2 {
  return { x: 0, y: cells * cell };
}

// ------------------------------------------------------------ yüze projeksiyon

/**
 * Bir geometriyi küpün verilen yüzeyine otomatik projekte eder (afin eşleme).
 *
 * Şeklin sınır kutusu, yüzeyin paralelkenarına eşlenir:
 *   top   → (u, v) düzlemi
 *   right → (u, z) düzlemi, v = v0
 *   left  → (v, z) düzlemi, u = u0
 */
export function projectGeometryToFace(geometry: Geometry, face: IsoFace, cube: IsoCube): Geometry {
  const bounds = geometryBoundsOf(geometry);
  if (bounds.width <= 0 || bounds.height <= 0) return geometry;

  const a = cube.cell;
  const u0 = cube.u * a;
  const v0 = cube.v * a;
  const u1 = (cube.u + cube.edge) * a;
  const v1 = (cube.v + cube.edge) * a;
  const zTop = cube.height * a;

  const P = (u: number, v: number, z: number): Vec2 => isoProject(u, v, z, cube.origin);

  let p0: Vec2; // bbox sol-üst → yüzeyin bir köşesi
  let px: Vec2; // bbox sağ-üst yönü
  let py: Vec2; // bbox sol-alt yönü

  if (face === 'top') {
    p0 = P(u0, v0, zTop);
    px = P(u1, v0, zTop);
    py = P(u0, v1, zTop);
  } else if (face === 'right') {
    p0 = P(u0, v0, zTop);
    px = P(u1, v0, zTop);
    py = P(u0, v0, 0);
  } else {
    p0 = P(u0, v0, zTop);
    px = P(u0, v1, zTop);
    py = P(u0, v0, 0);
  }

  const ex = { x: (px.x - p0.x) / bounds.width, y: (px.y - p0.y) / bounds.width };
  const ey = { x: (py.x - p0.x) / bounds.height, y: (py.y - p0.y) / bounds.height };

  const matrix: [number, number, number, number, number, number] = [
    ex.x,
    ex.y,
    ey.x,
    ey.y,
    p0.x - (ex.x * bounds.x + ey.x * bounds.y),
    p0.y - (ex.y * bounds.x + ey.y * bounds.y),
  ];

  return transformPoints(geometry, matrix);
}

function transformPoints(g: Geometry, m: [number, number, number, number, number, number]): Geometry {
  const fn = (p: Vec2): Vec2 => ({
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  });
  switch (g.kind) {
    case 'polygon':
      return {
        kind: 'polygon',
        keypoints: g.keypoints.map(fn),
        extraLoops: g.extraLoops?.map((l) => l.map(fn)),
      };
    case 'path':
      return { kind: 'path', subpaths: g.subpaths.map((sp) => ({ points: sp.points.map(fn), closed: sp.closed })) };
    case 'rect': {
      const pts = [
        fn({ x: g.x, y: g.y }),
        fn({ x: g.x + g.width, y: g.y }),
        fn({ x: g.x + g.width, y: g.y + g.height }),
        fn({ x: g.x, y: g.y + g.height }),
      ];
      return { kind: 'polygon', keypoints: pts };
    }
    case 'circle': {
      const steps = 64;
      const pts = Array.from({ length: steps }, (_, i) => {
        const t = (i / steps) * Math.PI * 2;
        return fn({ x: g.cx + Math.cos(t) * g.r, y: g.cy + Math.sin(t) * g.r });
      });
      return { kind: 'polygon', keypoints: pts };
    }
    case 'ellipse': {
      const steps = 64;
      const pts = Array.from({ length: steps }, (_, i) => {
        const t = (i / steps) * Math.PI * 2;
        return fn({ x: g.cx + Math.cos(t) * g.rx, y: g.cy + Math.sin(t) * g.ry });
      });
      return { kind: 'polygon', keypoints: pts };
    }
    case 'ring': {
      const outer = Math.abs(g.outerRadius);
      const inner = Math.max(0, outer - Math.abs(g.thickness));
      const mk = (r: number, reverse: boolean): Vec2[] => {
        const steps = 64;
        return Array.from({ length: steps }, (_, i) => {
          const t = ((reverse ? -i : i) / steps) * Math.PI * 2;
          return fn({ x: g.cx + Math.cos(t) * r, y: g.cy + Math.sin(t) * r });
        });
      };
      return inner <= 0.001
        ? { kind: 'polygon', keypoints: mk(outer, false) }
        : { kind: 'polygon', keypoints: mk(outer, false), extraLoops: [mk(inner, true)] };
    }
    case 'line': {
      const a = fn({ x: g.x1, y: g.y1 });
      const b = fn({ x: g.x2, y: g.y2 });
      return { kind: 'polygon', keypoints: [a, b] };
    }
  }
}

function geometryBoundsOf(g: Geometry): Rect {
  if (g.kind === 'rect') return { x: g.x, y: g.y, width: g.width, height: g.height };
  if (g.kind === 'circle') return { x: g.cx - g.r, y: g.cy - g.r, width: g.r * 2, height: g.r * 2 };
  if (g.kind === 'ellipse') return { x: g.cx - g.rx, y: g.cy - g.ry, width: g.rx * 2, height: g.ry * 2 };
  if (g.kind === 'ring') {
    const outer = Math.abs(g.outerRadius);
    return { x: g.cx - outer, y: g.cy - outer, width: outer * 2, height: outer * 2 };
  }
  const pts =
    g.kind === 'polygon'
      ? [...g.keypoints, ...(g.extraLoops ?? []).flat()]
      : g.kind === 'path'
        ? g.subpaths.flatMap((sp) => sp.points)
        : [
            { x: g.x1, y: g.y1 },
            { x: g.x2, y: g.y2 },
          ];
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Ekran noktasını, izometrik bir düzlemdeki (u,v) koordinatına çevirir.
 * Örneğin üst yüzün z yüksekliğinde çalışırken kullanılır.
 */
export function isoUnprojectOnPlane(p: Vec2, origin: Vec2, z: number): { u: number; v: number } {
  return isoUnproject(p, origin, z);
}

/** İzometrik modda çalışılacak varsayılan ızgara merkezini artboard'a göre verir. */
export function centerIsoOrigin(artboardSize: number): Vec2 {
  return { x: artboardSize / 2, y: artboardSize / 2 };
}
