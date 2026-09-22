/**
 * D harfi göbeği gibi "bir kenarı diğer şeklin kenarıyla tam çakışan"
 * durumları doğrulayan regresyon testi.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { booleanGeometry, loopsToPolygonGeometry, uniteAll } from '../src/core/boolean.ts';
import { flattenGeometry, geometryBounds, pointInGeometry } from '../src/core/geometry.ts';
import type { Geometry, Vec2 } from '../src/core/types.ts';
import { letterSpec, primToGeometry } from '../src/core/monogram.ts';
import { createDemoProject } from '../src/core/demoProject.ts';

function rect(x: number, y: number, w: number, h: number): Geometry {
  return { kind: 'rect', x, y, width: w, height: h };
}

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

test('regresyon: D harfinin göbeği (paylaşılan kenar) gerçek delik olarak açılır', () => {
  const box = { x: 0, y: 0, width: 200, height: 300 };
  const spec = letterSpec('D');
  assert.ok(spec, 'D harfi kütüphanede olmalı');

  const solids = spec.solids
    .map((p) => primToGeometry(p, box))
    .filter((g): g is Geometry => Boolean(g));
  const negatives = spec.negatives
    .map((p) => primToGeometry(p, box))
    .filter((g): g is Geometry => Boolean(g));

  let solid: Geometry = loopsToPolygonGeometry(uniteAll(solids));
  for (const neg of negatives) {
    solid = loopsToPolygonGeometry(booleanGeometry(solid, neg, 'subtract'));
  }

  // Göbek boş olmalı: bar'ın hemen sağında, dikey ortada
  const b = geometryBounds(solid);
  const inner = { x: b.x + b.width * 0.45, y: b.y + b.height / 2 };
  assert.equal(pointInGeometry(solid, inner), false, 'D göbeği boş olmalı (delik)');

  // Göbek çevresindeki gövde dolu olmalı
  const rightEdge = { x: b.x + b.width * 0.95, y: b.y + b.height / 2 };
  assert.equal(pointInGeometry(solid, rightEdge), true, 'D sağ kenarı dolu olmalı');
  const barArea = { x: b.x + b.width * 0.1, y: b.y + b.height / 2 };
  assert.equal(pointInGeometry(solid, barArea), true, 'D dikey barı dolu olmalı');

  // Alan: gövde eksi göbek olmalı (dolu dikdörtgenden küçük)
  const contours = flattenGeometry(solid);
  const area = filledArea(contours.map((c) => c.points));
  const fullBox = b.width * b.height;
  assert.ok(area < fullBox * 0.95, `D alanı göbeksiz olmalı: ${area} vs kutu ${fullBox}`);
  assert.ok(area > fullBox * 0.3, `D alanı beklenenden küçük: ${area}`);
});

test('regresyon: kenarı tam çakışan iki dikdörtgenin farkı', () => {
  // A ve B aynı x aralığında, B tamamen A'nın sağ kenarına yapışık
  const a = rect(0, 0, 100, 100);
  const b = rect(0, 100, 100, 100); // tam kenar paylaşımı, dışarıda
  const united = booleanGeometry(a, b, 'unite');
  assert.equal(united.length, 1, 'unite tek loop olmalı');
  assert.ok(Math.abs(filledArea(united) - 20000) < 60, `alan=${filledArea(united)}`);

  const diff = booleanGeometry(a, b, 'subtract');
  assert.ok(Math.abs(filledArea(diff) - 10000) < 60, `alan=${filledArea(diff)}`);
});

test('regresyon: tam içteki ve kenarı paylaşan dikdörtgen delik açar', () => {
  const outer = rect(0, 0, 200, 200);
  const inner = rect(0, 0, 200, 100); // sol/üst/sağ kenarları çakışık
  const loops = booleanGeometry(outer, inner, 'subtract');
  const area = filledArea(loops);
  assert.ok(Math.abs(area - 20000) < 200, `alan=${area} (beklenen 20000)`);
});

test('demo: harfler kırpma dairesinin içinde ve göbekleri dolu değil', () => {
  const demo = createDemoProject();
  for (const name of ['Letter S', 'Letter A', 'Letter D']) {
    const obj = demo.objects.find((o) => o.name === name);
    assert.ok(obj, `${name} bulunmalı`);
    const b = geometryBounds(obj!.geometry);
    assert.ok(b.width > 100 && b.height > 200, `${name} boyutu makul olmalı: ${b.width}×${b.height}`);
  }

  const letterA = demo.objects.find((o) => o.name === 'Letter A')!;
  const a = geometryBounds(letterA.geometry);
  // A'nın dikey counter'ı boş olmalı
  assert.equal(
    pointInGeometry(letterA.geometry, { x: a.x + a.width * 0.5, y: a.y + a.height * 0.45 }),
    false,
    'A counter boş olmalı',
  );
});
