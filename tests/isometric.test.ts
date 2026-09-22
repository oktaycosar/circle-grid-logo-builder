/**
 * İzometrik (küp tabanlı) logo sistemi testleri — spesifikasyon §İkinci video.
 *
 * Kapsam: izdüşüm, üç çizgi ailesi (grid), latis snap, eksen kilidi,
 * küp yüzleri, extrude ve yüzeye yansıtma.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ISO,
  ISO_COS,
  ISO_SIN,
  buildIsoCube,
  centerIsoOrigin,
  extrudeGeometry,
  isoAxisLock,
  isoCubeFaces,
  isoDepthOffset,
  isoGridPaths,
  isoLockedSegment,
  isoProject,
  isoSnapPoint,
  isoUnproject,
  projectGeometryToFace,
} from '../src/core/isometric.ts';
import { geometryBounds, geometryToSvgPathData, flattenGeometry, pointInGeometry } from '../src/core/geometry.ts';
import { resolveSnap } from '../src/core/snap.ts';
import { makeRect } from '../src/core/factory.ts';
import type { Geometry, GridSettings, IsoSettings, Vec2 } from '../src/core/types.ts';

const HALF30 = Math.tan(Math.PI / 6); // 0.577350…
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const rect = (x: number, y: number, w: number, h: number): Geometry => ({ kind: 'rect', x, y, width: w, height: h });

/** Poligonun toplam işaretli alanı. */
function ringArea(points: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function areaOf(geometry: Geometry): number {
  return flattenGeometry(geometry).reduce((sum, c) => sum + Math.abs(ringArea(c.points)), 0);
}

const ORIGIN: Vec2 = { x: 500, y: 500 };

// ----------------------------------------------------------------- izdüşüm

test('iso: projeksiyon ve ters projeksiyon birbirini tutar', () => {
  const samples: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 250, y: -175 },
    { x: -320, y: 410 },
  ];
  for (const s of samples) {
    const p = isoProject(s.x, s.y, 0, ORIGIN);
    const back = isoUnproject(p, ORIGIN, 0);
    assert.ok(close(back.u, s.x, 1e-9), `u uyuşmadı: ${back.u} ≠ ${s.x}`);
    assert.ok(close(back.v, s.y, 1e-9), `v uyuşmadı: ${back.v} ≠ ${s.y}`);
  }
});

test('iso: eksen vektörleri 30° / 150° / dikey yönlerindedir', () => {
  const o = isoProject(0, 0, 0, ORIGIN);
  const u = isoProject(100, 0, 0, ORIGIN);
  const v = isoProject(0, 100, 0, ORIGIN);
  const z = isoProject(0, 0, 100, ORIGIN);

  assert.ok(close(u.x - o.x, 100 * ISO_COS, 1e-9));
  assert.ok(close(u.y - o.y, 100 * ISO_SIN, 1e-9));
  assert.ok(close(v.x - o.x, -100 * ISO_COS, 1e-9));
  assert.ok(close(v.y - o.y, 100 * ISO_SIN, 1e-9));
  assert.ok(close(z.x - o.x, 0, 1e-9));
  assert.ok(close(z.y - o.y, -100, 1e-9));

  // u ekseni tam olarak +30°, v ekseni tam olarak 150° eğimli
  assert.ok(close((u.y - o.y) / (u.x - o.x), HALF30, 1e-9));
  assert.ok(close((v.y - o.y) / (v.x - o.x), -HALF30, 1e-9));
});

// -------------------------------------------------------------------- grid

