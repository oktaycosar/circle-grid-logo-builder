/**
 * Grid Draw — bölge motoru testleri.
 *
 * Kritik iddialar:
 *   - Izgara DÜŞEY ve YATAYDA EŞİTTİR ve artboard karedir; hücreler kare olur.
 *     Bu yüzden köşe çaprazları her hücreyi TAM ikiye böler.
 *   - Başlangıçta yalnızca ızgara vardır; daire/çizgi kullanıcı çizimidir.
 *   - Kılavuz eklemek bölgeleri BÖLER.
 *   - Her gözün sınırı GERÇEK kılavuz çizgisine/tam daireye oturur.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRID_DRAW,
  MAX_DIVISIONS,
  MIN_REGION_AREA,
  SNAP_TOL,
  buildGridDrawPlan,
  centerCircles,
  centerCrossLines,
  circleGuide,
  cornerDiagonals,
  guideGeometry,
  guideNear,
  lineGuide,
  normalizeSettings,
  regionAt,
  regionsInDisc,
  regionsOnSide,
  remapFills,
  strokeRegions,
  structureChanged,
  type GridDrawPlan,
  type GridDrawSettings,
} from '../src/griddraw/regions.ts';
import { DEFAULT_GRID_DRAW_STYLE, buildGridDrawSvg, guideRenderData } from '../src/griddraw/gridDrawSvg.ts';
import type { Vec2 } from '../src/core/types.ts';

const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

function settings(patch: Partial<GridDrawSettings> = {}): GridDrawSettings {
  return { ...DEFAULT_GRID_DRAW, ...patch };
}

/** Sade ızgara: yalnızca grid, hücre `size/grid` kare. */
function plainGrid(size = 400, grid = 4): GridDrawPlan {
  return buildGridDrawPlan(settings({ grid, size, guides: [] }));
}

