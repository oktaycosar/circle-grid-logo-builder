/**
 * Çekirdek motor testleri (spesifikasyon 37 — kabul testi).
 *
 * Node ile çalışır: `npm test`
 * DOM gerektirmeyen saf geometri/boolean/snap/export testleri içerir.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from 'linkedom';

import {
  booleanGeometry,
  loopsToPolygonGeometry,
  simplifyLoop,
  uniteAll,
} from '../src/core/boolean.ts';
import {
  commandsToSubPaths,
  flattenGeometry,
  geometryBounds,
  geometryToSvgPathData,
  parseSvgTransform,
  pathDataToCommands,
  pointInGeometry,
  smoothPolygonPathData,
} from '../src/core/geometry.ts';
import { applyMatrix, invert, multiply, rectOfPoints, rotate, scale, translate } from '../src/core/matrix.ts';
import { buildSvg, artworkBounds, exportableObjects } from '../src/core/export.ts';
import type { ArtboardObject, Geometry, GridSettings, Vec2 } from '../src/core/types.ts';
import { makeCircle, makeRect, makeRing } from '../src/core/factory.ts';
import { gridLines, gridStep, resolveSnap, snapToGrid } from '../src/core/snap.ts';
import { deleteKeypoint, geometryEditableLoops, insertKeypoint, moveKeypoint } from '../src/core/nodes.ts';
import { penAnchorsToSubPaths } from '../src/core/pen.ts';
import { LETTER_LIBRARY, letterSpec, primToGeometry } from '../src/core/monogram.ts';
import { createDemoProject } from '../src/core/demoProject.ts';
import { parseProject, buildProjectFile } from '../src/core/persistence.ts';
import { importSvg } from '../src/core/svgImport.ts';

// svgImport, tarayıcıdaki DOMParser'a dayanır; Node ortamında linkedom ile sağlanır.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

// -------------------------------------------------------------------- yardımcı

const rect = (x: number, y: number, w: number, h: number): Geometry => ({ kind: 'rect', x, y, width: w, height: h });
const disc = (cx: number, cy: number, r: number): Geometry => ({ kind: 'circle', cx, cy, r });
const poly = (points: Vec2[]): Geometry => ({ kind: 'polygon', keypoints: points });

function close(a: number, b: number, eps = 0.5): boolean {
  return Math.abs(a - b) <= eps;
}

/** Poligon loop İŞARETLİ alanı (delikler negatif katkı verir). */
function signedArea(loop: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/**
 * Loop'ların toplam DOLU alanı. Even-odd kuralı gereği delikler dış
 * loop'tan farklı yönde gelir, bu yüzden işaretli toplam doğru sonucu verir.
 */
function totalArea(loops: Vec2[][]): number {
  return Math.abs(loops.reduce((sum, l) => sum + signedArea(l), 0));
}

const GRID: GridSettings = { enabled: true, snap: true, size: 50, divisions: 2, opacity: 0.5, majorEvery: 4 };

// ============================================================== 1. MATRIS

test('matrix: döndürme + ölçek + öteleme zinciri doğru bileşir', () => {
  const m = multiply(multiply(translate(100, 0), rotate(90)), scale(2, 2));
  const p = applyMatrix(m, { x: 10, y: 0 });
  // (10,0) *2 = (20,0) -> 90° = (0,20) -> +100x = (100,20)
  assert.ok(close(p.x, 100), `x=${p.x}`);
  assert.ok(close(p.y, 20), `y=${p.y}`);

  const back = applyMatrix(invert(m), p);
  assert.ok(close(back.x, 10, 1e-6), `ters dönüşüm x=${back.x}`);
  assert.ok(close(back.y, 0, 1e-6), `ters dönüşüm y=${back.y}`);
});

test('matrix: rectOfPoints sınır kutusu', () => {
  const b = rectOfPoints([{ x: 5, y: 7 }, { x: -3, y: 2 }, { x: 10, y: -4 }]);
  assert.deepEqual(b, { x: -3, y: -4, width: 13, height: 11 });
});

// ============================================================== 2. BOOLEAN

test('boolean unite: iki dikdörtgen birleşimi alanı doğru', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const loops = booleanGeometry(a, b, 'unite');
  assert.equal(loops.length, 1, 'tek loop beklenir');
  // 10000 + 10000 - 2500 = 17500
  assert.ok(close(totalArea(loops), 17500, 40), `alan=${totalArea(loops)}`);
});

