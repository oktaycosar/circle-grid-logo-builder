import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ArtboardObject, PenAnchor, Rect, Vec2 } from '../core/types.ts';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { ObjectRenderer, sortByRenderOrder } from './ObjectRenderer.tsx';
import { GridOverlay } from './GridOverlay.tsx';
import { IsoGridOverlay } from './IsoGridOverlay.tsx';
import {
  AnchorOverlay,
  DrawPreview,
  GuideOverlay,
  IsoCubePreview,
  MarqueeOverlay,
  PenOverlay,
  SelectionOverlay,
  ShapeBuilderOverlay,
  SnapOverlay,
  TransformHandles,
  screenToWorldSvg,
  worldToScreen,
  type HandleId,
  type ScreenTransform,
} from './overlays.tsx';
import { bboxProbes, objectPointToWorld, resolveSnap, snapRect, type SnapContext } from '../core/snap.ts';
import {
  geometryBounds,
  geometryRotatedCorners,
  remapGeometry,
  translateGeometry,
} from '../core/geometry.ts';
import {
  geometryEditableLoops,
  insertKeypoint,
  moveKeypoint,
  parseNodeKey,
  syncObjectBox,
  type NodeRef,
} from '../core/nodes.ts';
import { makeCircle, makeEllipse, makeLine, makeRect, makeRing, makePolygon } from '../core/factory.ts';
import { penAnchorsToSubPaths, penPreviewPathData } from '../core/pen.ts';
import { computeShapeRegions, buildShapeFromRegions, trimSelectionWithLine, type ShapeRegion } from '../core/operations.ts';
import { importSvg } from '../core/svgImport.ts';
import { rectOfPoints } from '../core/matrix.ts';
import {
  buildIsoCube,
  isoSnapPoint,
  isoUnproject,
  isoLockedSegment,
  type IsoCube,
} from '../core/isometric.ts';

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startScreen: Vec2; startPan: Vec2 }
  | { kind: 'marquee'; start: Vec2; additive: boolean; base: string[] }
  | {
      kind: 'move';
      startWorld: Vec2;
      probes: Vec2[];
      ids: string[];
      originals: ArtboardObject[];
      moved: boolean;
      duplicated: boolean;
    }
  | {
      kind: 'resize';
      handle: HandleId;
      startBox: Rect;
      originals: ArtboardObject[];
      ids: string[];
      startWorld: Vec2;
    }
  | {
      kind: 'rotate';
      center: Vec2;
      startAngle: number;
      originals: ArtboardObject[];
      ids: string[];
    }
  | { kind: 'draw'; tool: DrawTool; start: Vec2; current: Vec2 }
  | { kind: 'node'; refs: NodeRef[]; originals: ArtboardObject[]; startWorld: Vec2 }
  | { kind: 'penHandle'; index: number }
  | { kind: 'isoCube'; start: Vec2; current: Vec2 }
  | { kind: 'knife'; start: Vec2; current: Vec2 };

type DrawTool = 'rectangle' | 'circle' | 'ring' | 'ellipse' | 'line';

const DRAW_TOOLS: DrawTool[] = ['rectangle', 'circle', 'ring', 'ellipse', 'line'];

function isDrawTool(tool: string): tool is DrawTool {
  return (DRAW_TOOLS as string[]).includes(tool);
}

export interface CanvasWorkspaceProps {
  onStatus: (message: string) => void;
}

