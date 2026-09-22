/**
 * Grid Draw — ÇIKTI KALİTESİ testleri.
 *
 * Hedef: **temiz, düzgün, kusursuz logo çıktısı**. Bu dosya bunu ölçülebilir
 * hale getirir:
 *
 *   1. Komşu gözler birleşince paylaşılan kenar tamamen kaybolur ve geometri
 *      TAM düzgün çokgen çıkar (fazladan/merdiven noktası yok).
 *   2. Birleşik silüetin TÜM köşeleri gerçek kılavuz üzerindedir.
 *   3. Delikler ve yaylar korunur.
 *   4. Birleşik SVG tek path'tir; kılavuz içermez.
 *   5. Aynalama doğru bölgeyi eşler.
 *   6. Tasarım kaydedilip geri yüklenebilir (eski kayıtlar taşınır).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRID_DRAW,
  GRID_PRESETS,
  MIRROR_LABELS,
  buildGridDrawPlan,
  centerCircles,
  centerCrossLines,
  circleGuide,
  concentricFan,
  cornerDiagonals,
  guideGeometry,
  lineGuide,
  mergeFilledRegions,
  mirrorRegions,
  mirrorSample,
  regionAt,
  regionsInDisc,
  signedLoopArea,
  type GridDrawPlan,
  type GridDrawSettings,
  type GridDrawGuides,
  type GuideCircle,
  type MirrorMode,
} from '../src/griddraw/regions.ts';
import { DEFAULT_GRID_DRAW_STYLE, buildGridDrawSvg } from '../src/griddraw/gridDrawSvg.ts';
import {
  GRID_DRAW_LEGACY_KEYS,
  GRID_DRAW_STORAGE_KEY,
  clearGridDraw,
  loadGridDraw,
  saveGridDraw,
} from '../src/griddraw/gridDrawStorage.ts';
import type { Vec2 } from '../src/core/types.ts';

const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

function settings(patch: Partial<GridDrawSettings> = {}): GridDrawSettings {
  return { ...DEFAULT_GRID_DRAW, ...patch };
}

/** Sade kare ızgara: yalnızca grid çizgileri. */
function plainGrid(size = 400, grid = 4): GridDrawPlan {
  return buildGridDrawPlan(settings({ grid, size, guides: [] }));
}

/** Verilen hücrelerin bölge kimlikleri (hücre merkezinden). */
function cellIds(plan: GridDrawPlan, cells: [number, number][]): number[] {
  return cells.map(([col, row]) => {
    const cell = plan.guides.cell;
    const id = regionAt(plan, { x: (col + 0.5) * cell, y: (row + 0.5) * cell });
    assert.ok(id > 0, `hücre (${col},${row}) bölgesi bulunamadı`);
    return id;
  });
}

function boundsOf(loops: Vec2[][]) {
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

// ------------------------------------------------- birleştirme: temiz geometri

test('gd: tek göz birleşince TAM dörtgen çıkar (4 nokta)', () => {
  const plan = plainGrid();
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[1, 1]])));
  assert.ok(merged, 'birleşik silüet üretilmeli');

  assert.equal(merged.loops.length, 1, 'tek göz → tek halka');
  assert.equal(merged.loops[0].length, 4, `tam dörtgen olmalı, ${merged.loops[0].length} nokta bulundu`);

  const b = boundsOf(merged.loops);
  assert.ok(close(b.x, 100) && close(b.y, 100) && close(b.w, 100) && close(b.h, 100), `sınır: ${JSON.stringify(b)}`);
});

test('gd: komşu iki göz birleşince ARADAKİ KENAR kaybolur (boşluk yok)', () => {
  const plan = plainGrid();
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[1, 1], [2, 1]])));
  assert.ok(merged);

  assert.equal(merged.loops.length, 1, 'iki komşu göz tek halka olmalı');
  assert.equal(
    merged.loops[0].length,
    4,
    `paylaşılan kenar tamamen kaybolmalı ve dörtgen kalmalı, ${merged.loops[0].length} nokta bulundu`,
  );
  assert.ok(close(Math.abs(signedLoopArea(merged.loops)), 20000, 1), 'alan iki hücrenin toplamı olmalı');

  const b = boundsOf(merged.loops);
  assert.ok(close(b.x, 100) && close(b.w, 200), `sınır 100..300 olmalı: ${JSON.stringify(b)}`);
});