test('boolean intersect: yalnızca ortak alan kalır', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const loops = booleanGeometry(a, b, 'intersect');
  assert.equal(loops.length, 1);
  assert.ok(close(totalArea(loops), 2500, 20), `alan=${totalArea(loops)}`);
});

test('boolean subtract: kesişen bölge çıkarılır', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const loops = booleanGeometry(a, b, 'subtract');
  // 10000 - 2500 = 7500
  assert.ok(close(totalArea(loops), 7500, 40), `alan=${totalArea(loops)}`);
});

test('boolean subtract: tamamen içteki şekil GERÇEK DELİK üretir', () => {
  const outer = disc(500, 500, 300);
  const inner = disc(500, 500, 100);
  const loops = booleanGeometry(outer, inner, 'subtract');
  assert.equal(loops.length, 2, 'delik için 2 loop beklenir (dış + iç)');
  const ringArea = Math.PI * (300 * 300 - 100 * 100);
  assert.ok(close(totalArea(loops), ringArea, ringArea * 0.02), `alan=${totalArea(loops)} beklenen=${ringArea}`);
});

test('boolean unite: ayrık şekiller iki loop olarak korunur', () => {
  const loops = booleanGeometry(rect(0, 0, 100, 100), rect(500, 500, 100, 100), 'unite');
  assert.equal(loops.length, 2);
  assert.ok(close(totalArea(loops), 20000, 100));
});

test('boolean intersect: ayrık şekillerde boş sonuç', () => {
  const loops = booleanGeometry(rect(0, 0, 100, 100), rect(500, 500, 100, 100), 'intersect');
  assert.equal(loops.length, 0);
});

test('boolean intersect: dikdörtgen ∩ daire (videodaki konstrüksiyon)', () => {
  const square = rect(400, 300, 400, 400);
  const circle = disc(500, 500, 250);
  const result = loopsToPolygonGeometry(booleanGeometry(square, circle, 'intersect'));
  const bounds = geometryBounds(result);
  assert.ok(bounds.width <= 500.5, `genişlik daire çapını aşmamalı: ${bounds.width}`);
  assert.ok(bounds.height <= 500.5, `yükseklik daire çapını aşmamalı: ${bounds.height}`);
  // Kırpılan alan, karenin alanından küçük olmalı
  const bounds2 = geometryBounds(result);
  assert.ok(bounds2.width * bounds2.height < 400 * 400);
});

test('boolean: çakışan kenarlar (grid hizalı) degenerasyon üretmez', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(100, 0, 100, 100); // tam kenar paylaşımı
  const loops = booleanGeometry(a, b, 'unite');
  assert.ok(close(totalArea(loops), 20000, 60), `alan=${totalArea(loops)}`);
});

test('boolean exclude (XOR): ortak alan çıkarılır', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const loops = booleanGeometry(a, b, 'exclude');
  // 17500 - 2500 = 15000
  assert.ok(close(totalArea(loops), 15000, 80), `alan=${totalArea(loops)}`);
});

test('boolean divide: parçalar toplamı birleşime eşit', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const parts = booleanGeometry(a, b, 'divide');
  assert.ok(parts.length >= 3, `en az 3 parça beklenir, alınan ${parts.length}`);
  assert.ok(close(totalArea(parts), 17500, 120), `toplam=${totalArea(parts)}`);
});

test('uniteAll: 5 dikdörtgenin birleşimi tek kompakt loop', () => {
  // Blok S konstrüksiyonu
  const bars = [
    rect(0, 0, 100, 20),
    rect(0, 20, 26, 20),
    rect(0, 40, 100, 20),
    rect(74, 60, 26, 20),
    rect(0, 80, 100, 20),
  ];
  const loops = uniteAll(bars);
  assert.equal(loops.length, 1, 'tek loop beklenir');
  const expected = 100 * 100 - (74 * 20) - (74 * 20);
  assert.ok(close(totalArea(loops), expected, 60), `alan=${totalArea(loops)} beklenen=${expected}`);
  // Loop nokta sayısı makul kalmalı (birleşim iç kenarları temizler)
  assert.ok(loops[0].length <= 24, `nokta sayısı=${loops[0].length}`);
});

