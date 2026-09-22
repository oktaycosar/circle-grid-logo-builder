import type { ArtboardObject, Geometry, Matrix, Vec2 } from './types.ts';
import { booleanGeometry, loopsToPolygonGeometry, uniteAll, type BooleanOp } from './boolean.ts';
import { editorStore } from '../store/editorStore.ts';
import {
  objectFromGeometry,
  makeCircle,
  makeRing,
  newId,
} from './factory.ts';
import { geometryBounds, geometryToSvgPathData, transformGeometry } from './geometry.ts';
import { letterSpec, primToGeometry } from './monogram.ts';
import { translate } from './matrix.ts';

/**
 * Yüksek seviye editör komutları: pathfinder, clip, concentric, knife,
 * shape builder ve monogram iskeleti. Hepsi store üzerinden geri alınabilir
 * (undo/redo) işlemler olarak çalışır.
 */

function objectsByIds(ids: string[]): ArtboardObject[] {
  const all = editorStore.getState().objects;
  return ids.map((id) => all.find((o) => o.id === id)).filter((o): o is ArtboardObject => Boolean(o));
}

function replaceObjects(removedIds: string[], created: ArtboardObject[], label: string): void {
  editorStore.commit(label, (s) => ({
    objects: [...s.objects.filter((o) => !removedIds.includes(o.id)), ...created],
    selection: created.map((o) => o.id),
    selectedNodes: [],
  }));
}

function nextLayerIndex(): number {
  return editorStore.getState().activeLayerIndex;
}

// ------------------------------------------------------------- pathfinder

export interface BooleanOpResult {
  ok: boolean;
  message: string;
}

/** Seçili nesnelerde gerçek boolean işlemi uygular. */
export function applyBooleanToSelection(op: BooleanOp): BooleanOpResult {
  const state = editorStore.getState();
  const objs = objectsByIds(state.selection).filter((o) => !o.locked);
  if (objs.length < 2) {
    return { ok: false, message: 'Boolean işlemi için en az 2 nesne seçin.' };
  }

  const labels: Record<BooleanOp, string> = {
    unite: 'Unite',
    subtract: 'Subtract',
    intersect: 'Intersect',
    exclude: 'Exclude',
    divide: 'Divide',
  };

  try {
    if (op === 'divide') {
      // Divide: her nesne çifti için kesişim + farklar üretilir.
      const created: ArtboardObject[] = [];
      for (let i = 0; i < objs.length; i++) {
        for (let j = i + 1; j < objs.length; j++) {
          const a = objs[i];
          const b = objs[j];
          const intersectLoops = booleanGeometry(a.geometry, b.geometry, 'intersect');
          const onlyA = booleanGeometry(a.geometry, b.geometry, 'subtract');
          const onlyB = booleanGeometry(b.geometry, a.geometry, 'subtract');
          const push = (loops: Vec2[][], suffix: string) => {
            if (!loops.length) return;
            created.push(
              objectFromGeometry(loopsToPolygonGeometry(loops), {
                name: `${a.name} / ${b.name} ${suffix}`,
                layerIndex: a.layerIndex,
                fill: a.fill,
                stroke: a.stroke,
                strokeWidth: a.strokeWidth,
                type: 'path',
              }),
            );
          };
          push(intersectLoops, 'intersect');
          push(onlyA, `${b.name} dışı`);
          push(onlyB, `${a.name} dışı`);
        }
      }
      if (!created.length) return { ok: false, message: 'Divide sonucu boş çıktı.' };
      replaceObjects(
        objs.map((o) => o.id),
        created,
        labels.divide,
      );
      return { ok: true, message: `Divide: ${created.length} parça üretildi.` };
    }

    // Subtract: seçim sırası önemli — ilk nesne taban, kalanlar çıkarılır.
    if (op === 'subtract') {
      let base = objs[0].geometry;
      for (let i = 1; i < objs.length; i++) {
        const loops = booleanGeometry(base, objs[i].geometry, 'subtract');
        base = loopsToPolygonGeometry(loops);
      }
      const result = objectFromGeometry(base, {
        name: `${objs[0].name} eksi ${objs.length - 1}`,
        layerIndex: objs[0].layerIndex,
        fill: objs[0].fill,
        stroke: objs[0].stroke,
        strokeWidth: objs[0].strokeWidth,
        type: 'path',
      });
      replaceObjects(
        objs.map((o) => o.id),
        [result],
        labels.subtract,
      );
      return { ok: true, message: `Subtract uygulandı (${objs.length} nesne).` };
    }

    // Unite / Intersect / Exclude: nesneleri sırayla akümülatöre uygula.
    let acc: Geometry | null = null;
    for (const obj of objs) {
      if (acc === null) {
        acc = obj.geometry;
        continue;
      }
      if (op === 'unite') {
        acc = loopsToPolygonGeometry(booleanGeometry(acc, obj.geometry, 'unite'));
      } else if (op === 'intersect') {
        acc = loopsToPolygonGeometry(booleanGeometry(acc, obj.geometry, 'intersect'));
      } else {
        acc = loopsToPolygonGeometry(booleanGeometry(acc, obj.geometry, 'exclude'));
      }
    }

    if (!acc || geometryArea(acc) < 1) {
      return { ok: false, message: `${labels[op]} sonucu boş çıktı.` };
    }

    const result = objectFromGeometry(acc, {
      name: `${labels[op]} sonucu`,
      layerIndex: objs[0].layerIndex,
      fill: objs[0].fill,
      stroke: objs[0].stroke,
      strokeWidth: objs[0].strokeWidth,
      type: 'path',
    });
    replaceObjects(
      objs.map((o) => o.id),
      [result],
      labels[op],
    );
    return { ok: true, message: `${labels[op]}: ${objs.length} nesne işlendi.` };
  } catch (err) {
    return { ok: false, message: `Boolean hatası: ${(err as Error).message}` };
  }
}