test('gd: üç gözden L şekli birleşince 6 köşeli tek çokgen olur', () => {
  const plan = plainGrid();
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[0, 0], [1, 0], [0, 1]])));
  assert.ok(merged);

  assert.equal(merged.loops.length, 1);
  assert.equal(merged.loops[0].length, 6, `L şekli 6 köşe olmalı, ${merged.loops[0].length} bulundu`);
  assert.ok(close(Math.abs(signedLoopArea(merged.loops)), 30000, 1));
});

test('gd: 2×2 blok birleşince tek dörtgen olur', () => {
  const plan = plainGrid();
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[0, 0], [1, 0], [0, 1], [1, 1]])));
  assert.ok(merged);

  assert.equal(merged.loops.length, 1);
  assert.equal(merged.loops[0].length, 4, `2×2 blok 4 köşe olmalı, ${merged.loops[0].length} bulundu`);
  assert.ok(close(Math.abs(signedLoopArea(merged.loops)), 40000, 1));
});

test('gd: birleşik silüette DELİK korunur ve delik de tam dörtgendir', () => {
  const plan = plainGrid(400, 4);
  const ring: [number, number][] = [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
  ];
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, ring)));
  assert.ok(merged);

  assert.equal(merged.loops.length, 2, `dış hat + delik = 2 halka, ${merged.loops.length} bulundu`);

  const areas = merged.loops.map((loop) => Math.abs(signedLoopArea([loop])));
  const outer = Math.max(...areas);
  const hole = Math.min(...areas);

  assert.ok(close(outer, 90000, 1), `dış alan 90000 olmalı, bulunan ${outer}`);
  assert.ok(close(hole, 10000, 1), `delik alanı 10000 olmalı, bulunan ${hole}`);

  const holeLoop = merged.loops.find((loop) => close(Math.abs(signedLoopArea([loop])), 10000, 1));
  assert.ok(holeLoop && holeLoop.length === 4, 'delik tam dörtgen olmalı');

  const hb = boundsOf([holeLoop]);
  assert.ok(close(hb.x, 100) && close(hb.y, 100) && close(hb.w, 100) && close(hb.h, 100), `delik sınırı: ${JSON.stringify(hb)}`);
});

test('gd: bitişik OLMAYAN dolgular ayrı parça kalır', () => {
  const plan = plainGrid();
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[0, 0], [3, 3]])));
  assert.ok(merged);

  assert.equal(merged.parts, 2, 'iki ayrı ada iki parça olmalı');
  assert.equal(merged.loops.length, 2);
});

test('gd: birleşik silüet gereksiz nokta taşımaz (düz kenar iki nokta)', () => {
  const plan = plainGrid(600, 6);
  const merged = mergeFilledRegions(plan, new Set(cellIds(plan, [[1, 2], [2, 2], [3, 2], [4, 2]])));
  assert.ok(merged);

  assert.equal(merged.loops.length, 1);
  assert.equal(merged.loops[0].length, 4, `şerit 4 köşe olmalı, ${merged.loops[0].length} bulundu`);
  assert.ok(close(Math.abs(signedLoopArea(merged.loops)), 40000, 1));
});

// ------------------------------------------------------ birleşik SVG çıktısı

test('gd: birleştirme açıkken SVG TEK path içerir ve kılavuz içermez', () => {
  const plan = plainGrid();
  const fills = new Set(cellIds(plan, [[1, 1], [2, 1], [1, 2]]));
  const merged = mergeFilledRegions(plan, fills);

  const svg = buildGridDrawSvg(plan, fills, { ...DEFAULT_GRID_DRAW_STYLE, merge: true }, merged);

  assert.equal((svg.match(/<path /g) ?? []).length, 1, 'birleşik silüet tek path olmalı');
  assert.ok(!svg.includes('<line'), 'kılavuz çizgisi olmamalı');
  assert.ok(!svg.includes('<circle'), 'daire kılavuzu olmamalı');
  assert.ok(!svg.includes('stroke-linejoin="round"'), 'birleşikte dikiş konturu eklenmemeli');
});

