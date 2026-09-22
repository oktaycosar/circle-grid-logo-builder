import { useMemo, useState } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { NumberField, Panel } from './ui.tsx';
import { PfDivide, PfExclude, PfIntersect, PfSubtract, PfUnite } from './icons.tsx';
import {
  applyBooleanToSelection,
  clipSelectionOutsideCircle,
  clipSelectionToCircle,
  createConcentricCircle,
  createRingFromCircle,
} from '../core/operations.ts';
import type { BooleanOp } from '../core/boolean.ts';

const OPS: { op: BooleanOp; label: string; icon: React.ReactNode; hint: string }[] = [
  { op: 'unite', label: 'Unite', icon: <PfUnite />, hint: 'Seçili şekilleri birleştirir' },
  { op: 'subtract', label: 'Subtract', icon: <PfSubtract />, hint: 'İlk şekilden diğerlerini çıkarır (delik açar)' },
  { op: 'intersect', label: 'Intersect', icon: <PfIntersect />, hint: 'Yalnızca ortak alanı bırakır' },
  { op: 'exclude', label: 'Exclude', icon: <PfExclude />, hint: 'Ortak alanı çıkarır (XOR)' },
  { op: 'divide', label: 'Divide', icon: <PfDivide />, hint: 'Tüm kesişim bölgelerini ayrı parçalara ayırır' },
];

/**
 * Pathfinder + Circle Construction paneli (spesifikasyon 12, 13).
 * Tüm işlemler gerçek vektör geometri üretir; CSS maske kullanılmaz.
 */
