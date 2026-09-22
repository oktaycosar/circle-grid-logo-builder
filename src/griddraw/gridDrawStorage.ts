/**
 * Grid Draw — kalıcılık.
 *
 * Tasarım `localStorage`'da tutulur: ayarlar, görünüm, aynalama modu ve
 * doldurulmuş bölgelerin kimlikleri. Plan ayarlardan **deterministik** olarak
 * üretildiği için bölge kimlikleri yeniden yüklendiğinde aynıdır; ayrıca
 * yükleme sırasında `byId` ile doğrulanır, geçersizler atılır.
 *
 * `Storage` enjekte edilebilir; böylece testte sahte bir depo ile çalışır.
 */

import type { MirrorMode } from './regions.ts';
import type { GridDrawStyle } from './gridDrawSvg.ts';
import { normalizeSettings, type GridDrawSettings } from './regions.ts';

/**
 * Depo anahtarı.
 *
 * `:v2` eki bilinçlidir: varsayılan ızgara 24×24 olduğu için eski (18×18)
 * kayıt yeni varsayılanı gölgelemesin diye anahtar yenilendi. Eski anahtar
 * okuma sırasında silinir.
 */
export const GRID_DRAW_STORAGE_KEY = 'logo-builder:griddraw:v2';

/** Önceki sürümün anahtarları — artık kullanılmaz, temizlenir. */
export const GRID_DRAW_LEGACY_KEYS = ['logo-builder:griddraw'];

export interface GridDrawSave {
  version: 2;
  settings: GridDrawSettings;
  style: GridDrawStyle;
  mirror: MirrorMode;
  fills: number[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveGridDraw(payload: GridDrawSave, store: Storage | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(GRID_DRAW_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadGridDraw(store: Storage | null = storage()): GridDrawSave | null {
  if (!store) return null;
  try {
    for (const legacy of GRID_DRAW_LEGACY_KEYS) {
      try {
        store.removeItem(legacy);
      } catch {
        /* yok sayılır */
      }
    }
    const raw = store.getItem(GRID_DRAW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GridDrawSave> & { version?: number };
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.settings || !parsed.style) return null;
    return {
      version: 2,
      // Eski kayıtlar (cols/rows/circles/diagonals) normalizeSettings içinde taşınır.
      settings: normalizeSettings(parsed.settings),
      style: parsed.style,
      mirror: parsed.mirror ?? 'none',
      fills: Array.isArray(parsed.fills) ? parsed.fills.filter((n) => Number.isInteger(n) && n > 0) : [],
    };
  } catch {
    return null;
  }
}

export function clearGridDraw(store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.removeItem(GRID_DRAW_STORAGE_KEY);
  } catch {
    /* yok sayılır */
  }
}