test('gd: birleştirme kapalıyken her göz ayrı path olur', () => {
  const plan = plainGrid();
  const fills = new Set(cellIds(plan, [[1, 1], [2, 1], [1, 2]]));
  const merged = mergeFilledRegions(plan, fills);

  const svg = buildGridDrawSvg(plan, fills, { ...DEFAULT_GRID_DRAW_STYLE, merge: false }, merged);

  assert.equal((svg.match(/<path /g) ?? []).length, 3, 'göz başına bir path');
  assert.ok(svg.includes('stroke-linejoin="round"'), 'dikiş düzeltmesi uygulanmalı');
});

test('gd: birleşik silüette kontur yalnızca dış hattı çizer', () => {
  const plan = plainGrid();
  const fills = new Set(cellIds(plan, [[1, 1], [2, 1]]));
  const merged = mergeFilledRegions(plan, fills);

  const svg = buildGridDrawSvg(
    plan,
    fills,
    { ...DEFAULT_GRID_DRAW_STYLE, merge: true, outline: true, outlineWidth: 10 },
    merged,
  );

  assert.equal((svg.match(/<path /g) ?? []).length, 2);
  assert.ok(svg.includes('stroke-width="10"'));
});

test('gd: boş dolguda birleşik silüet üretilmez', () => {
  const plan = plainGrid();
  assert.equal(mergeFilledRegions(plan, new Set()), null);
});

// ------------------------------------------------------------------ aynalama

test('gd: mirrorSample artboard merkezine göre aynalar', () => {
  // Genişlik 100 → merkez 50. Örnek 10, [10,11] aralığını kaplar, merkezi 10.5.
  // Aynası 100 − 10 − 1 = 89 → [89,90], merkezi 89.5. 50'ye uzaklıklar eşit.
  assert.deepEqual(mirrorSample({ x: 10, y: 20 }, 100, 200, 'x'), [{ x: 89, y: 20 }]);
  assert.deepEqual(mirrorSample({ x: 10, y: 20 }, 100, 200, 'y'), [{ x: 10, y: 179 }]);
  assert.deepEqual(mirrorSample({ x: 10, y: 20 }, 100, 200, 'quad'), [
    { x: 89, y: 20 },
    { x: 10, y: 179 },
    { x: 89, y: 179 },
  ]);
  assert.deepEqual(mirrorSample({ x: 10, y: 20 }, 100, 200, 'none'), []);
});

test('gd: aynalama simetrik bölgeyi bulur', () => {
  const plan = plainGrid(400, 4);
  const [left] = cellIds(plan, [[0, 0]]);
  const [right] = cellIds(plan, [[3, 0]]);

  const mirrored = mirrorRegions(plan, [left], 'x');
  assert.equal(mirrored.size, 1);
  assert.ok(mirrored.has(right), `sol üst gözün aynası sağ üst göz olmalı (${[...mirrored]} vs ${right})`);
});

test('gd: 4 yönlü aynalama üç karşılık üretir', () => {
  const plan = plainGrid(400, 4);
  const [topLeft] = cellIds(plan, [[0, 0]]);
  const mirrored = mirrorRegions(plan, [topLeft], 'quad');

  assert.equal(mirrored.size, 3, '4 yönlü aynada 3 karşılık olmalı');
  assert.equal(new Set([topLeft, ...mirrored]).size, 4, 'dört farklı göz');
});

test('gd: aynalama kapalıyken boş küme döner', () => {
  const plan = plainGrid();
  const [id] = cellIds(plan, [[1, 1]]);
  assert.equal(mirrorRegions(plan, [id], 'none').size, 0);
});