// -------------------------------------------------------- daire kırpma

/** Seçili şekilleri verilen daire ile gerçek boolean intersection'a sokar (madde 12). */
export function clipSelectionToCircle(circleId: string): BooleanOpResult {
  const state = editorStore.getState();
  const circle = state.objects.find((o) => o.id === circleId);
  if (!circle || circle.geometry.kind !== 'circle') {
    return { ok: false, message: 'Kırpma için bir daire seçin.' };
  }
  const targets = objectsByIds(state.selection).filter((o) => !o.locked && o.id !== circleId);
  if (!targets.length) {
    return { ok: false, message: 'Kırpılacak şekil seçin (daire hariç).' };
  }

  const created: ArtboardObject[] = [];
  for (const target of targets) {
    const loops = booleanGeometry(target.geometry, circle.geometry, 'intersect');
    if (!loops.length) continue;
    created.push(
      objectFromGeometry(loopsToPolygonGeometry(loops), {
        name: `${target.name} ∩ ${circle.name}`,
        layerIndex: target.layerIndex,
        fill: target.fill,
        stroke: target.stroke,
        strokeWidth: target.strokeWidth,
        type: 'path',
      }),
    );
  }
  if (!created.length) return { ok: false, message: 'Kesişim boş — şekil dairenin dışında.' };

  replaceObjects(
    targets.map((o) => o.id),
    created,
    'Clip to Circle',
  );
  return { ok: true, message: `${created.length} şekil daireye kırpıldı.` };
}

/** Bir şekli dairenin dışına taşan kısmını keser (dışarıda kalanı siler). */
export function clipSelectionOutsideCircle(circleId: string): BooleanOpResult {
  const state = editorStore.getState();
  const circle = state.objects.find((o) => o.id === circleId);
  if (!circle || circle.geometry.kind !== 'circle') {
    return { ok: false, message: 'Kırpma için bir daire seçin.' };
  }
  const targets = objectsByIds(state.selection).filter((o) => !o.locked && o.id !== circleId);
  if (!targets.length) return { ok: false, message: 'Kırpılacak şekil seçin.' };

  const created: ArtboardObject[] = [];
  for (const target of targets) {
    const loops = booleanGeometry(target.geometry, circle.geometry, 'subtract');
    if (!loops.length) continue;
    created.push(
      objectFromGeometry(loopsToPolygonGeometry(loops), {
        name: `${target.name} \\ ${circle.name}`,
        layerIndex: target.layerIndex,
        fill: target.fill,
        stroke: target.stroke,
        strokeWidth: target.strokeWidth,
        type: 'path',
      }),
    );
  }
  if (!created.length) return { ok: false, message: 'Sonuç boş (şekil tamamen dairenin içinde).' };

  replaceObjects(
    targets.map((o) => o.id),
    created,
    'Clip Outside Circle',
  );
  return { ok: true, message: `${created.length} şekil kırpıldı.` };
}

