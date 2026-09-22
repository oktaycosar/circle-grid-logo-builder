import { useState } from 'react';
import { GridDrawStudio } from './griddraw/GridDrawStudio.tsx';
import { VectorStudio } from './VectorStudio.tsx';

/**
 * Uygulama kabuğu.
 *
 * Varsayılan ekran **Grid Draw**: ızgara + daire + çapraz ağının kapalı
 * gözlerini boyayarak logo üretilen basit mod. Ağır vektör editörü
 * (Vector Studio) buradan açılır; kendi hook'ları ayrı yaşadığı için iki mod
 * birbirinin klavye kısayollarını ve geri alma geçmişini etkilemez.
 */

const MODE_KEY = 'logo-builder:mode';

type Mode = 'grid' | 'studio';

export default function App() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'studio' ? 'studio' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const go = (next: Mode) => {
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* localStorage kapalıysa sorun değil */
    }
    setMode(next);
  };

  if (mode === 'studio') return <VectorStudio onBackToGrid={() => go('grid')} />;
  return <GridDrawStudio onOpenStudio={() => go('studio')} />;
}
