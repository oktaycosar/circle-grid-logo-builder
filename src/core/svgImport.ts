import type { ArtboardObject, Geometry, SubPath, Vec2 } from './types.ts';
import {
  commandsToSubPaths,
  parseSvgTransform,
  pathDataToCommands,
  transformGeometry,
  geometryBounds,
} from './geometry.ts';
import { multiply, translate, scaleAbout } from './matrix.ts';
import type { Matrix } from './types.ts';
import { newId } from './factory.ts';

/**
 * SVG içe aktarma (spesifikasyon 28).
 *
 * Desteklenen elemanlar: path, circle, ellipse, rect, line, polyline,
 * polygon ve bunları saran <g> grupları (transform zinciri korunur).
 * Import edilen objeler ayrı bir katmana yerleştirilir.
 */

export interface ImportResult {
  objects: ArtboardObject[];
  warnings: string[];
  /** İçe aktarılan içeriğin sınırları. */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

interface WalkContext {
  matrix: Matrix;
  warnings: string[];
  objects: ArtboardObject[];
  layerIndex: number;
}

export function importSvg(text: string, layerIndex: number, artboardSize: number, fitToArtboard = true): ImportResult {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('SVG dosyası ayrıştırılamadı: geçerli bir SVG değil.');
  }

  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Kök eleman <svg> değil.');
  }

  const ctx: WalkContext = {
    matrix: parseSvgTransform(svg.getAttribute('transform')),
    warnings,
    objects: [],
    layerIndex,
  };

  for (const child of Array.from(svg.children)) {
    walkElement(child, ctx);
  }

  if (!ctx.objects.length) {
    throw new Error('SVG içinde desteklenen çizim elemanı bulunamadı (path, circle, rect, ellipse, line, polygon).');
  }

  const bounds = boundsOf(ctx.objects);

  // İçerik artboard'a sığmıyorsa ortala ve ölçekle.
  if (fitToArtboard && bounds) {
    const maxDim = Math.max(bounds.width, bounds.height);
    if (maxDim > artboardSize) {
      const factor = (artboardSize * 0.9) / maxDim;
      warnings.push(`İçerik ölçeklendi (×${factor.toFixed(3)}).`);
      applyMatrixToObjects(ctx.objects, scaleAbout(factor, factor, { x: bounds.x, y: bounds.y }));
    }
    const after = boundsOf(ctx.objects);
    if (after) {
      const dx = (artboardSize - after.width) / 2 - after.x;
      const dy = (artboardSize - after.height) / 2 - after.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        applyMatrixToObjects(ctx.objects, translate(dx, dy));
      }
    }
  }

  return { objects: ctx.objects, warnings, bounds: boundsOf(ctx.objects) };
}

function walkElement(el: Element, ctx: WalkContext): void {
  const tag = el.tagName.toLowerCase();
  const local = multiply(ctx.matrix, parseSvgTransform(el.getAttribute('transform')));

  const style = resolveStyle(el);
  const childCtx: WalkContext = { ...ctx, matrix: local, warnings: ctx.warnings, objects: ctx.objects };

  switch (tag) {
    case 'g':
    case 'svg':
      for (const child of Array.from(el.children)) walkElement(child, childCtx);
      return;
    case 'defs':
    case 'title':
    case 'desc':
    case 'metadata':
    case 'style':
      return;
    case 'use':
      ctx.warnings.push('<use> elemanı desteklenmiyor, atlandı.');
      return;
    default:
      break;
  }

  const geometry = elementToGeometry(el, tag);
  if (!geometry) {
    if (tag !== 'text' && tag !== 'image') ctx.warnings.push(`<${tag}> elemanı desteklenmiyor, atlandı.`);
    else ctx.warnings.push(`<${tag}> içe aktarılamaz (yalnızca vektör şekiller desteklenir).`);
    return;
  }

  const transformed = transformGeometry(geometry, local);
  const bounds = geometryBounds(transformed);

  const obj: ArtboardObject = {
    id: newId('import'),
    type: transformed.kind === 'circle' ? 'circle' : transformed.kind === 'rect' ? 'rectangle' : 'path',
    name: describe(tag, ctx.objects.length + 1),
    geometry: transformed,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: 0,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    sizing: 'stretch',
    visible: style.opacity > 0.01,
    locked: false,
    layerIndex: ctx.layerIndex,
  };

  ctx.objects.push(obj);
}

function describe(tag: string, index: number): string {
  const names: Record<string, string> = {
    path: 'Imported Path',
    circle: 'Imported Circle',
    ellipse: 'Imported Ellipse',
    rect: 'Imported Rectangle',
    line: 'Imported Line',
    polygon: 'Imported Polygon',
    polyline: 'Imported Polyline',
  };
  return `${names[tag] ?? 'Imported Shape'} ${index}`;
}