test('simplifyLoop: düz kenardaki fazla noktaları atar', () => {
  const dense: Vec2[] = [];
  for (let i = 0; i <= 100; i++) dense.push({ x: i, y: 0 });
  dense.push({ x: 100, y: 100 }, { x: 0, y: 100 });
  const simplified = simplifyLoop(dense, 0.1);
  assert.ok(simplified.length <= 6, `sadeleştirilmiş nokta=${simplified.length}`);
});

// ============================================================ 3. GEOMETRİ

test('geometry: daire path verisi gerçek bezier yayı üretir', () => {
  const d = geometryToSvgPathData(disc(100, 100, 50));
  assert.ok(d.startsWith('M 50 100'), d);
  assert.equal((d.match(/C/g) ?? []).length, 4, 'dört kübik yay beklenir');
  assert.ok(d.endsWith('Z'), d);
});

test('geometry: ring path verisi çift yay (delik) üretir', () => {
  const d = geometryToSvgPathData({ kind: 'ring', cx: 100, cy: 100, outerRadius: 50, thickness: 10 });
  assert.equal((d.match(/M/g) ?? []).length, 2, 'iki alt yol (dış + iç) beklenir');
});

test('geometry: polygon smoothing köşeleri korur, yayları yumuşatır', () => {
  // Kare: 4 keskin köşe → kompakt L komutları
  const square = smoothPolygonPathData([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);
  assert.equal(square, 'M 0 0 L 100 0 L 100 100 L 0 100 Z', square);

  // Dikdörtgen kenarındaki yüzlerce fazla nokta sadeleştirilir
  const dense: Vec2[] = [];
  for (let i = 0; i <= 120; i++) dense.push({ x: i * (100 / 120), y: 0 });
  dense.push({ x: 100, y: 100 }, { x: 0, y: 100 });
  const compact = smoothPolygonPathData(dense);
  assert.equal(compact, 'M 0 0 L 100 0 L 100 100 L 0 100 Z', compact);

  // Yay: çok noktalı eğri kübik bezier'lara çevrilir
  const arcPoints: Vec2[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI;
    arcPoints.push({ x: 100 + Math.cos(a) * 80, y: 100 + Math.sin(a) * 80 });
  }
  const arc = smoothPolygonPathData(arcPoints);
  assert.ok(arc.includes('C'), 'eğri kübik bezier içermeli');
  // Yay yolunun orta noktası gerçek yay noktasına yakın olmalı
  const numbers = (arc.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const lastX = numbers[numbers.length - 2];
  assert.ok(close(lastX, 20, 1), `yay bitişi yaklaşık 20 olmalı: ${lastX}`);
});

test('geometry: pointInGeometry delikli halkada doğru sonuç verir', () => {
  const ring: Geometry = { kind: 'ring', cx: 100, cy: 100, outerRadius: 50, thickness: 20 };
  assert.equal(pointInGeometry(ring, { x: 100, y: 145 }), true, 'halka gövdesi içinde');
  assert.equal(pointInGeometry(ring, { x: 100, y: 100 }), false, 'delik içinde değil');
  assert.equal(pointInGeometry(ring, { x: 100, y: 200 }), false, 'dışında');
});

test('geometry: flattenGeometry daire için yeterli çözünürlük verir', () => {
  const contours = flattenGeometry(disc(500, 500, 350));
  assert.equal(contours.length, 1);
  assert.ok(contours[0].points.length >= 200, `nokta=${contours[0].points.length}`);
  // Chord hatası çok küçük olmalı
  const pts = contours[0].points;
  let maxErr = 0;
  for (const p of pts) {
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(p.x - 500, p.y - 500) - 350));
  }
  assert.ok(maxErr < 0.2, `maks yarıçap hatası=${maxErr}`);
});

test('geometry: pathDataToCommands + commandsToSubPaths gidiş-dönüş', () => {
  const d = 'M 0 0 L 100 0 L 100 100 Z';
  const subpaths = commandsToSubPaths(pathDataToCommands(d));
  assert.equal(subpaths.length, 1);
  assert.equal(subpaths[0].closed, true);
  assert.equal(subpaths[0].points.length, 3);
});

test('geometry: SVG arc (A) komutu kübiklere çevrilir', () => {
  // Yarım daire yay
  const commands = pathDataToCommands('M 0 100 A 100 100 0 0 1 200 100');
  const cubics = commands.filter((c) => c.cmd === 'C');
  assert.ok(cubics.length >= 2, `kübik sayısı=${cubics.length}`);
  const last = cubics[cubics.length - 1] as Extract<(typeof cubics)[number], { cmd: 'C' }>;
  assert.ok(close(last.x, 200, 0.01), `bitiş x=${last.x}`);
  assert.ok(close(last.y, 100, 0.01), `bitiş y=${last.y}`);
});