function loopBounds(loops: Vec2[][]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const loop of loops) {
    for (const p of loop) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bir hücrenin merkezinden bölge kimliği. */
function cellAt(plan: GridDrawPlan, col: number, row: number): number {
  const cell = plan.guides.cell;
  return regionAt(plan, { x: (col + 0.5) * cell, y: (row + 0.5) * cell });
}

// ----------------------------------------------------------- ızgara karesi

test('gd: ızgara düşey ve yatayda eşittir, artboard karedir', () => {
  const g = guideGeometry(settings({ grid: 24, size: 1440 }));

  assert.equal(g.grid, 24);
  assert.equal(g.cols, g.rows, 'sütun ve satır sayısı eşit olmalı');
  assert.equal(g.size, 1440);
  assert.equal(g.width, g.height, 'artboard kare olmalı');
  assert.equal(g.cellW, g.cellH, 'hücre kare olmalı');
  assert.equal(g.cell, 60);
  assert.equal(g.cx, 720);
  assert.equal(g.cy, 720);
});

test('gd: köşe çaprazları kare hücrelerin kafes noktalarından geçer', () => {
  const plan = plainGrid(240, 4);
  const g = plan.guides;
  const cell = g.cell;

  // Köşe çaprazı y = x, her hücre köşesinden geçmeli: (i*cell, i*cell).
  for (let i = 0; i <= g.grid; i++) {
    const lattice = { x: i * cell, y: i * cell };
    assert.ok(close(lattice.x / cell, lattice.y / cell, 1e-9), 'kafes noktası hizasında');
  }

  // Çapraz eklenince bölge sayısı tam olarak artar (her hücre ikiye bölünür).
  const withDiagonals = buildGridDrawPlan(settings({ grid: 4, size: 240, guides: cornerDiagonals(240) }));
  const plain = buildGridDrawPlan(settings({ grid: 4, size: 240, guides: [] }));
  assert.ok(
    withDiagonals.regions.length > plain.regions.length,
    `çapraz bölmeli: ${withDiagonals.regions.length} > ${plain.regions.length}`,
  );
});

test('gd: bölme sayısı sınırları kırpılır', () => {
  assert.equal(guideGeometry(settings({ grid: 0 })).grid, 2);
  assert.equal(guideGeometry(settings({ grid: -5 })).grid, 2);
  assert.equal(guideGeometry(settings({ grid: 9999 })).grid, MAX_DIVISIONS);
});

test('gd: varsayılan ayarda HİÇ kılavuz yoktur (yalnızca ızgara)', () => {
  assert.deepEqual(DEFAULT_GRID_DRAW.guides, [], 'varsayılan kılavuz listesi boş olmalı');
  const g = guideGeometry(DEFAULT_GRID_DRAW);
  assert.equal(g.circles.length, 0);
  assert.equal(g.lines.length, 0);
});

// -------------------------------------------------------- kılavuz üretimi

test('gd: merkez daireleri artboard yarıçapına oranlıdır', () => {
  const circles = centerCircles(1440, 3);
  assert.equal(circles.length, 3);

  const radii = circles.map((c) => c.r);
  assert.ok(radii[0] > radii[1] && radii[1] > radii[2], 'yarıçaplar azalan olmalı');
  assert.ok(close(radii[0], 560, 0.5), `ilk yarıçap 560 olmalı, ${radii[0]}`);
  assert.ok(close(radii[1], 426.67, 0.5), `ikinci yarıçap 426.67 olmalı, ${radii[1]}`);
  assert.ok(close(radii[2], 280, 0.5), `üçüncü yarıçap 280 olmalı, ${radii[2]}`);

  // Hepsi merkezde
  for (const circle of circles) {
    assert.equal(circle.cx, 720);
    assert.equal(circle.cy, 720);
  }

  assert.equal(centerCircles(1440, 0).length, 0);
  assert.equal(centerCircles(1440, 9).length, 3, 'en fazla 3 daire');
});

test('gd: köşe çaprazları ve merkez artısı doğru uç noktalara sahiptir', () => {
  const diagonals = cornerDiagonals(400);
  assert.equal(diagonals.length, 2);
  assert.deepEqual(
    diagonals.map((d) => [d.ax, d.ay, d.bx, d.by]),
    [
      [0, 0, 400, 400],
      [400, 0, 0, 400],
    ],
  );

  const cross = centerCrossLines(400);
  assert.equal(cross.length, 2);
  assert.deepEqual(
    cross.map((l) => [l.ax, l.ay, l.bx, l.by]),
    [
      [200, 0, 200, 400],
      [0, 200, 400, 200],
    ],
  );
});

test('gd: her kılavuzun benzersiz kimliği vardır', () => {
  const a = circleGuide(10, 10, 5);
  const b = circleGuide(10, 10, 5);
  const c = lineGuide({ x: 0, y: 0 }, { x: 1, y: 1 });
  const ids = new Set([a.id, b.id, c.id]);
  assert.equal(ids.size, 3, 'kimlikler benzersiz olmalı');
});

test('gd: normalizeSettings eski kayıtları taşır', () => {
  const migrated = normalizeSettings({
    cols: 12,
    rows: 9,
    width: 1440,
    height: 1080,
    circles: 1,
    diagonals: true,
    centerCross: true,
  });

  assert.equal(migrated.grid, 12, 'cols → grid');
  assert.equal(migrated.size, 1440, 'width → size');
  assert.equal(migrated.guides.length, 5, '1 daire + 2 çapraz + 2 merkez artısı = 5 kılavuz');
  assert.equal(migrated.guides.filter((g) => g.kind === 'circle').length, 1);
  assert.equal(migrated.guides.filter((g) => g.kind === 'line').length, 4);
});

test('gd: normalizeSettings geçersiz girdide varsayılana düşer', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_GRID_DRAW);
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_GRID_DRAW);
  const fixed = normalizeSettings({ grid: 999, size: 10, guides: [] });
  assert.equal(fixed.grid, MAX_DIVISIONS);
  assert.equal(fixed.size, 48, 'en küçük artboard 48');
});

// --------------------------------------------------------- bölge sayısı

