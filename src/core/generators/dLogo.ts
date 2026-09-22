import type { ArtboardObject, Geometry, Vec2 } from '../types.ts';
import { ARTBOARD_SIZE } from '../types.ts';
import { objectFromGeometry } from '../factory.ts';

/**
 * GRID D LOGO GENERATOR
 * =====================
 *
 * Referans videodaki ("D Logo Design Tutorial Using Grid Method") yöntemin
 * parametrik karşılığı.
 *
 * Videoda yapılan iş:
 *   1. Eşit aralıklı yatay barlardan bir şerit deseni (pattern brush) kurulur.
 *   2. D şeklinde tek bir path çizilir (düz sol kenar + dairesel sağ gövde).
 *   3. Şerit deseni bu path'e fırça olarak uygulanır; böylece D bölgesi
 *      birbirine paralel eşit kalınlıkta bantlara ayrılır.
 *
 * Buradaki karşılığı, aynı sonucu GERÇEK dolgu geometrisiyle üretir:
 *   - D bölgesi analitik olarak tanımlanır (sol dikdörtgen + yarım daire).
 *   - Bölgenin `d` kadar içe kaydırılmış hali de yine bir D bölgesidir:
 *       sol = sol + d, üst = üst + d, alt = alt - d, yay yarıçapı = R - d
 *     (yay merkezinin x'i değişmez).
 *   - i. bant = D_in(i·adım) \ D_in(i·adım + kalınlık)
 *   - Böylece her bant iki loop'lu tek bir path olur (even-odd ile oyulur),
 *     stroke'a bağımlı değildir ve SVG export'ta birebir aynı görünür.
 *
 * Tüm ölçüler IZGARA HÜCRESİ cinsindendir; grid değiştiğinde logo da
 * grid ile birlikte ölçeklenir (videodaki "grid method" mantığı).
 */

export interface DLogoParams {
  /** Bir ızgara hücresinin artboard birimi karşılığı. */
  cell: number;
  /** D'nin sol üst köşesi (artboard birimi). */
  originX: number;
  originY: number;
  /** D yüksekliği (hücre). Gövde yarıçapı = heightCells / 2. */
  heightCells: number;
  /** Sol kenardan yay merkezine olan mesafe (hücre) = gövde genişliği. */
  stemCells: number;
  /** Siyah bant kalınlığı (hücre). */
  bandCells: number;
  /** Beyaz boşluk (hücre). */
  gapCells: number;
  /** Sol köşelerin yuvarlaklığı (hücre). */
  cornerCells: number;
  /** Üretilecek bant sayısı. 0 = otomatik (sığdığı kadar). */
  bands: number;
  /** Bantların içine ek olarak ince bir kontur çizilsin mi (video sonu). */
  outline?: boolean;
}

export const DEFAULT_D_PARAMS: DLogoParams = {
  cell: 50,
  originX: 200,
  originY: 200,
  heightCells: 12,
  stemCells: 6,
  bandCells: 0.8,
  gapCells: 0.2,
  cornerCells: 0.25,
  bands: 0,
};

/** Türetilmiş ölçüler (artboard birimi). */
export interface DLogoMetrics {
  cell: number;
  left: number;
  top: number;
  bottom: number;
  height: number;
  width: number;
  radius: number;
  stem: number;
  arcCenterX: number;
  band: number;
  gap: number;
  pitch: number;
  corner: number;
  /** Sığabilecek en fazla bant sayısı. */
  maxBands: number;
  /** Kullanılacak bant sayısı. */
  bandCount: number;
}

/** Eksik alanları varsayılanlarla tamamlar (kısmi parametre kabul edilir). */
export function withDefaults(params: Partial<DLogoParams>): DLogoParams {
  return { ...DEFAULT_D_PARAMS, ...params };
}

export function dLogoMetrics(params: DLogoParams): DLogoMetrics {
  const cell = Math.max(1, params.cell);
  const height = Math.max(cell, params.heightCells * cell);
  const stem = Math.max(cell * 0.5, params.stemCells * cell);
  const radius = height / 2;
  const band = Math.max(0.5, params.bandCells * cell);
  const gap = Math.max(0, params.gapCells * cell);
  const pitch = band + gap;
  const corner = Math.max(0, params.cornerCells * cell);

  // İçe kaydırma, min(gövde genişliği, yarıçap) sınırına ulaşınca bölge yok olur.
  // i. bandın geçerli olması için: i·adım + kalınlık < limit
  const limit = Math.min(stem, radius);
  let maxBands = 0;
  while (maxBands < 512 && maxBands * pitch + band < limit) maxBands++;

  const bandCount = params.bands > 0 ? Math.min(Math.floor(params.bands), maxBands) : maxBands;

  return {
    cell,
    left: params.originX,
    top: params.originY,
    bottom: params.originY + height,
    height,
    width: stem + radius,
    radius,
    stem,
    arcCenterX: params.originX + stem,
    band,
    gap,
    pitch,
    corner,
    maxBands,
    bandCount,
  };
}