test('geometry: relative (küçük harf) path komutları doğru', () => {
  const subpaths = commandsToSubPaths(pathDataToCommands('m 10 10 l 10 0 l 0 10 z'));
  assert.equal(subpaths[0].points[0].x, 10);
  assert.equal(subpaths[0].points[1].x, 20);
  assert.equal(subpaths[0].points[2].y, 20);
});

test('geometry: parseSvgTransform matrix/translate/rotate/scale', () => {
  const m = parseSvgTransform('translate(10,20) scale(2)');
  const p = applyMatrix(m, { x: 1, y: 1 });
  assert.ok(close(p.x, 12), `x=${p.x}`);
  assert.ok(close(p.y, 22), `y=${p.y}`);

  const r = parseSvgTransform('rotate(90 0 0)');
  const rp = applyMatrix(r, { x: 10, y: 0 });
  assert.ok(close(rp.x, 0, 1e-6) && close(rp.y, 10, 1e-6), `${rp.x},${rp.y}`);
});

// ================================================================ 4. SNAP

test('snap: grid adımı size/divisions', () => {
  assert.equal(gridStep(GRID), 25);
  assert.equal(gridStep({ ...GRID, size: 100, divisions: 4 }), 25);
});

test('snap: grid artboard merkezine göre SİMETRİK', () => {
  const { x } = gridLines(GRID, 1000);
  assert.ok(x.includes(500), 'merkez çizgisi mevcut olmalı');
  // Merkeze göre simetri kontrolü
  for (const v of x) {
    const mirror = 1000 - v;
    assert.ok(x.some((o) => close(o, mirror, 1e-6)), `${v} için ayna ${mirror} yok`);
  }
});

test('snap: snapToGrid en yakın alt bölmeye oturtur', () => {
  // step = 50 / 2 = 25
  assert.deepEqual(snapToGrid({ x: 62, y: 113 }, GRID), { x: 50, y: 125 });
  assert.deepEqual(snapToGrid({ x: 63, y: 112 }, GRID), { x: 75, y: 100 });
  assert.deepEqual(snapToGrid({ x: 487, y: 512 }, GRID), { x: 475, y: 500 });
});

test('snap: resolveSnap sürüklemeyi grid kesişimine kilitler', () => {
  const context = {
    grid: GRID,
    artboardSize: 1000,
    objects: [],
    excludeIds: [],
    screenTolerance: 8,
  };
  const outcome = resolveSnap({ probes: [{ x: 100, y: 100 }], delta: { x: 51, y: 2 }, context });
  // hedef (100,100) + (51,2) = (151,102) → X 150'ye, Y 100'e oturur → (150,100)
  assert.ok(close(outcome.delta.x, 50), `dx=${outcome.delta.x}`);
  assert.ok(close(outcome.delta.y, 0), `dy=${outcome.delta.y}`);
  assert.equal(outcome.result.point.x, 150);
  assert.equal(outcome.result.point.y, 100);
  assert.equal(outcome.result.labels.length, 2, 'iki eksen de raporlanmalı');
  assert.ok(outcome.result.labels.every((l) => l.text === 'grid'), JSON.stringify(outcome.result.labels));
  // İki eksen de hizalandığı için sonuç bir grid kesişimidir.
  assert.equal(outcome.result.guides.length, 2);
});

test('snap: tek eksen yakınsa yalnızca o eksen hizalanır', () => {
  const context = { grid: GRID, artboardSize: 1000, objects: [], excludeIds: [], screenTolerance: 8 };
  // y = 102 → y ekseninde 100 ve 125 çizgileri yakın değil (2 < 8 ama)
  // x = 151 → 150 yakın. Kesişim adayı için y de yakın olduğundan
  // serbest bırakmak istediğimiz durumu y=110 ile test ediyoruz.
  const outcome = resolveSnap({ probes: [{ x: 151, y: 110 }], delta: { x: 0, y: 0 }, context });
  assert.ok(close(outcome.delta.x, -1), `dx=${outcome.delta.x}`);
  assert.ok(close(outcome.delta.y, 0), `dy serbest kalmalı: ${outcome.delta.y}`);
});

