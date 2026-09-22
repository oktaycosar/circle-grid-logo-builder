import { editorStore, useEditorState } from '../store/editorStore.ts';
import { NumberField, Panel, SliderField, Toggle } from './ui.tsx';

/** Grid paneli (spesifikasyon 4): görünürlük, snap, boyut, bölme, opaklık. */
export function GridPanel() {
  const state = useEditorState();
  const grid = state.grid;

  return (
    <Panel title="Grid">
      <Toggle label="Show Grid" checked={grid.enabled} onChange={(v) => editorStore.setGrid({ enabled: v })} />
      <Toggle label="Snap to Grid" checked={grid.snap} onChange={(v) => editorStore.setGrid({ snap: v })} />
      <div className="grid2">
        <NumberField
          label="Size"
          value={grid.size}
          min={2}
          step={5}
          onChange={(v) => editorStore.setGridLive({ size: Math.max(2, v) })}
          onCommit={() => editorStore.commit('Grid boyutu', () => ({}))}
        />
        <NumberField
          label="Div"
          value={grid.divisions}
          min={1}
          max={10}
          step={1}
          onChange={(v) => editorStore.setGridLive({ divisions: Math.max(1, Math.min(10, Math.round(v))) })}
          onCommit={() => editorStore.commit('Grid bölmesi', () => ({}))}
        />
      </div>
      <SliderField
        label="Opacity"
        value={Math.round(grid.opacity * 100)}
        min={5}
        max={100}
        onChange={(v) => editorStore.setGridLive({ opacity: v / 100 })}
        onCommit={() => editorStore.commit('Grid opaklığı', () => ({}))}
      />
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => editorStore.setGrid({ enabled: !grid.enabled })}>
          {grid.enabled ? 'Hide Grid (G)' : 'Show Grid (G)'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => editorStore.setGrid({ size: 50, divisions: 2, opacity: 0.55, majorEvery: 4 })}
          title="Grid ayarlarını varsayılana döndür"
        >
          Varsayılan
        </button>
        <button type="button" className="btn" onClick={() => editorStore.setGrid({ size: 25, divisions: 1 })}>
          25 px
        </button>
        <button type="button" className="btn" onClick={() => editorStore.setGrid({ size: 100, divisions: 2 })}>
          100 px
        </button>
      </div>
      <Toggle
        label="Smart snap kılavuzları"
        checked={state.doc.showSmartGuides}
        onChange={(v) => editorStore.setDoc({ showSmartGuides: v })}
      />
      <Toggle
        label="Anchor noktalarını göster"
        checked={state.doc.showAnchors}
        onChange={(v) => editorStore.setDoc({ showAnchors: v })}
      />
      <Toggle
        label="Outline mod (Ctrl+Y)"
        checked={state.doc.outlineMode}
        onChange={(v) => editorStore.setDoc({ outlineMode: v })}
      />
      <p className="dialog__hint">
        Grid artboard merkezine göre simetriktir. Alt bölme çizgileri ana çizgilerden daha incedir ve SVG
        export'a dahil edilmez.
      </p>
    </Panel>
  );
}