test('gd: her aynalama modunun etiketi vardır', () => {
  for (const mode of ['none', 'x', 'y', 'quad'] as MirrorMode[]) {
    assert.ok(MIRROR_LABELS[mode].length > 0, `${mode} etiketi boş`);
  }
  const plan = buildGridDrawPlan(settings({ grid: 8, size: 800, guides: centerCircles(800, 1) }));
  const id = regionAt(plan, { x: 150, y: 450 });
  assert.ok(id > 0, 'probe bir bölgede olmalı');
  assert.ok(mirrorRegions(plan, [id], 'x').size >= 1, 'simetrik ağda karşılık bulunmalı');
});

// ------------------------------------------------------------------ kayıt

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const sampleSettings = settings({ grid: 12, size: 1440, guides: centerCircles(1440, 1) });

test('gd: tasarım kaydedilip geri yüklenir', () => {
  const store = new MemoryStorage();
  const payload = {
    version: 2 as const,
    settings: sampleSettings,
    style: { ...DEFAULT_GRID_DRAW_STYLE, color: '#ff0000', merge: false },
    mirror: 'quad' as MirrorMode,
    fills: [3, 7, 11],
  };

  assert.ok(saveGridDraw(payload, store));
  assert.ok(store.getItem(GRID_DRAW_STORAGE_KEY));

  const restored = loadGridDraw(store);
  assert.ok(restored, 'kayıt okunmalı');
  assert.deepEqual(restored.fills, [3, 7, 11]);
  assert.equal(restored.settings.grid, 12);
  assert.equal(restored.settings.guides.length, 1);
  assert.equal(restored.style.color, '#ff0000');
  assert.equal(restored.style.merge, false);
  assert.equal(restored.mirror, 'quad');
});

test('gd: ESKİ biçim kayıt (cols/rows/daireler) taşınır', () => {
  const store = new MemoryStorage();
  store.setItem(
    GRID_DRAW_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      settings: { cols: 16, rows: 12, width: 1200, height: 900, circles: 2, diagonals: true, centerCross: false },
      style: DEFAULT_GRID_DRAW_STYLE,
      mirror: 'x',
      fills: [5],
    }),
  );

  const restored = loadGridDraw(store);
  assert.ok(restored, 'eski kayıt okunabilmeli');
  assert.equal(restored.settings.grid, 16, 'cols → grid');
  assert.equal(restored.settings.size, 1200, 'width → size');
  assert.equal(restored.settings.guides.filter((g) => g.kind === 'circle').length, 2, '2 daire taşınmalı');
  assert.equal(restored.settings.guides.filter((g) => g.kind === 'line').length, 2, '2 çapraz taşınmalı');
  assert.deepEqual(restored.fills, [5]);
});

test('gd: bozuk kayıt çökmeden yok sayılır', () => {
  const store = new MemoryStorage();
  store.setItem(GRID_DRAW_STORAGE_KEY, '{bozuk json');
  assert.equal(loadGridDraw(store), null);

  store.setItem(GRID_DRAW_STORAGE_KEY, JSON.stringify({ fills: [1, 2] }));
  assert.equal(loadGridDraw(store), null, 'settings/style yoksa kayıt geçersiz');

  store.setItem(GRID_DRAW_STORAGE_KEY, JSON.stringify({ settings: {}, style: {}, fills: ['a', -1, 2.5, 4] }));
  const restored = loadGridDraw(store);
  assert.ok(restored);
  assert.deepEqual(restored.fills, [4], 'geçersiz kimlikler atılmalı');
  assert.equal(restored.settings.grid, DEFAULT_GRID_DRAW.grid, 'boş settings varsayılana düşmeli');
});

test('gd: temizle kaydı siler', () => {
  const store = new MemoryStorage();
  saveGridDraw({ version: 2, settings: sampleSettings, style: DEFAULT_GRID_DRAW_STYLE, mirror: 'none', fills: [1] }, store);
  clearGridDraw(store);
  assert.equal(loadGridDraw(store), null);
});

