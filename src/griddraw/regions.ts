/**
 * Grid Draw — düzlemsel BÖLGE (region) motoru.
 *
 * Amaç: kareleri boyamak değil, ızgara + daire + çapraz çizgilerin kurduğu
 * ağın kapalı GÖZLERİNİ tek tek doldurmak. Illustrator'daki karşılığı
 * Live Paint (canlı boyama) / Pathfinder → Divide mantığıdır.
 *
 * Yöntem:
 *   1. Kılavuz çizgileri raster "duvar" olarak çizilir (stroke kalınlığı
 *      kadar bir bant).
 *   2. Duvar olmayan örnekler 4-komşuluk ile bağlantılı bileşenlere ayrılır;
 *      her bileşen bir BÖLGEdir (göz).
 *   3. Her bölgenin sınırı, iki komşu örnek farklı etiketliyse oluşan
 *      "çatlak"lardan yönlü olarak toplanır ve halkalara zincirlenir.
 *      Bölge sürekli sol/sağ tarafta tutulduğu için dış hat ve delikler
 *      kendiliğinden doğru yönde çıkar.
 *   4. Halkalar Douglas-Peucker ile sadeleştirilir, sonra GERÇEK kılavuz
 *      geometrisine (tam grid çizgisi / tam daire / tam çapraz) oturtulur.
 *      Böylece çıktı, merdiven görünümlü piksel kenarı değil temiz vektör
 *      olur.
 *
 * Bu dosya saf fonksiyonlardan oluşur; DOM ve React bilmez, test edilebilir.
 */

import type { Vec2 } from '../core/types.ts';
import { simplifyPolyline } from '../core/geometry.ts';

// ------------------------------------------------------------ kılavuz şekli

/**
 * Kullanıcının çizdiği kılavuz şekli.
 *
 * Izgara ağı her zaman vardır; **daire ve çizgiler opsiyoneldir ve kullanıcı
 * tarafından çizilir** (Illustrator'daki construction guide mantığı). Böylece
 * her logo için gereken yay/çapraz yerine konabilir.
 */