export function BooleanPanel() {
  const state = useEditorState();
  const [innerOffset, setInnerOffset] = useState(30);
  const [ringThickness, setRingThickness] = useState(24);

  const selected = useMemo(
    () => state.objects.filter((o) => state.selection.includes(o.id)),
    [state.objects, state.selection],
  );

  const circles = useMemo(() => state.objects.filter((o) => o.geometry.kind === 'circle'), [state.objects]);
  const selectedCircle = selected.find((o) => o.geometry.kind === 'circle') ?? null;
  const [clipCircleId, setClipCircleId] = useState('');

  const activeClipCircle =
    circles.find((c) => c.id === clipCircleId) ??
    (selectedCircle && circles.length > 1 ? circles.find((c) => c.id !== selectedCircle.id) ?? null : null) ??
    circles[0] ??
    null;

  const canBoolean = selected.length >= 2;

  const run = (op: BooleanOp) => {
    const result = applyBooleanToSelection(op);
    editorStore.setStatus(result.message);
  };

  return (
    <>
      <Panel title="Pathfinder">
        <div className="pathfinder">
          {OPS.map((entry) => (
            <button
              key={entry.op}
              type="button"
              className="pf-btn"
              disabled={!canBoolean}
              onClick={() => run(entry.op)}
              title={entry.hint}
            >
              {entry.icon}
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
        <p className="dialog__hint">
          {canBoolean
            ? `Subtract: sıralamada ilk nesne taban alınır, diğerleri çıkarılır (negatif alan / gerçek delik).`
            : 'Boolean işlemleri için Shift+tık ile en az 2 nesne seçin.'}
        </p>
        {!canBoolean && (
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => editorStore.setSelection(state.objects.map((o) => o.id))}
              title="Tüm nesneleri seç"
            >
              Tümünü seç
            </button>
          </div>
        )}
      </Panel>

      <Panel title="Circle Construction">
        <div className="grid2">
          <NumberField
            label="Offset"
            value={innerOffset}
            min={1}
            step={1}
            onChange={(v) => setInnerOffset(Math.max(1, v))}
          />
          <button
            type="button"
            className="btn"
            disabled={!selectedCircle}
            onClick={() => {
              if (!selectedCircle) return;
              const result = createConcentricCircle(selectedCircle.id, innerOffset);
              editorStore.setStatus(result.message);
            }}
            title="Seçili daireden offset kadar içeride eş merkezli ikinci daire üretir"
          >
            Create Concentric
          </button>
        </div>

        <div className="grid2">
          <NumberField
            label="Thick"
            value={ringThickness}
            min={1}
            step={1}
            onChange={(v) => setRingThickness(Math.max(1, v))}
          />
          <button
            type="button"
            className="btn"
            disabled={!selectedCircle}
            onClick={() => {
              if (!selectedCircle) return;
              const result = createRingFromCircle(selectedCircle.id, ringThickness);
              editorStore.setStatus(result.message);
            }}
            title="Fill tabanlı gerçek halka (ring) üretir — stroke'a bağımlı değil"
          >
            Create Ring
          </button>
        </div>

        {selectedCircle && (
          <div className="field">
            <span className="field__label">Radius</span>
            <span style={{ flex: 1, color: '#f2f2f2' }}>
              {selectedCircle.geometry.kind === 'circle' ? selectedCircle.geometry.r.toFixed(1) : '—'}
            </span>
          </div>
        )}
      </Panel>

      <Panel title="Clip to Circle" defaultOpen={false}>
        <select
          className="field__select"
          value={activeClipCircle?.id ?? ''}
          onChange={(e) => setClipCircleId(e.target.value)}
        >
          {circles.length === 0 && <option value="">Daire yok — önce bir daire çizin</option>}
          {circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.geometry.kind === 'circle' ? `(r=${c.geometry.r.toFixed(0)})` : ''}
            </option>
          ))}
        </select>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!activeClipCircle || selected.length === 0}
            onClick={() => {
              if (!activeClipCircle) return;
              const result = clipSelectionToCircle(activeClipCircle.id);
              editorStore.setStatus(result.message);
            }}
            title="Seçili şekilleri daire ile GERÇEK boolean intersection'a sokar (letterShape ∩ innerCircle)"
          >
            Clip to Circle (∩)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!activeClipCircle || selected.length === 0}
            onClick={() => {
              if (!activeClipCircle) return;
              const result = clipSelectionOutsideCircle(activeClipCircle.id);
              editorStore.setStatus(result.message);
            }}
            title="Dairenin dışında kalan kısmı bırakır (şekil − daire)"
          >
            Clip Outside (\)
          </button>
        </div>
        <p className="dialog__hint">
          Sonuç gerçek SVG path olarak üretilir; CSS maske veya clip-path kullanılmaz. Harflerin dış
          kenarları dairenin eğrisini takip eder.
        </p>
      </Panel>

      <Panel title="Referans geometri" defaultOpen={false}>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const artboard = state.doc.artboardSize;
              const c = artboard / 2;
              const geometry = { kind: 'circle' as const, cx: c, cy: c, r: artboard * 0.35 };
              const obj = {
                id: `ref_${Date.now()}`,
                type: 'circle' as const,
                name: `Construction Circle r=${Math.round(artboard * 0.35)}`,
                geometry,
                x: c - artboard * 0.35,
                y: c - artboard * 0.35,
                width: artboard * 0.7,
                height: artboard * 0.7,
                rotation: 0,
                fill: { type: 'none' as const },
                stroke: '#000000',
                strokeWidth: 1.5,
                sizing: 'uniform' as const,
                visible: true,
                locked: false,
                layerIndex: state.activeLayerIndex,
              };
              editorStore.addObjects([obj], 'Konstrüksiyon dairesi');
            }}
            title="Artboard merkezine, artboard'ın %70 çapında daire ekler"
          >
            Merkeze Daire (⌀70%)
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const artboard = state.doc.artboardSize;
              const c = artboard / 2;
              const r = artboard * 0.35;
              const guide = {
                id: `guide_${Date.now()}`,
                type: 'circle' as const,
                name: 'Inner Construction Guide',
                geometry: { kind: 'circle' as const, cx: c, cy: c, r: r * 0.88 },
                x: c - r * 0.88,
                y: c - r * 0.88,
                width: r * 1.76,
                height: r * 1.76,
                rotation: 0,
                fill: { type: 'none' as const },
                stroke: '#8b7cf6',
                strokeWidth: 1.5,
                sizing: 'uniform' as const,
                visible: true,
                locked: false,
                layerIndex: 1,
                isGuide: true,
              };
              editorStore.addObjects([guide], 'Guide daire');
            }}
            title="İç sınır guide dairesi ekler (export edilmez)"
          >
            İç Sınır (Guide)
          </button>
        </div>
        {selectedCircle && (
          <NumberField
            label="R ="
            value={selectedCircle.geometry.kind === 'circle' ? selectedCircle.geometry.r : 0}
            min={1}
            onChange={(v) =>
              editorStore.commit('Yarıçap', (s) => ({
                objects: s.objects.map((o) =>
                  o.id === selectedCircle.id && o.geometry.kind === 'circle'
                    ? (() => {
                        const geometry = { ...o.geometry, r: v };
                        return { ...o, geometry, x: geometry.cx - v, y: geometry.cy - v, width: v * 2, height: v * 2 };
                      })()
                    : o,
                ),
              }))
            }
          />
        )}
      </Panel>
    </>
  );
}