test('gd: kılavuzsuz ızgarada bölge sayısı grid² dir', () => {
  assert.equal(plainGrid(400, 4).regions.length, 16, '4×4 = 16 göz');
  assert.equal(plainGrid(300, 5).regions.length, 25, '5×5 = 25 göz');
});

test('gd: daire/çapraz/merkez eklemek bölgeleri BÖLER', () => {
  // Tek sayıda bölme: merkez (250) hiçbir grid çizgisiyle çakışmaz, böylece
  // merkez artısı gerçekten yeni bölge üretir.
  const base = settings({ grid: 5, size: 500, guides: [] });
  const plain = buildGridDrawPlan(base);
  const one = buildGridDrawPlan({ ...base, guides: centerCircles(500, 1) });
  const three = buildGridDrawPlan({ ...base, guides: centerCircles(500, 3) });
  const withCross = buildGridDrawPlan({ ...base, guides: centerCrossLines(500) });
  const withDiagonals = buildGridDrawPlan({ ...base, guides: cornerDiagonals(500) });

  assert.ok(one.regions.length > plain.regions.length, 'daire bölmeli');
  assert.ok(three.regions.length > one.regions.length, 'daha çok daire daha çok bölge');
  assert.ok(withCross.regions.length > plain.regions.length, 'merkez artısı bölmeli');
  assert.ok(withDiagonals.regions.length > plain.regions.length, 'çapraz bölmeli');

  for (const plan of [one, three, withCross, withDiagonals]) {
    for (const region of plan.regions) {
      assert.ok(region.area >= MIN_REGION_AREA, `bölge #${region.id} çok küçük: ${region.area}`);
      assert.ok(region.loops.length >= 1);
      assert.ok(region.pathData.startsWith('M'));
      assert.ok(region.pathData.endsWith('Z'));
    }
  }
});

// -------------------------------------------------------- vuruş / regionAt

test('gd: kılavuz çizgisinin üstünde bölge yoktur', () => {
  const plan = plainGrid(400, 4);
  assert.equal(regionAt(plan, { x: 100, y: 150 }), 0, 'dikey çizgi üstünde bölge olmamalı');
  assert.equal(regionAt(plan, { x: 150, y: 100 }), 0, 'yatay çizgi üstünde bölge olmamalı');
  assert.equal(regionAt(plan, { x: 100, y: 100 }), 0, 'kavşakta bölge olmamalı');
  assert.ok(regionAt(plan, { x: 150, y: 150 }) > 0, 'hücre ortası bölge olmalı');
  assert.equal(regionAt(plan, { x: -10, y: 10 }), 0, 'artboard dışı');
  assert.equal(regionAt(plan, { x: 9999, y: 10 }), 0, 'artboard dışı');
});

test('gd: her bölge kendi temsili noktasında bulunur', () => {
  const plan = buildGridDrawPlan(settings({ grid: 6, size: 600, guides: centerCircles(600, 1) }));
  for (const region of plan.regions) {
    assert.equal(regionAt(plan, region.sample), region.id, `bölge #${region.id} temsili noktasında yok`);
  }
});

// --------------------------------------------------------------- snapping

test('gd: sade ızgarada bölge sınırı TAM grid çizgisine oturur', () => {
  const plan = plainGrid(400, 4);
  const id = cellAt(plan, 1, 1);
  const region = plan.byId[id];
  assert.ok(region, 'bölge bulunmalı');

  const bounds = loopBounds(region.loops);
  assert.ok(close(bounds.x, 100), `sol kenar 100 olmalı, ${bounds.x}`);
  assert.ok(close(bounds.y, 100), `üst kenar 100 olmalı, ${bounds.y}`);
  assert.ok(close(bounds.w, 100), `genişlik 100 olmalı, ${bounds.w}`);
  assert.ok(close(bounds.h, 100), `yükseklik 100 olmalı, ${bounds.h}`);
});