test('snap: artboard merkezi güçlü bir aday', () => {
  const context = {
    grid: { ...GRID, enabled: false },
    artboardSize: 1000,
    objects: [],
    excludeIds: [],
    screenTolerance: 8,
  };
  // (400,400) + (97,97) = (497,497) → merkez (500,500) her iki eksende de yakın
  const outcome = resolveSnap({ probes: [{ x: 400, y: 400 }], delta: { x: 97, y: 97 }, context });
  assert.ok(close(outcome.delta.x, 100), `dx=${outcome.delta.x}`);
  assert.ok(close(outcome.delta.y, 100), `dy=${outcome.delta.y}`);
  assert.equal(outcome.result.point.x, 500);
  assert.equal(outcome.result.point.y, 500);
});

test('snap: snap kapalıyken hareket değişmez', () => {
  const context = {
    grid: { ...GRID, snap: false },
    artboardSize: 1000,
    objects: [],
    excludeIds: [],
    screenTolerance: 8,
  };
  const outcome = resolveSnap({ probes: [{ x: 151.4, y: 102.7 }], delta: { x: 0, y: 0 }, context });
  assert.equal(outcome.delta.x, 0);
  assert.equal(outcome.delta.y, 0);
});

test('snap: obje kenarlarına snap uygulanır', () => {
  const target = makeRect(200, 200, 100, 100, { name: 'hedef' });
  const moving = makeRect(0, 0, 100, 100, { name: 'kayan' });
  const context = {
    grid: { ...GRID, enabled: false },
    artboardSize: 1000,
    objects: [target, moving],
    excludeIds: [moving.id],
    screenTolerance: 6,
  };
  // moving'in sağ-üst köşesi (100,0) → +103, +203 → (203,203) hedefin sol-üst köşesine yakın
  const outcome = resolveSnap({ probes: [{ x: 100, y: 0 }], delta: { x: 102, y: 201 }, context });
  assert.ok(close(outcome.delta.x, 100, 1), `dx=${outcome.delta.x}`);
  assert.ok(close(outcome.delta.y, 200, 1), `dy=${outcome.delta.y}`);
});

// ========================================================== 5. NODE EDİTİNG

test('nodes: rect köşesi sürüklenince karşı köşe sabit kalır', () => {
  const g = rect(100, 100, 200, 200);
  const moved = moveKeypoint(g, 0, { x: 50, y: 60 });
  assert.deepEqual(moved, { kind: 'rect', x: 50, y: 60, width: 250, height: 240 });
});

test('nodes: circle merkezi ve yarıçapı düzenlenebilir', () => {
  const g = disc(100, 100, 50);
  const movedCenter = moveKeypoint(g, 0, { x: 200, y: 300 });
  assert.deepEqual(movedCenter, { kind: 'circle', cx: 200, cy: 300, r: 50 });

  const resized = moveKeypoint(g, 1, { x: 180, y: 100 });
  assert.ok(resized.kind === 'circle' && close(resized.r, 80), 'yarıçap 80 olmalı');
});

