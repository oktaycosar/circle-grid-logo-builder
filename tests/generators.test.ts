/**
 * Yeni özellik testleri:
 *  - GRID D LOGO GENERATOR (parametrik D logosu)
 *  - Eksen-bağımsız snap sistemi
 *  - İç içe / bitişik şekillerde boolean doğruluğu
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_D_PARAMS,
  D_PRESETS,
  buildDLogo,
  buildConstructionGuides,
  cellFromGrid,
  centerDLogoOnArtboard,
  dLogoMetrics,
  dOutline,
  withDefaults,
} from '../src/core/generators/dLogo.ts';
import { booleanGeometry, loopsToPolygonGeometry, uniteAll } from '../src/core/boolean.ts';
import { geometryBounds, geometryToSvgPathData, pointInGeometry } from '../src/core/geometry.ts';
import type { Geometry, GridSettings, Vec2 } from '../src/core/types.ts';
import { buildSvg, exportableObjects } from '../src/core/export.ts';
import { makeRect } from '../src/core/factory.ts';
import { gridLines, resolveSnap, type SnapOutcome } from '../src/core/snap.ts';

const rect = (x: number, y: number, w: number, h: number): Geometry => ({
  kind: 'rect',
  x,
  y,
  width: w,
  height: h,
});

const disc = (cx: number, cy: number, r: number): Geometry => ({ kind: 'circle', cx, cy, r });

/** Even-odd kuralına göre dolu alan. */
function filledArea(loops: Vec2[][]): number {
  let signed = 0;
  for (const loop of loops) {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      s += p.x * q.y - q.x * p.y;
    }
    signed += s / 2;
  }
  return Math.abs(signed);
}

const close = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

const GRID: GridSettings = { enabled: true, snap: true, size: 50, divisions: 2, opacity: 0.55, majorEvery: 4 };

function snap(probes: Vec2[], delta: Vec2, opts: Partial<Parameters<typeof resolveSnap>[0]['context']> = {}): SnapOutcome {
  return resolveSnap({
    probes,
    delta,
    context: {
      grid: GRID,
      artboardSize: 1000,
      objects: [],
      excludeIds: [],
      screenTolerance: 8,
      ...opts,
    },
  });
}

// ==================================================== 1. D LOGO GENERATOR

test('dLogo: metrikler ızgara hücresinden türetilir', () => {
  const m = dLogoMetrics({ ...DEFAULT_D_PARAMS, cell: 50 });
  assert.equal(m.height, 600, 'yükseklik 12 hücre = 600');
  assert.equal(m.radius, 300, 'gövde yarıçapı = yükseklik/2');
  assert.equal(m.stem, 300, 'gövde genişliği 6 hücre');
  assert.equal(m.arcCenterX, DEFAULT_D_PARAMS.originX + 300);
  assert.equal(m.width, 600, 'toplam genişlik = gövde + yarıçap');
  assert.ok(close(m.band, 40, 1e-6), `bant kalınlığı=${m.band}`);
  assert.ok(close(m.pitch, 50, 1e-6), 'adım = kalınlık + boşluk = 1 hücre');
  assert.equal(m.maxBands, 6, `min(stem, R) / adım = 6, alınan ${m.maxBands}`);
  assert.equal(m.bandCount, 6, 'otomatik bant sayısı');
});

test('dLogo: hücre boyutu grid ayarından türetilebilir', () => {
  assert.equal(cellFromGrid(50, 2), 25);
  assert.equal(cellFromGrid(100, 4), 25);
  assert.equal(cellFromGrid(50, 1), 50);
});