test('gd: eski depo anahtarı okuma sırasında temizlenir', () => {
  const store = new MemoryStorage();
  store.setItem(GRID_DRAW_LEGACY_KEYS[0], '{"version":1,"settings":{"cols":18}}');
  saveGridDraw(
    { version: 2, settings: sampleSettings, style: DEFAULT_GRID_DRAW_STYLE, mirror: 'none', fills: [2] },
    store,
  );

  const restored = loadGridDraw(store);
  assert.ok(restored, 'yeni anahtardan okunmalı');
  assert.deepEqual(restored.fills, [2]);
  assert.equal(store.getItem(GRID_DRAW_LEGACY_KEYS[0]), null, 'eski anahtar silinmeli');
});

test('gd: depo yoksa kayıt sessizce başarısız olur', () => {
  assert.equal(
    saveGridDraw({ version: 2, settings: sampleSettings, style: DEFAULT_GRID_DRAW_STYLE, mirror: 'none', fills: [] }, null),
    false,
  );
  assert.equal(loadGridDraw(null), null);
  clearGridDraw(null);
});

// -------------------------------------------------- KUSURSUZ ÇIKTI KURALLARI

/** Bir noktanın üzerinde bulunduğu kılavuzların kimlikleri. */
function guidesAt(p: Vec2, g: GridDrawGuides, tol = 0.05): string[] {
  const out: string[] = [];

  const iv = Math.round(p.x / g.cellW);
  if (iv >= 0 && iv <= g.cols && Math.abs(p.x - iv * g.cellW) <= tol) out.push(`v${iv}`);

  const jh = Math.round(p.y / g.cellH);
  if (jh >= 0 && jh <= g.rows && Math.abs(p.y - jh * g.cellH) <= tol) out.push(`h${jh}`);

  for (const circle of g.circles) {
    if (Math.abs(Math.hypot(p.x - circle.cx, p.y - circle.cy) - circle.r) <= tol) out.push(`c${circle.index}`);
  }

  for (const line of g.lines) {
    const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    if (len < 1e-9) continue;
    const distance = Math.abs((line.b.x - line.a.x) * (p.y - line.a.y) - (line.b.y - line.a.y) * (p.x - line.a.x)) / len;
    if (distance <= tol) out.push(`l${line.index}`);
  }

  return out;
}

/**
 * Bir silüetin "kusursuz geometri" kurallarına uyduğunu doğrular:
 *   1. Her köşe bir kılavuz üzerinde.
 *   2. Ardışık iki köşe ORTAK bir kılavuz paylaşır (kenar bir duvar boyunca
 *      ilerler; paylaşmıyorlarsa köşe düşmüş demektir).
 *   3. Gereksiz (tam doğrusal) ara nokta yok.
 *   4. Kısa "köpek bacağı" artefaktı yok.
 */
function assertFlawlessLoops(loops: Vec2[][], g: GridDrawGuides, label: string): void {
  for (const loop of loops) {
    assert.ok(loop.length >= 3, `${label}: halka en az 3 nokta olmalı`);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i - 1 + loop.length) % loop.length];
      const p = loop[i];
      const c = loop[(i + 1) % loop.length];
      const where = `${label} (${p.x},${p.y})`;

      assert.ok(guidesAt(p, g).length > 0, `${where}: hiçbir kılavuzda değil`);

      const base = Math.hypot(c.x - a.x, c.y - a.y);
      if (base > 1e-9) {
        const off = Math.abs((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x)) / base;
        assert.ok(off > 0.015, `${where}: gereksiz ara nokta (sapma ${off.toFixed(3)})`);
      }

      const ux = p.x - a.x;
      const uy = p.y - a.y;
      const vx = c.x - p.x;
      const vy = c.y - p.y;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      assert.ok(lu > 1e-6 && lv > 1e-6, `${where}: sıfır uzunlukta kenar`);
      if (lu < 5 && lv < 5) {
        const cos = (ux * vx + uy * vy) / (lu * lv);
        assert.ok(cos >= 0.5, `${where}: köpek bacağı (cos ${cos.toFixed(2)})`);
      }
    }

    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const c = loop[(i + 1) % loop.length];
      const shared = guidesAt(p, g).some((x) => guidesAt(c, g).includes(x));
      assert.ok(shared, `${label}: (${p.x},${p.y}) → (${c.x},${c.y}) ortak kılavuz paylaşmıyor`);
    }
  }
}