// --------------------------------------------------- eş merkezli daireler

/** Seçili daireden verilen offset kadar içeride ikinci bir daire üretir (madde 8). */
export function createConcentricCircle(circleId: string, innerOffset: number): BooleanOpResult {
  const state = editorStore.getState();
  const circle = state.objects.find((o) => o.id === circleId);
  if (!circle || circle.geometry.kind !== 'circle') {
    return { ok: false, message: 'Eş merkezli daire için bir daire seçin.' };
  }
  const r = circle.geometry.r - innerOffset;
  if (r <= 0.5) return { ok: false, message: 'Offset yarıçaptan büyük olamaz.' };

  const created = makeCircle(circle.geometry.cx, circle.geometry.cy, r, {
    name: `${circle.name} iç`,
    layerIndex: circle.layerIndex,
    fill: { type: 'none' },
    stroke: circle.stroke === 'none' ? '#000000' : circle.stroke,
    strokeWidth: circle.strokeWidth || 2,
    strokeOnly: true,
  });
  editorStore.addObjects([created], 'Concentric Circle');
  return { ok: true, message: `Eş merkezli daire oluşturuldu (r = ${r.toFixed(1)}).` };
}

/** Seçili daireden gerçek bir ring (fill tabanlı halka) üretir (madde 9). */
export function createRingFromCircle(circleId: string, thickness: number): BooleanOpResult {
  const state = editorStore.getState();
  const circle = state.objects.find((o) => o.id === circleId);
  if (!circle || circle.geometry.kind !== 'circle') {
    return { ok: false, message: 'Ring için bir daire seçin.' };
  }
  if (thickness <= 0 || thickness >= circle.geometry.r) {
    return { ok: false, message: 'Halka kalınlığı geçersiz.' };
  }
  const ring = makeRing(circle.geometry.cx, circle.geometry.cy, circle.geometry.r, thickness, {
    name: `${circle.name} Ring`,
    layerIndex: circle.layerIndex,
    fill: circle.fill.type === 'none' ? { type: 'solid', color: '#000000' } : circle.fill,
  });
  editorStore.addObjects([ring], 'Ring oluştur');
  return { ok: true, message: `Ring oluşturuldu (kalınlık ${thickness}).` };
}

// ------------------------------------------------------------- knife / trim

/**
 * Seçili nesneleri verilen doğru boyunca ikiye böler (madde 6: Knife/Trim).
 * Doğrunun iki yanında kalan yarım düzlemlerle gerçek boolean kesişim yapılır.
 */
export function trimSelectionWithLine(p1: Vec2, p2: Vec2): BooleanOpResult {
  const state = editorStore.getState();
  const targets = objectsByIds(state.selection).filter((o) => !o.locked);
  if (!targets.length) return { ok: false, message: 'Kesilecek nesne seçin.' };

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { ok: false, message: 'Kesim çizgisi çok kısa.' };

  // Doğru boyunca uzanan çok büyük bir dikdörtgen; iki yöne kaydırılarak
  // iki yarım düzlem elde edilir.
  const ext = Math.max(4000, len * 8);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const offset = ext;

  const half1: Vec2[] = [
    { x: p1.x - ux * ext + nx * offset, y: p1.y - uy * ext + ny * offset },
    { x: p2.x + ux * ext + nx * offset, y: p2.y + uy * ext + ny * offset },
    { x: p2.x + ux * ext - nx * offset * 0.0001, y: p2.y + uy * ext - ny * offset * 0.0001 },
    { x: p1.x - ux * ext - nx * offset * 0.0001, y: p1.y - uy * ext - ny * offset * 0.0001 },
  ];
  const half2: Vec2[] = half1.map((p) => ({
    x: p.x + nx * offset,
    y: p.y + ny * offset,
  }));

  const planeA = loopsToPolygonGeometry([half1]);
  void half2;

  const created: ArtboardObject[] = [];
  for (const target of targets) {
    // Doğrunun bir tarafı: target ∩ half1 ; diğer taraf: target − half1
    const side1 = booleanGeometry(target.geometry, planeA, 'intersect');
    const side2 = booleanGeometry(target.geometry, planeA, 'subtract');

    const push = (loops: Vec2[][], suffix: string) => {
      if (!loops.length) return;
      const geom = loopsToPolygonGeometry(loops);
      const b = geometryBounds(geom);
      if (b.width < 0.5 || b.height < 0.5) return;
      created.push(
        objectFromGeometry(geom, {
          name: `${target.name} ${suffix}`,
          layerIndex: target.layerIndex,
          fill: target.fill,
          stroke: target.stroke,
          strokeWidth: target.strokeWidth,
          type: 'path',
        }),
      );
    };
    push(side1, 'A');
    push(side2, 'B');
  }

  if (!created.length) return { ok: false, message: 'Kesim sonucu boş çıktı.' };

  replaceObjects(
    targets.map((o) => o.id),
    created,
    'Knife / Trim',
  );
  return { ok: true, message: `${created.length} parça oluşturuldu.` };
}