test('dLogo: altı bant üretilir ve her bant bir halkadır (dış + iç sınır)', () => {
  const build = buildDLogo(DEFAULT_D_PARAMS, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
  assert.equal(build.objects.length, 6, `nesne sayısı=${build.objects.length}`);
  assert.equal(build.warnings.length, 0, build.warnings.join(' '));

  for (const [i, obj] of build.objects.entries()) {
    assert.equal(obj.geometry.kind, 'polygon', `bant ${i} polygon olmalı`);
    if (obj.geometry.kind !== 'polygon') continue;
    assert.ok(obj.geometry.keypoints.length > 20, `bant ${i} dış loop nokta sayısı`);
    assert.ok(
      (obj.geometry.extraLoops?.length ?? 0) === 1,
      `bant ${i} iç sınır (delik) içermeli — bu gerçek halka demektir`,
    );
    assert.equal(obj.fill.type, 'solid', `bant ${i} dolgu olmalı (stroke değil)`);
    assert.equal(obj.stroke, 'none');
  }
});

test('dLogo: bantlar paralel içe kaydırmalardır, üst üste binmez', () => {
  const build = buildDLogo(D_PRESETS[0].params, {
    layerIndex: 1,
    withGuides: false,
    guideLayerIndex: 0,
  });
  const m = build.metrics;

  for (let i = 0; i < build.objects.length; i++) {
    const geom = build.objects[i].geometry;
    const dOuter = i * m.pitch;
    // Her bandın dış sınırı beklenen içe kaydırmaya sahip olmalı:
    // sol kenar x = left + d
    const b = geometryBounds(geom);
    assert.ok(close(b.x, m.left + dOuter, 2), `bant ${i} sol kenarı: ${b.x} ≈ ${m.left + dOuter}`);
    assert.ok(close(b.y + b.height, m.bottom - dOuter, 2), `bant ${i} alt kenarı`);
  }

  // Bandın ortasındaki nokta bir sonraki bandın içinde olmamalı (boşluk var)
  const first = build.objects[0].geometry;
  const second = build.objects[1].geometry;
  const midGap = { x: m.left + m.band + m.gap / 2, y: (m.top + m.bottom) / 2 };
  assert.equal(pointInGeometry(second, midGap), false, 'bantlar arası boşluk korunmalı');
  void first;
});

test('dLogo: bant alanı analitik beklentiyle uyuşur', () => {
  // Köşe yuvarlaklığı 0 iken D bölgesinin alanı:
  //   (gövde - d) * 2 * (R - d) + π (R - d)² / 2
  const area = (d: number, stem: number, R: number) =>
    (stem - d) * 2 * (R - d) + (Math.PI * (R - d) ** 2) / 2;

  const params = { ...DEFAULT_D_PARAMS, cornerCells: 0, bands: 2 };
  const build = buildDLogo(params, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
  assert.equal(build.objects.length, 2);

  const m = build.metrics;
  for (let i = 0; i < 2; i++) {
    const loops = flattenToLoops(build.objects[i].geometry);
    const a = filledArea(loops);
    const expected = area(i * m.pitch, m.stem, m.radius) - area(i * m.pitch + m.band, m.stem, m.radius);
    assert.ok(
      close(a, expected, expected * 0.02),
      `bant ${i} alanı=${a.toFixed(0)} beklenen=${expected.toFixed(0)}`,
    );
  }
});

test('dLogo: bant sayısı ve merkez boşluğu parametrik', () => {
  const few = buildDLogo({ ...DEFAULT_D_PARAMS, bands: 3 }, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
  assert.equal(few.objects.length, 3);

  // Sığandan fazla bant istenirse kırpılır ve uyarı verilir
  const tooMany = buildDLogo(
    { ...DEFAULT_D_PARAMS, bands: 99 },
    { layerIndex: 1, withGuides: false, guideLayerIndex: 0 },
  );
  assert.equal(tooMany.objects.length, tooMany.metrics.maxBands);

  // Kalınlık gövdeyi aşarsa hiç bant üretilemez
  const impossible = buildDLogo(
    { ...DEFAULT_D_PARAMS, bandCells: 50, gapCells: 1, bands: 0 },
    { layerIndex: 1, withGuides: false, guideLayerIndex: 0 },
  );
  assert.equal(impossible.objects.length, 0);
  assert.ok(impossible.warnings.length > 0);
});

test('dLogo: konstrüksiyon guide olarak eklenir ve export edilmez', () => {
  const guides = buildConstructionGuides(dLogoMetrics(DEFAULT_D_PARAMS), 1);
  assert.ok(guides.length >= 3, `guide sayısı=${guides.length}`);
  assert.ok(guides.every((g) => g.isGuide), 'hepsi guide olmalı');
  assert.equal(exportableObjects(guides).length, 0, 'guide objeleri export dışı');

  const build = buildDLogo(DEFAULT_D_PARAMS, { layerIndex: 2, withGuides: true, guideLayerIndex: 1 });
  assert.ok(build.objects.some((o) => o.isGuide));
  assert.ok(build.objects.some((o) => !o.isGuide));
});

test('dLogo: SVG export gerçek vektör ve delikleri korur', () => {
  const build = buildDLogo(DEFAULT_D_PARAMS, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
  const { svg } = buildSvg({
    objects: build.objects,
    artboardSize: 1000,
    trimToArtwork: false,
    padding: 0,
    background: 'transparent',
    precision: 3,
  });

  const paths = svg.match(/<path/g) ?? [];
  assert.equal(paths.length, 6, `path sayısı=${paths.length}`);
  assert.ok(!svg.includes('<image'), 'raster gömülmemeli');
  assert.ok(svg.includes('fill-rule="evenodd"'), 'delikler even-odd ile oyulur');
  // Her path en az iki alt yol (dış + iç) içermeli
  assert.ok((svg.match(/M /g) ?? []).length >= 12, 'alt yol sayısı');
});

test('dLogo: artboard üzerinde ızgaraya hizalı ortalanır', () => {
  const centered = centerDLogoOnArtboard({ ...DEFAULT_D_PARAMS, originX: 3, originY: 7 }, 1000);
  const m = dLogoMetrics(centered);
  assert.equal(centered.originX % m.cell, 0, `originX=${centered.originX} hücreye tam bölünmeli`);
  assert.equal(centered.originY % m.cell, 0, `originY=${centered.originY}`);
  // Kenar boşlukları eşit
  const leftMargin = centered.originX;
  const rightMargin = 1000 - (centered.originX + m.width);
  assert.ok(close(leftMargin, rightMargin, m.cell), `sol=${leftMargin} sağ=${rightMargin}`);
  assert.ok(close(centered.originY, 1000 - (centered.originY + m.height), m.cell), 'dikey ortalama');
});

test('dLogo: tüm ön ayarlar geçerli geometri üretir', () => {
  for (const preset of D_PRESETS) {
    const params = withDefaults(preset.params);
    const build = buildDLogo(params, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
    assert.ok(build.objects.length >= 1, `${preset.id}: bant üretilmeli`);
    for (const obj of build.objects) {
      const b = geometryBounds(obj.geometry);
      assert.ok(b.width > 0 && b.height > 0, `${preset.id}: geçersiz sınır`);
    }
  }
});

test('dLogo: dOutline içe kaydırmada monoton küçülür ve sınırda boşalır', () => {
  const m = dLogoMetrics({ ...DEFAULT_D_PARAMS, cornerCells: 0 });
  const areas: number[] = [];
  for (const d of [0, 40, 80, 160, 280]) {
    const loop = dOutline(m, { inset: d, cornerRadius: 0 });
    assert.ok(loop.length >= 3, `inset ${d}: kontur üretilmeli`);
    areas.push(filledArea([loop]));
  }
  for (let i = 1; i < areas.length; i++) {
    assert.ok(areas[i] < areas[i - 1], `alan azalmalı: ${areas[i]} < ${areas[i - 1]}`);
  }
  assert.equal(dOutline(m, { inset: 300, cornerRadius: 0 }).length, 0, 'sınırda kontur boşalır');
});

/** Polygon geometrisini loop listesine çevirir (test yardımcısı). */
function flattenToLoops(g: Geometry): Vec2[][] {
  if (g.kind === 'polygon') return [g.keypoints, ...(g.extraLoops ?? [])];
  return [];
}

// ============================================================ 2. SNAP

test('snap: X ve Y EKSENLERİ BAĞIMSIZ çözülür', () => {
  // X grid çizgisine yakın, Y hiçbir şeye yakın değil → yalnızca X kaymalı
  const outcome = snap([{ x: 152, y: 313 }], { x: 0, y: 0 });
  assert.ok(close(outcome.delta.x, -2), `dx=${outcome.delta.x}`);
  assert.equal(outcome.delta.y, 0, `dy serbest kalmalı, alınan ${outcome.delta.y}`);
  assert.equal(outcome.result.guides.length, 1, 'yalnızca X kılavuzu çizilmeli');
});

test('snap: yalnızca Y ekseni grid çizgisine oturabilir', () => {
  const outcome = snap([{ x: 313, y: 202 }], { x: 0, y: 0 });
  assert.equal(outcome.delta.x, 0, 'X serbest');
  assert.ok(close(outcome.delta.y, -2), `dy=${outcome.delta.y}`);
});

test('snap: artboard merkezi tek eksende de güçlü bir hedeftir', () => {
  // Grid boyutunu 30 yaparsak 500 bir grid çizgisi olmaz; merkez yine hedef olmalı
  const grid: GridSettings = { ...GRID, size: 30, divisions: 1 };
  const outcome = snap([{ x: 400, y: 400 }], { x: 97, y: 0 }, { grid });
  assert.ok(close(outcome.delta.x, 100), `dx=${outcome.delta.x} (merkez 500'e oturmalı)`);
  assert.equal(outcome.delta.y, 0);

  // Dikey eksende de aynı
  const vertical = snap([{ x: 200, y: 400 }], { x: 0, y: 96 }, { grid });
  assert.ok(close(vertical.delta.y, 100), `dy=${vertical.delta.y}`);
});

test('snap: grid çizgisi merkez snap\'ini ezmez, ikisi birlikte çalışır', () => {
  // 500 hem grid çizgisi (50px grid) hem merkez → ikisi de aynı hedef
  const outcome = snap([{ x: 495, y: 495 }], { x: 0, y: 0 });
  assert.equal(outcome.delta.x, 5);
  assert.equal(outcome.delta.y, 5);
  assert.equal(outcome.result.labels.length, 2);
});

test('snap: başka objenin kenarına hizalanır (farklı eksenlerde)', () => {
  const target = makeRect(200, 300, 120, 80, { name: 'Hedef' });
  const outcome = snap([{ x: 205, y: 700 }], { x: 0, y: 0 }, {
    grid: { ...GRID, enabled: false },
    objects: [target],
    excludeIds: [],
  });
  // X: hedefin sol kenarı 200 (mesafe 5) → 5 birim kaymalı
  assert.ok(close(outcome.delta.x, -5), `dx=${outcome.delta.x}`);
  // Y: hedefin alt kenarı 380 (mesafe 320 > tolerans) → serbest
  assert.equal(outcome.delta.y, 0, `dy=${outcome.delta.y}`);
  assert.ok(outcome.result.labels[0].text.includes('Hedef'), outcome.result.labels[0].text);
});

test('snap: sürüklenen objenin kendi kenarına snap yapmaz', () => {
  const moving = makeRect(500, 500, 100, 100, { name: 'Kayan' });
  const outcome = snap([{ x: 502, y: 502 }], { x: 0, y: 0 }, {
    grid: { ...GRID, enabled: false },
    objects: [moving],
    excludeIds: [moving.id],
  });
  // Dışlanan objenin kenarları aday olarak kullanılmamalı;
  // geriye yalnızca artboard merkezi kalır.
  assert.ok(
    outcome.result.labels.every((l) => !l.text.includes('Kayan')),
    JSON.stringify(outcome.result.labels),
  );
});

test('snap: grid kapalıyken sadece merkez ve objeler kullanılır', () => {
  const outcome = snap([{ x: 301, y: 301 }], { x: 0, y: 0 }, {
    grid: { ...GRID, enabled: false },
  });
  assert.equal(outcome.delta.x, 0);
  assert.equal(outcome.delta.y, 0);
});

test('snap: çoklu probe ile hem köşe hem merkez hizalanır', () => {
  // Kutu (100..200, 100..200); delta (55, -3) → sol kenar 155 (grid 150'e), üst 97 (grid 100'e)
  const probes: Vec2[] = [
    { x: 150, y: 150 }, // merkez
    { x: 100, y: 100 }, // sol-üst
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];
  const outcome = snap(probes, { x: 55, y: -3 });
  // Merkez 205 → 200'e oturur (grid), sol kenar 155 → 150'ye. En yakın: sol kenar 155→150 (5)
  // vs merkez 205→200 (5) — eşit mesafede tier aynı, ilk kalan kazanır.
  assert.ok(close(outcome.delta.x, 50) || close(outcome.delta.x, 45), `dx=${outcome.delta.x}`);
  assert.ok(close(outcome.delta.y, 0) || close(outcome.delta.y, 0), `dy=${outcome.delta.y}`);
});

// ================================================ 3. İÇ İÇE BOOLEAN

test('boolean: birebir aynı iki şekil', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(0, 0, 100, 100);

  assert.ok(close(filledArea(booleanGeometry(a, b, 'unite')), 10000, 20), 'unite = kendisi');
  assert.ok(close(filledArea(booleanGeometry(a, b, 'intersect')), 10000, 20), 'intersect = kendisi');
  assert.equal(booleanGeometry(a, b, 'subtract').length, 0, 'fark boş olmalı');
});

test('boolean: tam kenar paylaşan bitişik dikdörtgenler', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(0, 100, 100, 100); // tam alttan bitişik

  const united = booleanGeometry(a, b, 'unite');
  assert.equal(united.length, 1, `unite tek loop olmalı, alınan ${united.length}`);
  assert.ok(close(filledArea(united), 20000, 40), `alan=${filledArea(united)}`);

  assert.equal(booleanGeometry(a, b, 'intersect').length, 0, 'kesişim boş olmalı');

  const diff = booleanGeometry(a, b, 'subtract');
  assert.ok(close(filledArea(diff), 10000, 40), `fark = A: ${filledArea(diff)}`);
});

test('boolean: delik sol ve sağ kenarları paylaşınca iki parça kalır', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(0, 25, 100, 50); // sol ve sağ kenarları A ile çakışık
  const loops = booleanGeometry(a, b, 'subtract');
  assert.equal(loops.length, 2, `iki parça beklenir, alınan ${loops.length}`);
  assert.ok(close(filledArea(loops), 5000, 60), `alan=${filledArea(loops)}`);
});

test('boolean: delik yalnızca sol kenarı paylaşınca C şekli kalır', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(0, 25, 50, 50);
  const loops = booleanGeometry(a, b, 'subtract');
  assert.equal(loops.length, 1, `tek loop beklenir, alınan ${loops.length}`);
  assert.ok(close(filledArea(loops), 7500, 60), `alan=${filledArea(loops)}`);
  // Çentik boş olmalı
  const geom = loopsToPolygonGeometry(loops);
  assert.equal(pointInGeometry(geom, { x: 25, y: 50 }), false, 'çentik boş olmalı');
  assert.equal(pointInGeometry(geom, { x: 75, y: 50 }), true, 'sağ taraf dolu olmalı');
});

test('boolean: delik dört kenara da teğet (daire içinde daire olmayan durum)', () => {
  const a = rect(0, 0, 200, 200);
  const b = disc(100, 100, 100); // daire kutuya dört kenardan teğet
  const inv = booleanGeometry(a, b, 'intersect'); // kutu ∩ daire = daire
  assert.ok(close(filledArea(inv), Math.PI * 100 * 100, 700), `alan=${filledArea(inv)}`);

  const diff = booleanGeometry(a, b, 'subtract');
  const expected = 200 * 200 - Math.PI * 100 * 100;
  assert.ok(close(filledArea(diff), expected, 900), `alan=${filledArea(diff)} beklenen=${expected}`);
  // Delik gerçek: merkez boş, köşeler dolu
  const geom = loopsToPolygonGeometry(diff);
  assert.equal(pointInGeometry(geom, { x: 100, y: 100 }), false, 'daire merkezi boş olmalı');
  assert.equal(pointInGeometry(geom, { x: 8, y: 8 }), true, 'köşe dolu olmalı');
});

test('boolean: daire sol kenara teğet delik', () => {
  const a = rect(0, 0, 200, 200);
  const b = disc(0, 100, 50); // sol kenara teğet, yarısı dışarıda
  const loops = booleanGeometry(a, b, 'subtract');
  const expected = 200 * 200 - (Math.PI * 50 * 50) / 2;
  assert.ok(close(filledArea(loops), expected, 500), `alan=${filledArea(loops)} beklenen=${expected}`);
});

test('boolean: üç şekil ardışık unite tek kompakt loop üretir', () => {
  const bars = [rect(0, 0, 100, 20), rect(0, 20, 100, 20), rect(0, 40, 100, 20)];
  const loops = uniteAll(bars);
  assert.equal(loops.length, 1, `tek loop beklenir, alınan ${loops.length}`);
  assert.ok(close(filledArea(loops), 6000, 40), `alan=${filledArea(loops)}`);
});

test('boolean: alan korunumu — A = (A - B) + (A ∩ B)', () => {
  const cases: { a: Geometry; b: Geometry; label: string }[] = [
    { a: rect(0, 0, 100, 100), b: rect(50, 50, 100, 100), label: 'kısmi kesişim' },
    { a: rect(0, 0, 100, 100), b: rect(20, 20, 60, 60), label: 'içte delik' },
    { a: rect(0, 0, 100, 100), b: rect(0, 30, 100, 40), label: 'kenar paylaşan delik' },
    { a: disc(0, 0, 100), b: disc(60, 0, 60), label: 'iki daire' },
    { a: rect(0, 0, 120, 80), b: disc(60, 40, 45), label: 'dikdörtgen ve daire' },
  ];

  for (const { a, b, label } of cases) {
    const aOnly = filledArea(booleanGeometry(a, b, 'subtract'));
    const both = filledArea(booleanGeometry(a, b, 'intersect'));
    const total = filledArea(loopsToPolygonGeometry(booleanGeometry(a, b, 'unite')) ? loopsOfGeometry(a) : []);
    void total;
    const areaA = filledArea(loopsOfGeometry(a));
    assert.ok(
      close(aOnly + both, areaA, areaA * 0.03),
      `${label}: (A-B)=${aOnly.toFixed(0)} + (A∩B)=${both.toFixed(0)} ≠ A=${areaA.toFixed(0)}`,
    );
  }
});

/** Bir geometrinin dolgu alanı. */
function loopsOfGeometry(g: Geometry): Vec2[][] {
  if (g.kind === 'rect') {
    return [
      [
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x + g.width, y: g.y + g.height },
        { x: g.x, y: g.y + g.height },
      ],
    ];
  }
  if (g.kind === 'circle') {
    const steps = 256;
    return [
      Array.from({ length: steps }, (_, i) => {
        const t = (i / steps) * Math.PI * 2;
        return { x: g.cx + Math.cos(t) * g.r, y: g.cy + Math.sin(t) * g.r };
      }),
    ];
  }
  if (g.kind === 'polygon') return [g.keypoints, ...(g.extraLoops ?? [])];
  return [];
}

