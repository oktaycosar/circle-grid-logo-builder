import type { ArtboardObject, Geometry, GridSettings, LayerInfo, Vec2 } from './types.ts';
import { ARTBOARD_SIZE } from './types.ts';
import { booleanGeometry, loopsToPolygonGeometry, uniteAll } from './boolean.ts';
import {
  BLACK,
  makeCircle,
  makeGuideCircle,
  makeGuideLine,
  makeRect,
  makeRing,
  objectFromGeometry,
} from './factory.ts';

/**
 * Varsayılan demo proje: referans videodaki "circle logo design using grid"
 * yöntemiyle üretilmiş SAD monogramı.
 *
 * Önemli: bu demo TAMAMEN uygulamanın kendi boolean motoruyla kurulur —
 * harfler dikdörtgen/üçgen parçalardan unite edilir, negatif alanlar subtract
 * ile açılır ve harflerin dış kenarları dairenin eğrisine `intersect` ile
 * oturtulur. Yani demo aynı zamanda motorun canlı testidir.
 */

const CX = 500;
const CY = 500;
const RING_OUTER = 400;
const RING_THICKNESS = 24;
const CLIP_R = 352;
const BAND_TOP = 330;
const BAND_BOTTOM = 670;

export interface DemoProject {
  objects: ArtboardObject[];
  layers: LayerInfo[];
  grid: GridSettings;
}

export const DEMO_LAYER_NAMES = [
  'Grid',
  'Guides',
  'Inner Boundary',
  'Outer Ring',
  'Letter S',
  'Letter A',
  'Letter D',
] as const;

export const LAYER = {
  grid: 0,
  guides: 1,
  innerBoundary: 2,
  outerRing: 3,
  letterS: 4,
  letterA: 5,
  letterD: 6,
} as const;

// ------------------------------------------------------------ geometri yardımcıları

const rect = (x: number, y: number, width: number, height: number): Geometry => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
});

const disc = (cx: number, cy: number, r: number): Geometry => ({ kind: 'circle', cx, cy, r });

const poly = (points: Vec2[]): Geometry => ({ kind: 'polygon', keypoints: points });

function unite(geometries: Geometry[]): Geometry {
  return loopsToPolygonGeometry(uniteAll(geometries));
}

function op(a: Geometry, b: Geometry, kind: 'intersect' | 'subtract' | 'unite'): Geometry {
  return loopsToPolygonGeometry(booleanGeometry(a, b, kind));
}

// ------------------------------------------------------------------ harfler

/** 5 satırlı blok yapıdan geometrik S (dikey + yatay barlar). */
function buildLetterS(): Geometry {
  const x0 = 175;
  const x1 = 425;
  const left = 275;
  const right = 325;
  const rows = 5;
  const rowHeight = (BAND_BOTTOM - BAND_TOP) / rows;

  const bars: Geometry[] = [];
  // Satır 1 (üst bar) — tam genişlik
  bars.push(rect(x0, BAND_TOP, x1 - x0, rowHeight));
  // Satır 2 (sol dikey)
  bars.push(rect(x0, BAND_TOP + rowHeight, left - x0, rowHeight));
  // Satır 3 (orta bar) — tam genişlik
  bars.push(rect(x0, BAND_TOP + rowHeight * 2, x1 - x0, rowHeight));
  // Satır 4 (sağ dikey)
  bars.push(rect(right, BAND_TOP + rowHeight * 3, x1 - right, rowHeight));
  // Satır 5 (alt bar) — tam genişlik
  bars.push(rect(x0, BAND_TOP + rowHeight * 4, x1 - x0, rowHeight));

  return unite(bars);
}

/** Ortadaki geometrik A: üçgen dış form, dikey dikdörtgen negatif alan. */
function buildLetterA(): Geometry {
  const apex: Vec2 = { x: 540, y: BAND_TOP };
  const leftBase: Vec2 = { x: 455, y: BAND_BOTTOM };
  const rightBase: Vec2 = { x: 625, y: BAND_BOTTOM };
  const outer = poly([apex, rightBase, leftBase]);
  // Spesifikasyon 16: A'nın negatif alanı dikey dikdörtgen counter.
  const counter = rect(512, 445, 56, 125);
  return op(outer, counter, 'subtract');
}