interface ResolvedStyle {
  fill: ArtboardObject['fill'];
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

function resolveStyle(el: Element): ResolvedStyle {
  const attr = (name: string): string | null => el.getAttribute(name);
  const inline = (el.getAttribute('style') ?? '').split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split(':');
    if (k && v) acc[k.trim().toLowerCase()] = v.trim();
    return acc;
  }, {});

  const read = (name: string, fallback: string): string => attr(name) ?? inline[name] ?? fallback;

  const fillRaw = read('fill', '#000000');
  const strokeRaw = read('stroke', 'none');
  const strokeWidthRaw = read('stroke-width', '1');
  const opacityRaw = read('opacity', '1');
  const fillOpacityRaw = read('fill-opacity', '1');

  const opacity = clamp01(Number(opacityRaw) || 1);
  const fillOpacity = clamp01(Number(fillOpacityRaw) || 1);

  let fill: ArtboardObject['fill'];
  const lowerFill = fillRaw.toLowerCase();
  if (lowerFill === 'none' || lowerFill === 'transparent') {
    fill = { type: 'none' };
  } else if (lowerFill.startsWith('url(')) {
    // Gradyan referansları düz renge indirgenir (uyarı ile)
    fill = { type: 'solid', color: '#000000' };
  } else {
    fill = { type: 'solid', color: normalizeColor(fillRaw) };
  }
  if (fillOpacity < 0.01) fill = { type: 'none' };

  const lowerStroke = strokeRaw.toLowerCase();
  const stroke = lowerStroke === 'none' || lowerStroke === 'transparent' ? 'none' : normalizeColor(strokeRaw);
  const strokeWidth = stroke === 'none' ? 0 : Math.max(0, parseFloat(strokeWidthRaw) || 0);

  return { fill, stroke, strokeWidth, opacity };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function normalizeColor(value: string): string {
  const v = value.trim();
  if (v.startsWith('#')) return v.toLowerCase();
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    gray: '#808080',
    grey: '#808080',
    none: 'none',
  };
  const lower = v.toLowerCase();
  if (named[lower]) return named[lower];
  const rgb = lower.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    if ([r, g, b].every((n) => !Number.isNaN(n))) {
      return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#000000';
}

function num(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  // Yüzde değerleri artboard oranına çevrilemez; 0 kabul edilir.
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function elementToGeometry(el: Element, tag: string): Geometry | null {
  switch (tag) {
    case 'path': {
      const d = el.getAttribute('d');
      if (!d) return null;
      const subpaths = commandsToSubPaths(pathDataToCommands(d));
      if (!subpaths.length) return null;
      return { kind: 'path', subpaths: normalizeSubpaths(subpaths) };
    }
    case 'circle': {
      const r = num(el, 'r');
      if (r <= 0) return null;
      return { kind: 'circle', cx: num(el, 'cx'), cy: num(el, 'cy'), r };
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      return { kind: 'ellipse', cx: num(el, 'cx'), cy: num(el, 'cy'), rx, ry };
    }
    case 'rect': {
      const width = num(el, 'width');
      const height = num(el, 'height');
      if (width <= 0 || height <= 0) return null;
      const rx = num(el, 'rx');
      const ry = num(el, 'ry', rx);
      if (rx > 0 || ry > 0) {
        // Yuvarlatılmış köşe: poligon yaklaşımı
        return roundedRectGeometry(num(el, 'x'), num(el, 'y'), width, height, rx, ry || rx);
      }
      return { kind: 'rect', x: num(el, 'x'), y: num(el, 'y'), width, height };
    }
    case 'line': {
      return {
        kind: 'line',
        x1: num(el, 'x1'),
        y1: num(el, 'y1'),
        x2: num(el, 'x2'),
        y2: num(el, 'y2'),
      };
    }
    case 'polygon':
    case 'polyline': {
      const points = parsePoints(el.getAttribute('points'));
      if (points.length < 2) return null;
      return { kind: 'path', subpaths: [{ points, closed: tag === 'polygon' }] };
    }
    default:
      return null;
  }
}

function parsePoints(raw: string | null): Vec2[] {
  if (!raw) return [];
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function normalizeSubpaths(subpaths: SubPath[]): SubPath[] {
  return subpaths.map((sp) => {
    const points: Vec2[] = [];
    for (const p of sp.points) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) continue;
      points.push(p);
    }
    return { points, closed: sp.closed };
  });
}

function roundedRectGeometry(
  x: number,
  y: number,
  width: number,
  height: number,
  rxIn: number,
  ryIn: number,
): Geometry {
  const rx = Math.min(rxIn, width / 2);
  const ry = Math.min(ryIn, height / 2);
  const segments = 16;
  const points: Vec2[] = [];

  const corner = (cx: number, cy: number, startAngle: number) => {
    for (let i = 0; i <= segments; i++) {
      const a = startAngle + (i / segments) * (Math.PI / 2);
      points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
  };

  corner(x + width - rx, y + ry, -Math.PI / 2);
  corner(x + width - rx, y + height - ry, 0);
  corner(x + rx, y + height - ry, Math.PI / 2);
  corner(x + rx, y + ry, Math.PI);

  return { kind: 'path', subpaths: [{ points, closed: true }] };
}

function boundsOf(objects: ArtboardObject[]): { x: number; y: number; width: number; height: number } | null {
  if (!objects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.width);
    maxY = Math.max(maxY, o.y + o.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function applyMatrixToObjects(objects: ArtboardObject[], m: Matrix): void {
  for (const obj of objects) {
    obj.geometry = transformGeometry(obj.geometry, m);
    const b = geometryBounds(obj.geometry);
    obj.x = b.x;
    obj.y = b.y;
    obj.width = b.width;
    obj.height = b.height;
    if (obj.stroke !== 'none') {
      // Ölçekleme sonrası stroke kalınlığını da ölçekle
      const sx = Math.hypot(m[0], m[1]);
      obj.strokeWidth = obj.strokeWidth * (sx || 1);
    }
  }
}

/** Kullanıcının sürükle-bırak ile verdiği dosyayı okur. */
export async function readSvgFile(file: File): Promise<string> {
  return await file.text();
}
