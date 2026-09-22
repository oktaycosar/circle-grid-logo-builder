import type { ArtboardObject, FillStyle, Rect } from './types.ts';
import { ARTBOARD_SIZE } from './types.ts';
import { geometryToSvgPathData, geometryRotatedCorners } from './geometry.ts';

/**
 * SVG / PNG dışa aktarma.
 *
 * Export edilen SVG gerçek vektördür: her obje `<path>` olarak, orijinal
 * geometriden üretilir. Grid, guide, seçim kutusu, anchor noktaları ve UI
 * hiçbir şekilde export edilmez. Raster görüntü gömülmez.
 */

export type SvgBackground = 'transparent' | 'white' | 'artboard';

export interface SvgExportOptions {
  objects: ArtboardObject[];
  artboardSize: number;
  /** Sadece logo sınırlarına kırp (viewBox = artwork bounds). */
  trimToArtwork: boolean;
  /** Trim modunda kenar boşluğu (artboard birimi). */
  padding: number;
  background: SvgBackground;
  /** Eksenlerde kaç ondalık basamak. */
  precision: number;
}

export interface PngExportOptions {
  size: number;
  transparent: boolean;
  trimToArtwork: boolean;
  padding: number;
}

const DEFAULT_SVG_OPTIONS: Partial<SvgExportOptions> = {
  trimToArtwork: false,
  padding: 24,
  background: 'artboard',
  precision: 3,
};

function fmt(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  return String(rounded);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Export edilecek objeler: görünür ve guide olmayan. */
export function exportableObjects(objects: ArtboardObject[]): ArtboardObject[] {
  return objects.filter((o) => o.visible && !o.isGuide && hasVisiblePaint(o));
}

function hasVisiblePaint(o: ArtboardObject): boolean {
  const hasFill = o.fill.type !== 'none';
  const hasStroke = o.stroke !== 'none' && o.strokeWidth > 0;
  return hasFill || hasStroke;
}

/** Objelerin (rotasyon dahil) sınır kutusu. */
export function artworkBounds(objects: ArtboardObject[]): Rect | null {
  const list = exportableObjects(objects);
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of list) {
    const pad = obj.stroke !== 'none' ? obj.strokeWidth / 2 : 0;
    for (const c of geometryRotatedCorners(obj.geometry, obj.rotation)) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function fillAttribute(fill: FillStyle, gradientId: string | null): string {
  switch (fill.type) {
    case 'none':
      return 'fill="none"';
    case 'solid':
      return `fill="${escapeXml(fill.color)}"`;
    case 'linear':
      return `fill="url(#${gradientId})"`;
  }
}

function gradientDef(fill: Extract<FillStyle, { type: 'linear' }>, id: string): string {
  const rad = (fill.angle * Math.PI) / 180;
  // Birim kutu içinde açıya göre gradyan ekseni
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;
  const x1 = 0.5 - dx;
  const y1 = 0.5 - dy;
  const x2 = 0.5 + dx;
  const y2 = 0.5 + dy;
  const stops = fill.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${escapeXml(s.color)}"/>`)
    .join('');
  return `<linearGradient id="${id}" x1="${fmt(x1, 4)}" y1="${fmt(y1, 4)}" x2="${fmt(x2, 4)}" y2="${fmt(y2, 4)}">${stops}</linearGradient>`;
}

export interface SvgBuildResult {
  svg: string;
  viewBox: Rect;
}

/** Temiz, saf vektör SVG üretir. */
export function buildSvg(options: SvgExportOptions): SvgBuildResult {
  const opts = { ...DEFAULT_SVG_OPTIONS, ...options } as SvgExportOptions;
  const list = exportableObjects(opts.objects);

  const defs: string[] = [];
  const body: string[] = [];

  list.forEach((obj, index) => {
    const d = geometryToSvgPathData(obj.geometry);
    if (!d) return;

    let gradientId: string | null = null;
    if (obj.fill.type === 'linear') {
      gradientId = `grad-${index}`;
      defs.push(gradientDef(obj.fill, gradientId));
    }

    const attrs: string[] = [`d="${d}"`];
    if (gradientId) attrs.push(`fill="url(#${gradientId})"`);
    else attrs.push(fillAttribute(obj.fill, null));

    if (obj.stroke !== 'none' && obj.strokeWidth > 0) {
      attrs.push(`stroke="${escapeXml(obj.stroke)}"`, `stroke-width="${fmt(obj.strokeWidth, opts.precision)}"`);
      attrs.push('stroke-linejoin="round"', 'stroke-linecap="round"');
    }

    // Delik/ayrık loop'lar even-odd ile doğru şekilde oyulur.
    attrs.push('fill-rule="evenodd"');

    if (obj.rotation) {
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      attrs.push(
        `transform="rotate(${fmt(obj.rotation, opts.precision)} ${fmt(cx, opts.precision)} ${fmt(cy, opts.precision)})"`,
      );
    }

    body.push(`  <path ${attrs.join(' ')}/>`);
  });

  let viewBox: Rect;
  let backgroundRect = '';
  if (opts.trimToArtwork) {
    const b = artworkBounds(opts.objects);
    if (b) {
      const pad = opts.padding;
      viewBox = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
    } else {
      viewBox = { x: 0, y: 0, width: opts.artboardSize, height: opts.artboardSize };
    }
  } else {
    viewBox = { x: 0, y: 0, width: opts.artboardSize, height: opts.artboardSize };
  }

  if (opts.background === 'white' || opts.background === 'artboard') {
    backgroundRect = `  <rect x="${fmt(viewBox.x, opts.precision)}" y="${fmt(viewBox.y, opts.precision)}" width="${fmt(
      viewBox.width,
      opts.precision,
    )}" height="${fmt(viewBox.height, opts.precision)}" fill="#ffffff"/>\n`;
  }

  const defsBlock = defs.length ? `  <defs>\n    ${defs.join('\n    ')}\n  </defs>\n` : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewBox.x, opts.precision)} ${fmt(
      viewBox.y,
      opts.precision,
    )} ${fmt(viewBox.width, opts.precision)} ${fmt(viewBox.height, opts.precision)}" width="${fmt(
      viewBox.width,
      opts.precision,
    )}" height="${fmt(viewBox.height, opts.precision)}">\n` +
    defsBlock +
    backgroundRect +
    body.join('\n') +
    (body.length ? '\n' : '') +
    `</svg>\n`;

  return { svg, viewBox };
}

/** Aynı görünümü koruyarak PNG üretir (SVG'den rasterize edilir). */
export async function buildPng(
  svg: string,
  viewBox: Rect,
  options: PngExportOptions,
): Promise<Blob> {
  const size = options.size;
  const aspect = viewBox.width === 0 ? 1 : viewBox.height / viewBox.width;
  const width = size;
  const height = Math.round(size * aspect) || size;

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(url);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D bağlamı oluşturulamadı.');

  if (!options.transparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG oluşturulamadı.'));
    }, 'image/png');
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG rasterize edilemedi.'));
    img.src = src;
  });
}

export const PNG_SIZES = [512, 1024, 2048, 4096] as const;

export function suggestedFilename(prefix = 'logo'): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}`;
}

export { ARTBOARD_SIZE };