test('gd: düz ızgarada birleşik silüet kusursuz geometri kurallarına uyar', () => {
  const plan = plainGrid(400, 4);
  const merged = mergeFilledRegions(
    plan,
    new Set(cellIds(plan, [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [0, 1], [1, 2]])),
  );
  assert.ok(merged);
  assertFlawlessLoops(merged.loops, plan.guides, 'düz ızgara');
});

test('gd: ızgara + daire + çapraz ağında birleşik silüet kusursuzdur', () => {
  const plan = buildGridDrawPlan(
    settings({
      grid: 12,
      size: 1440,
      guides: [...centerCircles(1440, 1), ...cornerDiagonals(1440)],
    }),
  );
  const g = plan.guides;

  const ids = new Set<number>();
  for (let i = 4; i <= 8; i++) {
    for (let j = 3; j <= 6; j++) {
      const id = regionAt(plan, { x: (i + 0.5) * g.cell, y: (j + 0.5) * g.cell });
      if (id > 0) ids.add(id);
    }
  }
  assert.ok(ids.size >= 10, `test bloğu yeterli bölge içermeli, ${ids.size} bulundu`);

  const merged = mergeFilledRegions(plan, ids);
  assert.ok(merged);
  assertFlawlessLoops(merged.loops, g, 'tam kılavuz ağı');
});

test('gd: KULLANICININ çizdiği serbest daire/çizgide de silüet kusursuzdur', () => {
  const plan = buildGridDrawPlan(
    settings({
      grid: 10,
      size: 1000,
      guides: [
        circleGuide(400, 420, 260),
        circleGuide(640, 560, 180),
        lineGuide({ x: 100, y: 900 }, { x: 900, y: 100 }),
      ],
    }),
  );
  const g = plan.guides;
  assert.equal(g.circles.length, 2);
  assert.equal(g.lines.length, 1);

  const ids = new Set<number>();
  for (let i = 1; i < 9; i++) {
    for (let j = 1; j < 9; j++) {
      const id = regionAt(plan, { x: (i + 0.5) * g.cell, y: (j + 0.5) * g.cell });
      if (id > 0) ids.add(id);
    }
  }
  assert.ok(ids.size >= 20, `yeterli bölge yok: ${ids.size}`);

  const merged = mergeFilledRegions(plan, ids);
  assert.ok(merged);
  assertFlawlessLoops(merged.loops, g, 'serbest kılavuzlar');
});

test('gd: eğrisel (daire) sınırlı birleşik silüet de kusursuzdur', () => {
  const plan = buildGridDrawPlan(settings({ grid: 8, size: 800, guides: centerCircles(800, 1) }));
  const g = plan.guides;
  const r = g.circles[0].r;

  // Dairenin İÇİNDE kalan BÖLGELERİ doldur: bir hücreyi daire ikiye
  // bölüyorsa yalnızca içerideki parça seçilir, dolayısıyla birleşik
  // silüetin dış sınırı daireyi takip eder (yay).
  const ids = new Set<number>();
  for (const region of plan.regions) {
    const x = region.sample.x + 0.5;
    const y = region.sample.y + 0.5;
    if (Math.hypot(x - g.cx, y - g.cy) <= r - 3) ids.add(region.id);
  }
  assert.ok(ids.size >= 6, `eğrisel test için yeterli bölge yok: ${ids.size}`);

  const merged = mergeFilledRegions(plan, ids);
  assert.ok(merged);

  const curved = merged.loops.some(
    (loop) => loop.filter((p) => Math.abs(Math.hypot(p.x - g.cx, p.y - g.cy) - r) <= 0.05).length >= 6,
  );
  assert.ok(curved, 'birleşik silüette daire yayı bulunmalı');

  assertFlawlessLoops(merged.loops, g, 'eğrisel silüet');
});

