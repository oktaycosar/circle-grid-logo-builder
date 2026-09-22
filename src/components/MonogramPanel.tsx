import { useState } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { NumberField, Panel, Toggle } from './ui.tsx';
import { insertMonogramSkeleton } from '../core/operations.ts';
import { supportedLetters } from '../core/monogram.ts';

/**
 * MONOGRAM MODE (spesifikasyon 11).
 *
 * MANUAL MODE: kullanıcı videodaki gibi harfleri rectangle/path ile kendisi
 * kurar; bu panel yalnızca ölçü ve konum yardımı verir.
 *
 * AUTO GUIDE MODE: girilen harfler için geometrik iskelet üretilir. İskelet
 * iki biçimde eklenebilir:
 *   - Parçalar ayrı ayrı (kullanıcı kendi unite/subtract'ını yapar)
 *   - Otomatik birleştirilmiş nihai harf geometrisi
 */
export function MonogramPanel() {
  const state = useEditorState();
  const [letters, setLetters] = useState('SAD');
  const [mode, setMode] = useState<'manual' | 'auto'>('auto');
  const [unitePieces, setUnitePieces] = useState(false);
  const [box, setBox] = useState({ x: 165, y: 330, width: 660, height: 340 });

  const lettersClean = letters.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const available = supportedLetters();
  const unsupported = lettersClean.split('').filter((ch) => !available.includes(ch));

  return (
    <Panel title="Monogram">
      <div className="mono-letters">
        <input
          type="text"
          maxLength={3}
          value={letters}
          placeholder="SAD"
          onChange={(e) => setLetters(e.target.value.toUpperCase().replace(/[^A-Za-z]/g, '').slice(0, 3))}
        />
      </div>
      <p className="dialog__hint">
        {lettersClean.length || 0} karakter · A–Z desteklenir (maks. 3).{' '}
        {unsupported.length > 0 && <span style={{ color: '#e07a5f' }}>Desteklenmeyen: {unsupported.join(', ')}</span>}
      </p>

      <div className="mono-mode">
        <button
          type="button"
          className={`btn${mode === 'manual' ? ' btn--active' : ''}`}
          onClick={() => setMode('manual')}
          title="Harfleri rectangle/path ile kendiniz çizin"
        >
          Manual
        </button>
        <button
          type="button"
          className={`btn${mode === 'auto' ? ' btn--active' : ''}`}
          onClick={() => setMode('auto')}
          title="Girilen harfler için geometrik iskelet üret"
        >
          Auto Guide
        </button>
      </div>

      {mode === 'manual' ? (
        <>
          <p className="dialog__hint">
            Rectangle (R), Circle (E), Line (L) ve Pen (P) araçlarıyla harfleri grid üzerinde kurun. Snap açıkken
            dikey/yatay parçalar grid çizgilerine oturur. Sonra Pathfinder ile Unite / Subtract / Intersect
            uygulayın ve "Clip to Circle" ile harfleri daireye kırpın.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const s = editorStore.getState();
                const c = s.doc.artboardSize / 2;
                editorStore.addObjects(
                  [
                    {
                      id: `mono_ref_${Date.now()}`,
                      type: 'rectangle' as const,
                      name: 'Harf Bandı Referansı',
                      geometry: { kind: 'rect' as const, x: box.x, y: box.y, width: box.width, height: box.height },
                      x: box.x,
                      y: box.y,
                      width: box.width,
                      height: box.height,
                      rotation: 0,
                      fill: { type: 'none' as const },
                      stroke: '#8b7cf6',
                      strokeWidth: 1.5,
                      sizing: 'stretch' as const,
                      visible: true,
                      locked: false,
                      layerIndex: 1,
                      isGuide: true,
                    },
                    {
                      id: `mono_mid_${Date.now()}`,
                      type: 'line' as const,
                      name: 'Harf Orta Ekseni',
                      geometry: {
                        kind: 'line' as const,
                        x1: box.x,
                        y1: box.y + box.height / 2,
                        x2: box.x + box.width,
                        y2: box.y + box.height / 2,
                      },
                      x: box.x,
                      y: box.y + box.height / 2,
                      width: box.width,
                      height: 0,
                      rotation: 0,
                      fill: { type: 'none' as const },
                      stroke: '#8b7cf6',
                      strokeWidth: 1.5,
                      sizing: 'stretch' as const,
                      visible: true,
                      locked: false,
                      layerIndex: 1,
                      isGuide: true,
                    },
                  ],
                  'Harf bandı guide',
                );
                void c;
                editorStore.setStatus('Harf bandı guide çizgileri eklendi.');
              }}
            >
              Harf bandı guide ekle
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid2">
            <NumberField label="X" value={box.x} step={5} onChange={(v) => setBox({ ...box, x: v })} />
            <NumberField label="Y" value={box.y} step={5} onChange={(v) => setBox({ ...box, y: v })} />
            <NumberField label="W" value={box.width} min={20} step={5} onChange={(v) => setBox({ ...box, width: v })} />
            <NumberField label="H" value={box.height} min={20} step={5} onChange={(v) => setBox({ ...box, height: v })} />
          </div>
          <Toggle
            label="Parçaları otomatik birleştir (unite + negatifleri subtract)"
            checked={unitePieces}
            onChange={setUnitePieces}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!lettersClean}
              onClick={() => {
                const result = insertMonogramSkeleton({ letters: lettersClean, box, unitePieces });
                editorStore.setStatus(result.message);
              }}
            >
              İskeleti oluştur
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const artboard = state.doc.artboardSize;
                const pad = artboard * 0.17;
                setBox({ x: pad, y: pad, width: artboard - pad * 2, height: artboard - pad * 2 });
              }}
              title="Kutuyu artboard'a ortala"
            >
              Ortala
            </button>
          </div>
          <p className="dialog__hint">
            İskelet bir <strong>taslaktır</strong>: dikdörtgen/çokgen parçalardan kurulur. "Parçaları otomatik
            birleştir" kapalıyken parçalar ayrı gelir; negatifler kırmızı konturla gösterilir ve bunları seçip
            Pathfinder → Subtract ile gerçek negatif alana çevirirsiniz.
          </p>
        </>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const artboard = state.doc.artboardSize;
            const c = artboard / 2;
            const r = artboard * 0.352;
            editorStore.addObjects(
              [
                {
                  id: `mono_inner_${Date.now()}`,
                  type: 'circle' as const,
                  name: 'Inner Boundary (Monogram)',
                  geometry: { kind: 'circle' as const, cx: c, cy: c, r },
                  x: c - r,
                  y: c - r,
                  width: r * 2,
                  height: r * 2,
                  rotation: 0,
                  fill: { type: 'none' as const },
                  stroke: '#8b7cf6',
                  strokeWidth: 1.5,
                  sizing: 'uniform' as const,
                  visible: true,
                  locked: false,
                  layerIndex: state.activeLayerIndex,
                  isGuide: true,
                },
              ],
              'Monogram iç sınır guide',
            );
            editorStore.setStatus('İç sınır guide dairesi eklendi — "Clip to Circle" ile harfleri buna kırpın.');
          }}
          title="Harflerin taşmayacağı iç sınır guide dairesi"
        >
          İç sınır dairesi ekle
        </button>
      </div>
    </Panel>
  );
}