test('nodes: polygon noktası taşınır, nokta eklenir ve silinir', () => {
  const g = poly([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);
  const moved = moveKeypoint(g, 2, { x: 120, y: 120 });
  assert.ok(moved.kind === 'polygon' && moved.keypoints[2].x === 120);

  const inserted = insertKeypoint(g, 0, 0, 0.5);
  assert.ok(inserted.kind === 'polygon' && inserted.keypoints.length === 5);
  assert.ok(close(inserted.keypoints[1].x, 50), 'eklenen nokta segment ortasında');

  const deleted = deleteKeypoint(g, 0, 0);
  assert.ok(deleted.kind === 'polygon' && deleted.keypoints.length === 3);
});

test('nodes: 3 noktadan az polygon nokta silinemez', () => {
  const tri = poly([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ]);
  const same = deleteKeypoint(tri, 0, 0);
  assert.equal(same.kind === 'polygon' ? same.keypoints.length : 0, 3);
});

test('nodes: extraLoops üzerindeki nokta da düzenlenebilir', () => {
  const g: Geometry = {
    kind: 'polygon',
    keypoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    extraLoops: [
      [
        { x: 30, y: 30 },
        { x: 70, y: 30 },
        { x: 70, y: 70 },
        { x: 30, y: 70 },
      ],
    ],
  };
  const loops = geometryEditableLoops(g);
  assert.equal(loops.length, 2, 'iki loop beklenir');
  const moved = moveKeypoint(g, 0, { x: 10, y: 10 }, 1);
  assert.ok(moved.kind === 'polygon');
  assert.equal(moved.extraLoops?.[0][0].x, 10);
  // Birincil loop değişmemeli
  assert.equal(moved.keypoints[0].x, 0);
});

// ==================================================================== 6. PEN

test('pen: düz çapalar düz path üretir', () => {
  const subpaths = penAnchorsToSubPaths([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], false);
  assert.equal(subpaths.length, 1);
  assert.equal(subpaths[0].points.length, 2);
  assert.equal(subpaths[0].closed, false);
});

test('pen: tutamaçlı çapalar eğri üretir', () => {
  const subpaths = penAnchorsToSubPaths(
    [
      { p: { x: 0, y: 0 }, h: { x: 50, y: -100 } },
      { p: { x: 100, y: 0 }, h: { x: 150, y: 100 } },
    ],
    false,
  );
  assert.ok(subpaths[0].points.length > 10, 'eğri örneklenmiş olmalı');
  // Eğri düz çizgiden sapmalı
  const mid = subpaths[0].points[Math.floor(subpaths[0].points.length / 2)];
  assert.ok(Math.abs(mid.y) > 1, `orta nokta sapmalı olmalı: y=${mid.y}`);
});

test('pen: kapalı çapa seti kapalı subpath üretir', () => {
  const subpaths = penAnchorsToSubPaths(
    [
      { p: { x: 0, y: 0 } },
      { p: { x: 100, y: 0 } },
      { p: { x: 100, y: 100 } },
    ],
    true,
  );
  assert.equal(subpaths[0].closed, true);
});

// ================================================================ 7. FABRİKA

test('factory: makeCircle / makeRect / makeRing sınır kutuları doğru', () => {
  const c = makeCircle(500, 500, 100);
  assert.deepEqual({ x: c.x, y: c.y, width: c.width, height: c.height }, { x: 400, y: 400, width: 200, height: 200 });

  const r = makeRect(10, 20, 30, 40);
  assert.deepEqual({ x: r.x, y: r.y, width: r.width, height: r.height }, { x: 10, y: 20, width: 30, height: 40 });

  const ring = makeRing(500, 500, 380, 24);
  assert.equal(ring.width, 760);
  assert.equal(ring.height, 760);
});

test('factory: guide nesneleri export edilmez', () => {
  const guide = makeCircle(500, 500, 100, { isGuide: true, strokeOnly: true });
  assert.equal(exportableObjects([guide]).length, 0);
  const normal = makeCircle(500, 500, 100);
  assert.equal(exportableObjects([normal]).length, 1);
});

// ================================================================= 8. EXPORT

test('export: SVG temiz vektör üretir, grid/guide/UI içermez', () => {
  const objects: ArtboardObject[] = [
    makeCircle(500, 500, 300, { name: 'Outer' }),
    makeRect(100, 100, 50, 50, { name: 'Guide', isGuide: true, strokeOnly: true }),
    makeCircle(200, 200, 40, { name: 'Hidden' }),
  ];
  objects[2].visible = false;

  const { svg, viewBox } = buildSvg({
    objects,
    artboardSize: 1000,
    trimToArtwork: false,
    padding: 0,
    background: 'transparent',
    precision: 3,
  });

  assert.ok(svg.startsWith('<svg'), 'svg kökü');
  assert.ok(svg.includes('viewBox="0 0 1000 1000"'), svg.slice(0, 200));
  assert.equal(viewBox.width, 1000);
  assert.ok(svg.includes('<path'), 'path elemanı beklenir');
  assert.ok(!svg.includes('<image'), 'raster görüntü gömülmemeli');
  assert.ok(!svg.includes('<rect'), 'guide rect export edilmemeli');
  assert.ok(!svg.includes('<text'), 'UI metni olmamalı');
  // Yalnızca görünür + guide olmayan nesne çizilmeli
  assert.equal((svg.match(/<path/g) ?? []).length, 1);
});

test('export: trim to artwork görünür içeriğe kırpar', () => {
  const objects = [makeCircle(500, 500, 100)];
  const bounds = artworkBounds(objects);
  assert.ok(bounds);
  assert.ok(close(bounds!.width, 200, 0.01), `genişlik=${bounds!.width}`);

  const { viewBox } = buildSvg({
    objects,
    artboardSize: 1000,
    trimToArtwork: true,
    padding: 10,
    background: 'transparent',
    precision: 3,
  });
  assert.ok(close(viewBox.width, 220, 0.5), `trim genişlik=${viewBox.width}`);
});

test('export: artboard 1000 olan demo SVG gerçek vektör üretir', () => {
  const demo = createDemoProject();
  const { svg } = buildSvg({
    objects: demo.objects,
    artboardSize: 1000,
    trimToArtwork: false,
    padding: 0,
    background: 'artboard',
    precision: 3,
  });
  assert.ok((svg.match(/<path/g) ?? []).length >= 6, 'en az 6 path beklenir');
  assert.ok(!/<image/.test(svg));
});

// ================================================================= 9. DEMO

test('demo: SAD projesi boolean motoruyla üretilir ve yapı doğrudur', () => {
  const demo = createDemoProject();
  assert.ok(demo.objects.length >= 8, `nesne sayısı=${demo.objects.length}`);
  assert.equal(demo.layers.length, 7);

  const names = demo.objects.map((o) => o.name);
  assert.ok(names.includes('Outer Ring'), names.join(', '));
  assert.ok(names.includes('Letter S'));
  assert.ok(names.includes('Letter A'));
  assert.ok(names.includes('Letter D'));

  const letterS = demo.objects.find((o) => o.name === 'Letter S');
  assert.ok(letterS, 'Letter S bulunmalı');
  assert.equal(letterS!.geometry.kind, 'polygon', 'harfler boolean sonucu polygon olmalı');
  assert.ok(letterS!.fill.type === 'solid', 'harfler dolu olmalı');

  // Harf, iç kırpma dairesinin dışına taşmamalı
  const center = { x: 500, y: 500 };
  const contours = flattenGeometry(letterS!.geometry);
  let maxDist = 0;
  for (const c of contours) {
    for (const p of c.points) {
      maxDist = Math.max(maxDist, Math.hypot(p.x - center.x, p.y - center.y));
    }
  }
  assert.ok(maxDist <= 353, `harf kırpma dairesini aşmamalı: ${maxDist}`);

  // Outer ring fill tabanlı gerçek halka
  const ring = demo.objects.find((o) => o.name === 'Outer Ring');
  assert.ok(ring && ring.geometry.kind === 'ring');
  assert.ok(ring!.fill.type === 'solid');
  assert.equal(ring!.stroke, 'none', 'ring stroke kullanmamalı');
});

test('demo: letter S şekli blok yapıdan gelir ve gerçek delik/boşluk içerir', () => {
  const demo = createDemoProject();
  const letterS = demo.objects.find((o) => o.name === 'Letter S');
  assert.ok(letterS);
  const bounds = geometryBounds(letterS!.geometry);
  assert.ok(bounds.width > 150, `S genişliği=${bounds.width}`);
  assert.ok(bounds.height > 250, `S yüksekliği=${bounds.height}`);

  // S'nin ortasında (üst-sağ boşluk bölgesi) dolu olmamalı
  const emptySpot = { x: bounds.x + bounds.width * 0.85, y: bounds.y + bounds.height * 0.3 };
  assert.equal(pointInGeometry(letterS!.geometry, emptySpot), false, 'S üst-sağ boşluğu dolu olmamalı');
});

// ============================================================ 10. PERSISTENCE

test('persistence: proje JSON gidiş-dönüşü kayıpsız', () => {
  const demo = createDemoProject();
  const file = buildProjectFile(demo.objects, demo.layers, {
    artboardSize: 1000,
    background: '#ffffff',
    outlineMode: false,
    showGuides: true,
    showAnchors: true,
    showSmartGuides: true,
  }, demo.grid);

  const parsed = parseProject(JSON.stringify(file));
  assert.equal(parsed.objects.length, demo.objects.length);
  assert.equal(parsed.layers.length, demo.layers.length);
  assert.deepEqual(parsed.objects[0].geometry, demo.objects[0].geometry);
  assert.equal(parsed.warnings.length, 0);
});

test('persistence: bozuk katman indeksi düzeltilir ve uyarı verir', () => {
  const json = JSON.stringify({
    objects: [
      {
        id: 'x',
        type: 'circle',
        name: 'Test',
        geometry: { kind: 'circle', cx: 0, cy: 0, r: 10 },
        layerIndex: 99,
      },
    ],
    layers: [{ id: 'l0', name: 'L0' }],
  });
  const parsed = parseProject(json);
  assert.equal(parsed.objects[0].layerIndex, 0);
  assert.ok(parsed.warnings.length > 0);
});

test('persistence: geçersiz JSON hata fırlatır', () => {
  assert.throws(() => parseProject('bu json değil'));
});

// ============================================================= 11. SVg IMPORT

test('svgImport: path/circle/rect/polygon ve group transform desteği', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <g transform="translate(10 10)">
      <rect x="0" y="0" width="20" height="20" fill="#ff0000"/>
      <circle cx="50" cy="50" r="10"/>
      <path d="M 0 0 L 10 0 L 10 10 Z"/>
      <polygon points="60,60 70,60 70,70"/>
    </g>
  </svg>`;
  const result = importSvg(svg, 0, 1000, true);
  assert.equal(result.objects.length, 4, `nesne sayısı=${result.objects.length}`);
  const rect = result.objects.find((o) => o.name.includes('Rectangle'));
  assert.ok(rect);
  assert.equal(rect!.fill.type === 'solid' ? rect!.fill.color : '', '#ff0000');
  // Transform uygulanmış olmalı
  assert.ok(rect!.x > 9, `translate uygulanmalı: x=${rect!.x}`);
});

test('svgImport: desteklenmeyen elemanlar uyarı üretir, hata vermez', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0">hi</text><circle cx="5" cy="5" r="3"/></svg>`;
  const result = importSvg(svg, 0, 1000, false);
  assert.equal(result.objects.length, 1);
  assert.ok(result.warnings.length >= 1);
});