test('gd: tekil bölgeler de kusursuz geometri kurallarına uyar', () => {
  const plan = buildGridDrawPlan(
    settings({ grid: 12, size: 1440, guides: [...centerCircles(1440, 2), ...cornerDiagonals(1440)] }),
  );
  assert.ok(plan.regions.length > 50);

  const step = Math.max(1, Math.floor(plan.regions.length / 40));
  let checked = 0;
  for (let i = 0; i < plan.regions.length; i += step) {
    assertFlawlessLoops(plan.regions[i].loops, plan.guides, `bölge #${plan.regions[i].id}`);
    checked++;
  }
  assert.ok(checked >= 20, `yeterli bölge denetlenmeli, ${checked}`);
});

test('gd: ızgara çizgisi boyunca komşu iki göz birleşince iç çatlak kalmaz', () => {
  const size = 1440;
  const plan = buildGridDrawPlan(settings({ grid: 14, size, guides: [] }));
  const cell = plan.guides.cell;

  // Yan yana iki göz: aralarında yalnızca ızgara duvarı var. Birleşince
  // 1×2 hücrelik DOLU bir dikdörtgen çıkmalı; ızgara duvarından arta kalan
  // saç teli bir çatlak delik olarak kalmamalı (eskiden 2 halka çıkıyordu).
  const left = regionAt(plan, { x: cell * 3.5, y: cell * 3.5 });
  const right = regionAt(plan, { x: cell * 4.5, y: cell * 3.5 });
  assert.ok(left > 0 && right > 0, 'yan yana iki göz bulunmalı');
  assert.notEqual(left, right);

  const single = mergeFilledRegions(plan, new Set([left]));
  assert.equal(single?.loops.length, 1, 'tek göz tek halka olmalı');

  const merged = mergeFilledRegions(plan, new Set([left, right]));
  assert.ok(merged);
  assert.equal(
    merged.loops.length,
    1,
    'ızgara duvarından arta kalan saç teli çatlak, delik olarak kalmamalı',
  );
});

test('gd: birleştirme, boyanmamış GERÇEK gözleri delik olarak korur', () => {
  // Dayanıklılık: kama yutma adımı yalnızca duvardan oluşan boşlukları
  // yutmalı; gerçek bir gözü asla doldurmamalı. Halka doldurup içini
  // boyamayınca ortada gerçek bir DELİK kalmalı.
  const plan = buildGridDrawPlan(
    settings({ grid: 12, size: 1440, guides: [circleGuide(720, 720, 600), circleGuide(720, 720, 300)] }),
  );
  const outer = regionsInDisc(plan, 720, 720, 600, 'in');
  const inner = new Set(regionsInDisc(plan, 720, 720, 300, 'in'));
  const ring = new Set(outer.filter((id) => !inner.has(id)));
  assert.ok(ring.size >= 10, `halkada yeterli göz yok: ${ring.size}`);

  const merged = mergeFilledRegions(plan, ring);
  assert.ok(merged);
  assert.equal(merged.loops.length, 2, 'halka: dış sınır + gerçek iç delik');
});

test('gd: hazır gridler yalnızca ızgara + kılavuz tanımlar, dolgu içermez', () => {
  assert.ok(GRID_PRESETS.length >= 3, 'birkaç hazır grid olmalı');
  for (const preset of GRID_PRESETS) {
    const next = preset.build(1440);
    assert.deepEqual(Object.keys(next).sort(), ['grid', 'guides'], `${preset.id}: yalnızca grid+guides`);
    assert.ok(preset.label.length > 0 && preset.hint.length > 0, `${preset.id}: etiket ve açıklama`);
    const plan = buildGridDrawPlan(settings({ grid: next.grid, size: 1440, guides: next.guides }));
    assert.ok(plan.regions.length >= 8, `${preset.id}: yeterli bölge yok (${plan.regions.length})`);
  }
});

