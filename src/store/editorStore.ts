import { useSyncExternalStore } from 'react';
import type {
  ArtboardObject,
  Camera,
  DocumentSettings,
  GridSettings,
  IsoFace,
  IsoSettings,
  LayerInfo,
  PenAnchor,
  ToolId,
  ViewMode,
} from '../core/types.ts';
import { ARTBOARD_SIZE } from '../core/types.ts';
import { syncObjectBox } from '../core/nodes.ts';
import { translateGeometry } from '../core/geometry.ts';
import { DEFAULT_ISO } from '../core/isometric.ts';

export type { PenAnchor };

// ------------------------------------------------------------------ durum

export interface SnapVisual {
  guides: { x1: number; y1: number; x2: number; y2: number }[];
  labels: { x: number; y: number; text: string }[];
}

export interface EditorState {
  objects: ArtboardObject[];
  layers: LayerInfo[];
  activeLayerIndex: number;
  selection: string[];
  selectedNodes: string[];
  tool: ToolId;
  camera: Camera;
  grid: GridSettings;
  /** İzometrik çalışma modu (3 yönlü ızgara + küp). */
  iso: IsoSettings;
  /** Yeni çizilen / renklendirilen yüz. */
  activeFace: IsoFace;
  doc: DocumentSettings;
  viewMode: ViewMode;
  snap: SnapVisual;
  /** Pen tool ile devam eden path. */
  penDraft: PenAnchor[] | null;
  /** Shape Builder için seçilmiş bölgeler. */
  shapeBuilderRegions: string[];
  canUndo: boolean;
  canRedo: boolean;
  historyLabel: string;
  statusMessage: string;
}

interface Snapshot {
  objects: ArtboardObject[];
  layers: LayerInfo[];
  doc: DocumentSettings;
  selection: string[];
}

const MAX_HISTORY = 120;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultLayers(): LayerInfo[] {
  return [
    { id: 'layer-guides', name: 'Guides', visible: true, locked: false, order: 0 },
    { id: 'layer-artwork', name: 'Artwork', visible: true, locked: false, order: 1 },
  ];
}

function initialState(): EditorState {
  return {
    objects: [],
    layers: defaultLayers(),
    activeLayerIndex: 1,
    selection: [],
    selectedNodes: [],
    tool: 'select',
    camera: { zoom: 0.78, pan: { x: 0, y: 0 } },
    grid: {
      enabled: true,
      snap: true,
      size: 50,
      divisions: 2,
      opacity: 0.55,
      majorEvery: 4,
    },
    iso: { ...DEFAULT_ISO, faceColors: { ...DEFAULT_ISO.faceColors } },
    activeFace: 'top',
    doc: {
      artboardSize: ARTBOARD_SIZE,
      background: '#ffffff',
      outlineMode: false,
      showGuides: true,
      showAnchors: true,
      showSmartGuides: true,
    },
    viewMode: 'construction',
    snap: { guides: [], labels: [] },
    penDraft: null,
    shapeBuilderRegions: [],
    canUndo: false,
    canRedo: false,
    historyLabel: '',
    statusMessage: '',
  };
}

// ------------------------------------------------------------------ store

class EditorStore {
  private state: EditorState = initialState();
  private listeners = new Set<() => void>();
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private txSnapshot: Snapshot | null = null;
  private idCounter = 0;
  /** Sürükleme sırasında rAF ile birleştirilmiş bildirim (spesifikasyon 32). */
  private pendingFrame: number | null = null;

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Anında bildirim (yapısal değişiklikler: araç, seçim, grid…). */
  private flush(): void {
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.state = { ...this.state };
    this.emit();
  }