test('iso: üç çizgi ailesi de üretilir ve 30° eğimlidir', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, enabled: true, cell: 50, showVerticals: true };
  const paths = isoGridPaths(iso, 1000);

  assert.ok(paths.lineCount > 10, 'grid yeterli çizgi üretmeli');
  assert.ok(paths.alongU.includes('M'), 'u ailesi path içermeli');
  assert.ok(paths.alongV.includes('M'), 'v ailesi path içermeli');
  assert.ok(paths.vertical.includes('M'), 'dikey aile path içermeli');

  // `alongU` üzerindeki her segment +30°, `alongV` üzerindeki her segment −30° olmalı.
  const segmentsOf = (d: string): { a: Vec2; b: Vec2 }[] => {
    const out: { a: Vec2; b: Vec2 }[] = [];
    for (const chunk of d.split('M').slice(1)) {
      const coords = chunk.trim().split(/[\sL]+/).map(Number).filter((n) => !Number.isNaN(n));
      if (coords.length >= 4) out.push({ a: { x: coords[0], y: coords[1] }, b: { x: coords[2], y: coords[3] } });
    }
    return out;
  };

  for (const s of segmentsOf(paths.alongU)) {
    assert.ok(close((s.b.y - s.a.y) / (s.b.x - s.a.x), HALF30, 1e-3), 'u çizgisi 30° olmalı');
  }
  for (const s of segmentsOf(paths.alongV)) {
    assert.ok(close((s.b.y - s.a.y) / (s.b.x - s.a.x), -HALF30, 1e-3), 'v çizgisi 150° olmalı');
  }
  for (const s of segmentsOf(paths.vertical)) {
    assert.ok(close(s.b.x, s.a.x, 1e-6), 'dikey çizgiler sabit x taşımalı');
  }
});

test('iso: dikey aile kapalıyken üretilmez', () => {
  const paths = isoGridPaths({ ...DEFAULT_ISO, enabled: true, showVerticals: false }, 1000);
  assert.equal(paths.vertical, '');
  assert.ok(paths.alongU.length > 0 && paths.alongV.length > 0);
});

test('iso: grid artboardu tamamen kapsar', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, cell: 50, origin: centerIsoOrigin(1000) };
  const paths = isoGridPaths(iso, 1000);
  const coords = paths.alongU.split('M').slice(1).flatMap((c) =>
    c.trim().split(/[\sL]+/).map(Number).filter((n) => !Number.isNaN(n)),
  );
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...xs) <= 0 && Math.max(...xs) >= 1000, 'x kapsaması yetersiz');
  assert.ok(Math.min(...ys) <= 0 && Math.max(...ys) >= 1000, 'y kapsaması yetersiz');
});

// -------------------------------------------------------------------- snap

test('iso: latis snap her zaman geçerli bir düğüme oturur', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, cell: 50, origin: ORIGIN, snap: true };
  const a = 50;
  const prop = ISO_SIN;

  for (const target of [
    { x: 517, y: 489 },
    { x: 213, y: 733 },
    { x: 902, y: 118 },
  ]) {
    const snapped = isoSnapPoint(target, iso);
    // m ve n pariteleri eşit olmalı (3B latisin izdüşümü)
    const m = Math.round((snapped.point.x - ORIGIN.x) / (a * ISO_COS));
    const n = Math.round((snapped.point.y - ORIGIN.y) / (a * prop));
    assert.equal(((m % 2) + 2) % 2, ((n % 2) + 2) % 2, `parite uyuşmadı: m=${m}, n=${n}`);
    assert.ok(snapped.distance <= a, 'snap mesafesi bir hücreyi aşmamalı');
  }
});

test('iso: snapten sonra mesafe 0 olur', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, cell: 50, origin: ORIGIN, snap: true };
  const first = isoSnapPoint({ x: 517, y: 489 }, iso);
  const again = isoSnapPoint(first.point, iso);
  assert.ok(again.distance < 1e-6, 'sabit nokta olmalı');
  assert.ok(close(again.point.x, first.point.x, 1e-9));
  assert.ok(close(again.point.y, first.point.y, 1e-9));
});

test('iso: snap ekran latis indekslerini doğru (u,v) hücresine çevirir', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, cell: 50, origin: ORIGIN };
  const a = 50;

  // Doğrudan bir latis düğümü: u = 3, v = 2 hücre.
  const node = isoProject(3 * a, 2 * a, 0, ORIGIN);
  const snapped = isoSnapPoint(node, iso);

  assert.ok(close(snapped.u, 3, 1e-6), `u beklenen 3, bulunan ${snapped.u}`);
  assert.ok(close(snapped.v, 2, 1e-6), `v beklenen 2, bulunan ${snapped.v}`);
  assert.ok(close(snapped.point.x, node.x, 1e-6) && close(snapped.point.y, node.y, 1e-6), 'düğüm korunmalı');

  // (u, v) ile (m, n) karıştırılmamalı: m = u − v, n = u + v.
  assert.ok(close(snapped.m, snapped.u - snapped.v, 1e-9));
  assert.ok(close(snapped.n, snapped.u + snapped.v, 1e-9));
});