test('gd: tüm bölge köşeleri bir kılavuz üzerindedir', () => {
  const plan = buildGridDrawPlan(
    settings({
      grid: 6,
      size: 600,
      guides: [...centerCircles(600, 1), ...cornerDiagonals(600)],
    }),
  );
  const g = plan.guides;

  for (const region of plan.regions) {
    for (const loop of region.loops) {
      for (const p of loop) {
        const onV =
          Math.abs(p.x - Math.round(p.x / g.cellW) * g.cellW) <= 0.02 &&
          Math.round(p.x / g.cellW) >= 0 &&
          Math.round(p.x / g.cellW) <= g.cols;
        const onH =
          Math.abs(p.y - Math.round(p.y / g.cellH) * g.cellH) <= 0.02 &&
          Math.round(p.y / g.cellH) >= 0 &&
          Math.round(p.y / g.cellH) <= g.rows;
        const onCircle = g.circles.some((c) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) <= 0.02);
        assert.ok(
          onV || onH || onCircle || hasLine(p, g.lines),
          `nokta (${p.x}, ${p.y}) hiçbir kılavuzda değil`,
        );
      }
    }
  }
});

/** Yardımcı: nokta herhangi bir kılavuz doğrusu üzerinde mi. */
function hasLine(p: Vec2, lines: { a: Vec2; b: Vec2 }[]): boolean {
  return lines.some(({ a, b }) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) return false;
    return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len <= 0.02;
  });
}

test('gd: aykırı hücre boyutunda da snapping çalışır (7 bölme)', () => {
  // 1440 / 7 ≈ 205.71 → duvar sapması en yüksek noktada
  const plan = buildGridDrawPlan(settings({ grid: 7, size: 1440, guides: [] }));
  const g = plan.guides;

  for (const region of plan.regions) {
    const bounds = loopBounds(region.loops);
    const leftIndex = Math.round(bounds.x / g.cellW);
    assert.ok(
      Math.abs(bounds.x - leftIndex * g.cellW) <= 0.02,
      `sol kenar grid çizgisine oturmadı: ${bounds.x} (beklenen ${leftIndex * g.cellW})`,
    );
  }
});

test('gd: snap toleransı duvar sapmasını karşılar ama gereksiz büyük değildir', () => {
  assert.ok(SNAP_TOL > 1.5, 'duvar sapması en fazla 1.9 birim');
  assert.ok(SNAP_TOL < 8, 'komşu kılavuzlara yanlış oturmayacak kadar küçük olmalı');
});

// ------------------------------------------------------------------ çıktı

test('gd: temiz SVG kılavuz içermez, yalnızca dolgular vardır', () => {
  const plan = buildGridDrawPlan(settings({ grid: 4, size: 400, guides: centerCircles(400, 1) }));
  const first = plan.regions[0];
  const svg = buildGridDrawSvg(plan, new Set([first.id]), DEFAULT_GRID_DRAW_STYLE);

  assert.ok(svg.startsWith('<svg'), 'SVG kökü olmalı');
  assert.ok(svg.includes('viewBox="0 0 400 400"'), 'viewBox kare olmalı');
  assert.ok(svg.includes(`fill="${DEFAULT_GRID_DRAW_STYLE.color}"`), 'logo rengi yazılmalı');
  assert.ok(svg.includes(DEFAULT_GRID_DRAW_STYLE.background), 'zemin rengi yazılmalı');
  assert.ok(svg.includes('fill-rule="evenodd"'), 'delikler için evenodd gerekli');
  assert.ok(!svg.includes('<line'), 'kılavuz çizgisi çıktıya girmemeli');
  assert.ok(!svg.includes('<circle'), 'daire kılavuzu çıktıya girmemeli');
  assert.equal((svg.match(/<path /g) ?? []).length, 1, 'tek bölge → tek path');
});

test('gd: şeffaf zemin seçilince arka plan dikdörtgeni eklenmez', () => {
  const plan = plainGrid(300, 3);
  const svg = buildGridDrawSvg(plan, new Set([plan.regions[0].id]), {
    ...DEFAULT_GRID_DRAW_STYLE,
    transparent: true,
  });
  assert.ok(!svg.includes('<rect'), 'şeffaf modda rect olmamalı');
});