/** Sağdaki D: dikey bar + daireden türetilmiş dış eğri (bowl). */
function buildLetterD(): Geometry {
  const barLeft = 660;
  const barRight = 760;
  const bowlRadius = 180;
  const bowlStroke = 100;

  const bar = rect(barLeft, BAND_TOP, barRight - barLeft, BAND_BOTTOM - BAND_TOP);
  const clip = rect(barLeft, BAND_TOP, 320, BAND_BOTTOM - BAND_TOP);

  // Dış yay: bar sol kenarını merkez alan dairenin sağ yarısı.
  const outerArc = op(disc(barLeft, CY, bowlRadius), clip, 'intersect');
  // İç boşluk (counter): aynı merkezli, kalınlık kadar küçük yarıçap.
  const innerArc = op(disc(barLeft, CY, bowlRadius - bowlStroke), clip, 'intersect');

  const solid = op(bar, outerArc, 'unite');
  return op(solid, innerArc, 'subtract');
}

/** Harfin dış kenarlarını dairenin eğrisine oturtur (madde 12). */
function clipToCircle(geometry: Geometry, r: number): Geometry {
  return op(geometry, disc(CX, CY, r), 'intersect');
}

// ------------------------------------------------------------ katman iskeleti

function buildLayers(): LayerInfo[] {
  return DEMO_LAYER_NAMES.map((name, index) => ({
    id: `layer-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    visible: true,
    locked: false,
    order: index,
  }));
}

// ------------------------------------------------------------------ üretim

export function createDemoProject(): DemoProject {
  const objects: ArtboardObject[] = [];

  // --- Grid katmanı: artboard sınır çerçevesi (konstrüksiyon yardımcısı)
  objects.push(
    makeRect(0, 0, ARTBOARD_SIZE, ARTBOARD_SIZE, {
      name: 'Artboard Boundary',
      layerIndex: LAYER.grid,
      fill: { type: 'none' },
      stroke: '#5a6472',
      strokeWidth: 1,
      locked: true,
      strokeOnly: true,
    }),
  );

  // --- Guides katmanı: merkez ekseni + dış çember konstrüksiyonu
  objects.push(makeGuideLine(CX, 0, CX, ARTBOARD_SIZE, 'Center Vertical'));
  objects.push(makeGuideLine(0, CY, ARTBOARD_SIZE, CY, 'Center Horizontal'));
  objects.push(makeGuideCircle(CX, CY, CLIP_R, 'Inner Construction Circle'));
  objects.push(makeGuideCircle(CX, CY, RING_OUTER, 'Ring Outer Edge'));
  objects.push(makeGuideCircle(CX, CY, RING_OUTER - RING_THICKNESS, 'Ring Inner Edge'));

  // --- Inner Boundary: dış halkanın iç sınırı (görünür, siyah ince çizgi)
  objects.push(
    makeCircle(CX, CY, RING_OUTER - RING_THICKNESS, {
      name: 'Inner Boundary',
      layerIndex: LAYER.innerBoundary,
      fill: { type: 'none' },
      stroke: BLACK,
      strokeWidth: 2,
      strokeOnly: true,
    }),
  );

  // --- Outer Ring: fill tabanlı gerçek halka (stroke'a bağımlı değil)
  objects.push(
    makeRing(CX, CY, RING_OUTER, RING_THICKNESS, {
      name: 'Outer Ring',
      layerIndex: LAYER.outerRing,
      fill: { type: 'solid', color: BLACK },
      stroke: 'none',
      strokeWidth: 0,
    }),
  );

  // --- Harfler: birleştir -> negatif alan -> daireye kırp
  const letterS = objectFromGeometry(clipToCircle(buildLetterS(), CLIP_R), {
    name: 'Letter S',
    layerIndex: LAYER.letterS,
    fill: { type: 'solid', color: BLACK },
  });
  const letterA = objectFromGeometry(clipToCircle(buildLetterA(), CLIP_R), {
    name: 'Letter A',
    layerIndex: LAYER.letterA,
    fill: { type: 'solid', color: BLACK },
  });
  const letterD = objectFromGeometry(clipToCircle(buildLetterD(), CLIP_R), {
    name: 'Letter D',
    layerIndex: LAYER.letterD,
    fill: { type: 'solid', color: BLACK },
  });

  objects.push(letterS, letterA, letterD);

  return {
    objects,
    layers: buildLayers(),
    grid: {
      enabled: true,
      snap: true,
      size: 50,
      divisions: 2,
      opacity: 0.55,
      majorEvery: 4,
    },
  };
}

/** Demo harflerinin renklerini değiştirmek için yardımcı (test). */
export { CX as DEMO_CX, CY as DEMO_CY, CLIP_R as DEMO_CLIP_R };