test('iso: (u,v) indeksleri her zaman tamsayıdır', () => {
  const iso: IsoSettings = { ...DEFAULT_ISO, cell: 50, origin: ORIGIN };
  for (const p of [
    { x: 320, y: 640 },
    { x: 811, y: 199 },
    { x: 522, y: 501 },
  ]) {
    const s = isoSnapPoint(p, iso);
    assert.ok(close(s.u, Math.round(s.u), 1e-9), `u tamsayı değil: ${s.u}`);
    assert.ok(close(s.v, Math.round(s.v), 1e-9), `v tamsayı değil: ${s.v}`);
  }
});

test('iso: resolveSnap izometrik moddayken latise kilitlenir', () => {
  const GRID: GridSettings = { enabled: true, snap: true, size: 50, divisions: 2, opacity: 0.5, majorEvery: 4 };
  const iso: IsoSettings = { ...DEFAULT_ISO, enabled: true, cell: 50, origin: ORIGIN, snap: true };
  const probe: Vec2 = { x: 585, y: 549 };
  const outcome = resolveSnap({
    probes: [probe],
    delta: { x: 0, y: 0 },
    context: { grid: GRID, iso, artboardSize: 1000, objects: [], excludeIds: [], screenTolerance: 10 },
  });
  const snapped = isoSnapPoint(probe, iso);
  assert.ok(snapped.distance < 10, 'test probu latise yakın olmalı');
  assert.ok(close(outcome.point.x, snapped.point.x, 1e-6), 'x latise oturmalı');
  assert.ok(close(outcome.point.y, snapped.point.y, 1e-6), 'y latise oturmalı');
});

test('iso: snap kapalıyken latis devreye girmez', () => {
  const GRID: GridSettings = { enabled: false, snap: false, size: 50, divisions: 2, opacity: 0.5, majorEvery: 4 };
  const iso: IsoSettings = { ...DEFAULT_ISO, enabled: true, cell: 50, origin: ORIGIN, snap: false };
  const outcome = resolveSnap({
    probes: [{ x: 519, y: 488 }],
    delta: { x: 0, y: 0 },
    context: { grid: GRID, iso, artboardSize: 1000, objects: [], excludeIds: [], screenTolerance: 10 },
  });
  assert.equal(outcome.delta.x, 0);
  assert.equal(outcome.delta.y, 0);
});

// -------------------------------------------------------------- eksen kilidi

test('iso: eksen kilidi yalnızca ±30° veya dikey üretir', () => {
  const deltas: Vec2[] = [
    { x: 120, y: 20 },
    { x: -90, y: 140 },
    { x: 30, y: -160 },
    { x: 200, y: 210 },
  ];
  for (const d of deltas) {
    const locked = isoAxisLock(d, true);
    const len = Math.hypot(locked.x, locked.y);
    if (len < 1e-9) continue;
    const slope = locked.y / locked.x;
    const isVertical = Math.abs(locked.x) < 1e-9;
    const okAngle = close(Math.abs(slope), HALF30, 1e-6);
    assert.ok(
      isVertical || okAngle,
      `kilit izometrik eksene oturmadı: (${locked.x}, ${locked.y})`,
    );
  }
});

test('iso: dikey izin verilmediğinde yalnızca ±30° kalır', () => {
  const locked = isoLockedSegment({ x: 0, y: 0 }, { x: 10, y: -500 });
  assert.ok(Math.abs(locked.x) > 1e-6 || Math.hypot(locked.x, locked.y) < 1e-6);
});

// -------------------------------------------------------------------- küp

