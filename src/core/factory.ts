import type {
  ArtboardObject,
  CircleGeometry,
  EllipseGeometry,
  FillStyle,
  Geometry,
  LineGeometry,
  ObjectType,
  PathGeometry,
  PolygonGeometry,
  RectGeometry,
  RingGeometry,
  SubPath,
  Vec2,
} from './types.ts';
import { geometryBounds } from './geometry.ts';

let counter = 0;
export function newId(prefix = 'obj'): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const BLACK = '#000000';
export const WHITE = '#ffffff';
export const GUIDE_COLOR = '#8b7cf6';

export interface BaseOptions {
  name?: string;
  layerIndex?: number;
  fill?: FillStyle;
  stroke?: string;
  strokeWidth?: number;
  /** Sadece stroke ile çizilen objeler: fill yok sayılır. */
  strokeOnly?: boolean;
  isGuide?: boolean;
  locked?: boolean;
  rotation?: number;
}

function baseObject(
  type: ObjectType,
  geometry: Geometry,
  opts: BaseOptions,
): ArtboardObject {
  const bounds = geometryBounds(geometry);
  const isGuide = opts.isGuide ?? false;
  const strokeOnly = opts.strokeOnly ?? false;
  return {
    id: newId(),
    type,
    name: opts.name ?? type,
    geometry,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: opts.rotation ?? 0,
    fill: strokeOnly ? { type: 'none' } : (opts.fill ?? { type: 'solid', color: BLACK }),
    stroke: isGuide ? GUIDE_COLOR : (opts.stroke ?? 'none'),
    strokeWidth: opts.strokeWidth ?? (isGuide ? 2 : 0),
    sizing: 'stretch',
    visible: true,
    locked: opts.locked ?? false,
    layerIndex: opts.layerIndex ?? 1,
    isGuide: isGuide || undefined,
  };
}

// ------------------------------------------------------------------ şekiller

export function makeCircle(cx: number, cy: number, r: number, opts: BaseOptions = {}): ArtboardObject {
  const geometry: CircleGeometry = { kind: 'circle', cx, cy, r };
  return baseObject('circle', geometry, { name: opts.name ?? 'Circle', ...opts });
}

export function makeEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  opts: BaseOptions = {},
): ArtboardObject {
  const geometry: EllipseGeometry = { kind: 'ellipse', cx, cy, rx, ry };
  return baseObject('ellipse', geometry, { name: opts.name ?? 'Ellipse', ...opts });
}

export function makeRing(
  cx: number,
  cy: number,
  outerRadius: number,
  thickness: number,
  opts: BaseOptions = {},
): ArtboardObject {
  const geometry: RingGeometry = { kind: 'ring', cx, cy, outerRadius, thickness };
  return baseObject('ring', geometry, { name: opts.name ?? 'Ring', ...opts });
}

export function makeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  opts: BaseOptions = {},
): ArtboardObject {
  const geometry: RectGeometry = { kind: 'rect', x, y, width, height };
  return baseObject('rectangle', geometry, { name: opts.name ?? 'Rectangle', ...opts });
}

export function makeLine(x1: number, y1: number, x2: number, y2: number, opts: BaseOptions = {}): ArtboardObject {
  const geometry: LineGeometry = { kind: 'line', x1, y1, x2, y2 };
  return baseObject('line', geometry, {
    name: opts.name ?? 'Line',
    strokeOnly: true,
    stroke: opts.stroke ?? (opts.isGuide ? GUIDE_COLOR : BLACK),
    strokeWidth: opts.strokeWidth ?? 2,
    ...opts,
    // strokeOnly ve stroke'un üzerine yazılmaması için tekrar uygula
    fill: { type: 'none' },
  });
}

export function makePolygon(keypoints: Vec2[], opts: BaseOptions & { extraLoops?: Vec2[][] } = {}): ArtboardObject {
  const geometry: PolygonGeometry = { kind: 'polygon', keypoints, extraLoops: opts.extraLoops };
  return baseObject('polygon', geometry, { name: opts.name ?? 'Path', ...opts });
}

export function makePath(subpaths: SubPath[], opts: BaseOptions = {}): ArtboardObject {
  const geometry: PathGeometry = { kind: 'path', subpaths };
  return baseObject('path', geometry, { name: opts.name ?? 'Path', ...opts });
}

export function makeGuideLine(x1: number, y1: number, x2: number, y2: number, name = 'Guide Line'): ArtboardObject {
  return makeLine(x1, y1, x2, y2, { name, isGuide: true, layerIndex: 1, strokeWidth: 1.5 });
}

export function makeGuideCircle(cx: number, cy: number, r: number, name = 'Guide Circle'): ArtboardObject {
  return makeCircle(cx, cy, r, {
    name,
    isGuide: true,
    strokeOnly: false,
    fill: { type: 'none' },
    stroke: GUIDE_COLOR,
    strokeWidth: 1.5,
    layerIndex: 1,
  });
}

/** Bir geometriden obje türetir (boolean sonucu vb.). */
export function objectFromGeometry(
  geometry: Geometry,
  opts: BaseOptions & { type?: ObjectType } = {},
): ArtboardObject {
  const type: ObjectType = opts.type ?? (geometry.kind === 'polygon' || geometry.kind === 'path' ? 'polygon' : 'rectangle');
  return baseObject(type, geometry, { name: opts.name ?? 'Result', ...opts });
}

/** Obje merkezini döndürür (rotasyon dahil). */
export function objectCenter(obj: ArtboardObject): Vec2 {
  return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
}

export function hasFill(obj: ArtboardObject): boolean {
  return obj.fill.type !== 'none' && !obj.isGuide;
}