// ------------------------------------------------------------ shape builder

export interface ShapeRegion {
  key: string;
  ids: string[];
  geometry: Geometry;
  pathData: string;
  area: number;
}

function polygonArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function geometryArea(g: Geometry): number {
  if (g.kind === 'polygon') {
    const outer = polygonArea(g.keypoints);
    const holes = (g.extraLoops ?? []).reduce((sum, l) => sum + polygonArea(l), 0);
    return Math.abs(outer - holes);
  }
  if (g.kind === 'circle') return Math.PI * g.r * g.r;
  if (g.kind === 'ellipse') return Math.PI * g.rx * g.ry;
  if (g.kind === 'rect') return Math.abs(g.width * g.height);
  if (g.kind === 'ring') {
    const inner = Math.max(0, g.outerRadius - g.thickness);
    return Math.PI * (g.outerRadius ** 2 - inner ** 2);
  }
  return 0;
}

/**
 * Shape Builder için bölge çözümlemesi (madde 14).
 *
 * Seçili şekillerin tüm alt kümeleri için "kesişim eksi tamamlayıcı birleşimi"
 * hesaplanır; bu, düzlemi kesişmeyen bölgelere ayırır. n ≤ 4 ile sınırlıdır.
 */
export function computeShapeRegions(ids: string[]): ShapeRegion[] {
  const objs = objectsByIds(ids).filter((o) => !o.locked);
  if (objs.length < 2 || objs.length > 4) return [];

  const n = objs.length;
  const regions: ShapeRegion[] = [];

  for (let mask = 1; mask < 1 << n; mask++) {
    const inside = objs.filter((_, i) => mask & (1 << i));
    const outside = objs.filter((_, i) => !(mask & (1 << i)));

    let inner: Vec2[][] | null = null;
    for (const obj of inside) {
      const loops = loopsOfAny(obj.geometry);
      if (inner === null) {
        inner = loops;
      } else {
        inner = booleanGeometry(loopsToPolygonGeometry(inner), obj.geometry, 'intersect');
      }
      if (!inner.length) break;
    }
    if (!inner || !inner.length) continue;

    let region = loopsToPolygonGeometry(inner);

    if (outside.length) {
      const outerGeom = loopsToPolygonGeometry(uniteAll(outside.map((o) => o.geometry)));
      const diff = booleanGeometry(region, outerGeom, 'subtract');
      if (!diff.length) continue;
      region = loopsToPolygonGeometry(diff);
    }

    const area = geometryArea(region);
    if (area < 1) continue;

    regions.push({
      key: `region-${mask}-${newId('r')}`,
      ids: inside.map((o) => o.id),
      geometry: region,
      pathData: geometryToSvgPathData(region),
      area,
    });
  }

  return regions;
}