export interface GuideCircle {
  id: string;
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface GuideLine {
  id: string;
  kind: 'line';
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export type GuideShape = GuideCircle | GuideLine;

let guideCounter = 0;

/** Kararlı kılavuz kimliği (React anahtarı ve yeniden eşleme için). */
export function newGuideId(prefix: string): string {
  guideCounter += 1;
  return `${prefix}${guideCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function circleGuide(cx: number, cy: number, r: number): GuideCircle {
  return { id: newGuideId('c'), kind: 'circle', cx, cy, r };
}

export function lineGuide(a: Vec2, b: Vec2): GuideLine {
  return { id: newGuideId('l'), kind: 'line', ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

// ------------------------------------------------------------------ ayarlar

export interface GridDrawSettings {
  /**
   * Izgara bölme sayısı. **Düşey ve yatayda EŞİTTİR.**
   *
   * Köşeden köşeye çaprazların her kareyi tam ikiye bölmesi ancak böyle
   * mümkündür: çapraz, kafes noktalarından geçmesi için satır ve sütun
   * sayısının eşit olması gerekir. Aksi halde çapraz kareleri rastgele
   * açılarla keser.
   */
  grid: number;
  /**
   * Artboard kenarı (birim). Kare tutulur; böylece hücreler de kare olur ve
   * çaprazlar her hücreyi eşit iki üçgene böler.
   */
  size: number;
  /** Kullanıcının çizdiği kılavuzlar. Varsayılan: yok (yalnızca ızgara). */
  guides: GuideShape[];
}

/**
 * Varsayılan: YALNIZCA ızgara çizgileri; daire ve çapraz kullanıcı çizer.
 *
 * 24×24 → 576 göz, hücre 60×60 birim (1440 kare artboard).
 */
export const DEFAULT_GRID_DRAW: GridDrawSettings = {
  grid: 24,
  size: 1440,
  guides: [],
};

/** Daire yarıçapları, artboard yarıçapına oranlıdır (klasik oranlar). */
export const CIRCLE_RATIOS = [0.7777778, 0.5925926, 0.3888889] as const;

/** Klasik eş merkezli daireler (hızlı ekleme kısayolu). */
export function centerCircles(size: number, count: number): GuideCircle[] {
  const base = size / 2;
  const n = Math.max(0, Math.min(3, Math.round(count)));
  return CIRCLE_RATIOS.slice(0, n).map((ratio) => circleGuide(base, base, Math.round(base * ratio * 100) / 100));
}

/** Köşeden köşeye X çaprazları (hızlı ekleme kısayolu). */
export function cornerDiagonals(size: number): GuideLine[] {
  return [
    lineGuide({ x: 0, y: 0 }, { x: size, y: size }),
    lineGuide({ x: size, y: 0 }, { x: 0, y: size }),
  ];
}

/** Merkezden geçen dikey + yatay kılavuz (hızlı ekleme kısayolu). */
export function centerCrossLines(size: number): GuideLine[] {
  const c = size / 2;
  return [lineGuide({ x: c, y: 0 }, { x: c, y: size }), lineGuide({ x: 0, y: c }, { x: size, y: c })];
}

/** İki kılavuz şeklinin geometrik olarak aynı olup olmadığı. */
function sameGuide(a: GuideShape, b: GuideShape): boolean {
  if (a.id !== b.id || a.kind !== b.kind) return false;
  if (a.kind === 'circle' && b.kind === 'circle') {
    return a.cx === b.cx && a.cy === b.cy && a.r === b.r;
  }
  if (a.kind === 'line' && b.kind === 'line') {
    return a.ax === b.ax && a.ay === b.ay && a.bx === b.bx && a.by === b.by;
  }
  return false;
}

/**
 * Eksik/bozuk ayarları güvenli hale getirir ve **eski kayıtları taşır**.
 *
 * Eski biçim `cols`/`rows`/`circles`/`diagonals`/`centerCross` alanlarını
 * kullanıyordu; ızgara tek sayıya indiği ve kılavuzlar kullanıcı çizimine
 * döndüğü için bu alanlar dönüştürülür.
 */
export function normalizeSettings(raw: unknown): GridDrawSettings {
  const input = (raw ?? {}) as Partial<GridDrawSettings> & {
    cols?: number;
    rows?: number;
    width?: number;
    height?: number;
    circles?: number;
    diagonals?: boolean;
    centerCross?: boolean;
  };

  const size = Math.max(48, Math.round(input.size ?? input.width ?? DEFAULT_GRID_DRAW.size));
  const grid = Math.max(
    MIN_DIVISIONS,
    Math.min(MAX_DIVISIONS, Math.round(input.grid ?? input.cols ?? input.rows ?? DEFAULT_GRID_DRAW.grid)),
  );

  let guides: GuideShape[] = [];
  if (Array.isArray(input.guides)) {
    guides = input.guides.filter(
      (g): g is GuideShape =>
        Boolean(g) &&
        (g as GuideShape).kind !== undefined &&
        ((g as GuideCircle).kind === 'circle' || (g as GuideLine).kind === 'line'),
    );
  } else {
    // Eski biçimden taşıma
    guides = [
      ...centerCircles(size, input.circles ?? 0),
      ...(input.diagonals ? cornerDiagonals(size) : []),
      ...(input.centerCross ? centerCrossLines(size) : []),
    ];
  }

  return { grid, size, guides };
}

/**
 * Eğrisel kılavuzların (daire, çapraz) duvar yarı kalınlığı.
 *
 * Düz grid çizgileri için 0.5 (2 örnek) yeterlidir: çizgi ızgaraya tam
 * hizalıdır. Eğrilerde art arda satırların işaretlediği sütunlar 1 birim
 * kayabilir; 4-komşuluk kopmasın (duvarda kaçak olmasın) diye bant daha
 * kalın tutulur.
 */
export const CURVE_HALF = 1;
/** Bu alandan küçük bölgeler sayısal gürültü sayılır (birim²). */
export const MIN_REGION_AREA = 8;
/**
 * Sınır sadeleştirme toleransı (birim).
 *
 * Sadeleştirme, kılavuza oturtmadan SONRA uygulanır. O zaman düz bir kenarın
 * tüm noktaları tam olarak aynı doğru üzerinde olduğu için sapma 0 çıkar ve
 * kenar iki uç noktaya iner; yayda ise sapma gerçek olduğu için eğri korunur.
 * Küçük tolerans, yayları gereksiz köşelendirmez.
 */
export const SIMPLIFY_TOL = 0.4;
/**
 * Kılavuza oturtma toleransı.
 * Üst sınır = eğrisel duvar sapması (≈1.9) + sadeleştirme payı (0.5).
 */
export const SNAP_TOL = 2.4;

export const MIN_DIVISIONS = 2;
export const MAX_DIVISIONS = 64;

function clampInt(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, v));
}

// ----------------------------------------------------------------- kılavuzlar

export interface GridDrawGuides {
  /** Kare artboard kenarı (birim). */
  size: number;
  /** Bölme sayısı; düşey = yatay. */
  grid: number;
  /** Kare hücre kenarı. */
  cell: number;
  /** Artboard merkezi. */
  cx: number;
  cy: number;
  /** Kullanıcı daireleri; `index` ayarlardaki konumudur (kararlı kimlik). */
  circles: { index: number; cx: number; cy: number; r: number }[];
  /** Kullanıcı çizgileri; `index` ayarlardaki konumudur. */
  lines: { index: number; a: Vec2; b: Vec2 }[];
  // Aşağıdakiler tarama/snapping kodunun tek biçimli kalması için kısayoldur.
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/** Ayarlardan kılavuz geometrisini üretir. Çizim ve motor aynı kaynağı kullanır. */
export function guideGeometry(settings: GridDrawSettings): GridDrawGuides {
  const size = Math.max(48, Math.round(settings.size));
  const grid = clampInt(settings.grid, MIN_DIVISIONS, MAX_DIVISIONS);
  const cell = size / grid;

  const circles: GridDrawGuides['circles'] = [];
  const lines: GridDrawGuides['lines'] = [];

  settings.guides.forEach((guide, index) => {
    if (guide.kind === 'circle') {
      if (guide.r > 0.5) circles.push({ index, cx: guide.cx, cy: guide.cy, r: guide.r });
    } else if (Math.hypot(guide.bx - guide.ax, guide.by - guide.ay) > 0.5) {
      lines.push({ index, a: { x: guide.ax, y: guide.ay }, b: { x: guide.bx, y: guide.by } });
    }
  });

  return {
    size,
    grid,
    cell,
    cx: size / 2,
    cy: size / 2,
    circles,
    lines,
    width: size,
    height: size,
    cols: grid,
    rows: grid,
    cellW: cell,
    cellH: cell,
  };
}

// -------------------------------------------------------------------- bölge

export interface GridDrawRegion {
  id: number;
  /** Bölgenin içinde kalan temsili örnek nokta (ayar değişince yeniden eşlemek için). */
  sample: Vec2;
  /** Örnek sayısı (yaklaşık alan). */
  area: number;
  /** even-odd dolgu için tüm halkalar; dış hat + delikler. */
  loops: Vec2[][];
  pathData: string;
}

export interface GridDrawPlan {
  settings: GridDrawSettings;
  guides: GridDrawGuides;
  width: number;
  height: number;
  /** width*height; 0 = duvar ya da atılan gürültü. */
  labels: Int32Array;
  /** id → bölge (0 kullanılmaz). */
  byId: (GridDrawRegion | null)[];
  regions: GridDrawRegion[];
}

// --------------------------------------------------------------- duvar çizimi

function markColumn(walls: Uint8Array, width: number, height: number, x: number, half: number): void {
  const a = Math.max(0, Math.floor(x - half));
  const b = Math.min(width - 1, Math.floor(x + half));
  for (let i = a; i <= b; i++) {
    const base = i;
    for (let j = 0; j < height; j++) walls[j * width + base] = 1;
  }
}

function markRow(walls: Uint8Array, width: number, height: number, y: number, half: number): void {
  const a = Math.max(0, Math.floor(y - half));
  const b = Math.min(height - 1, Math.floor(y + half));
  for (let j = a; j <= b; j++) {
    const base = j * width;
    for (let i = 0; i < width; i++) walls[base + i] = 1;
  }
}

/**
 * Aynı satırda [x0, x1] aralığını duvar yapar.
 *
 * Örnek `i`, [i, i+1] aralığını kaplar ve merkezi `i+0.5`'tir; bu yüzden
 * MERKEZİ aralığa düşen örnekler işaretlenir. Hücre sınırına göre
 * işaretlemek bandı 1 örnek genişletir ve bölge sınırını kılavuzdan
 * gereksiz uzaklaştırır. Aralık 1 örnekten dar olsa bile en az bir örnek
 * işaretlenir; yoksa duvarda tek satırlık bir kaçak oluşup flood fill
 * komşu bölgeye sızabilir.
 */
function markSpan(walls: Uint8Array, width: number, x0: number, x1: number, y: number): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  let a = Math.max(0, Math.ceil(lo - 0.5));
  let b = Math.min(width - 1, Math.floor(hi - 0.5));
  if (b < a) {
    a = Math.max(0, Math.min(width - 1, Math.floor((lo + hi) / 2)));
    b = a;
  }
  const base = y * width;
  for (let i = a; i <= b; i++) walls[base + i] = 1;
}

/** Merkezi (x±r, y±r) karesine düşen örnekleri duvar yapar. */
function markDisc(walls: Uint8Array, width: number, height: number, x: number, y: number, r: number): void {
  const x0 = Math.max(0, Math.ceil(x - r - 0.5));
  const x1 = Math.min(width - 1, Math.floor(x + r - 0.5));
  const y0 = Math.max(0, Math.ceil(y - r - 0.5));
  const y1 = Math.min(height - 1, Math.floor(y + r - 0.5));
  if (x1 < x0 || y1 < y0) {
    const cx = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.floor(y)));
    walls[cy * width + cx] = 1;
    return;
  }
  for (let j = y0; j <= y1; j++) {
    const base = j * width;
    for (let i = x0; i <= x1; i++) walls[base + i] = 1;
  }
}

function rasterWalls(guides: GridDrawGuides): Uint8Array {
  const { width, height, cols, rows, cellW, cellH, circles, lines } = guides;
  const walls = new Uint8Array(width * height);

  // Artboard kenarı: dış bölge kapansın diye 1 örnek kalınlığında çerçeve.
  for (let i = 0; i < width; i++) {
    walls[i] = 1;
    walls[(height - 1) * width + i] = 1;
  }
  for (let j = 0; j < height; j++) {
    walls[j * width] = 1;
    walls[j * width + width - 1] = 1;
  }

  // Düz grid çizgileri: ızgaraya tam hizalı, 2 örnek yeterli.
  for (let i = 0; i <= cols; i++) markColumn(walls, width, height, i * cellW, 0.5);
  for (let j = 0; j <= rows; j++) markRow(walls, width, height, j * cellH, 0.5);

  // Kullanıcı çizgileri: hat boyunca küçük diskler basarak (eğim ne olursa olsun güvenli)
  for (const line of lines) {
    const span = Math.max(Math.abs(line.b.x - line.a.x), Math.abs(line.b.y - line.a.y));
    const steps = Math.max(2, Math.ceil(span * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      markDisc(
        walls,
        width,
        height,
        line.a.x + (line.b.x - line.a.x) * t,
        line.a.y + (line.b.y - line.a.y) * t,
        CURVE_HALF,
      );
    }
  }

  // Kullanıcı daireleri: her satırda halka aralığı doğrudan hesaplanır
  for (const circle of circles) {
    const { cx, cy, r } = circle;
    const y0 = Math.max(0, Math.floor(cy - r - CURVE_HALF));
    const y1 = Math.min(height - 1, Math.ceil(cy + r + CURVE_HALF));
    for (let j = y0; j <= y1; j++) {
      const py = j + 0.5;
      const dy = py - cy;
      const outerSq = (r + CURVE_HALF) ** 2 - dy * dy;
      if (outerSq <= 0) continue;
      const outer = Math.sqrt(outerSq);
      const innerSq = (r - CURVE_HALF) ** 2 - dy * dy;
      const inner = innerSq > 0 ? Math.sqrt(innerSq) : 0;
      markSpan(walls, width, cx - outer, cx - inner, j);
      markSpan(walls, width, cx + inner, cx + outer, j);
    }
  }

  return walls;
}

// ------------------------------------------------------------------ flood fill

interface Filled {
  labels: Int32Array;
  areas: number[];
  samples: Vec2[];
  count: number;
}

function floodFill(walls: Uint8Array, width: number, height: number): Filled {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const areas: number[] = [];
  const samples: Vec2[] = [];
  let nextId = 0;

  for (let start = 0; start < labels.length; start++) {
    if (walls[start] || labels[start] !== 0) continue;
    const id = ++nextId;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;

    let area = 0;
    let sampleX = 0;
    let sampleY = 0;

    while (top > 0) {
      const idx = stack[--top];
      const x = idx % width;
      const y = (idx - x) / width;
      if (area === 0) {
        sampleX = x;
        sampleY = y;
      }
      area++;

      if (x > 0) {
        const n = idx - 1;
        if (!walls[n] && labels[n] === 0) {
          labels[n] = id;
          stack[top++] = n;
        }
      }
      if (x + 1 < width) {
        const n = idx + 1;
        if (!walls[n] && labels[n] === 0) {
          labels[n] = id;
          stack[top++] = n;
        }
      }
      if (y > 0) {
        const n = idx - width;
        if (!walls[n] && labels[n] === 0) {
          labels[n] = id;
          stack[top++] = n;
        }
      }
      if (y + 1 < height) {
        const n = idx + width;
        if (!walls[n] && labels[n] === 0) {
          labels[n] = id;
          stack[top++] = n;
        }
      }
    }

    areas[id] = area;
    samples[id] = { x: sampleX, y: sampleY };
  }

  return { labels, areas, samples, count: nextId };
}

// ----------------------------------------------------------- sınır zincirleme

/**
 * Etiket farkı olan her komşuluk bir "çatlak"tır. Çatlaklar, ait oldukları
 * bölge için YÖNLÜ kenara çevrilir (bölge hep aynı tarafta kalır), böylece
 * halkalar düğüm noktalarından kendiliğinden zincirlenir.
 */
function chainLoops(edges: number[], width: number, height: number): Vec2[][] {
  const stride = height + 1;
  const edgeCount = edges.length / 4;
  if (!edgeCount) return [];

  const starts = new Map<number, number[]>();
  for (let i = 0; i < edgeCount; i++) {
    const key = edges[i * 4] * stride + edges[i * 4 + 1];
    const list = starts.get(key);
    if (list) list.push(i);
    else starts.set(key, [i]);
  }

  const used = new Uint8Array(edgeCount);
  const loops: Vec2[][] = [];

  for (let i = 0; i < edgeCount; i++) {
    if (used[i]) continue;
    const loop: Vec2[] = [];
    let cur = i;
    while (cur !== -1 && !used[cur]) {
      used[cur] = 1;
      loop.push({ x: edges[cur * 4], y: edges[cur * 4 + 1] });
      const key = edges[cur * 4 + 2] * stride + edges[cur * 4 + 3];
      const candidates = starts.get(key);
      let next = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used[c]) {
            next = c;
            break;
          }
        }
      }
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }

  void width;
  return loops;
}

// ------------------------------------------------------------------- snapping

function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return { point: { ...a }, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/**
 * Piksel sınırından gelen noktayı gerçek kılavuz geometrisine oturtur.
 *
 * Önce eğrisel kılavuzlar (kullanıcı daireleri ve çizgileri) denenir; daha
 * yakınsa onlar kazanır. Aksi halde X ve Y eksenleri bağımsız olarak grid
 * çizgilerine oturtulur.
 */
export function snapToGuides(p: Vec2, guides: GridDrawGuides, tolerance = SNAP_TOL): Vec2 {
  interface Candidate {
    point: Vec2;
    distance: number;
  }
  const candidates: Candidate[] = [];

  for (const circle of guides.circles) {
    const dx = p.x - circle.cx;
    const dy = p.y - circle.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) continue;
    candidates.push({
      point: { x: circle.cx + (dx / d) * circle.r, y: circle.cy + (dy / d) * circle.r },
      distance: Math.abs(d - circle.r),
    });
  }
  for (const line of guides.lines) candidates.push(projectOnSegment(p, line.a, line.b));

  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.distance > tolerance) continue;
    if (best === null || candidate.distance < best.distance) best = candidate;
  }
  if (best !== null) return best.point;

  let x = p.x;
  let y = p.y;

  const i = Math.round(x / guides.cellW);
  if (i >= 0 && i <= guides.cols && Math.abs(x - i * guides.cellW) <= tolerance) x = i * guides.cellW;

  const j = Math.round(y / guides.cellH);
  if (j >= 0 && j <= guides.rows && Math.abs(y - j * guides.cellH) <= tolerance) y = j * guides.cellH;

  return { x, y };
}

/**
 * Yeni bir kılavuz çizerken ucun ızgara kavşağına kenetlenmesi.
 * (Serbest bırakmak için `Ctrl` basılı tutulur; bu ayrım arayüzde yapılır.)
 */
export function snapToGridPoint(p: Vec2, guides: GridDrawGuides, tolerance = 14): Vec2 {
  const i = Math.round(p.x / guides.cellW);
  const j = Math.round(p.y / guides.cellH);
  const x = i >= 0 && i <= guides.cols && Math.abs(p.x - i * guides.cellW) <= tolerance ? i * guides.cellW : p.x;
  const y = j >= 0 && j <= guides.rows && Math.abs(p.y - j * guides.cellH) <= tolerance ? j * guides.cellH : p.y;
  return { x, y };
}

function n2(v: number): number {
  return Math.round(v * 100) / 100;
}

// --------------------------------------------------------- köşe onarımı

/** Bir noktanın üzerinde bulunduğu kılavuz. */
interface GuideRef {
  /** v: dikey grid, h: yatay grid, c: kullanıcı dairesi, l: kullanıcı çizgisi. */
  kind: 'v' | 'h' | 'c' | 'l';
  index: number;
  /** v/h için koordinat; c/l için ayardaki şekil indeksi. */
  value: number;
  /** l için doğru parçası. */
  seg?: [Vec2, Vec2];
  /** c için merkez ve yarıçap. */
  circle?: { cx: number; cy: number; r: number };
}

/** Bir noktanın kılavuz üzerinde sayılması için tolerans (birim). */
const GUIDE_TOL = 0.02;

function guidesOf(p: Vec2, guides: GridDrawGuides): GuideRef[] {
  const out: GuideRef[] = [];

  const iv = Math.round(p.x / guides.cellW);
  if (iv >= 0 && iv <= guides.cols && Math.abs(p.x - iv * guides.cellW) <= GUIDE_TOL) {
    out.push({ kind: 'v', index: iv, value: iv * guides.cellW });
  }

  const jh = Math.round(p.y / guides.cellH);
  if (jh >= 0 && jh <= guides.rows && Math.abs(p.y - jh * guides.cellH) <= GUIDE_TOL) {
    out.push({ kind: 'h', index: jh, value: jh * guides.cellH });
  }

  for (const circle of guides.circles) {
    if (Math.abs(Math.hypot(p.x - circle.cx, p.y - circle.cy) - circle.r) <= GUIDE_TOL) {
      out.push({
        kind: 'c',
        index: circle.index,
        value: circle.index,
        circle: { cx: circle.cx, cy: circle.cy, r: circle.r },
      });
    }
  }

  for (const line of guides.lines) {
    if (projectOnSegment(p, line.a, line.b).distance <= GUIDE_TOL) {
      out.push({ kind: 'l', index: line.index, value: line.index, seg: [line.a, line.b] });
    }
  }

  return out;
}

// ----------------------------------------------- analitik kesişim yardımcıları

function nearestOf(points: Vec2[], near: Vec2): Vec2 | null {
  if (!points.length) return null;
  return points.reduce((best, cur) =>
    Math.hypot(cur.x - near.x, cur.y - near.y) < Math.hypot(best.x - near.x, best.y - near.y) ? cur : best,
  );
}

/** Doğru parçası üzerinde x'e karşılık gelen y (düşey doğru ise null). */
function yOnSegment(seg: [Vec2, Vec2], x: number): number | null {
  const [p0, p1] = seg;
  const dx = p1.x - p0.x;
  if (Math.abs(dx) < 1e-9) return null;
  return p0.y + ((x - p0.x) * (p1.y - p0.y)) / dx;
}

/** Doğru parçası üzerinde y'ye karşılık gelen x (yatay doğru ise null). */
function xOnSegment(seg: [Vec2, Vec2], y: number): number | null {
  const [p0, p1] = seg;
  const dy = p1.y - p0.y;
  if (Math.abs(dy) < 1e-9) return null;
  return p0.x + ((y - p0.y) * (p1.x - p0.x)) / dy;
}

function segmentSegment(a: [Vec2, Vec2], b: [Vec2, Vec2]): Vec2 | null {
  const [p1, p2] = a;
  const [p3, p4] = b;
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

/** İki çemberin kesişimi (eş merkezli ya da ayrık ise null). */
function circleCircle(
  c1: { cx: number; cy: number; r: number },
  c2: { cx: number; cy: number; r: number },
  near: Vec2,
): Vec2 | null {
  const dx = c2.cx - c1.cx;
  const dy = c2.cy - c1.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null;
  if (d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return null;

  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const hSq = c1.r * c1.r - a * a;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;
  const mx = c1.cx + (a * dx) / d;
  const my = c1.cy + (a * dy) / d;
  if (h < 1e-9) return { x: mx, y: my };
  const ox = (-dy * h) / d;
  const oy = (dx * h) / d;
  return nearestOf([{ x: mx + ox, y: my + oy }, { x: mx - ox, y: my - oy }], near);
}

/** Çember × doğru parçası kesişimi. */
function circleSegment(
  circle: { cx: number; cy: number; r: number },
  seg: [Vec2, Vec2],
  near: Vec2,
): Vec2 | null {
  const [p0, p1] = seg;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const qa = dx * dx + dy * dy;
  if (qa < 1e-9) return null;

  const fx = p0.x - circle.cx;
  const fy = p0.y - circle.cy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - circle.r * circle.r;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;

  const root = Math.sqrt(disc);
  const points = [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]
    .filter((t) => t >= -0.001 && t <= 1.001)
    .map((t) => ({ x: p0.x + dx * t, y: p0.y + dy * t }));
  return nearestOf(points, near);
}

/**
 * İki kılavuzun kesişimi; yoksa (paralel, eş merkezli, ayrık) null.
 *
 * Desteklenen tüm ikililer: grid×grid, grid×daire, grid×çizgi,
 * çizgi×çizgi, çizgi×daire, daire×daire.
 */
function guideIntersection(a: GuideRef, b: GuideRef, near: Vec2): Vec2 | null {
  const pick = (kind: GuideRef['kind']): GuideRef | null =>
    a.kind === kind ? a : b.kind === kind ? b : null;

  const vert = pick('v');
  const horz = pick('h');
  const circle = pick('c');
  const line = pick('l');

  if (vert && horz) return { x: vert.value, y: horz.value };

  if (vert && circle?.circle) {
    const c = circle.circle;
    const dx = vert.value - c.cx;
    const inner = c.r * c.r - dx * dx;
    if (inner < 0) return null;
    const s = Math.sqrt(inner);
    return nearestOf([{ x: vert.value, y: c.cy - s }, { x: vert.value, y: c.cy + s }], near);
  }

  if (horz && circle?.circle) {
    const c = circle.circle;
    const dy = horz.value - c.cy;
    const inner = c.r * c.r - dy * dy;
    if (inner < 0) return null;
    const s = Math.sqrt(inner);
    return nearestOf([{ x: c.cx - s, y: horz.value }, { x: c.cx + s, y: horz.value }], near);
  }

  if (vert && line?.seg) {
    const y = yOnSegment(line.seg, vert.value);
    return y === null ? null : { x: vert.value, y };
  }

  if (horz && line?.seg) {
    const x = xOnSegment(line.seg, horz.value);
    return x === null ? null : { x, y: horz.value };
  }

  if (a.kind === 'c' && b.kind === 'c' && a.circle && b.circle) {
    return circleCircle(a.circle, b.circle, near);
  }

  if (circle?.circle && line?.seg) return circleSegment(circle.circle, line.seg, near);

  if (a.kind === 'l' && b.kind === 'l' && a.seg && b.seg) return segmentSegment(a.seg, b.seg);

  return null;
}

/**
 * Kısa "köpek bacağı" (dogleg) temizliği.
 *
 * Kılavuz kesişimlerinde, duvar bantlarının birleşimi yüzünden sınırın
 * birkaç birim köşeyi aşıp geri döndüğü küçük çıkıntılar oluşur. Her iki
 * komşu kenarı da kısa olan keskin bir dönüş noktası bu artefaktın
 * imzasıdır; atılır ve köşe `repairCorners` ile tam yerine konur.
 */
function dropDoglets(loop: Vec2[], shortEdge = 5, sharpCos = 0.5): Vec2[] {
  let points = loop;
  for (let pass = 0; pass < 3; pass++) {
    if (points.length <= 4) break;
    const n = points.length;
    const out: Vec2[] = [];
    let removed = false;
    for (let i = 0; i < n; i++) {
      const a = points[(i - 1 + n) % n];
      const p = points[i];
      const c = points[(i + 1) % n];
      const ux = p.x - a.x;
      const uy = p.y - a.y;
      const vx = c.x - p.x;
      const vy = c.y - p.y;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (lu > 0 && lv > 0 && lu < shortEdge && lv < shortEdge && (ux * vx + uy * vy) / (lu * lv) < sharpCos) {
        removed = true;
        continue;
      }
      out.push(p);
    }
    if (!removed) break;
    points = out;
  }
  return points.length >= 3 ? points : loop;
}

/**
 * Köşe onarımı.
 *
 * Sağlam bir bölge sınırında ardışık iki nokta MUTLAKA ortak bir kılavuz
 * paylaşır (kenar bir duvar boyunca ilerler). Paylaşmıyorlarsa aradaki
 * köşe düşmüş demektir; iki kılavuzun ANALİTİK kesişimi geri eklenir.
 * Böylece kesişim noktaları yuvarlama hatası olmadan tam yerinde olur.
 */
function repairCorners(loop: Vec2[], guides: GridDrawGuides): Vec2[] {
  const n = loop.length;
  if (n < 3) return loop;

  const orientation = Math.sign(signedLoopArea([loop])) || 1;
  // Kesilen köşe en fazla bir hücre köşegeni kadar uzakta olabilir; payla
  // birlikte biraz geniş tutulur.
  const maxChord = 2.5 * Math.hypot(guides.cellW, guides.cellH);

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const c = loop[(i + 1) % n];
    out.push(a);

    const ga = guidesOf(a, guides);
    const gc = guidesOf(c, guides);
    if (!ga.length || !gc.length) continue;

    const shared = ga.some((x) => gc.some((y) => x.kind === y.kind && x.index === y.index));
    if (shared) continue;

    const chord = Math.hypot(c.x - a.x, c.y - a.y);
    if (chord > maxChord) continue;

    const near = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    let best: Vec2 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const first of ga) {
      for (const second of gc) {
        const point = guideIntersection(first, second, near);
        if (!point) continue;
        /*
         * İki grid çizgisi birleşiminde İKİ aday kesişim olur ve kirişin
         * ortasına uzaklıkları eşit olabilir. Doğru olan, dönüş yönü
         * halkanın yönüyle aynı olandır; yanlış aday poligonu kendisiyle
         * kestirir. Beraberlik bu şekilde bozulur.
         */
        const turn = (point.x - a.x) * (c.y - point.y) - (point.y - a.y) * (c.x - point.x);
        const aligned = Math.sign(turn) === orientation;
        const score = Math.hypot(point.x - near.x, point.y - near.y) + (aligned ? 0 : 10000);
        if (score < bestScore) {
          bestScore = score;
          best = point;
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Yakın iki köşe noktasını TEK tam köşede birleştirir.
 *
 * Snapping bazen bir kılavuzun üstündeki noktayı doğru x ile ama yanlış y ile
 * bırakır (y yalnızca komşu kılavuzla kesişince kesinleşir). Böyle bir nokta
 * ile komşusu birkaç birim arayla farklı kılavuzlardaysa, araya yeni nokta
 * eklemek yanlış olur: ikisi de aynı gerçek köşenin kopyasıdır. İkisi
 * atılıp yerine kılavuzların ANALİTİK kesişimi konur. Böylece hem fazladan
 * nokta kalmaz hem de köşe yuvarlama hatası taşımaz.
 */
function collapseCornerPairs(loop: Vec2[], guides: GridDrawGuides, close = 8): Vec2[] {
  const n = loop.length;
  if (n < 4) return loop;

  const out: Vec2[] = [];
  const skipped = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (skipped[i]) continue;
    const a = loop[i];
    const c = loop[(i + 1) % n];
    const gap = Math.hypot(c.x - a.x, c.y - a.y);

    if (gap > 0 && gap < close) {
      const ga = guidesOf(a, guides);
      const gc = guidesOf(c, guides);
      const near = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };

      let best: Vec2 | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const first of ga) {
        for (const second of gc) {
          const point = guideIntersection(first, second, near);
          if (!point) continue;
          const score =
            Math.hypot(point.x - a.x, point.y - a.y) + Math.hypot(point.x - c.x, point.y - c.y);
          if (score < bestScore) {
            bestScore = score;
            best = point;
          }
        }
      }

      if (
        best &&
        Math.hypot(best.x - a.x, best.y - a.y) < close &&
        Math.hypot(best.x - c.x, best.y - c.y) < close
      ) {
        out.push(best);
        skipped[(i + 1) % n] = true;
        continue;
      }
    }

    out.push(a);
  }

  return out.length >= 3 ? out : loop;
}

/**
 * Bir halkayı yayınlanabilir hale getirir: yakın köşe birleştirme, köpek
 * bacağı ve gereksiz nokta temizliği, ardından eksik köşe onarımı.
 *
 * Geçişler birbirini etkilediği için (bir nokta atılınca komşusu yeni bir
 * köpek bacağı oluşturabilir) sonuç kararlı hale gelene kadar yinelenir ve
 * çıkışta daima gereksiz nokta temizliği yapılır.
 */
function polishLoop(loop: Vec2[], guides: GridDrawGuides): Vec2[] {
  let points = dropDoglets(loop);

  for (let pass = 0; pass < 3; pass++) {
    const collapsed = collapseCornerPairs(points, guides);
    const repaired = repairCorners(collapsed, guides);
    const cleaned = dropDoglets(dropCollinearPoints(repaired));
    const stable = cleaned.length >= collapsed.length && cleaned.length >= points.length;
    points = cleaned;
    if (stable) break;
  }

  return dropCollinearPoints(points);
}

/**
 * Ortak doğrusal ara noktaları atar (tolerans çok küçük).
 *
 * Yalnızca köşe onarımından SONRA çalışır: onarım bazen aynı kenar üzerine
 * fazladan bir nokta ekler. Sadeleştirme (DP) zaten yapıldığı için yay
 * noktaları birbirinden yeterince uzaktır ve bu toleransa takılmaz.
 *
 * Bir noktanın atılması komşusunu yeni doğrusal hale getirebildiği için
 * kararlı olana kadar yinelenir.
 */
function dropCollinearPoints(loop: Vec2[], tolerance = 0.02): Vec2[] {
  let points = loop;
  for (let pass = 0; pass < 4; pass++) {
    const n = points.length;
    if (n < 4) break;

    const out: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const a = points[(i - 1 + n) % n];
      const p = points[i];
      const c = points[(i + 1) % n];
      const base = Math.hypot(c.x - a.x, c.y - a.y);
      if (base < 1e-9) {
        out.push(p);
        continue;
      }
      const distance = Math.abs((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x)) / base;
      if (distance > tolerance) out.push(p);
    }
    if (out.length === n || out.length < 3) break;
    points = out;
  }
  return points.length >= 3 ? points : loop;
}

function loopsToPathData(loops: Vec2[][]): string {
  const parts: string[] = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    let d = `M ${n2(loop[0].x)} ${n2(loop[0].y)}`;
    for (let i = 1; i < loop.length; i++) d += ` L ${n2(loop[i].x)} ${n2(loop[i].y)}`;
    parts.push(`${d} Z`);
  }
  return parts.join(' ');
}

/** Kapalı halkaların işaretli alan toplamı (delikler kendiliğinden düşer). */
export function signedLoopArea(loops: Vec2[][]): number {
  let total = 0;
  for (const loop of loops) {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      s += p.x * q.y - q.x * p.y;
    }
    total += s / 2;
  }
  return total;
}

// ------------------------------------------------------------------- plan

/**
 * Kılavuz ağının tüm kapalı bölgelerini hesaplar.
 *
 * Not: bu fonksiyon ~1.5M örnek üzerinde çalışır; ayarlar değişmedikçe
 * yeniden çağrılmamalıdır (React tarafında memoize edilir).
 */
export function buildGridDrawPlan(settings: GridDrawSettings): GridDrawPlan {
  const guides = guideGeometry(settings);
  const { width, height } = guides;

  const walls = rasterWalls(guides);
  const filled = floodFill(walls, width, height);

  // Gürültüyü at: küçük bölgelerin etiketini sıfırla.
  const keep = new Uint8Array(filled.count + 1);
  let kept = 0;
  for (let id = 1; id <= filled.count; id++) {
    if (filled.areas[id] >= MIN_REGION_AREA) {
      keep[id] = 1;
      kept++;
    }
  }
  if (kept !== filled.count) {
    for (let i = 0; i < filled.labels.length; i++) {
      const id = filled.labels[i];
      if (id !== 0 && !keep[id]) filled.labels[i] = 0;
    }
  }

  const byId: (GridDrawRegion | null)[] = new Array(filled.count + 1).fill(null);
  const regions: GridDrawRegion[] = [];

  for (const traced of traceContours(filled.labels, width, height, guides)) {
    const region: GridDrawRegion = {
      id: traced.id,
      sample: filled.samples[traced.id] ?? { x: 0, y: 0 },
      area: filled.areas[traced.id] ?? 0,
      loops: traced.loops,
      pathData: traced.pathData,
    };
    byId[traced.id] = region;
    regions.push(region);
  }

  return { settings, guides, width, height, labels: filled.labels, byId, regions };
}

// ------------------------------------------------------------ kontur çıkarma

export interface TracedContour {
  id: number;
  loops: Vec2[][];
  pathData: string;
}

/**
 * Etiket haritasındaki her bileşenin sınır konturlarını çıkarır.
 *
 * Ortak kullanılır: hem tek tek bölgeler (`buildGridDrawPlan`) hem de
 * birleştirilmiş silüet (`mergeFilledRegions`) buradan geçer. Böylece
 * "göz" ve "silüet" kavramları aynı sadeleştirme + kılavuza oturtma
 * hattından geçer ve çıktıları tutarlı olur.
 */
function traceContours(
  labels: Int32Array,
  width: number,
  height: number,
  guides: GridDrawGuides,
): TracedContour[] {
  // Çatlakları bölge bazında topla.
  const edgesByRegion = new Map<number, number[]>();
  const push = (region: number, ax: number, ay: number, bx: number, by: number) => {
    let list = edgesByRegion.get(region);
    if (!list) {
      list = [];
      edgesByRegion.set(region, list);
    }
    list.push(ax, ay, bx, by);
  };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const here = labels[row + x];

      if (x + 1 < width) {
        const right = labels[row + x + 1];
        if (here !== right) {
          const X = x + 1;
          // Sol taraftaki bölge: kenar AŞAĞI yönlü
          if (here !== 0) push(here, X, y, X, y + 1);
          // Sağ taraftaki bölge: kenar YUKARI yönlü
          if (right !== 0) push(right, X, y + 1, X, y);
        }
      }

      if (y + 1 < height) {
        const below = labels[row + width + x];
        if (here !== below) {
          const Y = y + 1;
          // Üstteki bölge: kenar SOLA yönlü
          if (here !== 0) push(here, x + 1, Y, x, Y);
          // Alttaki bölge: kenar SAĞA yönlü
          if (below !== 0) push(below, x, Y, x + 1, Y);
        }
      }
    }
  }

  /*
   * ARTBOARD KENARI.
   *
   * Izgaranın dışı "örnek yok" demektir; yukarıdaki komşuluk döngüsü bu
   * yüzden kenarda çatlak üretmez. Oysa birleştirme dolu alanı kenara kadar
   * genişlettiğinde bölgenin dış sınırı TAM olarak artboard kenarıdır ve
   * çatlağı yazılmazsa halka kapanmaz, köşe kaybolur (örneğin 2×2 blok
   * dörtgen yerine üçgen çıkar). Bu yüzden kenarı sanal bir komşu gibi
   * ele alıp çatlakları burada üretiyoruz.
   */
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const left = labels[row];
    if (left !== 0) push(left, 0, y + 1, 0, y);

    const rightEdge = labels[row + width - 1];
    if (rightEdge !== 0) push(rightEdge, width, y, width, y + 1);
  }
  for (let x = 0; x < width; x++) {
    const top = labels[x];
    if (top !== 0) push(top, x, 0, x + 1, 0);

    const bottom = labels[(height - 1) * width + x];
    if (bottom !== 0) push(bottom, x + 1, height, x, height);
  }

  const out: TracedContour[] = [];

  for (const [id, edges] of edgesByRegion) {
    const raw = chainLoops(edges, width, height);
    if (!raw.length) continue;

    const loops: Vec2[][] = [];
    for (const loop of raw) {
      /*
       * SIRA ÖNEMLİ: önce her noktayı GERÇEK kılavuza oturt, sonra
       * sadeleştir.
       *
       * - Oturtma sayesinde, merdiven görünümlü düz bir kenarın tüm
       *   noktaları tam olarak aynı çizgiye gelir; Douglas-Peucker bunları
       *   "sapma 0" görüp tek bir doğru parçasına indirir.
       * - Yayda ise noktalar tam daire üzerinde kalır, sapma gerçek olduğu
       *   için eğri korunur (yerel "komşulara göre doğrusal mı" testi
       *   yayları yanlışlıkla düzleştirirdi).
       * - DP yalnızca girdi noktalarını korur; dolayısıyla çıktı noktaları
       *   da kılavuz üzerinde kalır, ikinci bir oturtmaya gerek yoktur.
       */
      const snapped: Vec2[] = [];
      for (const p of loop) {
        const s = snapToGuides(p, guides);
        const prev = snapped[snapped.length - 1];
        if (prev && Math.abs(prev.x - s.x) < 0.01 && Math.abs(prev.y - s.y) < 0.01) continue;
        snapped.push(s);
      }
      // Kapanışta tekrar eden noktayı at
      if (snapped.length >= 2) {
        const first = snapped[0];
        const last = snapped[snapped.length - 1];
        if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) snapped.pop();
      }
      if (snapped.length < 3) continue;

      const simplified = simplifyPolyline(snapped, SIMPLIFY_TOL, true);
      const final = polishLoop(simplified, guides);
      if (final.length >= 3 && Math.abs(signedLoopArea([final])) > 1) loops.push(final);
    }
    if (!loops.length) continue;

    const pathData = loopsToPathData(loops);
    if (!pathData) continue;
    out.push({ id, loops, pathData });
  }

  return out;
}

// --------------------------------------------------------------- birleştirme

/**
 * BAĞLANTI genişletmesi: komşu bölgeler arasındaki duvarı yutmak için kaç
 * örnek genişletileceği. Duvar 2–3 örnek kalınlığındadır; 2 örnek her iki
 * durumu da kapatır.
 */
export const MERGE_CLOSE = 2;

/**
 * GEOMETRİ genişletmesi: konturlar bu maskeden çıkarılır.
 *
 * 1 örnek seçilmesi kritik: bölge sınırı duvarın 1 örnek içindedir, 1 örnek
 * genişletme sınırı TAM kılavuzun üstüne getirir. Daha fazlası sınırı
 * kılavuzun öbür tarafına taşırır; snapping o noktaları geri çekince sıraları
 * ters döner ve çıktıda zikzak/çentik oluşur.
 */
export const MERGE_SHAPE = 1;

export interface MergedShape {
  loops: Vec2[][];
  pathData: string;
  /** Silüet kaç ayrı parçadan oluşuyor (bitişik olmayan gruplar). */
  parts: number;
}

/**
 * Dolu bölgeleri TEK silüete indirir (Illustrator'daki Pathfinder → Unite
 * karşılığı).
 *
 * Yöntem iki ayrı maskeye dayanır ve bu ayrım kritiktir:
 *
 *   • BAĞLANTI (dilation 2): komşu iki dolu göz, aralarındaki kılavuz duvarı
 *     yutulunca aynı bileşene düşer. Hangi gözlerin bitişik sayılacağı burada
 *     belirlenir.
 *   • GEOMETRİ (dilation 1): sınır tam olarak kılavuzun ÜSTÜNE oturur.
 *     Daha fazla genişletmek sınırı kılavuzun öbür tarafına taşırır; o zaman
 *     snapping karşı taraftan gelen noktaları geri çekip sıralarını ters
 *     çevirir ve çıktıda zikzak/çentik oluşur. Bu yüzden geometri yalnızca
 *     1 örnek genişletilir.
 *
 * Konturlar GEOMETRİ maskesinden, etiketler ise BAĞLANTI maskesinden alınır:
 * böylece 3 örnek kalınlığındaki bir eğrisel duvarda kalan 1 örnek boşluk
 * "aynı etiket" olduğu için iç kenar sayılır ve tamamen kaybolur.
 */
export function mergeFilledRegions(
  plan: GridDrawPlan,
  fills: ReadonlySet<number>,
): MergedShape | null {
  if (!fills.size) return null;
  const { width, height, labels } = plan;
  const size = width * height;

  // 1 = silüetin dışı, 0 = silüet (dolu bölgeler)
  const barrier = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const id = labels[i];
    barrier[i] = id !== 0 && fills.has(id) ? 0 : 1;
  }

  // 1) Bağlantı: komşu gözler tek parça olsun.
  const connectivityMask = erode(barrier, width, height, MERGE_CLOSE);
  const connectivity = floodFill(connectivityMask, width, height);
  if (!connectivity.count) return null;

  // 2) Geometri: sınır kılavuzun üstüne otursun.
  const shapeMask = erode(barrier, width, height, MERGE_SHAPE);
  const shaped = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    shaped[i] = shapeMask[i] === 0 ? connectivity.labels[i] : 0;
  }

  // 3) Artakalan adacıkları at (alan GEOMETRİ maskesinden sayılır).
  const areas = new Map<number, number>();
  for (let i = 0; i < size; i++) {
    const id = shaped[i];
    if (id !== 0) areas.set(id, (areas.get(id) ?? 0) + 1);
  }
  for (let i = 0; i < size; i++) {
    const id = shaped[i];
    if (id !== 0 && (areas.get(id) ?? 0) < MIN_REGION_AREA) shaped[i] = 0;
  }

  // 3b) SAÇ TELİ ÇATLAKLARI KAPAT.
  //
  // Duvar (ızgara/daire/çapraz çizgisi) 3 örnek kalınlığındadır ve
  // MERGE_SHAPE=1 genişletmesi bandın ORTASINDA 1–2 örneklik bir kalıntı
  // bırakır. Tuvalde ızgara çizgisi bunu örttüğü için görünmez, ama temiz
  // (kılavuzsuz) SVG/PNG çıktısında dolu şeklin içinden geçen saç teli bir
  // ÇATLAK olarak çıkar. Burada yalnızca KARŞI İKİ YANINDA AYNI parça bulunan
  // (en çok `MERGE_CLOSE + 1` örnek ötede) kalıntılar o parçaya katılır;
  // böylece dış sınır ve komşuluk ilişkileri değişmez, kontur sırası bozulmaz.
  // Bir hücrenin binde biri kadar bir boşluk zaten tasarım olamaz.
  const REACH = MERGE_CLOSE + 1;
  const nearest = (from: number, step: number): number => {
    for (let k = 1; k <= REACH; k++) {
      const v = shaped[from + k * step];
      if (v !== 0) return v;
    }
    return 0;
  };
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (shaped[i] !== 0) continue;
      if (x >= REACH && x + REACH < width) {
        const left = nearest(i, -1);
        if (left !== 0 && left === nearest(i, 1)) {
          shaped[i] = left;
          continue;
        }
      }
      if (y >= REACH && y + REACH < height) {
        const up = nearest(i, -width);
        if (up !== 0 && up === nearest(i, width)) {
          shaped[i] = up;
          continue;
        }
      }
    }
  }

  const traced = traceContours(shaped, width, height, plan.guides);
  if (!traced.length) return null;

  const loops: Vec2[][] = [];
  for (const contour of traced) loops.push(...contour.loops);

  const pathData = loopsToPathData(loops);
  if (!pathData) return null;
  return { loops, pathData, parts: traced.length };
}

/**
 * Silüet dışını `steps` örnek ERODE eder; yani dolu alanı `steps` örnek
 * genişletir. Böylece iki dolu bölge arasındaki kılavuz duvarı kaybolur ve
 * ikisi tek parçaya birleşir.
 */
function erode(barrier: Uint8Array, width: number, height: number, steps: number): Uint8Array {
  const size = width * height;
  let current = barrier;
  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(current);
    for (let i = 0; i < size; i++) {
      if (current[i] === 0) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (
        (x > 0 && current[i - 1] === 0) ||
        (x + 1 < width && current[i + 1] === 0) ||
        (y > 0 && current[i - width] === 0) ||
        (y + 1 < height && current[i + width] === 0)
      ) {
        next[i] = 0;
      }
    }
    current = next;
  }
  return steps === 0 ? barrier : current;
}

// ------------------------------------------------------------------ aynalama

export type MirrorMode = 'none' | 'x' | 'y' | 'quad';

export const MIRROR_LABELS: Record<MirrorMode, string> = {
  none: 'Kapalı',
  x: '↔ Yatay',
  y: '↕ Dikey',
  quad: '4 yön',
};

/**
 * Bir örnek noktasının aynadaki karşılıklarını verir.
 *
 * Örnek (x, y) artboard'da [x, x+1] × [y, y+1] aralığını kaplar, merkezi
 * x+0.5'tir. Artboard merkezine (width/2) göre aynası x' = width − x − 1 olur;
 * bu, ızgara ve daireler merkeze göre simetrik olduğu için bölge yapısını da
 * tam olarak eşler.
 */
export function mirrorSample(sample: Vec2, width: number, height: number, mode: MirrorMode): Vec2[] {
  if (mode === 'none') return [];
  const mx = width - sample.x - 1;
  const my = height - sample.y - 1;
  if (mode === 'x') return [{ x: mx, y: sample.y }];
  if (mode === 'y') return [{ x: sample.x, y: my }];
  return [
    { x: mx, y: sample.y },
    { x: sample.x, y: my },
    { x: mx, y: my },
  ];
}

/**
 * Verilen bölgelerin aynadaki karşılıklarını bulur.
 * Dönen küme kaynakları içermez.
 */
export function mirrorRegions(
  plan: GridDrawPlan,
  ids: Iterable<number>,
  mode: MirrorMode,
): Set<number> {
  const result = new Set<number>();
  if (mode === 'none') return result;
  for (const id of ids) {
    const region = plan.byId[id];
    if (!region) continue;
    for (const point of mirrorSample(region.sample, plan.width, plan.height, mode)) {
      const mirrored = regionAt(plan, point);
      if (mirrored !== 0 && mirrored !== id) result.add(mirrored);
    }
  }
  return result;
}

// -------------------------------------------------------------- yardımcılar

/** Artboard koordinatındaki bölgeyi bulur; duvarda/boşlukta 0 döner. */
export function regionAt(plan: GridDrawPlan, p: Vec2): number {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= plan.width || y >= plan.height) return 0;
  return plan.labels[y * plan.width + x];
}

/**
 * Bir dairenin İÇİNDEKİ (ya da DIŞINDAKİ) bütün bölgeleri toplar.
 *
 * Daire bir duvar olduğu için hiçbir bölge yayı ortadan kesmez; her bölge
 * kendi temsil örneğiyle sınıflandırılır. Dairenin içindeki tüm bölgelerin
 * birleşimi **tam olarak daire diski** olur — böylece tek hamlede dolu bir
 * daire elde edilir.
 */
export function regionsInDisc(
  plan: GridDrawPlan,
  cx: number,
  cy: number,
  r: number,
  mode: 'in' | 'out' = 'in',
): number[] {
  const wantInside = mode === 'in';
  const r2 = r * r;
  const ids: number[] = [];
  for (const region of plan.regions) {
    const dx = region.sample.x - cx;
    const dy = region.sample.y - cy;
    const inside = dx * dx + dy * dy <= r2;
    if (inside === wantInside) ids.push(region.id);
  }
  return ids;
}

/**
 * Bir kılavuz çizgisinin bir YANINDAKİ bütün bölgeleri toplar.
 *
 * `side` +1 → çizginin "pozitif" tarafı, -1 → öbür taraf.
 */
export function regionsOnSide(plan: GridDrawPlan, a: Vec2, b: Vec2, side: 1 | -1): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ids: number[] = [];
  for (const region of plan.regions) {
    const cross = dx * (region.sample.y - a.y) - dy * (region.sample.x - a.x);
    if (Math.sign(cross) === side) ids.push(region.id);
  }
  return ids;
}

/**
 * Verilen noktaya en yakın kılavuzu bulur (tolerans içindeyse).
 *
 * Taşıma aracı bunu kullanır: çizginin üzerine ya da dairenin çemberine
 * yakın tıklamak o kılavuzu yakalar.
 */
export function guideNear(guideList: GuideShape[], p: Vec2, tol: number): GuideShape | null {
  let best: GuideShape | null = null;
  let bestDistance = tol;
  for (const guide of guideList) {
    const distance =
      guide.kind === 'circle'
        ? Math.abs(Math.hypot(p.x - guide.cx, p.y - guide.cy) - guide.r)
        : projectOnSegment(p, { x: guide.ax, y: guide.ay }, { x: guide.bx, y: guide.by }).distance;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = guide;
    }
  }
  return best;
}

/**
 * Örnek noktaların tam kılavuz sınırına düşmemesi için küçük kaydırma.
 *
 * Tam olarak ızgara kavşağından geçen bir fırça izi (örneğin 45° çapraz)
 * aksi halde hiçbir bölgeye denk gelmezdi: `regionAt` sınır örneğinde 0 döner.
 */
export const SAMPLE_JITTER = { x: 0.37, y: 0.61 } as const;

/**
 * İki bölge kimliği kümesinin kesişimi.
 *
 * "Daralt" (Illustrator → Pathfinder/Intersect) bunu kullanır: mevcut dolgu,
 * seçilen kılavuzun içi/dışı ya da bir yanı ile kesiştirilir. Böylece
 * halka ∩ çizginin bir yanı = **yay** (uçları tam çizgide kesilir).
 */
export function intersectIds(fills: ReadonlySet<number>, keep: readonly number[]): Set<number> {
  const allowed = new Set(keep);
  const out = new Set<number>();
  for (const id of fills) if (allowed.has(id)) out.add(id);
  return out;
}

/**
 * Dikdörtgen bir alanın içindeki bütün bölgeleri toplar.
 *
 * Alan süpürme (Shift + sürükle) bunu kullanır: büyük bir bölgeyi fareyle
 * tarayıp tek hamlede doldurmak/silmek için. Sınırlar dahildir.
 */
export function regionsInRect(plan: GridDrawPlan, a: Vec2, b: Vec2): number[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const ids: number[] = [];
  for (const region of plan.regions) {
    const { x, y } = region.sample;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) ids.push(region.id);
  }
  return ids;
}

/**
 * Bir fırça izinin (`from` → `to`) süpürdüğü bütün bölgeleri toplar.
 *
 * Fare olayları arasında kalan hücreler atlanmasın diye iki nokta arası
 * adımlanır. Adım hücrenin üçte biridir: eksen hizalı bir izde hiçbir hücre
 * atlanmaz, çapraz izde de iz boyunca ilerlenir.
 */
export function strokeRegions(plan: GridDrawPlan, from: Vec2, to: Vec2): number[] {
  const step = Math.max(2, Math.min(plan.guides.cellW, plan.guides.cellH) / 3);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.max(1, Math.ceil(distance / step));
  const ids = new Set<number>();
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const id = regionAt(plan, {
      x: from.x + (to.x - from.x) * t + SAMPLE_JITTER.x,
      y: from.y + (to.y - from.y) * t + SAMPLE_JITTER.y,
    });
    if (id && plan.byId[id]) ids.add(id);
  }
  return [...ids];
}

/**
 * Dolgu kümesini yeni plana taşır: her dolu bölgenin temsili noktası yeni
 * planda hangi bölgeye düşüyorsa o doldurulur. Böylece grid/daire ayarı
 * değiştiğinde seçimler kaybolmaz.
 */
export function remapFills(
  fills: ReadonlySet<number>,
  previous: GridDrawPlan,
  next: GridDrawPlan,
): Set<number> {
  const result = new Set<number>();
  for (const id of fills) {
    const region = previous.byId[id];
    if (!region) continue;
    const mapped = regionAt(next, region.sample);
    if (mapped !== 0) result.add(mapped);
  }
  return result;
}

/** Ayarların bölge yapısını etkileyip etkilemediğini söyler. */
export function structureChanged(a: GridDrawSettings, b: GridDrawSettings): boolean {
  if (a.grid !== b.grid || a.size !== b.size) return true;
  if (a.guides.length !== b.guides.length) return true;
  return a.guides.some((guide, i) => !sameGuide(guide, b.guides[i]));
}