test('gd: kontur açıkken ayrı bir strok grubu eklenir', () => {
  const plan = plainGrid(300, 3);
  const svg = buildGridDrawSvg(plan, new Set([plan.regions[0].id]), {
    ...DEFAULT_GRID_DRAW_STYLE,
    outline: true,
    outlineColor: '#ff0000',
    outlineWidth: 12,
  });
  assert.ok(svg.includes('stroke="#ff0000"'));
  assert.ok(svg.includes('stroke-width="12"'));
  assert.equal((svg.match(/<path /g) ?? []).length, 2, 'dolgu + kontur');
});

test('gd: iki komşu bölge doldurulunca iki path çıkar', () => {
  const plan = plainGrid(300, 3);
  const a = cellAt(plan, 0, 0);
  const b = cellAt(plan, 1, 0);
  assert.notEqual(a, b);
  const svg = buildGridDrawSvg(plan, new Set([a, b]), DEFAULT_GRID_DRAW_STYLE);
  assert.equal((svg.match(/<path /g) ?? []).length, 2);
});

test('gd: boş dolgu kümesinde geçerli ama boş SVG üretilir', () => {
  const plan = plainGrid(300, 3);
  const svg = buildGridDrawSvg(plan, new Set(), DEFAULT_GRID_DRAW_STYLE);
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('<path'));
});

test('gd: guideRenderData kılavuz ailelerini üretir', () => {
  const data = guideRenderData(
    settings({
      grid: 4,
      size: 400,
      guides: [...centerCircles(400, 2), ...cornerDiagonals(400)],
    }),
  );

  assert.equal(data.size, 400);
  assert.equal(data.grid, 4);
  assert.equal(data.cell, 100);
  // (4+1) dikey + (4+1) yatay çizgi
  assert.equal((data.gridPath.match(/M /g) ?? []).length, 10);
  assert.equal(data.circles.length, 2);
  assert.equal(data.lines.length, 2);
  assert.ok(close(data.circles[0].cx, 200) && close(data.circles[0].cy, 200));
});

// ------------------------------------------------------- dolgu yeniden eşleme

test('gd: yapı değişmeyince structureChanged false döner', () => {
  const a = settings({ grid: 6, size: 600, guides: centerCircles(600, 1) });
  assert.equal(structureChanged(a, { ...a }), false);
  assert.equal(structureChanged(a, { ...a, grid: 7 }), true);
  assert.equal(structureChanged(a, { ...a, size: 800 }), true);
  assert.equal(structureChanged(a, { ...a, guides: [...a.guides, circleGuide(300, 300, 100)] }), true);
  assert.equal(structureChanged(a, { ...a, guides: [] }), true);
  // Aynı geometri, farklı kimlik → yapı değişmiş sayılır (plan yeniden kurulur).
  const same = { ...a, guides: [circleGuide(300, 300, a.guides[0].kind === 'circle' ? a.guides[0].r : 0)] };
  assert.equal(structureChanged(a, same), true);
});

test('gd: bölme sayısı artınca dolgular kaybolmaz, yeni bölgelere taşınır', () => {
  const before = plainGrid(400, 4);
  const filled = new Set<number>([cellAt(before, 0, 0), cellAt(before, 1, 0)]);

  const after = plainGrid(400, 8);
  const remapped = remapFills(filled, before, after);

  assert.equal(remapped.size, 2, 'iki dolgu da taşınmalı');
  for (const id of remapped) assert.ok(after.byId[id], `#${id} yeni planda geçerli olmalı`);
});

test('gd: daire eklenince dolgu geçerli kalır', () => {
  const before = plainGrid(600, 6);
  const probe: Vec2 = { x: 350, y: 250 };
  const id = regionAt(before, probe);
  assert.ok(id > 0, 'probe bir bölgede olmalı');

  const after = buildGridDrawPlan(settings({ grid: 6, size: 600, guides: centerCircles(600, 1) }));
  const remapped = remapFills(new Set([id]), before, after);

  assert.equal(remapped.size, 1, 'dolgu korunmalı');
  for (const newId of remapped) assert.ok(after.byId[newId]);
});