/** Herhangi bir geometriyi kontur listesine çevirir. */
function loopsOfAny(geometry: Geometry): Vec2[][] {
  switch (geometry.kind) {
    case 'polygon':
      return [geometry.keypoints, ...(geometry.extraLoops ?? [])].map((l) => l.map((p) => ({ ...p })));
    case 'path':
      return geometry.subpaths.map((sp) => sp.points.map((p) => ({ ...p })));
    case 'rect':
      return [
        [
          { x: geometry.x, y: geometry.y },
          { x: geometry.x + geometry.width, y: geometry.y },
          { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
          { x: geometry.x, y: geometry.y + geometry.height },
        ],
      ];
    default:
      return contoursFrom(geometry);
  }
}

function contoursFrom(geometry: Geometry): Vec2[][] {
  // circle / ellipse / ring / line için yeterli çözünürlükte örnekleme
  if (geometry.kind === 'circle') {
    const r = Math.abs(geometry.r);
    const steps = Math.max(48, Math.min(360, Math.ceil(r)));
    return [Array.from({ length: steps }, (_, i) => {
      const a = (i / steps) * Math.PI * 2;
      return { x: geometry.cx + Math.cos(a) * r, y: geometry.cy + Math.sin(a) * r };
    })];
  }
  if (geometry.kind === 'ellipse') {
    const steps = 96;
    return [Array.from({ length: steps }, (_, i) => {
      const a = (i / steps) * Math.PI * 2;
      return { x: geometry.cx + Math.cos(a) * geometry.rx, y: geometry.cy + Math.sin(a) * geometry.ry };
    })];
  }
  if (geometry.kind === 'ring') {
    const outer = Math.abs(geometry.outerRadius);
    const inner = Math.max(0, outer - Math.abs(geometry.thickness));
    const mk = (r: number, reverse: boolean) => {
      const steps = Math.max(48, Math.min(360, Math.ceil(r)));
      return Array.from({ length: steps }, (_, i) => {
        const a = ((reverse ? -i : i) / steps) * Math.PI * 2;
        return { x: geometry.cx + Math.cos(a) * r, y: geometry.cy + Math.sin(a) * r };
      });
    };
    return inner <= 0.001 ? [mk(outer, false)] : [mk(outer, false), mk(inner, true)];
  }
  return [];
}

/** Shape Builder: verilen bölgeyi seçili şekillerin birleşimine ekler. */
export function buildShapeFromRegions(regionGeometries: Geometry[], remove = false): BooleanOpResult {
  const state = editorStore.getState();
  const base = objectsByIds(state.selection).filter((o) => !o.locked);
  if (!base.length || !regionGeometries.length) {
    return { ok: false, message: 'Bölge seçilmedi.' };
  }

  const regionUnion = loopsToPolygonGeometry(uniteAll(regionGeometries));
  const baseUnion = loopsToPolygonGeometry(uniteAll(base.map((o) => o.geometry)));

  const merged = remove
    ? loopsToPolygonGeometry(booleanGeometry(baseUnion, regionUnion, 'subtract'))
    : loopsToPolygonGeometry(booleanGeometry(baseUnion, regionUnion, 'unite'));

  const result = objectFromGeometry(merged, {
    name: remove ? 'Shape Builder (−)' : 'Shape Builder (+)',
    layerIndex: base[0].layerIndex,
    fill: base[0].fill,
    stroke: base[0].stroke,
    strokeWidth: base[0].strokeWidth,
    type: 'path',
  });

  replaceObjects(
    base.map((o) => o.id),
    [result],
    remove ? 'Shape Builder çıkar' : 'Shape Builder birleştir',
  );
  return { ok: true, message: remove ? 'Bölge çıkarıldı.' : 'Bölge birleştirildi.' };
}

// --------------------------------------------------------------- monogram

export interface MonogramOptions {
  letters: string;
  box: { x: number; y: number; width: number; height: number };
  /** Parçaları birleştirip tek şekil üret (false: düzenlenebilir parçalar). */
  unitePieces: boolean;
}

/**
 * AUTO GUIDE MODE: verilen harfler için geometrik iskelet üretir (madde 11).
 * Parçalar ayrı ayrı bırakılır ki kullanıcı istediğini unite/subtract edebilsin.
 */
export function insertMonogramSkeleton(options: MonogramOptions): BooleanOpResult {
  const letters = options.letters
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .split('');
  if (!letters.length) return { ok: false, message: 'En az bir harf girin.' };

  const missing = letters.filter((ch) => !letterSpec(ch));
  if (missing.length) return { ok: false, message: `Desteklenmeyen harf: ${missing.join(', ')}` };

  const gap = options.box.width * 0.06;
  const cellWidth = (options.box.width - gap * (letters.length - 1)) / letters.length;
  const layerIndex = nextLayerIndex();

  type Piece = { obj: ArtboardObject; char: string; role: 'solid' | 'negative' };
  const pieces: Piece[] = [];

  letters.forEach((char, index) => {
    const spec = letterSpec(char);
    if (!spec) return;
    const box = {
      x: options.box.x + index * (cellWidth + gap),
      y: options.box.y,
      width: cellWidth,
      height: options.box.height,
    };

    for (const prim of spec.solids) {
      const geom = primToGeometry(prim, box);
      if (!geom) continue;
      pieces.push({
        obj: objectFromGeometry(geom, {
          name: `${char} · parça`,
          layerIndex,
          fill: { type: 'solid', color: '#000000' },
        }),
        char,
        role: 'solid',
      });
    }
    for (const prim of spec.negatives) {
      const geom = primToGeometry(prim, box);
      if (!geom) continue;
      pieces.push({
        obj: objectFromGeometry(geom, {
          name: `${char} · negatif (çıkarılacak)`,
          layerIndex,
          fill: { type: 'none' },
          stroke: '#d9534f',
          strokeWidth: 1.5,
          strokeOnly: true,
        }),
        char,
        role: 'negative',
      });
    }
  });

  if (!pieces.length) return { ok: false, message: 'İskelet üretilemedi.' };

  if (!options.unitePieces) {
    editorStore.addObjects(
      pieces.map((p) => p.obj),
      'Monogram iskeleti',
    );
    return {
      ok: true,
      message: `${letters.join('')} iskeleti eklendi (${pieces.length} parça). Negatifleri seçip Subtract uygulayın.`,
    };
  }

  // Her harf için: solids unite, negatives sırayla subtract
  const created: ArtboardObject[] = [];
  for (const char of letters) {
    const solids = pieces.filter((p) => p.char === char && p.role === 'solid').map((p) => p.obj.geometry);
    const negatives = pieces.filter((p) => p.char === char && p.role === 'negative').map((p) => p.obj.geometry);
    if (!solids.length) continue;
    let geom: Geometry = loopsToPolygonGeometry(uniteAll(solids));
    for (const neg of negatives) {
      const diff = booleanGeometry(geom, neg, 'subtract');
      geom = loopsToPolygonGeometry(diff);
    }
    created.push(
      objectFromGeometry(geom, {
        name: `Letter ${char}`,
        layerIndex,
        fill: { type: 'solid', color: '#000000' },
        type: 'path',
      }),
    );
  }

  editorStore.addObjects(created, 'Monogram harfleri');
  return { ok: true, message: `${letters.join('')} geometrik harfleri oluşturuldu.` };
}

// ------------------------------------------------------------- dönüşümler

/** Seçimi verilen matrisle dönüştürür. */
export function transformSelection(matrix: Matrix, label: string): void {
  const state = editorStore.getState();
  if (!state.selection.length) return;
  editorStore.commit(label, (s) => ({
    objects: s.objects.map((o) =>
      state.selection.includes(o.id)
        ? (() => {
            const geometry = transformGeometry(o.geometry, matrix);
            const b = geometryBounds(geometry);
            const scale = Math.hypot(matrix[0], matrix[1]) || 1;
            return {
              ...o,
              geometry,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              strokeWidth: o.strokeWidth * scale,
            };
          })()
        : o,
    ),
  }));
}

export function moveSelectionBy(dx: number, dy: number, label = 'Taşı'): void {
  transformSelection(translate(dx, dy), label);
}

export function scaleSelectionTo(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
  label = 'Ölçekle',
): void {
  if (from.width === 0 || from.height === 0) return;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const m: Matrix = [
    sx,
    0,
    0,
    sy,
    from.x - sx * from.x + (to.x - from.x),
    from.y - sy * from.y + (to.y - from.y),
  ];
  transformSelection(m, label);
}