export function CanvasWorkspace({ onStatus }: CanvasWorkspaceProps) {
  const state = useEditorState();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drawPreview, setDrawPreview] = useState<{ tool: DrawTool | 'knife'; from: Vec2; to: Vec2 } | null>(null);
  const [isoPreview, setIsoPreview] = useState<IsoCube | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [cursorWorld, setCursorWorld] = useState<Vec2 | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [shapeRegions, setShapeRegions] = useState<ShapeRegion[]>([]);
  const [hoverRegion, setHoverRegion] = useState<string | null>(null);
  const [pickedRegions, setPickedRegions] = useState<string[]>([]);

  const camera = state.camera;
  const transform: ScreenTransform = useMemo(() => ({ zoom: camera.zoom, pan: camera.pan }), [camera.zoom, camera.pan]);

  const toWorld = useCallback(
    (screen: Vec2): Vec2 => screenToWorldSvg(screen, { zoom: camera.zoom, pan: camera.pan }),
    [camera.zoom, camera.pan],
  );
  const toScreen = useCallback(
    (world: Vec2): Vec2 => worldToScreen(world, { zoom: camera.zoom, pan: camera.pan }),
    [camera.zoom, camera.pan],
  );

  const localPoint = useCallback((e: { clientX: number; clientY: number }): Vec2 => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const worldPoint = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => toWorld(localPoint(e)),
    [localPoint, toWorld],
  );

  // ------------------------------------------------------------- boyutlandırma

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitToArtboard = useCallback(() => {
    if (!size.width || !size.height) return;
    const artboard = editorStore.getState().doc.artboardSize;
    const zoom = Math.min(size.width, size.height) * 0.88 / artboard;
    editorStore.setCamera({
      zoom,
      pan: { x: (size.width - artboard * zoom) / 2, y: (size.height - artboard * zoom) / 2 },
    });
  }, [size.width, size.height]);

  useEffect(() => {
    if (!initialised && size.width > 0 && size.height > 0) {
      fitToArtboard();
      setInitialised(true);
    }
  }, [initialised, size, fitToArtboard]);

  // ------------------------------------------------------ yardımcı seçiciler

  const selectedObjects = useMemo(
    () => state.objects.filter((o) => state.selection.includes(o.id)),
    [state.objects, state.selection],
  );

  const selectedBox = useMemo<Rect | null>(() => {
    if (!selectedObjects.length) return null;
    const pts: Vec2[] = [];
    for (const o of selectedObjects) {
      pts.push(...geometryRotatedCorners(o.geometry, o.rotation));
    }
    return rectOfPoints(pts);
  }, [selectedObjects]);

  const snapContext = useCallback(
    (excludeIds: string[]): SnapContext => ({
      grid: editorStore.getState().grid,
      iso: editorStore.getState().iso,
      artboardSize: editorStore.getState().doc.artboardSize,
      objects: editorStore.getState().objects,
      excludeIds,
      screenTolerance: 8 / editorStore.getState().camera.zoom,
    }),
    [],
  );

  const hitObjectAt = useCallback((world: Vec2): ArtboardObject | null => {
    const list = sortByRenderOrder(editorStore.getState().objects);
    for (let i = list.length - 1; i >= 0; i--) {
      const obj = list[i];
      if (!obj.visible) continue;
      const local = worldToLocalPoint(obj, world);
      const loops = geometryEditableLoops(obj.geometry);
      for (const loop of loops) {
        if (pointInPolygonList(loop.points, local, loop.closed)) {
          if (obj.fill.type !== 'none' || obj.isGuide) return obj;
        }
      }
      // stroke toleransı
      const tol = Math.max(obj.strokeWidth, 8 / editorStore.getState().camera.zoom);
      for (const loop of loops) {
        if (distanceToLoop(loop.points, local, loop.closed) <= tol) return obj;
      }
    }
    return null;
  }, []);

  // --------------------------------------------------------------- pointer

  const beginPan = (e: React.PointerEvent) => {
    dragRef.current = { kind: 'pan', startScreen: localPoint(e), startPan: { ...camera.pan } };
  };

  /**
   * İzometrik latis içinde bir dünya noktasını (u,v) HÜCRE indeksine çevirir.
   *
   * `isoSnapPoint` ekran latis indeksleri (m, n) döndürür; bunlar (u,v) ile
   * m = u − v, n = u + v bağıntısıyla bağlıdır, dolayısıyla doğrudan
   * kullanılamaz.
   */
  const isoCellOf = (world: Vec2, iso: typeof state.iso): { u: number; v: number } => {
    const a = Math.max(2, iso.cell);
    if (iso.snap) {
      const snapped = isoSnapPoint(world, iso);
      return { u: snapped.u, v: snapped.v };
    }
    const raw = isoUnproject(world, iso.origin, 0);
    return { u: Math.round(raw.u / a), v: Math.round(raw.v / a) };
  };

  /**
   * Sürükleme ile tanımlanan küpü üretir. Başlangıç noktası küpün yakın
   * köşesi, sürükleme miktarı ise kenar uzunluğudur.
   */
  const isoCubeFromDrag = (start: Vec2, current: Vec2, iso: typeof state.iso): IsoCube => {
    const a = isoCellOf(start, iso);
    const b = isoCellOf(current, iso);
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const edge = Math.max(1, Math.max(Math.abs(du), Math.abs(dv)));
    return {
      u: du >= 0 ? a.u : a.u - edge,
      v: dv >= 0 ? a.v : a.v - edge,
      edge,
      height: Math.max(1, Math.round(iso.cubeHeightCells)),
      cell: iso.cell,
      origin: iso.origin,
      faceColors: iso.faceColors,
    };
  };

  const zoomAt = (factor: number, screen: Vec2) => {
    const next = Math.min(64, Math.max(0.02, camera.zoom * factor));
    const world = toWorld(screen);
    editorStore.setCamera({
      zoom: next,
      pan: { x: screen.x - world.x * next, y: screen.y - world.y * next },
    });
  };

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const screen = localPoint(e);
    const world = toWorld(screen);

    // Space veya orta tuş veya Hand tool → pan
    if (spaceDown || e.button === 1 || state.tool === 'hand') {
      beginPan(e);
      return;
    }

    if (state.tool === 'zoom') {
      zoomAt(e.altKey ? 1 / 1.4 : 1.4, screen);
      return;
    }

    if (state.tool === 'pen') {
      handlePenPointerDown(world, e);
      return;
    }

    if (state.tool === 'knife') {
      dragRef.current = { kind: 'knife', start: world, current: world };
      setDrawPreview({ tool: 'knife', from: world, to: world });
      return;
    }

    if (state.tool === 'iso-cube') {
      const anchor = state.iso.snap ? isoSnapPoint(world, state.iso).point : world;
      dragRef.current = { kind: 'isoCube', start: anchor, current: anchor };
      setIsoPreview(isoCubeFromDrag(anchor, anchor, state.iso));
      return;
    }

    if (isDrawTool(state.tool)) {
      const start = state.iso.enabled && state.iso.snap ? isoSnapPoint(world, state.iso).point : snapRect(world, state.grid);
      dragRef.current = { kind: 'draw', tool: state.tool, start, current: start };
      setDrawPreview({ tool: state.tool, from: start, to: start });
      return;
    }

    if (state.tool === 'shape-builder') return;

    if (state.tool === 'direct-select') {
      const hit = hitObjectAt(world);
      if (hit) {
        if (!state.selection.includes(hit.id)) editorStore.setSelection([hit.id]);
        return;
      }
    }

    // Select tool: boşluğa tıklama → marquee
    dragRef.current = {
      kind: 'marquee',
      start: world,
      additive: e.shiftKey,
      base: e.shiftKey ? [...state.selection] : [],
    };
    if (!e.shiftKey) editorStore.setSelection([]);
  };

  const onObjectPointerDown = (e: React.PointerEvent<SVGGElement>, object: ArtboardObject) => {
    if (e.button === 2) return;
    if (spaceDown || state.tool === 'hand') return;
    e.stopPropagation();
    (svgRef.current as Element)?.setPointerCapture?.(e.pointerId);

    const world = toWorld(localPoint(e));

    if (state.tool === 'direct-select') {
      if (!state.selection.includes(object.id)) editorStore.setSelection([object.id]);
      return;
    }

    if (state.tool === 'shape-builder') return;
    if (isDrawTool(state.tool) || state.tool === 'pen' || state.tool === 'knife') return;

    if (object.locked) {
      onStatus(`"${object.name}" kilitli. Katmanlar panelinden kilidi açın.`);
      return;
    }

    let ids = state.selection;
    if (e.shiftKey) {
      ids = ids.includes(object.id) ? ids.filter((id) => id !== object.id) : [...ids, object.id];
      editorStore.setSelection(ids);
    } else if (!ids.includes(object.id)) {
      ids = [object.id];
      editorStore.setSelection(ids);
    }

    startMoveDrag(world, ids, e.altKey);
  };

  const startMoveDrag = (world: Vec2, ids: string[], altDuplicate: boolean) => {
    let activeIds = ids;
    if (altDuplicate) {
      const created = editorStore.duplicateSelection();
      if (created.length) {
        activeIds = created;
        onStatus('Alt+drag: nesne çoğaltıldı.');
      }
    }
    const originals = editorStore
      .getState()
      .objects.filter((o) => activeIds.includes(o.id))
      .map((o) => structuredClone(o));

    const probes: Vec2[] = [];
    for (const o of originals) {
      probes.push(...bboxProbes({ x: o.x, y: o.y, width: o.width, height: o.height }, o.rotation));
    }
    if (!probes.length) probes.push(world);

    editorStore.beginTransaction();
    dragRef.current = {
      kind: 'move',
      startWorld: world,
      probes,
      ids: activeIds,
      originals,
      moved: false,
      duplicated: altDuplicate,
    };
  };

  const onHandlePointerDown = (e: React.PointerEvent, handle: HandleId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (svgRef.current as Element)?.setPointerCapture?.(e.pointerId);
    if (!selectedBox) return;

    const ids = [...state.selection];
    const originals = state.objects.filter((o) => ids.includes(o.id)).map((o) => structuredClone(o));
    editorStore.beginTransaction();

    if (handle === 'rot') {
      const center = { x: selectedBox.x + selectedBox.width / 2, y: selectedBox.y + selectedBox.height / 2 };
      const world = worldPoint(e);
      dragRef.current = {
        kind: 'rotate',
        center,
        startAngle: Math.atan2(world.y - center.y, world.x - center.x),
        originals,
        ids,
      };
      return;
    }

    dragRef.current = {
      kind: 'resize',
      handle,
      startBox: selectedBox,
      originals,
      ids,
      startWorld: worldPoint(e),
    };
  };

  const onAnchorPointerDown = (e: React.PointerEvent, ref: NodeRef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (svgRef.current as Element)?.setPointerCapture?.(e.pointerId);

    const key = `${ref.objectId}:${ref.loop}:${ref.index}`;
    const already = state.selectedNodes.includes(key);
    const next = e.shiftKey
      ? already
        ? state.selectedNodes.filter((k) => k !== key)
        : [...state.selectedNodes, key]
      : [key];
    editorStore.setSelectedNodes(next);

    const originals = state.objects.map((o) => structuredClone(o));
    editorStore.beginTransaction();
    dragRef.current = {
      kind: 'node',
      refs: next.map(parseNodeKey).filter((r): r is NodeRef => Boolean(r)),
      originals,
      startWorld: worldPoint(e),
    };
  };

  const onSegmentDoubleClick = (objectId: string, loop: number, segment: number, point: Vec2) => {
    const obj = editorStore.getState().objects.find((o) => o.id === objectId);
    if (!obj) return;
    if (obj.geometry.kind !== 'polygon' && obj.geometry.kind !== 'path') {
      onStatus('Nokta ekleme yalnızca path/polygon nesnelerinde yapılabilir.');
      return;
    }
    const t = 0.5;
    const geometry = insertKeypoint(obj.geometry, loop, segment, t);
    editorStore.commit('Nokta ekle', (s) => ({
      objects: s.objects.map((o) => (o.id === objectId ? withBox({ ...o, geometry }) : o)),
    }));
    onStatus(`Nokta eklendi: ${point.x.toFixed(1)}, ${point.y.toFixed(1)}`);
  };

  // ------------------------------------------------------------------ pen

  const finishPen = useCallback(
    (close: boolean) => {
      const draft = editorStore.getState().penDraft;
      if (!draft || draft.length < 2) {
        editorStore.setPenDraft(null);
        return;
      }
      const subpaths = penAnchorsToSubPaths(draft, close);
      if (!subpaths.length) {
        editorStore.setPenDraft(null);
        return;
      }
      const obj = makePolygon([], { name: 'Pen Path', layerIndex: editorStore.getState().activeLayerIndex });
      const geometry = { kind: 'path' as const, subpaths };
      const box = geometryBounds(geometry);
      const pathObj: ArtboardObject = {
        ...obj,
        type: 'path',
        geometry,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        fill: close ? { type: 'solid', color: '#000000' } : { type: 'none' },
        stroke: '#000000',
        strokeWidth: close ? 0 : 2,
      };
      editorStore.addObjects([pathObj], 'Pen path');
      editorStore.setPenDraft(null);
      setDrawPreview(null);
      onStatus(`Path oluşturuldu (${draft.length} anchor).`);
    },
    [onStatus],
  );

  const handlePenPointerDown = (world: Vec2, e: React.PointerEvent) => {
    const draft = editorStore.getState().penDraft ?? [];
    const snapped = snapRect(world, state.grid);

    if (draft.length >= 2) {
      const first = toScreen(draft[0].p);
      const screen = localPoint(e);
      if (Math.hypot(first.x - screen.x, first.y - screen.y) <= 10) {
        finishPen(true);
        return;
      }
    }

    const next: PenAnchor[] = [...draft, { p: snapped }];
    editorStore.setPenDraft(next);
    dragRef.current = { kind: 'penHandle', index: next.length - 1 };
    onStatus('Pen: tıklayarak nokta ekleyin, sürükleyerek eğri verin. Enter ile bitirin, Esc ile iptal.');
  };

  // -------------------------------------------------------------- pointer up

  const endDrag = useCallback(
    (world: Vec2, e: React.PointerEvent | null) => {
      const drag = dragRef.current;
      dragRef.current = { kind: 'none' };

      switch (drag.kind) {
        case 'pan':
          break;

        case 'marquee': {
          const rect = normRect(drag.start, world);
          const ids = editorStore
            .getState()
            .objects.filter((o) => o.visible !== false)
            .filter((o) => rectIntersectsRotated(o, rect))
            .map((o) => o.id);
          editorStore.setSelection(drag.additive ? Array.from(new Set([...drag.base, ...ids])) : ids);
          setMarquee(null);
          break;
        }

        case 'move': {
          if (!drag.moved) {
            editorStore.cancelTransaction();
            // Alt+drag ile çoğaltılıp hiç hareket edilmediyse kopyayı geri al
            if (drag.duplicated) editorStore.undo();
            editorStore.clearSnap();
          } else {
            editorStore.endTransaction('Taşı');
            editorStore.clearSnap();
          }
          break;
        }

        case 'resize':
          editorStore.endTransaction('Ölçekle');
          editorStore.clearSnap();
          break;

        case 'rotate':
          editorStore.endTransaction('Döndür');
          editorStore.clearSnap();
          break;

        case 'node':
          editorStore.endTransaction('Nokta düzenle');
          editorStore.clearSnap();
          break;

        case 'draw': {
          setDrawPreview(null);
          commitDraw(drag.tool, drag.start, world, e);
          break;
        }

        case 'isoCube': {
          setIsoPreview(null);
          const live = editorStore.getState().iso;
          const cube = isoCubeFromDrag(drag.start, drag.current, live);
          const objects = buildIsoCube(cube, editorStore.getState().activeLayerIndex);
          if (objects.length) {
            editorStore.addObjects(objects, 'İzometrik küp');
            editorStore.setStatus(`Küp eklendi: kenar ${cube.edge}, yükseklik ${cube.height} hücre`);
          }
          break;
        }

        case 'penHandle':
          break;

        case 'knife': {
          setDrawPreview(null);
          const len = Math.hypot(world.x - drag.start.x, world.y - drag.start.y);
          if (len < 3) {
            onStatus('Kesim çizgisi çok kısa.');
            break;
          }
          const result = trimSelectionWithLine(drag.start, world);
          onStatus(result.message);
          break;
        }

        default:
          break;
      }
    },
    [onStatus],
  );

  // isoCube sürüklemesi sırasında hesaplanan küp, endDrag içinde tekrar
  // üretilebilmesi için drag.current kullanır.

  const commitDraw = (tool: DrawTool, start: Vec2, endRaw: Vec2, e: React.PointerEvent | null) => {
    const shift = e?.shiftKey ?? false;
    const alt = e?.altKey ?? false;
    const layerIndex = editorStore.getState().activeLayerIndex;

    let box: Rect;
    if (shift) {
      const side = Math.max(Math.abs(endRaw.x - start.x), Math.abs(endRaw.y - start.y));
      const sx = endRaw.x < start.x ? -1 : 1;
      const sy = endRaw.y < start.y ? -1 : 1;
      box = normRect(start, { x: start.x + side * sx, y: start.y + side * sy });
    } else {
      box = normRect(start, endRaw);
    }

    if (alt) {
      // Merkez bazlı çizim
      const halfW = Math.abs(endRaw.x - start.x);
      const halfH = shift ? halfW : Math.abs(endRaw.y - start.y);
      box = { x: start.x - halfW, y: start.y - halfH, width: halfW * 2, height: halfH * 2 };
    }

    if (box.width < 1 && box.height < 1 && tool !== 'line') {
      onStatus('Şekil çok küçük.');
      return;
    }

    let object: ArtboardObject | null = null;
    switch (tool) {
      case 'rectangle': {
        const g = { kind: 'rect' as const, ...box };
        object = makeRect(box.x, box.y, box.width, box.height, { name: 'Rectangle', layerIndex });
        object.geometry = g;
        break;
      }
      case 'circle': {
        const r = Math.min(box.width, box.height) / 2;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        object = makeCircle(cx, cy, r, { name: 'Circle', layerIndex });
        break;
      }
      case 'ellipse': {
        object = makeEllipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, {
          name: 'Ellipse',
          layerIndex,
        });
        break;
      }
      case 'ring': {
        const r = Math.min(box.width, box.height) / 2;
        const thickness = snapMidThickness(r);
        object = makeRing(box.x + box.width / 2, box.y + box.height / 2, r, thickness, {
          name: 'Ring',
          layerIndex,
        });
        break;
      }
      case 'line': {
        object = makeLine(start.x, start.y, endRaw.x, endRaw.y, {
          name: 'Line',
          layerIndex,
          stroke: '#000000',
          strokeWidth: 4,
        });
        break;
      }
    }

    if (!object) return;
    if (shift && tool === 'circle') {
      onStatus('Shift: tam daire.');
    }
    editorStore.addObjects([withBox(object)], `${tool} oluştur`);
    onStatus(`${labelOf(tool)} oluşturuldu.`);
  };

  const snapMidThickness = (radius: number): number => {
    const target = Math.max(2, radius * 0.08);
    if (!state.grid.snap) return target;
    const step = state.grid.size / Math.max(1, state.grid.divisions);
    return Math.max(step / 2, Math.round(target / (step / 2)) * (step / 2));
  };

  // ------------------------------------------------------------- pointer move

  const onPointerMove = (e: React.PointerEvent) => {
    const screen = localPoint(e);
    const world = toWorld(screen);
    setCursorWorld(world);

    const drag = dragRef.current;

    switch (drag.kind) {
      case 'none':
        return;

      case 'pan': {
        editorStore.setCamera(
          { zoom: camera.zoom, pan: { x: drag.startPan.x + (screen.x - drag.startScreen.x), y: drag.startPan.y + (screen.y - drag.startScreen.y) } },
          true,
        );
        return;
      }

      case 'marquee': {
        setMarquee(normRect(drag.start, world));
        return;
      }

      case 'move': {
        const raw = { x: world.x - drag.startWorld.x, y: world.y - drag.startWorld.y };
        let delta = raw;
        if (state.doc.showSmartGuides && !e.ctrlKey) {
          const outcome = resolveSnap({ probes: drag.probes, delta: raw, context: snapContext(drag.ids) });
          delta = outcome.delta;
          editorStore.setSnap({ guides: outcome.result.guides, labels: outcome.result.labels });
        }
        drag.moved = drag.moved || Math.hypot(delta.x, delta.y) > 0.01;

        const originals = new Map(drag.originals.map((o) => [o.id, o]));
        editorStore.applyLive({
          objects: editorStore.getState().objects.map((o) => {
            const original = originals.get(o.id);
            if (!original) return o;
            const geometry = translateGeometry(original.geometry, delta.x, delta.y);
            return withBox({ ...original, geometry });
          }),
        });
        return;
      }

      case 'resize': {
        applyResize(drag, world, e);
        return;
      }

      case 'rotate': {
        const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
        let degrees = ((angle - drag.startAngle) * 180) / Math.PI;
        if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
        const originals = new Map(drag.originals.map((o) => [o.id, o]));
        editorStore.applyLive({
          objects: editorStore.getState().objects.map((o) => {
            const original = originals.get(o.id);
            if (!original) return o;
            return { ...original, rotation: normalizeAngle(original.rotation + degrees) };
          }),
        });
        return;
      }

      case 'node': {
        const raw = { x: world.x - drag.startWorld.x, y: world.y - drag.startWorld.y };
        let delta = raw;
        if (state.doc.showSmartGuides) {
          const movingIds = Array.from(new Set(drag.refs.map((r) => r.objectId)));
          const probes = drag.refs.map((ref) => {
            const obj = drag.originals.find((o) => o.id === ref.objectId);
            if (!obj) return world;
            const loops = geometryEditableLoops(obj.geometry);
            const p = loops[ref.loop]?.points[ref.index] ?? world;
            return objectPointToWorld(obj, p);
          });
          const outcome = resolveSnap({ probes, delta: raw, context: snapContext(movingIds) });
          delta = outcome.delta;
          editorStore.setSnap({ guides: outcome.result.guides, labels: outcome.result.labels });
        }

        const refsByObject = new Map<string, NodeRef[]>();
        for (const ref of drag.refs) {
          const list = refsByObject.get(ref.objectId) ?? [];
          list.push(ref);
          refsByObject.set(ref.objectId, list);
        }

        editorStore.applyLive({
          objects: editorStore.getState().objects.map((o) => {
            const refs = refsByObject.get(o.id);
            const original = drag.originals.find((x) => x.id === o.id);
            if (!refs || !original) return o;

            const cos = Math.cos((-original.rotation * Math.PI) / 180);
            const sin = Math.sin((-original.rotation * Math.PI) / 180);
            const ox = original.x + original.width / 2;
            const oy = original.y + original.height / 2;

            let geometry = original.geometry;
            const loops = geometryEditableLoops(original.geometry);
            for (const ref of refs) {
              const point = loops[ref.loop]?.points[ref.index];
              if (!point) continue;
              // Dünya uzayındaki hedefi objenin local uzayına çevir
              const targetWorld = { x: point.x + delta.x, y: point.y + delta.y };
              const local = original.rotation
                ? {
                    x: ox + (targetWorld.x - ox) * cos - (targetWorld.y - oy) * sin,
                    y: oy + (targetWorld.x - ox) * sin + (targetWorld.y - oy) * cos,
                  }
                : targetWorld;
              geometry = moveKeypoint(geometry, ref.index, local, ref.loop);
            }
            return withBox({ ...original, geometry });
          }),
        });
        return;
      }

      case 'draw': {
        let target = world;
        if (state.iso.enabled && state.iso.snap) {
          target = isoSnapPoint(world, state.iso).point;
        }
        // İzometrik eksen kilidi (Shift): çizgi yalnızca ±30° veya dikey gider.
        if (state.iso.enabled && state.iso.axisLock && e.shiftKey && drag.tool === 'line') {
          target = isoLockedSegment(drag.start, target);
        }
        const snapped = state.iso.enabled && state.iso.snap ? target : snapRect(target, state.grid);
        drag.current = snapped;
        setDrawPreview({ tool: drag.tool, from: drag.start, to: snapped });
        return;
      }

      case 'isoCube': {
        const anchor = state.iso.snap ? isoSnapPoint(world, state.iso).point : world;
        drag.current = anchor;
        setIsoPreview(isoCubeFromDrag(drag.start, anchor, state.iso));
        return;
      }

      case 'knife': {
        drag.current = world;
        setDrawPreview({ tool: 'knife', from: drag.start, to: world });
        return;
      }

      case 'penHandle': {
        const draft = editorStore.getState().penDraft;
        if (!draft) return;
        const next = draft.map((a, i) => (i === drag.index ? { ...a, h: world } : a));
        editorStore.setPenDraft(next);
        return;
      }

      default:
        return;
    }
  };

  const applyResize = (drag: Extract<DragState, { kind: 'resize' }>, world: Vec2, e: React.PointerEvent) => {
    const { startBox, handle, originals } = drag;

    // Snap: tutulan köşe grid/obje adaylarına oturur
    let target = world;
    if (state.doc.showSmartGuides && !e.ctrlKey) {
      const outcome = resolveSnap({ probes: [world], delta: { x: 0, y: 0 }, context: snapContext(drag.ids) });
      target = outcome.result.point;
      editorStore.setSnap({ guides: outcome.result.guides, labels: outcome.result.labels });
    }

    let box = { ...startBox };

    const setX = (value: number) => {
      if (handle.includes('w')) {
        const right = startBox.x + startBox.width;
        box.x = Math.min(value, right - 1);
        box.width = right - box.x;
      } else if (handle.includes('e')) {
        box.width = Math.max(1, value - startBox.x);
      }
    };
    const setY = (value: number) => {
      if (handle.includes('n')) {
        const bottom = startBox.y + startBox.height;
        box.y = Math.min(value, bottom - 1);
        box.height = bottom - box.y;
      } else if (handle.includes('s')) {
        box.height = Math.max(1, value - startBox.y);
      }
    };

    if (handle === 'n' || handle === 's') {
      setY(target.y);
    } else if (handle === 'e' || handle === 'w') {
      setX(target.x);
    } else {
      setX(target.x);
      setY(target.y);
    }

    const lockAspect = e.shiftKey && handle !== 'n' && handle !== 's' && handle !== 'e' && handle !== 'w';
    if (lockAspect && startBox.width > 0 && startBox.height > 0) {
      const aspect = startBox.width / startBox.height;
      if (handle.includes('w') || handle.includes('e')) box.height = box.width / aspect;
      else box.width = box.height * aspect;
      if (handle.includes('n')) box.y = startBox.y + startBox.height - box.height;
      if (handle.includes('w')) box.x = startBox.x + startBox.width - box.width;
    }

    // Alt: merkezden ölçekle
    if (e.altKey) {
      const cx = startBox.x + startBox.width / 2;
      const cy = startBox.y + startBox.height / 2;
      box = { x: cx - box.width / 2, y: cy - box.height / 2, width: box.width, height: box.height };
    }

    if (box.width < 0.5 || box.height < 0.5) return;

    const fromUnion = startBox;
    const toUnion = box;

    editorStore.applyLive({
      objects: editorStore.getState().objects.map((o) => {
        const original = originals.find((x) => x.id === o.id);
        if (!original) return o;
        const localBox = { x: original.x, y: original.y, width: original.width, height: original.height };
        const mapped = mapSubBox(localBox, fromUnion, toUnion);
        if (original.sizing === 'uniform' || original.geometry.kind === 'circle' || original.geometry.kind === 'ring') {
          const uniform = Math.min(mapped.width / (localBox.width || 1), mapped.height / (localBox.height || 1));
          const cx = mapped.x + mapped.width / 2;
          const cy = mapped.y + mapped.height / 2;
          const size = (localBox.width || 1) * uniform;
          const sizeY = (localBox.height || 1) * uniform;
          const uniformBox = { x: cx - size / 2, y: cy - sizeY / 2, width: size, height: sizeY };
          return withBox({ ...original, ...uniformBox, geometry: remapGeometry(original.geometry, localBox, uniformBox) });
        }
        const geometry = remapGeometry(original.geometry, localBox, mapped);
        return withBox({ ...original, geometry });
      }),
    });
  };

  // ------------------------------------------------------------ pointer up bağlama

  const handlePointerUp = (e: React.PointerEvent) => {
    endDrag(worldPoint(e), e);
  };

  const handlePointerLeave = () => {
    if (dragRef.current.kind === 'none') setCursorWorld(null);
  };

  // -------------------------------------------------------- shape builder

  useEffect(() => {
    if (state.tool !== 'shape-builder') {
      setShapeRegions([]);
      setHoverRegion(null);
      setPickedRegions([]);
      return;
    }
    if (state.selection.length < 2 || state.selection.length > 4) {
      setShapeRegions([]);
      return;
    }
    const regions = computeShapeRegions(state.selection);
    setShapeRegions(regions);
    setPickedRegions((prev) => prev.filter((k) => regions.some((r) => r.key === k)));
  }, [state.tool, state.selection, state.objects]);

  const onRegionClick = (key: string, remove: boolean) => {
    const region = shapeRegions.find((r) => r.key === key);
    if (!region) return;
    const nextPicked = remove ? pickedRegions.filter((k) => k !== key) : [...pickedRegions, key];
    setPickedRegions(nextPicked);

    if (!nextPicked.length) {
      onStatus('Shape Builder: bölge seçin, ardından "Uygula" ile birleştirin.');
      return;
    }
    const geometries = shapeRegions.filter((r) => nextPicked.includes(r.key)).map((r) => r.geometry);
    const result = buildShapeFromRegions(geometries, remove && nextPicked.length === 0);
    onStatus(result.message);
    setPickedRegions([]);
  };

  const applyShapeBuilder = (remove: boolean) => {
    if (!pickedRegions.length) {
      onStatus('Önce bölge seçin.');
      return;
    }
    const geometries = shapeRegions.filter((r) => pickedRegions.includes(r.key)).map((r) => r.geometry);
    const result = buildShapeFromRegions(geometries, remove);
    onStatus(result.message);
    setPickedRegions([]);
  };

  // ------------------------------------------------------------------ drop

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.svg')) {
      onStatus('Yalnızca .svg dosyaları sürükleyip bırakılabilir.');
      return;
    }
    try {
      const text = await file.text();
      const layerIndex = editorStore.addLayer(`Imported · ${file.name.replace(/\.svg$/i, '')}`);
      const result = importSvg(text, layerIndex, editorStore.getState().doc.artboardSize, true);
      editorStore.addObjects(result.objects, 'SVG içe aktar');
      const warn = result.warnings.length ? ` Uyarı: ${result.warnings.slice(0, 2).join(' ')}` : '';
      onStatus(`${result.objects.length} nesne içe aktarıldı.${warn}`);
    } catch (err) {
      onStatus(`SVG içe aktarılamadı: ${(err as Error).message}`);
    }
  };

  // ------------------------------------------------------------------ klavye

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.tool !== 'pen' || !state.penDraft) return;
      if (e.key === 'Enter') {
        finishPen(false);
      } else if (e.key === 'Escape') {
        editorStore.setPenDraft(null);
        setDrawPreview(null);
        onStatus('Pen iptal edildi.');
      } else if (e.key === 'Backspace') {
        const draft = editorStore.getState().penDraft ?? [];
        if (draft.length <= 1) editorStore.setPenDraft(null);
        else editorStore.setPenDraft(draft.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.tool, state.penDraft, finishPen, onStatus]);

  // -------------------------------------------------------- tekerlek zoom

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0016);
      const cam = editorStore.getState().camera;
      const next = Math.min(64, Math.max(0.02, cam.zoom * factor));
      const world = { x: (screen.x - cam.pan.x) / cam.zoom, y: (screen.y - cam.pan.y) / cam.zoom };
      editorStore.setCamera({ zoom: next, pan: { x: screen.x - world.x * next, y: screen.y - world.y * next } }, true);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onFit = () => fitToArtboard();
    window.addEventListener('logo-builder:fit', onFit);
    return () => window.removeEventListener('logo-builder:fit', onFit);
  }, [fitToArtboard]);

  // ---------------------------------------------------------------- render

  const artboard = state.doc.artboardSize;
  const renderList = useMemo(() => sortByRenderOrder(state.objects), [state.objects]);
  const construction = state.viewMode === 'construction';

  const surfaceCursor = spaceDown || state.tool === 'hand'
    ? 'grab'
    : state.tool === 'zoom'
      ? 'zoom-in'
      : isDrawTool(state.tool) || state.tool === 'pen' || state.tool === 'knife' || state.tool === 'iso-cube'
        ? 'crosshair'
        : 'default';

  const penDraft = state.penDraft;
  const penPreview = penDraft
    ? penPreviewPathData(
        penDraft.map((a) => ({ p: toScreenLocal(a.p, transform) })),
        cursorWorld ? toScreenLocal(cursorWorld, transform) : null,
        false,
      )
    : '';
  const penScreenAnchors = penDraft
    ? penDraft.map((a) => ({
        p: toScreenLocal(a.p, transform),
        h: a.h ? toScreenLocal(a.h, transform) : undefined,
      }))
    : null;

  return (
    <div
      ref={containerRef}
      className={`workspace${dropActive ? ' workspace--drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="workspace__svg"
        style={{ cursor: surfaceCursor }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* ---------------------------------------------------- world */}
        <g transform={`translate(${camera.pan.x} ${camera.pan.y}) scale(${camera.zoom})`}>
          <rect x={0} y={0} width={artboard} height={artboard} fill={state.doc.background} />
          {/* Artboard gölgesi/kenarı */}
          <rect
            x={0}
            y={0}
            width={artboard}
            height={artboard}
            fill="none"
            stroke="#4a4a4a"
            strokeWidth={1 / camera.zoom}
          />

          {construction && <GridOverlay grid={state.grid} artboardSize={artboard} zoom={camera.zoom} />}
          {construction && state.iso.enabled && <IsoGridOverlay iso={state.iso} artboardSize={artboard} />}

          <g>
            {renderList.map((object) => (
              <ObjectRenderer
                key={object.id}
                object={object}
                doc={state.doc}
                zoom={camera.zoom}
                isSelected={state.selection.includes(object.id)}
                interactive={state.tool !== 'shape-builder'}
                onPointerDown={onObjectPointerDown}
              />
            ))}
          </g>

          {construction && isoPreview && <IsoCubePreview cube={isoPreview} />}

          {construction && (
            <GuideOverlay show={state.doc.showGuides && state.viewMode === 'construction'} objects={state.objects} />
          )}
        </g>

        {/* ---------------------------------------------------- overlay (ekran uzayı) */}
        {construction && (
          <>
            <MarqueeOverlay rect={marquee} t={transform} />
            {drawPreview && (
              <DrawPreview
                kind={drawPreview.tool}
                from={drawPreview.from}
                to={drawPreview.to}
                thickness={drawPreview.tool === 'ring' ? snapMidThickness(40) : 0}
                t={transform}
              />
            )}
            <SnapOverlay guides={state.snap.guides} labels={state.snap.labels} t={transform} />
            <SelectionOverlay objects={selectedObjects} t={transform} showHandles={state.tool === 'select'} />
            {state.doc.showAnchors && state.tool === 'direct-select' && (
              <AnchorOverlay
                objects={selectedObjects}
                t={transform}
                selectedNodes={state.selectedNodes}
                onAnchorPointerDown={onAnchorPointerDown}
                onSegmentDoubleClick={onSegmentDoubleClick}
              />
            )}
            {penDraft && penScreenAnchors && (
              <PenOverlay
                anchors={penScreenAnchors}
                cursor={cursorWorld ? toScreenLocal(cursorWorld, transform) : null}
                previewPathData={penPreview}
              />
            )}
          </>
        )}

        {construction && state.tool === 'select' && selectedObjects.length === 1 && (
          <TransformHandles object={selectedObjects[0]} t={transform} onHandlePointerDown={onHandlePointerDown} />
        )}

        {state.tool === 'shape-builder' && shapeRegions.length > 0 && (
          <g transform={`translate(${camera.pan.x} ${camera.pan.y}) scale(${camera.zoom})`}>
            <ShapeBuilderOverlay
              regions={shapeRegions.map((r) => ({
                key: r.key,
                pathData: r.pathData,
                label: `${r.ids.length} şekil · alan ${Math.round(r.area)}`,
              }))}
              hoveredKey={hoverRegion}
              selectedKeys={pickedRegions}
              onHover={setHoverRegion}
              onClick={onRegionClick}
            />
          </g>
        )}
      </svg>

      {dropActive && <div className="workspace__drop">SVG dosyasını bırakın</div>}

      <div className="workspace__hint">
        {state.tool === 'shape-builder'
          ? 'Shape Builder: bölgeye tıklayın (birleştirir) · Alt+tık (çıkarır)'
          : state.tool === 'pen'
            ? 'Pen: tıkla = nokta · sürükle = eğri · ilk noktaya tıkla = kapat · Enter = bitir · Esc = iptal'
            : state.tool === 'knife'
              ? 'Knife: seçili nesnelerin üzerinden bir çizgi sürükleyin — kesim gerçek boolean ile yapılır'
              : 'Boşluk+sürükle / orta tuş = pan · Tekerlek = zoom · Ctrl+0 sığdır'}
      </div>

      {state.tool === 'shape-builder' && pickedRegions.length > 0 && (
        <div className="workspace__hint" style={{ left: 'auto', right: 12, bottom: 12 }}>
          <div className="btn-row">
            <button className="btn btn--primary" onClick={() => applyShapeBuilder(false)}>
              Seçili bölgeleri birleştir
            </button>
            <button className="btn" onClick={() => applyShapeBuilder(true)}>
              Seçili bölgeleri çıkar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ yardımcılar

function withBox<T extends ArtboardObject>(o: T): T {
  const box = syncObjectBox(o.geometry);
  return { ...o, ...box };
}

function toScreenLocal(world: Vec2, t: ScreenTransform): Vec2 {
  return { x: world.x * t.zoom + t.pan.x, y: world.y * t.zoom + t.pan.y };
}

function normRect(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function normalizeAngle(deg: number): number {
  let v = deg % 360;
  if (v < 0) v += 360;
  return Math.round(v * 100) / 100;
}

/** Bir kutunun alt kutusunu, üst kutunun dönüşümüne göre eşler. */
function mapSubBox(sub: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (sub.x - from.x) * sx,
    y: to.y + (sub.y - from.y) * sy,
    width: sub.width * sx,
    height: sub.height * sy,
  };
}

function rectIntersectsRotated(obj: ArtboardObject, rect: Rect): boolean {
  const corners = geometryRotatedCorners(obj.geometry, obj.rotation);
  const box = rectOfPoints(corners);
  return !(
    box.x + box.width < rect.x ||
    rect.x + rect.width < box.x ||
    box.y + box.height < rect.y ||
    rect.y + rect.height < box.y
  );
}

function worldToLocalPoint(obj: ArtboardObject, world: Vec2): Vec2 {
  if (!obj.rotation) return world;
  const box = geometryBounds(obj.geometry);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rad = (-obj.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + (world.x - cx) * cos - (world.y - cy) * sin,
    y: cy + (world.x - cx) * sin + (world.y - cy) * cos,
  };
}

function pointInPolygonList(points: Vec2[], p: Vec2, closed: boolean): boolean {
  if (!closed || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToLoop(points: Vec2[], p: Vec2, closed: boolean): number {
  let best = Infinity;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

function labelOf(tool: DrawTool): string {
  const map: Record<DrawTool, string> = {
    rectangle: 'Dikdörtgen',
    circle: 'Daire',
    ellipse: 'Elips',
    ring: 'Ring',
    line: 'Çizgi',
  };
  return map[tool];
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}