// ------------------------------------------------------------ performans

test('gd: varsayılan ayarlarda plan makul sürede üretilir', () => {
  const started = Date.now();
  const plan = buildGridDrawPlan(DEFAULT_GRID_DRAW);
  const elapsed = Date.now() - started;

  assert.equal(DEFAULT_GRID_DRAW.grid, 24, 'varsayılan bölme 24 olmalı');
  assert.equal(plan.regions.length, 576, `varsayılan 24×24 = 576 göz, bulunan ${plan.regions.length}`);
  assert.ok(elapsed < 4000, `plan üretimi çok yavaş: ${elapsed}ms`);
});

// ------------------------------------------------- kılavuz yakalama / taşıma

test('gd: fırça izi (strokeRegions) ara hücreleri ATLAMAZ', () => {
  const plan = plainGrid(400, 4);

  const row = strokeRegions(plan, { x: 50, y: 50 }, { x: 350, y: 50 });
  assert.equal(row.length, 4, `yatay iz 4 hücreyi süpürmeli, bulunan ${row.length}`);

  const column = strokeRegions(plan, { x: 50, y: 50 }, { x: 50, y: 350 });
  assert.equal(column.length, 4, `dikey iz 4 hücreyi süpürmeli, bulunan ${column.length}`);

  // Tam ızgara kavşağından geçen 45° iz: kaydırma olmasa hiçbir hücreye denk gelmezdi.
  const diagonal = strokeRegions(plan, { x: 0, y: 0 }, { x: 400, y: 400 });
  assert.ok(diagonal.length >= 4, `çapraz iz en az 4 hücre bulmalı, bulunan ${diagonal.length}`);
  assert.ok(diagonal.includes(cellAt(plan, 0, 0)), 'çapraz iz sol üst hücreden başlamalı');

  for (const id of [...row, ...column, ...diagonal]) {
    assert.ok(plan.byId[id], `#${id} geçerli bölge olmalı`);
  }

  assert.deepEqual(
    strokeRegions(plan, { x: 50, y: 50 }, { x: 50, y: 50 }),
    [cellAt(plan, 0, 0)],
    'tek nokta tek hücre süpürür',
  );
});

test('gd: guideNear çizgiyi ve daireyi tolerans içinde yakalar', () => {
  const circle = circleGuide(200, 200, 100);
  const line = lineGuide({ x: 0, y: 400 }, { x: 400, y: 400 });
  const guideList = [circle, line];

  assert.equal(guideNear(guideList, { x: 300, y: 200 }, 20)?.id, circle.id, 'çemberin sağı yakalanmalı');
  assert.equal(guideNear(guideList, { x: 200, y: 300 }, 20)?.id, circle.id, 'çemberin altı yakalanmalı');
  assert.equal(guideNear(guideList, { x: 150, y: 410 }, 20)?.id, line.id, 'çizginin üstü yakalanmalı');
  assert.equal(guideNear(guideList, { x: 200, y: 200 }, 20), null, 'dairenin merkezi yakalanmamalı');
  assert.equal(guideNear(guideList, { x: 200, y: 250 }, 20), null, 'çemberden uzak nokta yakalanmamalı');
  assert.equal(guideNear([], { x: 0, y: 0 }, 20), null, 'boş liste null döner');

  // Tolerans büyüyünce yakalanır.
  assert.equal(guideNear([line], { x: 200, y: 430 }, 20), null);
  assert.equal(guideNear([line], { x: 200, y: 430 }, 40)?.id, line.id);
});

