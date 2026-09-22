import type { Geometry, Vec2 } from './types.ts';

/**
 * AUTO GUIDE MODE — geometrik harf iskeleti kütüphanesi (spesifikasyon 11).
 *
 * Her harf 0..1 × 0..1 birim kutusunda (y aşağı) tanımlanır ve yalnızca
 * temel primitiflerden kurulur: dikdörtgen, çokgen ve yay. Negatif
 * primitifler `boolean subtract` ile açılır.
 *
 * Sonuç bir "taslaktır": kesin nihai logo değil, grid üzerinde
 * düzenlenebilecek geometrik iskelettir. Kullanıcı parçaları unite/subtract
 * ederek videodaki yöntemle kendi harfini kurar.
 */

export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'poly'; points: Vec2[] };

export interface LetterSpec {
  /** Birleştirilecek pozitif parçalar. */
  solids: Prim[];
  /** Sırayla subtract edilecek negatif alanlar. */
  negatives: Prim[];
}

export const STEM = 0.22;

// ------------------------------------------------------------------ primitifler

const r = (x: number, y: number, w: number, h: number): Prim => ({ k: 'rect', x, y, w, h });
const poly = (points: Vec2[]): Prim => ({ k: 'poly', points });

/** Merkezi (cx,cy), yarıçapları (rx,ry) olan yaydan çokgen üretir. */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  segments = 40,
): Vec2[] {
  const points: Vec2[] = [];
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = (endDeg * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return points;
}

/** Sağ yarım elips göbek — sol kenarı bar'ın sağ kenarına oturur (D/B/P/R). */
function bowl(rightRadius: number, cy: number, ry: number): Prim {
  return poly(arc(STEM, cy, rightRadius, ry, -90, 90, 28));
}

/** Alt yarım elips taban (U/J). */
function bottomBowl(cx: number, cy: number, rx: number, ry: number): Prim {
  return poly(arc(cx, cy, rx, ry, 0, 180, 28));
}

function disc(cx: number, cy: number, radius: number): Prim {
  return poly(arc(cx, cy, radius, radius, 0, 360, 64));
}

// -------------------------------------------------------------------- harfler

/** 5 satırlı blok yapıdan S — saf dikey/yatay bar konstrüksiyonu. */
function letterS(): LetterSpec {
  const h = 0.2;
  const left = 0.26;
  const right = 0.74;
  return {
    solids: [
      r(0, 0, 1, h),
      r(0, h, left, h),
      r(0, h * 2, 1, h),
      r(right, h * 3, 1 - right, h),
      r(0, h * 4, 1, h),
    ],
    negatives: [],
  };
}

function letterC(): LetterSpec {
  return { solids: [disc(0.5, 0.5, 0.5)], negatives: [disc(0.5, 0.5, 0.28), r(0.5, 0.24, 0.5, 0.52)] };
}

function letterO(): LetterSpec {
  return { solids: [disc(0.5, 0.5, 0.5)], negatives: [disc(0.5, 0.5, 0.28)] };
}

function letterG(): LetterSpec {
  return {
    solids: [disc(0.5, 0.5, 0.5), r(0.55, 0.44, 0.45, STEM), r(1 - STEM, 0.44, STEM, 0.4)],
    negatives: [disc(0.5, 0.5, 0.28), r(0.5, 0.22, 0.5, 0.22)],
  };
}

function letterD(): LetterSpec {
  const outerRight = 1 - STEM;
  const innerRight = outerRight - STEM;
  return {
    solids: [r(0, 0, STEM, 1), bowl(outerRight, 0.5, 0.5)],
    negatives: [bowl(innerRight, 0.5, 0.5 - STEM)],
  };
}

function letterP(): LetterSpec {
  return {
    solids: [r(0, 0, STEM, 1), bowl(0.4, 0.25, 0.25)],
    negatives: [bowl(0.4 - STEM, 0.25, 0.25 - STEM)],
  };
}

function letterR(): LetterSpec {
  const base = letterP();
  return {
    solids: [
      ...base.solids,
      poly([
        { x: 0.42, y: 0.5 },
        { x: 0.62, y: 0.5 },
        { x: 1, y: 1 },
        { x: 0.74, y: 1 },
      ]),
    ],
    negatives: base.negatives,
  };
}

function letterB(): LetterSpec {
  return {
    solids: [r(0, 0, STEM, 1), bowl(0.24, 0.24, 0.24), bowl(0.24, 0.76, 0.24)],
    negatives: [bowl(0.24 - STEM, 0.24, 0.24 - STEM), bowl(0.24 - STEM, 0.76, 0.24 - STEM)],
  };
}

function letterU(): LetterSpec {
  return {
    solids: [r(0, 0, STEM, 0.72), r(1 - STEM, 0, STEM, 0.72), bottomBowl(0.5, 0.72, 0.5, 0.28)],
    negatives: [],
  };
}

function letterJ(): LetterSpec {
  return { solids: [r(1 - STEM, 0, STEM, 0.72), bottomBowl(0.5, 0.72, 0.5, 0.28)], negatives: [] };
}

function letterQ(): LetterSpec {
  return {
    solids: [
      disc(0.5, 0.5, 0.5),
      poly([
        { x: 0.58, y: 0.72 },
        { x: 0.76, y: 0.72 },
        { x: 1, y: 1 },
        { x: 0.82, y: 1 },
      ]),
    ],
    negatives: [disc(0.5, 0.5, 0.28)],
  };
}

// ---------------------------------------------------------------- kütüphane

export const LETTER_LIBRARY: Record<string, LetterSpec> = {
  A: {
    solids: [poly([{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])],
    negatives: [r(0.37, 0.42, 0.26, 0.34)],
  },
  B: letterB(),
  C: letterC(),
  D: letterD(),
  E: {
    solids: [r(0, 0, 0.26, 1), r(0, 0, 0.78, STEM), r(0, 0.39, 0.64, STEM), r(0, 1 - STEM, 0.78, STEM)],
    negatives: [],
  },
  F: { solids: [r(0, 0, 0.26, 1), r(0, 0, 0.78, STEM), r(0, 0.39, 0.64, STEM)], negatives: [] },
  G: letterG(),
  H: {
    solids: [r(0, 0, STEM, 1), r(1 - STEM, 0, STEM, 1), r(STEM, 0.39, 1 - STEM * 2, STEM)],
    negatives: [],
  },
  I: { solids: [r(0.39, 0, STEM, 1)], negatives: [] },
  J: letterJ(),
  K: {
    solids: [
      r(0, 0, STEM, 1),
      poly([
        { x: STEM, y: 0.5 },
        { x: 0.86, y: 0 },
        { x: 1, y: 0.16 },
        { x: 0.42, y: 0.66 },
      ]),
      poly([
        { x: 0.4, y: 0.56 },
        { x: 1, y: 0.84 },
        { x: 0.88, y: 1 },
        { x: STEM, y: 0.66 },
      ]),
    ],
    negatives: [],
  },
  L: { solids: [r(0, 0, 0.26, 1), r(0, 1 - STEM, 0.8, STEM)], negatives: [] },
  M: {
    solids: [
      r(0, 0, STEM, 1),
      r(1 - STEM, 0, STEM, 1),
      poly([
        { x: 0, y: 0.08 },
        { x: 0.5, y: 0.66 },
        { x: 1, y: 0.08 },
        { x: 1, y: 0.34 },
        { x: 0.5, y: 0.94 },
        { x: 0, y: 0.34 },
      ]),
    ],
    negatives: [],
  },
  N: {
    solids: [
      r(0, 0, STEM, 1),
      r(1 - STEM, 0, STEM, 1),
      poly([
        { x: STEM, y: 0 },
        { x: 1 - STEM, y: 0.76 },
        { x: 1 - STEM, y: 1 },
        { x: STEM, y: 0.24 },
      ]),
    ],
    negatives: [],
  },
  O: letterO(),
  P: letterP(),
  Q: letterQ(),
  R: letterR(),
  S: letterS(),
  T: { solids: [r(0, 0, 1, STEM), r(0.39, 0, STEM, 1)], negatives: [] },
  U: letterU(),
  V: {
    solids: [
      poly([
        { x: 0, y: 0 },
        { x: STEM, y: 0 },
        { x: 0.5, y: 0.72 },
        { x: 1 - STEM, y: 0 },
        { x: 1, y: 0 },
        { x: 0.61, y: 1 },
        { x: 0.39, y: 1 },
      ]),
    ],
    negatives: [],
  },
  W: {
    solids: [
      poly([
        { x: 0, y: 0 },
        { x: 0.18, y: 0 },
        { x: 0.3, y: 0.68 },
        { x: 0.5, y: 0.2 },
        { x: 0.7, y: 0.68 },
        { x: 0.82, y: 0 },
        { x: 1, y: 0 },
        { x: 0.74, y: 1 },
        { x: 0.62, y: 1 },
        { x: 0.5, y: 0.58 },
        { x: 0.38, y: 1 },
        { x: 0.26, y: 1 },
      ]),
    ],
    negatives: [],
  },
  X: {
    solids: [
      poly([
        { x: 0, y: 0 },
        { x: STEM, y: 0 },
        { x: 0.5, y: 0.38 },
        { x: 1 - STEM, y: 0 },
        { x: 1, y: 0 },
        { x: 0.6, y: 0.5 },
        { x: 1, y: 1 },
        { x: 1 - STEM, y: 1 },
        { x: 0.5, y: 0.62 },
        { x: STEM, y: 1 },
        { x: 0, y: 1 },
        { x: 0.4, y: 0.5 },
      ]),
    ],
    negatives: [],
  },
  Y: {
    solids: [
      poly([
        { x: 0, y: 0 },
        { x: STEM, y: 0 },
        { x: 0.5, y: 0.48 },
        { x: 1 - STEM, y: 0 },
        { x: 1, y: 0 },
        { x: 0.61, y: 0.62 },
        { x: 0.61, y: 1 },
        { x: 0.39, y: 1 },
        { x: 0.39, y: 0.62 },
      ]),
    ],
    negatives: [],
  },
  Z: {
    solids: [
      r(0, 0, 1, STEM),
      r(0, 1 - STEM, 1, STEM),
      poly([
        { x: 1 - STEM, y: STEM },
        { x: 1, y: STEM },
        { x: STEM, y: 1 - STEM },
        { x: 0, y: 1 - STEM },
      ]),
    ],
    negatives: [],
  },
};

export function letterSpec(char: string): LetterSpec | null {
  return LETTER_LIBRARY[char.toUpperCase()] ?? null;
}

export function supportedLetters(): string[] {
  return Object.keys(LETTER_LIBRARY).sort();
}

/** Bir primitifi verilen yerleşim kutusuna ölçekleyerek geometriye çevirir. */
export function primToGeometry(
  prim: Prim,
  box: { x: number; y: number; width: number; height: number },
): Geometry | null {
  const sx = (v: number) => box.x + v * box.width;
  const sy = (v: number) => box.y + v * box.height;
  switch (prim.k) {
    case 'rect':
      if (prim.w <= 0 || prim.h <= 0) return null;
      return {
        kind: 'rect',
        x: sx(prim.x),
        y: sy(prim.y),
        width: prim.w * box.width,
        height: prim.h * box.height,
      };
    case 'poly':
      if (prim.points.length < 3) return null;
      return { kind: 'polygon', keypoints: prim.points.map((pt) => ({ x: sx(pt.x), y: sy(pt.y) })) };
  }
}

export function primLabel(prim: Prim): string {
  return prim.k === 'rect' ? 'Rectangle' : 'Polygon';
}

export { poly as polyPrim, r as rectPrim };