test('iso: küp üç yüz üretir ve yüzler yakın dikey kenarı paylaşır', () => {
  const cube = { u: 0, v: 0, edge: 6, height: 6, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const faces = isoCubeFaces(cube);

  for (const face of ['top', 'right', 'left'] as const) {
    assert.equal(faces[face].length, 4, `${face} dört köşeli olmalı`);
    assert.ok(Math.abs(ringArea(faces[face])) > 1, `${face} alanı sıfır olmamalı`);
  }

  // Üst ve sağ yüz, üst-yakın köşeyi paylaşır.
  const nearTop = isoProject(0, 0, 300, ORIGIN);
  const nearBottom = isoProject(0, 0, 0, ORIGIN);
  const hasPoint = (pts: Vec2[], p: Vec2) => pts.some((q) => close(q.x, p.x, 1e-9) && close(q.y, p.y, 1e-9));

  assert.ok(hasPoint(faces.top, nearTop), 'üst yüz yakın-üst köşeyi içermeli');
  assert.ok(hasPoint(faces.right, nearTop) && hasPoint(faces.right, nearBottom), 'sağ yüz yakın dikey kenarı taşımalı');
  assert.ok(hasPoint(faces.left, nearTop) && hasPoint(faces.left, nearBottom), 'sol yüz yakın dikey kenarı taşımalı');
});

test('iso: buildIsoCube üç obje üretir, hepsi isoFace etiketli', () => {
  const cube = { u: 0, v: 0, edge: 4, height: 6, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const objects = buildIsoCube(cube, 0);

  assert.equal(objects.length, 3);
  const tags = objects.map((o) => o.isoFace).sort();
  assert.deepEqual(tags, ['left', 'right', 'top']);

  const colors = new Set(objects.map((o) => (o.fill.type === 'solid' ? o.fill.color : '')));
  assert.equal(colors.size, 3, 'üç yüz farklı renkte olmalı');

  for (const obj of objects) {
    assert.ok(geometryToSvgPathData(obj.geometry).includes('Z'), 'yüz kapalı path olmalı');
  }
});

test('iso: küp yüzeyi yüksekliği ile ölçeklenir', () => {
  const base = { u: 0, v: 0, edge: 4, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const low = isoCubeFaces({ ...base, height: 2 });
  const high = isoCubeFaces({ ...base, height: 8 });

  const heightOf = (pts: Vec2[]) => {
    const ys = pts.map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  };

  assert.ok(heightOf(high.right) > heightOf(low.right), 'yükseklik yüz boyutunu büyütmeli');
  // Üst yüzün dikey boyutu yükseklikten bağımsız olmalı (sadece kenar).
  assert.ok(close(heightOf(high.top), heightOf(low.top), 1e-6), 'üst yüz yükseklikten etkilenmemeli');
});

// ---------------------------------------------------------------- extrude

test('iso: extrude bandı üretir ve şeklin içini boş bırakır', () => {
  // Dikey ofset: yalnızca üst ve alt bant oluşur (sol/sağ kenarlar sıfır alanlı).
  const vertical = extrudeGeometry(rect(0, 0, 100, 100), 0, -50);
  const verticalArea = areaOf(vertical);
  assert.ok(Math.abs(verticalArea - 10000) < 1, `dikey: beklenen 10000, bulunan ${verticalArea}`);

  // Çapraz ofset: bant, şeklin sınır kenarlarını süpürür ama İÇ bölgeyi kaplamaz.
  const diagonal = extrudeGeometry(rect(0, 0, 100, 100), 30, -30);
  assert.ok(areaOf(diagonal) > 10000, 'çapraz bant üretilmeli');
  assert.ok(!pointInGeometry(diagonal, { x: 50, y: 50 }), 'şeklin içi bantta olmamalı');
  assert.ok(pointInGeometry(diagonal, { x: 5, y: 50 }), 'sol kenar süpürülmüş olmalı');
  assert.ok(pointInGeometry(diagonal, { x: 50, y: 95 }), 'üst kenar süpürülmüş olmalı');
});

test('iso: extrude neredeyse sıfır ofsette boş döner', () => {
  const band = extrudeGeometry(rect(0, 0, 100, 100), 0, 0);
  assert.equal(band.kind, 'polygon');
  if (band.kind === 'polygon') assert.equal(band.keypoints.length, 0);
});

test('iso: derinlik ofseti ekranda dikey (−z) yönündedir', () => {
  const off = isoDepthOffset(4, 50);
  assert.ok(Math.abs(off.x) < 1e-9, 'x kaymamalı');
  assert.ok(close(off.y, 200, 1e-9), 'z derinliği ekranda +y (aşağı) yönünde olmalı');
  // Ofset, projeksiyondaki z ekseniyle zıt yönde olmalı (−z = ekranda aşağı).
  const zAxis = isoProject(0, 0, 0, ORIGIN);
  const zUp = isoProject(0, 0, 1, ORIGIN);
  assert.ok(close(zUp.x - zAxis.x, 0, 1e-9) && zUp.y - zAxis.y < 0, 'projeksiyonda +z yukarıdır');
});

// ------------------------------------------------------- yüzeye yansıtma

test('iso: projectGeometryToFace hedef yüzeyin düzlemine oturtur', () => {
  const cube = { u: 0, v: 0, edge: 6, height: 6, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const src = rect(-100, -100, 200, 200);

  for (const face of ['top', 'right', 'left'] as const) {
    const projected = projectGeometryToFace(src, face, cube);
    const bounds = geometryBounds(projected);
    assert.ok(bounds.width > 0 && bounds.height > 0, `${face}: geçersiz sınır`);

    // Yansıtılan şeklin tüm noktaları, hedef yüzün paralelkenar sınırları içinde olmalı.
    const facePts = isoCubeFaces(cube)[face];
    const fb = geometryBounds({ kind: 'polygon', keypoints: facePts });
    assert.ok(bounds.x >= fb.x - 1 && bounds.y >= fb.y - 1, `${face}: şekil yüzün dışına taştı (sol/üst)`);
    assert.ok(
      bounds.x + bounds.width <= fb.x + fb.width + 1 && bounds.y + bounds.height <= fb.y + fb.height + 1,
      `${face}: şekil yüzün dışına taştı (sağ/alt)`,
    );
  }
});

test('iso: yüzeye yansıtma boş şekilde çökmez', () => {
  const cube = { u: 0, v: 0, edge: 4, height: 4, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const empty: Geometry = { kind: 'polygon', keypoints: [] };
  const projected = projectGeometryToFace(empty, 'top', cube);
  assert.ok(projected !== null);
});

// ------------------------------------------------ dışa aktarma bütünlüğü

test('iso: izometrik modda üretilen obje SVG path olarak yazılabilir', () => {
  const cube = { u: 0, v: 0, edge: 3, height: 3, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const objects = buildIsoCube(cube, 0);
  for (const obj of objects) {
    const d = geometryToSvgPathData(obj.geometry);
    assert.ok(d.startsWith('M'), `${obj.name}: path M ile başlamalı`);
    assert.ok(d.endsWith('Z'), `${obj.name}: path kapanmalı`);
  }
});

test('iso: centerIsoOrigin artboard merkezini verir', () => {
  const o = centerIsoOrigin(1000);
  assert.deepEqual(o, { x: 500, y: 500 });
  assert.deepEqual(centerIsoOrigin(800), { x: 400, y: 400 });
});

test('iso: makeRect ile karıştırıldığında koordinatlar bozulmaz', () => {
  // Yüz poligonları ile parametrik dikdörtgenler aynı doküman uzayında olmalı.
  const cube = { u: 0, v: 0, edge: 2, height: 2, cell: 50, origin: ORIGIN, faceColors: DEFAULT_ISO.faceColors };
  const faces = isoCubeFaces(cube);
  const bounds = geometryBounds({ kind: 'polygon', keypoints: faces.top });
  assert.ok(bounds.x > 0 && bounds.y > 0, 'yüzler pozitif koordinatlarda olmalı');
  const r = makeRect(0, 0, 100, 100, { layerIndex: 0 });
  assert.equal(r.x, 0);
});
