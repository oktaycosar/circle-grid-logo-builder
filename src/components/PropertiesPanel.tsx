import { useMemo } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { ColorField, NumberField, Panel, Toggle, round } from './ui.tsx';
import type { ArtboardObject, FillStyle, Geometry } from '../core/types.ts';
import { geometryBounds, remapGeometry, transformGeometry } from '../core/geometry.ts';
import { geometryEditableLoops } from '../core/nodes.ts';
import { makeGuideCircle, makeGuideLine } from '../core/factory.ts';
import { applyBooleanToSelection } from '../core/operations.ts';
import { rotationAbout, scaleAbout, translate } from '../core/matrix.ts';

const SWATCHES = ['#000000', '#ffffff', '#e02020', '#1e6feb', '#c9a227', '#12b886', '#8b7cf6'];

function fillColor(fill: FillStyle): string {
  if (fill.type === 'solid') return fill.color;
  if (fill.type === 'linear') return fill.stops[0]?.color ?? '#000000';
  return '#000000';
}

function centerOf(g: Geometry): { x: number; y: number } {
  const b = geometryBounds(g);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function flipGeometry(g: Geometry, axis: 'x' | 'y'): Geometry {
  const c = centerOf(g);
  const matrix: [number, number, number, number, number, number] =
    axis === 'x' ? [-1, 0, 0, 1, 2 * c.x, 0] : [1, 0, 0, -1, 0, 2 * c.y];
  return transformGeometry(g, matrix);
}

export function PropertiesPanel() {
  const state = useEditorState();
  const selected = useMemo(
    () => state.objects.filter((o) => state.selection.includes(o.id)),
    [state.objects, state.selection],
  );
  const primary: ArtboardObject | null = selected[0] ?? null;
  const multi = selected.length > 1;

  if (!primary) {
    return (
      <Panel title={multi ? `Properties · ${selected.length} nesne` : 'Properties / Object'}>
        <p className="panel__empty">
          Özellikleri düzenlemek için bir nesne seçin. Boş alana tıklayıp sürükleyerek marquee seçimi
          yapabilirsiniz.
        </p>
      </Panel>
    );
  }

  const update = (patch: Partial<ArtboardObject>, label: string) => {
    editorStore.commit(label, (s) => ({
      objects: s.objects.map((o) => (state.selection.includes(o.id) ? { ...o, ...patch } : o)),
    }));
  };

  const updateGeometry = (mutate: (g: Geometry, o: ArtboardObject) => Geometry, label: string) => {
    editorStore.commit(label, (s) => ({
      objects: s.objects.map((o) => {
        if (!state.selection.includes(o.id)) return o;
        const geometry = mutate(o.geometry, o);
        return { ...o, geometry, ...geometryBounds(geometry) };
      }),
    }));
  };

  const box = multi
    ? (() => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const o of selected) {
          minX = Math.min(minX, o.x);
          minY = Math.min(minY, o.y);
          maxX = Math.max(maxX, o.x + o.width);
          maxY = Math.max(maxY, o.y + o.height);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      })()
    : { x: primary.x, y: primary.y, width: primary.width, height: primary.height };

  const setBox = (next: { x: number; y: number; width: number; height: number }) => {
    updateGeometry(
      (g, o) => remapGeometry(g, { x: o.x, y: o.y, width: o.width, height: o.height }, next),
      'Boyutlandır',
    );
  };

  const nodeCount = geometryEditableLoops(primary.geometry).reduce((sum, l) => sum + l.points.length, 0);
  const setSolidFill = (color: string) => update({ fill: { type: 'solid', color } }, 'Renk');

  return (
    <>
      <Panel title={multi ? `Properties (${selected.length} nesne)` : `Properties · ${primary.name}`}>
        <div className="grid2">
          <NumberField label="X" value={box.x} onChange={(v) => setBox({ ...box, x: v })} />
          <NumberField label="Y" value={box.y} onChange={(v) => setBox({ ...box, y: v })} />
          <NumberField label="W" value={box.width} min={0.5} onChange={(v) => setBox({ ...box, width: v })} />
          <NumberField label="H" value={box.height} min={0.5} onChange={(v) => setBox({ ...box, height: v })} />
        </div>
        {!multi && (
          <div className="grid2">
            <NumberField
              label="Rotate"
              value={primary.rotation}
              step={1}
              suffix="°"
              onChange={(v) => update({ rotation: round(v, 2) }, 'Döndür')}
            />
            <button
              type="button"
              className="btn"
              onClick={() =>
                updateGeometry((g) => transformGeometry(g, rotationAbout(90, centerOf(g))), '90° döndür')
              }
              title="Saat yönünde 90° döndür"
            >
              90° döndür
            </button>
          </div>
        )}
      </Panel>

      <Panel title="Dönüşüm">
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => updateGeometry((g) => flipGeometry(g, 'x'), 'Yatay çevir')}>
            ↔ Flip H
          </button>
          <button type="button" className="btn" onClick={() => updateGeometry((g) => flipGeometry(g, 'y'), 'Dikey çevir')}>
            ↕ Flip V
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => updateGeometry((g) => transformGeometry(g, scaleAbout(2, 2, centerOf(g))), 'Ölçek ×2')}
          >
            ×2
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => updateGeometry((g) => transformGeometry(g, scaleAbout(0.5, 0.5, centerOf(g))), 'Ölçek ÷2')}
          >
            ÷2
          </button>
          <button type="button" className="btn" onClick={() => updateGeometry((g) => transformGeometry(g, translate(10, 0)), 'Sağa taşı')}>
            → 10
          </button>
          <button type="button" className="btn" onClick={() => updateGeometry((g) => transformGeometry(g, translate(-10, 0)), 'Sola taşı')}>
            ← 10
          </button>
          <button type="button" className="btn" onClick={() => updateGeometry((g) => transformGeometry(g, translate(0, -10)), 'Yukarı taşı')}>
            ↑ 10
          </button>
          <button type="button" className="btn" onClick={() => updateGeometry((g) => transformGeometry(g, translate(0, 10)), 'Aşağı taşı')}>
            ↓ 10
          </button>
        </div>
      </Panel>

      <Panel title="Appearance">
        <ColorField
          label="Fill"
          value={fillColor(primary.fill)}
          disabled={primary.fill.type === 'none'}
          onChange={setSolidFill}
        />
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              title={c}
              onClick={() => setSolidFill(c)}
            />
          ))}
          <button
            type="button"
            className={`swatch${primary.fill.type === 'none' ? ' swatch--active' : ''}`}
            style={{ background: 'repeating-conic-gradient(#555 0% 25%, #2a2a2a 0% 50%) 50% / 8px 8px' }}
            title="Fill yok (negatif alan için)"
            onClick={() => update({ fill: { type: 'none' } }, 'Fill yok')}
          />
        </div>

        <ColorField
          label="Stroke"
          value={primary.stroke === 'none' ? '#000000' : primary.stroke}
          onChange={(v) => update({ stroke: v }, 'Stroke rengi')}
        />
        <div className="grid2">
          <NumberField
            label="Width"
            value={primary.strokeWidth}
            min={0}
            step={0.5}
            onChange={(v) => update({ strokeWidth: v }, 'Stroke kalınlığı')}
          />
          <button
            type="button"
            className="btn"
            onClick={() => update({ stroke: primary.stroke === 'none' ? '#000000' : 'none' }, 'Stroke aç/kapat')}
          >
            {primary.stroke === 'none' ? 'Stroke ekle' : 'Stroke kaldır'}
          </button>
        </div>
      </Panel>

      <Panel title="Nesne">
        <div className="field">
          <span className="field__label">Ad</span>
          <input
            type="text"
            value={primary.name}
            onChange={(e) => {
              const value = e.target.value;
              editorStore.applyLive({
                objects: editorStore.getState().objects.map((o) => (o.id === primary.id ? { ...o, name: value } : o)),
              });
            }}
          />
        </div>
        <div className="grid2">
          <Toggle label="Görünür" checked={primary.visible} onChange={(v) => update({ visible: v }, 'Görünürlük')} />
          <Toggle label="Kilitli" checked={primary.locked} onChange={(v) => update({ locked: v }, 'Kilit')} />
        </div>
        <div className="field">
          <span className="field__label">Tip</span>
          <span style={{ flex: 1, color: '#f2f2f2' }}>
            {primary.type} · {primary.geometry.kind}
            {primary.opLabel ? ` · ${primary.opLabel}` : ''}
          </span>
        </div>
        <div className="field">
          <span className="field__label">Anchor</span>
          <span style={{ flex: 1, color: '#f2f2f2' }}>{nodeCount} nokta</span>
        </div>
      </Panel>

      <Panel title="Guide" defaultOpen={false}>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const c = centerOf(primary.geometry);
              const r = Math.max(primary.width, primary.height) / 2;
              editorStore.addObjects([makeGuideCircle(c.x, c.y, r, `${primary.name} guide`)], 'Guide daire');
            }}
            title="Seçili nesnenin ölçülerinde guide daire oluştur"
          >
            Guide Circle
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const c = centerOf(primary.geometry);
              editorStore.addObjects(
                [makeGuideLine(c.x, 0, c.x, state.doc.artboardSize, `${primary.name} guide V`)],
                'Guide çizgi',
              );
            }}
          >
            Guide V
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const c = centerOf(primary.geometry);
              editorStore.addObjects(
                [makeGuideLine(0, c.y, state.doc.artboardSize, c.y, `${primary.name} guide H`)],
                'Guide çizgi',
              );
            }}
          >
            Guide H
          </button>
          <button
            type="button"
            className={`btn${primary.isGuide ? ' btn--primary' : ''}`}
            onClick={() => update({ isGuide: !primary.isGuide }, 'Guide dönüşümü')}
            title="Nesneyi guide yap / geri al — guide'lar export edilmez"
          >
            {primary.isGuide ? "Guide'dan çıkar" : 'Convert to Guide'}
          </button>
        </div>
        <Toggle
          label="Guide'ları göster"
          checked={state.doc.showGuides}
          onChange={(v) => editorStore.setDoc({ showGuides: v })}
        />
      </Panel>

      <Panel title="Hizalama ve işlemler" defaultOpen={false}>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() =>
              updateGeometry((g, o) => {
                const dx = state.doc.artboardSize / 2 - (o.x + o.width / 2);
                const dy = state.doc.artboardSize / 2 - (o.y + o.height / 2);
                return transformGeometry(g, translate(dx, dy));
              }, 'Artboard merkezine')
            }
          >
            Merkeze ortala
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const result = applyBooleanToSelection('unite');
              editorStore.setStatus(result.message);
            }}
          >
            Unite
          </button>
          <button type="button" className="btn btn--danger" onClick={() => editorStore.deleteSelection()}>
            Sil (Del)
          </button>
        </div>
      </Panel>
    </>
  );
}
