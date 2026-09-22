import { useMemo, useState } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { Panel } from './ui.tsx';
import { IconEye, IconLock, IconPlus, IconTrash } from './icons.tsx';

/**
 * Layers paneli (spesifikasyon 19): katman görünürlüğü, kilidi, yeniden
 * adlandırma, silme ve drag-and-drop ile sıralama; altında katmandaki
 * nesneler listelenir.
 */
export function LayersPanel() {
  const state = useEditorState();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [newLayerName, setNewLayerName] = useState('');

  const objectsByLayer = useMemo(() => {
    const map = new Map<number, typeof state.objects>();
    state.objects.forEach((o) => {
      const list = map.get(o.layerIndex) ?? [];
      list.push(o);
      map.set(o.layerIndex, list);
    });
    return map;
  }, [state.objects]);

  // Katman listesi üstten alta gösterilir (en üst katman en üstte)
  const ordered = useMemo(
    () => state.layers.map((layer, index) => ({ layer, index })).reverse(),
    [state.layers],
  );

  return (
    <Panel title={`Layers (${state.layers.length})`}>
      <div className="layers">
        {ordered.map(({ layer, index }) => {
          const layerObjects = objectsByLayer.get(index) ?? [];
          const isOpen = !collapsed[index];
          const locked = layer.locked;
          return (
            <div
              key={layer.id}
              className={`layer${state.activeLayerIndex === index ? ' layer--active' : ''}${
                overIndex === index ? ' layer--drag-over' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(index);
              }}
              onDragLeave={() => setOverIndex((v) => (v === index ? null : v))}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== index) {
                  editorStore.moveLayer(dragIndex, index);
                }
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <div className="layer__head">
                <span
                  className="layer__grip"
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  title="Sürükleyerek katman sırasını değiştir"
                >
                  ⠿
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 14 }}
                  onClick={() => setCollapsed((c) => ({ ...c, [index]: !c[index] }))}
                  title={isOpen ? 'Daralt' : 'Genişlet'}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                <input
                  className="layer__name"
                  value={layer.name}
                  onChange={(e) =>
                    editorStore.applyLive({
                      layers: editorStore.getState().layers.map((l, i) =>
                        i === index ? { ...l, name: e.target.value } : l,
                      ),
                    })
                  }
                  onBlur={() => editorStore.commit('Katman adı', () => ({}))}
                  onFocus={() => editorStore.setActiveLayerIndex(index)}
                />
                <span className="layer__count">{layerObjects.length}</span>
                <button
                  type="button"
                  className={`icon-btn${layer.visible ? ' icon-btn--on' : ''}`}
                  onClick={() => editorStore.updateLayer(index, { visible: !layer.visible }, 'Katman görünürlüğü')}
                  title="Katmanı göster/gizle"
                >
                  <IconEye open={layer.visible} />
                </button>
                <button
                  type="button"
                  className={`icon-btn${locked ? ' icon-btn--on' : ''}`}
                  onClick={() => editorStore.updateLayer(index, { locked: !locked }, 'Katman kilidi')}
                  title="Katmanı kilitle"
                >
                  <IconLock locked={locked} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => editorStore.removeLayer(index)}
                  disabled={state.layers.length <= 1}
                  title="Katmanı sil (içindeki nesnelerle birlikte)"
                >
                  <IconTrash />
                </button>
              </div>

              {isOpen && layerObjects.length > 0 && (
                <div className="layer__objects">
                  {layerObjects.map((obj) => (
                    <div
                      key={obj.id}
                      className={`layerobj${
                        state.selection.includes(obj.id) ? ' layerobj--selected' : ''
                      }`}
                      onClick={(e) => {
                        editorStore.setSelection(
                          e.shiftKey
                            ? state.selection.includes(obj.id)
                              ? state.selection.filter((id) => id !== obj.id)
                              : [...state.selection, obj.id]
                            : [obj.id],
                        );
                      }}
                    >
                      <span className="layerobj__name">{obj.name}</span>
                      <span className="layerobj__type">{obj.geometry.kind}</span>
                      <button
                        type="button"
                        className={`icon-btn${obj.visible ? ' icon-btn--on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          editorStore.updateObject(obj.id, (o) => ({ ...o, visible: !o.visible }), 'Görünürlük');
                        }}
                        title="Göster/gizle"
                      >
                        <IconEye open={obj.visible} />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn${obj.locked ? ' icon-btn--on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          editorStore.updateObject(obj.id, (o) => ({ ...o, locked: !o.locked }), 'Kilit');
                        }}
                        title="Kilitle"
                      >
                        <IconLock locked={obj.locked} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row row--tight">
        <div className="field">
          <span className="field__label">Yeni</span>
          <input
            type="text"
            value={newLayerName}
            placeholder="katman adı"
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLayerName.trim()) {
                editorStore.addLayer(newLayerName.trim());
                setNewLayerName('');
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            editorStore.addLayer(newLayerName.trim() || `Layer ${state.layers.length + 1}`);
            setNewLayerName('');
          }}
        >
          <IconPlus width={12} height={12} /> Katman
        </button>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={!state.selection.length}
          onClick={() => {
            const target = state.activeLayerIndex;
            editorStore.updateObjects((o) => ({ ...o, layerIndex: target }), 'Katmana taşı', state.selection);
          }}
          title="Seçili nesneleri aktif katmana taşı"
        >
          Aktif katmana taşı
        </button>
      </div>

      {state.selection.length === 1 && (
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => editorStore.moveObjectOrder(state.selection[0], 'top')} title="En üste">
            ⤒ En üst
          </button>
          <button type="button" className="btn" onClick={() => editorStore.moveObjectOrder(state.selection[0], 'up')} title="Bir üst">
            ↑
          </button>
          <button type="button" className="btn" onClick={() => editorStore.moveObjectOrder(state.selection[0], 'down')} title="Bir alt">
            ↓
          </button>
          <button type="button" className="btn" onClick={() => editorStore.moveObjectOrder(state.selection[0], 'bottom')} title="En alta">
            ⤓ En alt
          </button>
        </div>
      )}
    </Panel>
  );
}
