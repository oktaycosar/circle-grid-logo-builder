import type { ArtboardObject, DocumentSettings, GridSettings, LayerInfo } from './types.ts';
import { ARTBOARD_SIZE } from './types.ts';
import { createDemoProject } from './demoProject.ts';

const STORAGE_KEY = 'circle-grid-logo-builder::project';
const AUTOSAVE_KEY = 'circle-grid-logo-builder::autosave';
const SCHEMA_VERSION = 1;

export interface ProjectFile {
  app: 'circle-grid-logo-builder';
  version: number;
  savedAt: string;
  artboardSize: number;
  objects: ArtboardObject[];
  layers: LayerInfo[];
  doc?: DocumentSettings;
  grid?: GridSettings;
}

export function buildProjectFile(
  objects: ArtboardObject[],
  layers: LayerInfo[],
  doc: DocumentSettings,
  grid: GridSettings,
): ProjectFile {
  return {
    app: 'circle-grid-logo-builder',
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    artboardSize: doc.artboardSize || ARTBOARD_SIZE,
    objects,
    layers,
    doc,
    grid,
  };
}

export function serializeProject(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

export interface ParsedProject {
  objects: ArtboardObject[];
  layers: LayerInfo[];
  doc?: DocumentSettings;
  grid?: GridSettings;
  warnings: string[];
}

/** Proje JSON'unu doğrulayıp okur; eksik alanları tamamlar. */
export function parseProject(json: string): ParsedProject {
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Proje dosyası geçerli JSON değil.');
  }
  const data = raw as Partial<ProjectFile>;
  if (!data || typeof data !== 'object') throw new Error('Proje dosyası okunamadı.');
  if (!Array.isArray(data.objects)) throw new Error('Proje dosyasında "objects" dizisi yok.');

  const objects: ArtboardObject[] = [];
  for (const item of data.objects) {
    const obj = item as ArtboardObject;
    if (!obj || typeof obj.id !== 'string' || !obj.geometry) {
      warnings.push('Bir nesne atlandı: eksik alanlar.');
      continue;
    }
    objects.push({
      ...obj,
      rotation: obj.rotation ?? 0,
      fill: obj.fill ?? { type: 'solid', color: '#000000' },
      stroke: obj.stroke ?? 'none',
      strokeWidth: obj.strokeWidth ?? 0,
      sizing: obj.sizing ?? 'stretch',
      visible: obj.visible ?? true,
      locked: obj.locked ?? false,
      layerIndex: obj.layerIndex ?? 0,
      x: obj.x ?? 0,
      y: obj.y ?? 0,
      width: obj.width ?? 0,
      height: obj.height ?? 0,
      name: obj.name ?? obj.type ?? 'Object',
    });
  }

  const layers: LayerInfo[] =
    Array.isArray(data.layers) && data.layers.length
      ? data.layers.map((l, i) => ({
          id: l.id ?? `layer-${i}`,
          name: l.name ?? `Layer ${i + 1}`,
          visible: l.visible ?? true,
          locked: l.locked ?? false,
          order: l.order ?? i,
        }))
      : [{ id: 'layer-artwork', name: 'Artwork', visible: true, locked: false, order: 0 }];

  // Katman indekslerini geçerli aralığa sıkıştır
  for (const o of objects) {
    if (o.layerIndex < 0 || o.layerIndex >= layers.length) {
      warnings.push(`"${o.name}" nesnesinin katmanı düzeltildi.`);
      o.layerIndex = Math.max(0, Math.min(layers.length - 1, o.layerIndex));
    }
  }

  return { objects, layers, doc: data.doc, grid: data.grid, warnings };
}

// ------------------------------------------------------------- localStorage

export function saveToLocalStorage(file: ProjectFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(file));
  } catch {
    /* kota dolu olabilir — sessizce yut */
  }
}

export function loadFromLocalStorage(): ParsedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}

export function hasSavedProject(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSavedProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* yut */
  }
}

/** Otomatik kaydetme: sayfa yenilendiğinde son proje geri yüklenir. */
export function autosave(file: ProjectFile): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(file));
  } catch {
    /* yut */
  }
}

export function loadAutosave(): ParsedProject | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}

export function downloadFile(filename: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { createDemoProject };