test('gd: "Sekiz daire" hazır gridi logonun konstrüksiyonudur', () => {
  const preset = GRID_PRESETS.find((p) => p.id === 'sekiz-daire');
  assert.ok(preset, 'sekiz-daire şablonu bulunmalı');

  const size = 1440;
  const next = preset!.build(size);
  const cell = size / 14;
  assert.equal(next.grid, 14);
  assert.equal(next.guides.length, 8);

  const circles = next.guides.filter((g): g is GuideCircle => g.kind === 'circle');
  assert.equal(circles.length, 8);

  // Merkezler artboard merkezinden (±2, 0) hücre
  const centers = [...new Set(circles.map((c) => Math.round(c.cx)))].sort((a, b) => a - b);
  assert.deepEqual(centers, [Math.round(size / 2 - 2 * cell), Math.round(size / 2 + 2 * cell)]);
  for (const c of circles) assert.equal(Math.round(c.cy), size / 2, 'merkezler omuz çizgisinde (y = merkez)');

  // Yarıçaplar 2, 3, 4 ve 5 hücre
  const radii = [...new Set(circles.map((c) => Math.round(c.r)))].sort((a, b) => a - b);
  assert.deepEqual(radii, [2, 3, 4, 5].map((k) => Math.round(k * cell)));

  // Şablon planı, logonun göz sayısını verir
  const plan = buildGridDrawPlan(settings({ grid: next.grid, size, guides: next.guides }));
  assert.equal(plan.regions.length, 392, 'logonun planı 392 göz verir');
  assert.equal(plan.guides.circles.length, 8);

  // Dört kilit nokta konstrüksiyondan doğar:
  // tepe = r=4 dairelerinin kesişimi (merkezden -3.464 hücre)
  const r4 = circles.filter((c) => Math.abs(c.r - 4 * cell) < 1e-6);
  assert.equal(r4.length, 2, 'iki r=4 dairesi olmalı');
  const apexY = size / 2 - Math.sqrt((4 * cell) ** 2 - (2 * cell) ** 2);
  assert.ok(Math.abs(apexY - (size / 2 - 3.464 * cell)) < 0.5, 'tepe merkezden -3.46 hücre');

  // kase dibi = r=3 dairesinin altı (+3 hücre), kanat ucu = sağ ucu (±5 hücre)
  const wing = circles.find((c) => c.cx > size / 2 && Math.abs(c.r - 3 * cell) < 1e-6);
  assert.ok(wing, 'sağdaki r=3 dairesi bulunmalı');
  assert.equal(Math.round(wing!.cy + wing!.r), Math.round(size / 2 + 3 * cell), 'kase dibi +3 hücre');
  assert.equal(Math.round(wing!.cx + wing!.r), Math.round(size / 2 + 5 * cell), 'kanat ucu +5 hücre');
});

test('gd: merkez artısı kılavuzları da kusursuz bölge üretir', () => {
  const plan = buildGridDrawPlan(settings({ grid: 5, size: 500, guides: centerCrossLines(500) }));
  const g = plan.guides;

  // Merkez artısı grid çizgileriyle çakışmadığı için bölge sayısı artmalı.
  const plain = plainGrid(500, 5);
  assert.ok(plan.regions.length > plain.regions.length);

  const step = Math.max(1, Math.floor(plan.regions.length / 20));
  for (let i = 0; i < plan.regions.length; i += step) {
    assertFlawlessLoops(plan.regions[i].loops, g, `merkez artısı bölge #${plan.regions[i].id}`);
  }
});

test('gd: birleştirme kılavuz geometrisini bozmaz', () => {
  const plan = plainGrid();
  const before = guideGeometry(plan.settings);
  mergeFilledRegions(plan, new Set(cellIds(plan, [[1, 1], [2, 1]])));
  const after = guideGeometry(plan.settings);

  assert.deepEqual(before, after, 'birleştirme kılavuzu değiştirmemeli');
});
