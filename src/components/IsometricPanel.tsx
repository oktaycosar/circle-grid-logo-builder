import { useMemo } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { ColorField, NumberField, Panel, SliderField, Toggle } from './ui.tsx';
import type { ArtboardObject, IsoFace } from '../core/types.ts';
import { ISO_FACES } from '../core/types.ts';
import {
  buildIsoCube,
  extrudeGeometry,
  isoDepthOffset,
  projectGeometryToFace,
  type IsoCube,
} from '../core/isometric.ts';
import { newId } from '../core/factory.ts';
import { geometryBounds } from '../core/geometry.ts';

/**
 * İzometrik mod paneli (spesifikasyon §İkinci video).
 *
 * Karşıladığı istekler:
 *   Isometric Grid · Cube Construction · Isometric Snap · Face Selection ·
 *   Extrude / Depth · Top / Front / Side Face Coloring
 */

const FACE_LABELS: Record<IsoFace, string> = {
  top: 'Top (Üst)',
  right: 'Front (Sağ)',
  left: 'Side (Sol)',
};

/** Objenin dolu rengi; düz renk değilse nötr bir gri döner. */
function fallbackColor(obj: ArtboardObject): string {
  const fill = obj.fill;
  if (fill.type === 'solid') return fill.color;
  return '#4d4d4d';
}

/** Küpün üç yüzünü artboard ortasına yerleştirerek ekler. */
function insertCube(cube: IsoCube, layerIndex: number, artboardSize: number): void {
  const base = buildIsoCube(cube, layerIndex);
  if (!base.length) return;

  // Üç yüzün toplam sınırını bul, artboard merkezine kaydır.
  const points: { x: number; y: number }[] = [];
  for (const obj of base) {
    if (obj.geometry.kind === 'polygon') points.push(...obj.geometry.keypoints);
  }
  const bounds = geometryBounds({ kind: 'polygon', keypoints: points });
  const dx = artboardSize / 2 - (bounds.x + bounds.width / 2);
  const dy = artboardSize / 2 - (bounds.y + bounds.height / 2);

  const shifted = base.map((obj) => {
    if (obj.geometry.kind !== 'polygon') return obj;
    return {
      ...obj,
      geometry: {
        kind: 'polygon' as const,
        keypoints: obj.geometry.keypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      },
    };
  });

  editorStore.addObjects(shifted, 'İzometrik küp');
  editorStore.setStatus(`Küp eklendi: ${cube.edge}×${cube.height} hücre`);
}