  /** Sürükleme sırasında frame başına en fazla bir bildirim. */
  private schedule(): void {
    if (this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.state = { ...this.state };
      this.emit();
    });
  }

  private set(patch: Partial<EditorState>, live = false): void {
    this.state = { ...this.state, ...patch };
    if (live) this.schedule();
    else this.flush();
  }

  // ------------------------------------------------------------- history

  private snapshot(): Snapshot {
    return {
      objects: clone(this.state.objects),
      layers: clone(this.state.layers),
      doc: clone(this.state.doc),
      selection: [...this.state.selection],
    };
  }

  private restore(snap: Snapshot): void {
    this.state = {
      ...this.state,
      objects: clone(snap.objects),
      layers: clone(snap.layers),
      doc: clone(snap.doc),
      selection: [...snap.selection],
      selectedNodes: [],
    };
    this.syncFlags();
    this.flush();
  }

  private syncFlags(): void {
    this.state.canUndo = this.past.length > 0;
    this.state.canRedo = this.future.length > 0;
  }

  private pushHistory(label: string, prev: Snapshot): void {
    this.past.push(prev);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.state.historyLabel = label;
    this.syncFlags();
  }

  /** Geri alınabilir bir işlem uygular. */
  commit(label: string, mutator: (state: EditorState) => Partial<EditorState> | void): void {
    const prev = this.snapshot();
    const patch = mutator(this.state) ?? {};
    this.state = { ...this.state, ...patch };
    this.pushHistory(label, prev);
    this.flush();
  }

  /** Sürükleme başlangıcı: mevcut durumu saklar, history henüz yazılmaz. */
  beginTransaction(): void {
    if (this.txSnapshot) return;
    this.txSnapshot = this.snapshot();
  }

  /** Sürükleme sırasında geçici güncelleme (history'siz, frame başına 1 render). */
  applyLive(patch: Partial<EditorState>): void {
    this.set(patch, true);
  }

  /** Sürükleme sonu: başlangıç durumu history'ye yazılır. */
  endTransaction(label: string): void {
    const snap = this.txSnapshot;
    this.txSnapshot = null;
    if (!snap) return;
    this.past.push(snap);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.state.historyLabel = label;
    this.syncFlags();
    this.flush();
  }

  cancelTransaction(): void {
    const snap = this.txSnapshot;
    this.txSnapshot = null;
    if (snap) this.restore(snap);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restore(next);
  }

  // --------------------------------------------------------------- id

  nextId(prefix = 'obj'): string {
    this.idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.idCounter}`;
  }

  // -------------------------------------------------------- basit setter'lar

  setTool(tool: ToolId): void {
    // İzometrik küp aracı latis olmadan kullanılamaz; seçilince ızgarayı aç.
    const iso = tool === 'iso-cube' && !this.state.iso.enabled ? { ...this.state.iso, enabled: true } : this.state.iso;
    this.set({ tool, iso, penDraft: tool === 'pen' ? this.state.penDraft : null, shapeBuilderRegions: [] });
  }

  setCamera(camera: Camera, live = false): void {
    this.set({ camera }, live);
  }

  setGrid(patch: Partial<GridSettings>): void {
    this.commit('Grid ayarları', (s) => ({ grid: { ...s.grid, ...patch } }));
  }

  setGridLive(patch: Partial<GridSettings>): void {
    this.applyLive({ grid: { ...this.state.grid, ...patch } });
  }

  setDoc(patch: Partial<DocumentSettings>): void {
    this.commit('Görünüm ayarları', (s) => ({ doc: { ...s.doc, ...patch } }));
  }

  // ----------------------------------------------------------- izometrik

  setIso(patch: Partial<IsoSettings>, live = false): void {
    const next = { ...this.state.iso, ...patch, faceColors: { ...this.state.iso.faceColors, ...patch.faceColors } };
    if (live) this.applyLive({ iso: next });
    else this.commit('İzometrik ayarlar', () => ({ iso: next }));
  }

  setActiveFace(face: IsoFace): void {
    this.set({ activeFace: face });
  }

  /** Bir yüzdeki tüm objeleri verilen renge boyar. */
  colorFace(face: IsoFace, color: string): void {
    const next = { ...this.state.iso, faceColors: { ...this.state.iso.faceColors, [face]: color } };
    this.commit(`${face} yüzü rengi`, (s) => ({
      iso: next,
      objects: s.objects.map((o) =>
        o.isoFace === face ? { ...o, fill: { type: 'solid' as const, color } } : o,
      ),
    }));
  }

  /** Seçili objeleri verilen yüzle etiketler ve yüz rengiyle boyar. */
  assignFaceToSelection(face: IsoFace): void {
    const color = this.state.iso.faceColors[face];
    const ids = new Set(this.state.selection);
    this.commit(`${face} yüzüne ata`, (s) => ({
      objects: s.objects.map((o) =>
        ids.has(o.id) ? { ...o, isoFace: face, fill: { type: 'solid' as const, color } } : o,
      ),
    }));
  }

  /** Verilen yüzdeki tüm objeleri seçer (Face Selection). */
  selectFace(face: IsoFace): void {
    this.set({
      activeFace: face,
      selection: this.state.objects.filter((o) => o.isoFace === face && !o.locked).map((o) => o.id),
      selectedNodes: [],
    });
  }

  setSelection(ids: string[]): void {
    this.set({ selection: ids, selectedNodes: [] });
  }

  setActiveLayerIndex(index: number): void {
    this.set({ activeLayerIndex: Math.max(0, Math.min(this.state.layers.length - 1, index)) });
  }

  setSelectedNodes(keys: string[]): void {
    this.set({ selectedNodes: keys });
  }

  setViewMode(mode: ViewMode): void {
    this.set({ viewMode: mode });
  }

  setStatus(message: string): void {
    this.set({ statusMessage: message });
  }

  setSnap(snap: SnapVisual, live = true): void {
    this.set({ snap }, live);
  }

  clearSnap(): void {
    if (this.state.snap.guides.length || this.state.snap.labels.length) {
      this.set({ snap: { guides: [], labels: [] } });
    }
  }

  setPenDraft(points: PenAnchor[] | null): void {
    this.set({ penDraft: points });
  }

  // --------------------------------------------------------- doküman işlemleri

  addObjects(objects: ArtboardObject[], label = 'Nesne ekle'): void {
    this.commit(label, (s) => {
      const withBox = objects.map((o) => ({ ...o, ...syncObjectBox(o.geometry) }));
      return { objects: [...s.objects, ...withBox], selection: objects.map((o) => o.id) };
    });
  }

  updateObject(id: string, mutator: (o: ArtboardObject) => ArtboardObject, label = 'Nesne güncelle'): void {
    this.commit(label, (s) => ({
      objects: s.objects.map((o) => (o.id === id ? withSyncedBox(mutator(o)) : o)),
    }));
  }

  updateObjects(
    mutator: (o: ArtboardObject) => ArtboardObject,
    label = 'Nesneleri güncelle',
    ids?: string[],
  ): void {
    const target = ids ? new Set(ids) : null;
    this.commit(label, (s) => ({
      objects: s.objects.map((o) => (!target || target.has(o.id) ? withSyncedBox(mutator(o)) : o)),
    }));
  }

  /** Sürükleme sırasında kullanılan history'siz güncelleme. */
  updateObjectsLive(mutator: (o: ArtboardObject) => ArtboardObject, ids?: string[]): void {
    const target = ids ? new Set(ids) : null;
    this.applyLive({
      objects: this.state.objects.map((o) => (!target || target.has(o.id) ? withSyncedBox(mutator(o)) : o)),
    });
  }

  replaceGeometry(id: string, geometry: ArtboardObject['geometry'], label: string, name?: string, type?: ArtboardObject['type']): void {
    this.commit(label, (s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? withSyncedBox({
              ...o,
              geometry,
              name: name ?? o.name,
              type: type ?? o.type,
              opLabel: label,
              sizing: 'stretch',
            })
          : o,
      ),
    }));
  }

  deleteSelection(label = 'Sil'): void {
    const ids = this.state.selection;
    if (!ids.length) return;
    this.commit(label, (s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selection: [],
      selectedNodes: [],
    }));
  }

  duplicateSelection(): string[] {
    const ids = this.state.selection;
    if (!ids.length) return [];
    const created: ArtboardObject[] = [];
    this.commit('Çoğalt', (s) => {
      for (const id of ids) {
        const src = s.objects.find((o) => o.id === id);
        if (!src) continue;
        const copy = structuredClone(src);
        copy.id = this.nextId();
        copy.name = `${src.name} copy`;
        copy.geometry = translateGeometryBy(copy.geometry, 25, 25);
        created.push(copy);
      }
      return {
        objects: [...s.objects, ...created.map((o) => withSyncedBox(o))],
        selection: created.map((o) => o.id),
      };
    });
    return created.map((o) => o.id);
  }

  // --------------------------------------------------------------- layers

  addLayer(name: string): number {
    let index = 0;
    this.commit('Katman ekle', (s) => {
      index = s.layers.length;
      const ordered = s.layers.map((l, i) => ({ ...l, order: i }));
      return {
        layers: [...ordered, { id: this.nextId('layer'), name, visible: true, locked: false, order: index }],
        activeLayerIndex: index,
      };
    });
    return index;
  }

  updateLayer(index: number, patch: Partial<LayerInfo>, label = 'Katman güncelle'): void {
    this.commit(label, (s) => ({
      layers: s.layers.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  }

  removeLayer(index: number): void {
    if (this.state.layers.length <= 1) return;
    this.commit('Katman sil', (s) => {
      const layers = s.layers.filter((_, i) => i !== index).map((l, i) => ({ ...l, order: i }));
      const objects = s.objects
        .filter((o) => o.layerIndex !== index)
        .map((o) => ({ ...o, layerIndex: o.layerIndex > index ? o.layerIndex - 1 : o.layerIndex }));
      return { layers, objects, activeLayerIndex: Math.max(0, Math.min(index, layers.length - 1)) };
    });
  }

  /** Katman sırasını değiştirir (drag & drop). */
  moveLayer(from: number, to: number): void {
    if (from === to) return;
    this.commit('Katman sırası', (s) => {
      const layers = [...s.layers];
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved);
      const remap = new Map<number, number>();
      s.layers.forEach((_, oldIndex) => {
        remap.set(oldIndex, layers.findIndex((l) => l.id === s.layers[oldIndex].id));
      });
      return {
        layers: layers.map((l, i) => ({ ...l, order: i })),
        objects: s.objects.map((o) => ({ ...o, layerIndex: remap.get(o.layerIndex) ?? o.layerIndex })),
      };
    });
  }

  /** Obje z-sırasını katman içinde değiştirir. */
  moveObjectOrder(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): void {
    this.commit('Sıralama', (s) => {
      const index = s.objects.findIndex((o) => o.id === id);
      if (index === -1) return {};
      const objects = [...s.objects];
      const [obj] = objects.splice(index, 1);
      let target = index;
      if (direction === 'up') target = Math.min(objects.length, index + 1);
      if (direction === 'down') target = Math.max(0, index - 1);
      if (direction === 'top') target = objects.length;
      if (direction === 'bottom') target = 0;
      objects.splice(target, 0, obj);
      return { objects };
    });
  }

  // ------------------------------------------------------------ doküman yükleme

  loadDocument(payload: {
    objects: ArtboardObject[];
    layers: LayerInfo[];
    doc?: DocumentSettings;
    grid?: GridSettings;
    iso?: IsoSettings;
  }): void {
    const prev = this.snapshot();
    this.state = {
      ...this.state,
      objects: clone(payload.objects),
      layers: payload.layers.length ? clone(payload.layers) : defaultLayers(),
      doc: payload.doc ? clone(payload.doc) : this.state.doc,
      grid: payload.grid ? clone(payload.grid) : this.state.grid,
      iso: payload.iso ? clone(payload.iso) : this.state.iso,
      selection: [],
      selectedNodes: [],
      penDraft: null,
    };
    this.pushHistory('Proje yükle', prev);
    this.flush();
  }

  resetDocument(keepGrid = true): void {
    const prev = this.snapshot();
    const fresh = initialState();
    this.state = {
      ...this.state,
      objects: [],
      layers: defaultLayers(),
      activeLayerIndex: 1,
      selection: [],
      selectedNodes: [],
      doc: fresh.doc,
      grid: keepGrid ? this.state.grid : fresh.grid,
      penDraft: null,
      viewMode: 'construction',
    };
    this.pushHistory('Yeni proje', prev);
    this.flush();
  }
}

function withSyncedBox(o: ArtboardObject): ArtboardObject {
  const box = syncObjectBox(o.geometry);
  return { ...o, ...box };
}

function translateGeometryBy(
  geometry: ArtboardObject['geometry'],
  dx: number,
  dy: number,
): ArtboardObject['geometry'] {
  return translateGeometry(geometry, dx, dy);
}

export const editorStore = new EditorStore();

export function useEditorState(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState);
}

/** Sadece belirli bir dilimi dinleyen hook — gereksiz render'ları önler. */
export function useEditorSelector<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    editorStore.subscribe,
    () => selector(editorStore.getState()),
    () => selector(editorStore.getState()),
  );
}

export { ARTBOARD_SIZE };