test('boolean: divide parçaları birleşimi ve kesişimi kaplar', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  const parts = booleanGeometry(a, b, 'divide');
  assert.ok(parts.length >= 3, `parça sayısı=${parts.length}`);
  assert.ok(close(filledArea(parts), 17500, 100), `toplam=${filledArea(parts)}`);
});

test('boolean: grid D logosunun bantları geometrik olarak ayrıktır', () => {
  const build = buildDLogo(DEFAULT_D_PARAMS, { layerIndex: 1, withGuides: false, guideLayerIndex: 0 });
  const m = build.metrics;

  // Bir bandın dolu olduğu noktanın, başka bir bantta da dolu OLMAMASI gerekir.
  const probes: Vec2[] = [
    { x: m.left + m.band / 2, y: (m.top + m.bottom) / 2 },
    { x: m.arcCenterX + m.radius - m.band / 2, y: (m.top + m.bottom) / 2 },
    { x: m.left + m.band / 2 + m.pitch, y: (m.top + m.bottom) / 2 },
    { x: m.left + m.band / 2, y: m.top + m.band / 2 },
  ];

  for (const p of probes) {
    const hits = build.objects.filter((o) => pointInGeometry(o.geometry, p)).length;
    assert.ok(hits <= 1, `nokta (${p.x},${p.y}) ${hits} bantta dolu — bantlar üst üste binmemeli`);
  }

  // Toplam siyah alan, tüm D bölgesinden küçük ve makul olmalı
  const totalBlack = build.objects.reduce((sum, o) => sum + filledArea(flattenToLoops(o.geometry)), 0);
  const areaAll = (m.stem * m.height) + (Math.PI * m.radius ** 2) / 2;
  assert.ok(totalBlack < areaAll, `siyah alan=${totalBlack} toplam=${areaAll}`);
  assert.ok(totalBlack > areaAll * 0.6, `siyah alan beklenenden az: ${totalBlack} / ${areaAll}`);
});

test('snap: grid çizgileri hücre boyutuna göre simetrik kalır', () => {
  const lines = gridLines({ ...GRID, size: 40, divisions: 2 }, 1000).x;
  assert.ok(lines.includes(500), 'merkez çizgisi var');
  assert.ok(lines.includes(480) && lines.includes(520), 'hücre çizgileri simetrik');
});