export function IsometricPanel() {
  const state = useEditorState();
  const iso = state.iso;

  const selectedIds = useMemo(() => new Set(state.selection), [state.selection]);

  const currentCube = (): IsoCube => ({
    u: 0,
    v: 0,
    edge: iso.cubeEdgeCells,
    height: iso.cubeHeightCells,
    cell: iso.cell,
    origin: iso.origin,
    faceColors: iso.faceColors,
  });

  /** İzometrik bir eylem başlamadan önce ızgaranın görünür olmasını sağlar. */
  const ensureGridVisible = () => {
    if (!editorStore.getState().iso.enabled) editorStore.setIso({ enabled: true });
  };

  /** Seçili şekillerin sınır kenarlarını izometrik derinlik yönünde süpürür. */
  const extrude = (depthCells: number) => {
    if (!selectedIds.size) {
      editorStore.setStatus('Extrude için bir şekil seçin');
      return;
    }
    ensureGridVisible();
    const offset = isoDepthOffset(depthCells, iso.cell);
    const extras: ArtboardObject[] = [];

    editorStore.commit('Extrude', (s) => {
      const objects = s.objects.map((obj) => {
        if (!selectedIds.has(obj.id)) return obj;
        const band = extrudeGeometry(obj.geometry, offset.x, offset.y);
        if (band.kind !== 'polygon' || band.keypoints.length < 3) return obj;
        const face = obj.isoFace;
        extras.push({
          ...obj,
          id: newId('depth'),
          name: `${obj.name} · Depth`,
          geometry: band,
          fill: { type: 'solid', color: face ? iso.faceColors[face] : fallbackColor(obj) },
          stroke: 'none',
          strokeWidth: 0,
        });
        return obj;
      });
      return { objects: [...objects, ...extras] };
    });

    editorStore.setStatus(
      extras.length ? `Extrude: ${extras.length} yanal yüzey eklendi` : 'Extrude uygulanamadı (şekil çok küçük)',
    );
  };

  /** Seçili şekilleri aktif küp yüzüne yansıtır (perspektif oturtma). */
  const projectToFace = () => {
    if (!selectedIds.size) {
      editorStore.setStatus('Yüzeye oturtmak için bir şekil seçin');
      return;
    }
    ensureGridVisible();
    const cube = currentCube();
    const face = state.activeFace;
    const color = iso.faceColors[face];
    editorStore.updateObjects(
      (obj) =>
        selectedIds.has(obj.id)
          ? {
              ...obj,
              geometry: projectGeometryToFace(obj.geometry, face, cube),
              isoFace: face,
              fill: { type: 'solid' as const, color },
            }
          : obj,
      'Yüzeye oturt',
      state.selection,
    );
    editorStore.setStatus(`${selectedIds.size} şekil ${FACE_LABELS[face]} yüzüne oturtuldu`);
  };

  return (
    <>
      <Panel title="Isometric Grid">
        <Toggle
          label="İzometrik ızgarayı göster"
          checked={iso.enabled}
          onChange={(v) => editorStore.setIso({ enabled: v })}
        />
        <NumberField
          label="Hücre"
          value={iso.cell}
          min={4}
          max={400}
          step={1}
          onChange={(v) => editorStore.setIso({ cell: v })}
        />
        <SliderField
          label="Opaklık"
          value={iso.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => editorStore.setIso({ opacity: v })}
        />
        <Toggle
          label="Dikey çizgiler"
          checked={iso.showVerticals}
          onChange={(v) => editorStore.setIso({ showVerticals: v })}
        />
        <Toggle
          label="Isometric Snap (latis)"
          checked={iso.snap}
          onChange={(v) => editorStore.setIso({ snap: v })}
        />
        <Toggle
          label="Eksen kilidi (Shift)"
          checked={iso.axisLock}
          onChange={(v) => editorStore.setIso({ axisLock: v })}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              editorStore.setIso({ origin: { x: state.doc.artboardSize / 2, y: state.doc.artboardSize / 2 } });
              editorStore.setStatus('Izgara artboard merkezine alındı');
            }}
          >
            Izgarayı merkeze al
          </button>
        </div>
      </Panel>

      <Panel title="Cube Construction" defaultOpen={false}>
        <NumberField
          label="Kenar (hücre)"
          value={iso.cubeEdgeCells}
          min={1}
          max={60}
          step={1}
          onChange={(v) => editorStore.setIso({ cubeEdgeCells: Math.max(1, Math.round(v)) })}
        />
        <NumberField
          label="Yükseklik (hücre)"
          value={iso.cubeHeightCells}
          min={1}
          max={60}
          step={1}
          onChange={(v) => editorStore.setIso({ cubeHeightCells: Math.max(1, Math.round(v)) })}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              ensureGridVisible();
              insertCube(currentCube(), state.activeLayerIndex, state.doc.artboardSize);
            }}
          >
            Küp ekle (3 yüz)
          </button>
        </div>
        <p className="dialog__hint">
          <b>I</b> tuşuyla <i>Isometric Cube</i> aracını seçip tuvale sürükleyerek de küp çizebilirsiniz.
        </p>
      </Panel>

      <Panel title="Extrude / Depth" defaultOpen={false}>
        <div className="btn-row">
          {[2, 4, 6, 8].map((d) => (
            <button key={d} type="button" className="btn" onClick={() => extrude(d)}>
              +{d} hücre
            </button>
          ))}
        </div>
        <p className="dialog__hint">
          Seçili şekillerin sınır kenarlarını izometrik derinlik yönünde (–z, ekranda aşağı) süpürüp yanal yüzeyi
          üretir. Sonuç gerçek vektör geometridir.
        </p>
      </Panel>

      <Panel title="Face Selection" defaultOpen={false}>
        <div className="pf-ops">
          {ISO_FACES.map((face) => (
            <button
              key={face}
              type="button"
              className={state.activeFace === face ? 'btn btn--primary' : 'btn'}
              onClick={() => editorStore.setActiveFace(face)}
            >
              {FACE_LABELS[face]}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => editorStore.selectFace(state.activeFace)}>
            Aktif yüzdeki objeleri seç
          </button>
          <button type="button" className="btn" onClick={() => editorStore.assignFaceToSelection(state.activeFace)}>
            Seçimi bu yüze ata
          </button>
          <button type="button" className="btn" onClick={projectToFace}>
            Seçimi yüzeye oturt
          </button>
        </div>
        <p className="dialog__hint">
          Yüz ataması objeye <code>isoFace</code> etiketi verir; yüz rengi değiştiğinde o yüzeydeki tüm objeler
          birlikte renklenir.
        </p>
      </Panel>

      <Panel title="Face Coloring" defaultOpen={false}>
        {ISO_FACES.map((face) => (
          <ColorField
            key={face}
            label={FACE_LABELS[face]}
            value={iso.faceColors[face]}
            onChange={(c) => editorStore.colorFace(face, c)}
          />
        ))}
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              editorStore.setIso({ faceColors: { top: '#1a1a1a', right: '#4d4d4d', left: '#848484' } });
              editorStore.setStatus('Yüz renkleri sıfırlandı');
            }}
          >
            Renkleri sıfırla
          </button>
        </div>
        <p className="dialog__hint">Birleştirmek için Pathfinder panelindeki Unite işlemini kullanın.</p>
      </Panel>
    </>
  );
}