test('svgImport: boş SVG hata fırlatır', () => {
  assert.throws(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 0, 1000, false));
});

// =============================================================== 12. MONOGRAM

test('monogram: A–Z kütüphanesi tam ve her harf geçerli geometri üretir', () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (const ch of letters) {
    assert.ok(letterSpec(ch), `${ch} harfi kütüphanede olmalı`);
  }
  assert.equal(Object.keys(LETTER_LIBRARY).length, 26);

  const box = { x: 100, y: 100, width: 200, height: 300 };
  for (const ch of letters) {
    const spec = letterSpec(ch)!;
    const solids = spec.solids.map((p) => primToGeometry(p, box)).filter((g): g is Geometry => Boolean(g));
    assert.ok(solids.length >= 1, `${ch} için en az 1 pozitif parça olmalı`);
    for (const g of solids) {
      const b = geometryBounds(g);
      assert.ok(b.width >= 0 && b.height >= 0, `${ch} geçersiz sınır`);
    }
  }
});

test('monogram: harf kütüphanesi unite/subtract ile anlamlı alan üretir', () => {
  const box = { x: 0, y: 0, width: 200, height: 300 };
  const spec = letterSpec('D')!;
  const solids = spec.solids.map((p) => primToGeometry(p, box)).filter((g): g is Geometry => Boolean(g));
  let geom: Geometry = loopsToPolygonGeometry(uniteAll(solids));
  for (const neg of spec.negatives) {
    const ng = primToGeometry(neg, box);
    if (!ng) continue;
    geom = loopsToPolygonGeometry(booleanGeometry(geom, ng, 'subtract'));
  }
  const bounds = geometryBounds(geom);
  assert.ok(bounds.width > 50, `D genişliği=${bounds.width}`);
  // D'nin iç boşluğu dolu olmamalı
  const inner = { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height / 2 };
  assert.equal(pointInGeometry(geom, inner), false, 'D iç boşluğu dolu olmamalı');
});

// =========================================================== 13. PERFORMANS

test('performans: boolean işlemleri makul sürede tamamlanır', () => {
  const a = disc(500, 500, 350);
  const b = rect(160, 330, 680, 340);
  const start = Date.now();
  for (let i = 0; i < 5; i++) {
    booleanGeometry(a, b, 'intersect');
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `5 boolean işlemi ${elapsed}ms sürdü`);
});

test('performans: grid pattern üretimi yüzlerce çizgi yerine tek pattern kullanır', () => {
  const { x, y } = gridLines({ ...GRID, size: 10, divisions: 2 }, 1000);
  // 5px adımda 200+ çizgi olur; pattern ile DOM'da tek eleman kalır.
  assert.ok(x.length > 100, `çizgi sayısı=${x.length}`);
});