// ------------------------------------------------------------- D konturu

export interface DOutlineOptions {
  /** Dışa doğru negatif olabilir. */
  inset: number;
  /** Sol köşe yuvarlaklığı (inset zaten düşülmüş). */
  cornerRadius: number;
  /** Yay için örnek sayısı. */
  arcSegments?: number;
}

/**
 * D bölgesinin `inset` kadar içe kaydırılmış sınırını saat yönünde üretir.
 *
 * Sıra: sol-alt köşe → yukarı → sol-üst köşe → sağa (üst kenar) →
 * yay (yukarıdan aşağı) → sola (alt kenar) → kapanış.
 */
export function dOutline(metrics: DLogoMetrics, options: DOutlineOptions): Vec2[] {
  const { inset, cornerRadius } = options;
  const segments = options.arcSegments ?? 96;

  const left = metrics.left + inset;
  const top = metrics.top + inset;
  const bottom = metrics.bottom - inset;
  const radius = metrics.radius - inset;
  if (radius <= 0 || top >= bottom) return [];

  const cy = (top + bottom) / 2;
  const cx = metrics.arcCenterX;
  const rc = Math.max(0, Math.min(cornerRadius, radius, metrics.stem - inset));

  const points: Vec2[] = [];

  const cornerSteps = 12;
  const addCorner = (ccx: number, ccy: number, startDeg: number, endDeg: number) => {
    for (let i = 0; i <= cornerSteps; i++) {
      const a = ((startDeg + ((endDeg - startDeg) * i) / cornerSteps) * Math.PI) / 180;
      points.push({ x: ccx + Math.cos(a) * rc, y: ccy + Math.sin(a) * rc });
    }
  };

  // Sol-alt köşe: 90° → 180°
  if (rc > 0) addCorner(left + rc, bottom - rc, 90, 180);
  else points.push({ x: left, y: bottom });

  // Sol kenar yukarı
  if (rc > 0) points.push({ x: left, y: top + rc });

  // Sol-üst köşe: 180° → 270°
  if (rc > 0) addCorner(left + rc, top + rc, 180, 270);
  else points.push({ x: left, y: top });

  // Üst kenar sağa, yay başlangıcına kadar
  if (cx > left + rc + 0.001) points.push({ x: cx, y: top });

  // Sağ yay: -90° → +90° (yukarıdan aşağı, sağa doğru)
  for (let i = 0; i <= segments; i++) {
    const a = (-90 + (180 * i) / segments) * (Math.PI / 180);
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }

  // Alt kenar sola
  if (cx > left + rc + 0.001) points.push({ x: left + rc, y: bottom });

  return dedupe(points);
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ üretim

export interface DLogoBuild {
  objects: ArtboardObject[];
  metrics: DLogoMetrics;
  warnings: string[];
}

/**
 * Parametrelere göre D logosunu üretir.
 * Sonuç: her biri iki loop'lu (dış + iç sınır) gerçek dolgu geometrisi olan
 * bantlar; ayrıca isteğe bağlı konstrüksiyon guide'ları.
 */
export function buildDLogo(
  paramsInput: Partial<DLogoParams>,
  options: { layerIndex: number; withGuides: boolean; guideLayerIndex: number; fill?: string },
): DLogoBuild {
  const params = withDefaults(paramsInput);
  const metrics = dLogoMetrics(params);
  const warnings: string[] = [];
  const objects: ArtboardObject[] = [];

  const limit = Math.min(metrics.stem, metrics.radius);
  for (let i = 0; i < metrics.bandCount; i++) {
    const outerInset = i * metrics.pitch;
    const innerInset = outerInset + metrics.band;
    if (innerInset >= limit) break;

    const outer = dOutline(metrics, { inset: outerInset, cornerRadius: metrics.corner - outerInset });
    // İç sınır TERS yönde verilir: böylece hem even-odd hem nonzero dolgu
    // kurallarında doğru delik oluşur ve işaretli alan gerçek alana eşit olur.
    const innerRaw = dOutline(metrics, { inset: innerInset, cornerRadius: metrics.corner - innerInset });
    const inner = [...innerRaw].reverse();
    if (outer.length < 3) continue;

    const geometry: Geometry =
      inner.length >= 3
        ? { kind: 'polygon', keypoints: outer, extraLoops: [inner] }
        : { kind: 'polygon', keypoints: outer };

    objects.push(
      objectFromGeometry(geometry, {
        name: `D Band ${i + 1}`,
        layerIndex: options.layerIndex,
        fill: { type: 'solid', color: options.fill ?? '#000000' },
        stroke: 'none',
        strokeWidth: 0,
        type: 'polygon',
      }),
    );
  }

  if (!objects.length) warnings.push('Bant üretilemedi — parametreleri kontrol edin (kalınlık çok büyük olabilir).');

  const residual = limit - (metrics.bandCount - 1) * metrics.pitch - metrics.band - metrics.gap;
  if (residual > metrics.pitch) {    warnings.push(
      `Merkezde ${residual.toFixed(1)} birimlik boş alan kaldı; bant sayısını artırabilirsiniz (en fazla ${metrics.maxBands}).`,
    );
  }

  if (options.withGuides) {
    objects.push(...buildConstructionGuides(metrics, options.guideLayerIndex));
  }

  return { objects, metrics, warnings };
}

/** Konstrüksiyon yardımcıları: temel D konturu, yay merkezi, ızgara hücresi. */
export function buildConstructionGuides(metrics: DLogoMetrics, layerIndex: number): ArtboardObject[] {
  const guides: ArtboardObject[] = [];

  const addPath = (name: string, geometry: Geometry) => {
    guides.push(
      objectFromGeometry(geometry, {
        name,
        layerIndex,
        fill: { type: 'none' },
        stroke: '#8b7cf6',
        strokeWidth: 1.5,
        strokeOnly: true,
        type: 'path',
        isGuide: true,
      }),
    );
  };

  // Temel (inset 0) D konturu
  addPath('D Outline (base)', { kind: 'polygon', keypoints: dOutline(metrics, { inset: 0, cornerRadius: metrics.corner }) });

  // Gövde dairesi (yay merkezinde, yarıçap = yükseklik/2)
  addPath('Bowl Circle', {
    kind: 'circle',
    cx: metrics.arcCenterX,
    cy: (metrics.top + metrics.bottom) / 2,
    r: metrics.radius,
  });

  // Sol sınır çizgisi (yay merkezi hizası)
  addPath('Stem Line', {
    kind: 'line',
    x1: metrics.arcCenterX,
    y1: metrics.top,
    x2: metrics.arcCenterX,
    y2: metrics.bottom,
  });

  // Izgara hücresi göstergesi (sol üst köşede)
  addPath('Cell Reference', {
    kind: 'rect',
    x: metrics.left - metrics.cell,
    y: metrics.top,
    width: metrics.cell,
    height: metrics.cell,
  });

  return guides;
}

// ---------------------------------------------------------------- ön ayarlar

export interface DLogoPreset {
  id: string;
  name: string;
  description: string;
  params: Partial<DLogoParams>;
}

export const D_PRESETS: DLogoPreset[] = [
  {
    id: 'video',
    name: 'Video (6 bant)',
    description: 'Referans videodaki oranlar: kalın siyah bant, ince beyaz boşluk, 6 bant.',
    params: { heightCells: 12, stemCells: 6, bandCells: 0.8, gapCells: 0.2, cornerCells: 0.25, bands: 0 },
  },
  {
    id: 'bold',
    name: 'Kalın bantlar',
    description: 'Daha az sayıda, daha kalın bant.',
    params: { heightCells: 10, stemCells: 5, bandCells: 1.6, gapCells: 0.4, cornerCells: 0.2, bands: 3 },
  },
  {
    id: 'fine',
    name: 'İnce bantlar',
    description: 'Yüksek yoğunluklu ince şeritler.',
    params: { heightCells: 14, stemCells: 7, bandCells: 0.5, gapCells: 0.25, cornerCells: 0.3, bands: 0 },
  },
  {
    id: 'sharp',
    name: 'Keskin köşe',
    description: 'Yuvarlatma olmadan, tam ızgara hizalı köşeler.',
    params: { heightCells: 12, stemCells: 6, bandCells: 0.8, gapCells: 0.2, cornerCells: 0, bands: 0 },
  },
  {
    id: 'rounded',
    name: 'Yuvarlak köşe',
    description: 'Belirgin yuvarlatılmış sol köşeler.',
    params: { heightCells: 12, stemCells: 6, bandCells: 0.8, gapCells: 0.24, cornerCells: 1, bands: 0 },
  },
];

/** Izgaraya göre logoyu ortalar ve tüm ölçüleri hücreye kilitler. */
export function centerDLogoOnArtboard(paramsInput: Partial<DLogoParams>, artboardSize = ARTBOARD_SIZE): DLogoParams {
  const params = withDefaults(paramsInput);
  const cell = Math.max(1, params.cell);
  const metrics = dLogoMetrics(params);
  const width = metrics.width;
  const height = metrics.height;

  const x = Math.round((artboardSize - width) / 2 / cell) * cell;
  const y = Math.round((artboardSize - height) / 2 / cell) * cell;

  return { ...params, originX: x, originY: y };
}

/** Grid ayarlarından hücre boyutunu türetir (grid method). */
export function cellFromGrid(gridCellSize: number, divisions: number): number {
  return gridCellSize / Math.max(1, divisions);
}