test('gd: regionsInDisc dairenin içini ve dışını TAM ayırır', () => {
  const plan = buildGridDrawPlan(settings({ grid: 8, size: 800, guides: [] }));
  const circle = { cx: 400, cy: 400, r: 300 };

  const inside = new Set(regionsInDisc(plan, circle.cx, circle.cy, circle.r, 'in'));
  const outside = new Set(regionsInDisc(plan, circle.cx, circle.cy, circle.r, 'out'));

  assert.ok(inside.size > 0 && outside.size > 0, 'her iki küme de dolu olmalı');
  for (const region of plan.regions) {
    assert.ok(
      inside.has(region.id) !== outside.has(region.id),
      `bölge #${region.id} her iki kümede ya da hiçbirinde`,
    );
  }

  for (const region of plan.regions) {
    const distance = Math.hypot(region.sample.x - circle.cx, region.sample.y - circle.cy);
    assert.equal(
      distance <= circle.r,
      inside.has(region.id),
      `bölge #${region.id} (mesafe ${distance.toFixed(1)}) yanlış sınıflandı`,
    );
  }
});

test('gd: daire içi bölgelerin toplam alanı disk alanına yakındır', () => {
  const plan = buildGridDrawPlan(settings({ grid: 8, size: 800, guides: [] }));
  const ids = regionsInDisc(plan, 400, 400, 300, 'in');
  const total = ids.reduce((sum, id) => sum + (plan.byId[id]?.area ?? 0), 0);
  const disc = Math.PI * 300 * 300;

  // Sınırdaki hücreler yarım kalabilir; sapma çevre × hücre mertebesindedir.
  const tolerance = 2 * Math.PI * 300 * (800 / 8);
  assert.ok(Math.abs(total - disc) < tolerance, `iç alan ${total}, disk ${Math.round(disc)}`);
});

test('gd: regionsOnSide çizginin iki yanını kesişimsiz böler', () => {
  // Gerçek kullanım: çizgi bir kılavuzdur, yani duvardır — hiçbir bölge onu
  // ortadan kesmez, dolayısıyla her bölge tam olarak bir yanda kalır.
  const a: Vec2 = { x: 0, y: 0 };
  const b: Vec2 = { x: 600, y: 600 };
  const plan = buildGridDrawPlan(settings({ grid: 6, size: 600, guides: [lineGuide(a, b)] }));

  const positive = new Set(regionsOnSide(plan, a, b, 1));
  const negative = new Set(regionsOnSide(plan, a, b, -1));

  assert.ok(positive.size > 0 && negative.size > 0);
  assert.equal(positive.size + negative.size, plan.regions.length, 'iki yan tüm bölgeleri kapsamalı');

  for (const region of plan.regions) {
    assert.ok(positive.has(region.id) !== negative.has(region.id), `bölge #${region.id} tek yanda olmalı`);
    const cross = (b.x - a.x) * (region.sample.y - a.y) - (b.y - a.y) * (region.sample.x - a.x);
    assert.equal(Math.sign(cross) === 1, positive.has(region.id), `bölge #${region.id} yanı yanlış`);
  }
});

test('gd: çok kılavuzlu ağda da plan üretilebilir', () => {
  const plan = buildGridDrawPlan(
    settings({
      grid: 12,
      size: 1440,
      guides: [
        ...centerCircles(1440, 3),
        ...cornerDiagonals(1440),
        circleGuide(400, 400, 180),
        lineGuide({ x: 0, y: 700 }, { x: 1440, y: 900 }),
      ],
    }),
  );
  assert.ok(plan.regions.length > 200, `yeterli bölge üretilmeli, ${plan.regions.length}`);
  assert.equal(plan.guides.circles.length, 4);
  assert.equal(plan.guides.lines.length, 3);
});

test('gd: artboard dışına taşan bölge yoktur', () => {
  const plan = buildGridDrawPlan(settings({ grid: 5, size: 500, guides: centerCircles(500, 1) }));
  for (const region of plan.regions) {
    const bounds = loopBounds(region.loops);
    assert.ok(bounds.x >= -0.02 && bounds.y >= -0.02, `bölge #${region.id} dışarı taştı`);
    assert.ok(
      bounds.x + bounds.w <= plan.width + 0.02 && bounds.y + bounds.h <= plan.height + 0.02,
      `bölge #${region.id} dışarı taştı`,
    );
  }
});
