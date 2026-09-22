import { useRef } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import {
  IconConstruction,
  IconDuplicate,
  IconExport,
  IconFile,
  IconFit,
  IconGrid,
  IconLogoView,
  IconOpen,
  IconOutline,
  IconRedo,
  IconSave,
  IconTrash,
  IconUndo,
} from './icons.tsx';
import {
  buildProjectFile,
  clearSavedProject,
  createDemoProject,
  downloadFile,
  parseProject,
  serializeProject,
} from '../core/persistence.ts';
import { importSvg } from '../core/svgImport.ts';

export interface TopToolbarProps {
  onExport: () => void;
  onStatus: (message: string) => void;
}

export function TopToolbar({ onExport, onStatus }: TopToolbarProps) {
  const state = useEditorState();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fit = () => window.dispatchEvent(new Event('logo-builder:fit'));

  /** Zoom'u artboard merkezini görünüm merkezinde tutarak uygular. */
  const setZoom = (zoom: number) => {
    const artboard = editorStore.getState().doc.artboardSize;
    const next = Math.min(64, Math.max(0.02, zoom));
    const rect = document.querySelector('.workspace')?.getBoundingClientRect();
    const viewCenter = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 640, y: 400 };
    const worldCenter = { x: artboard / 2, y: artboard / 2 };
    editorStore.setCamera({
      zoom: next,
      pan: { x: viewCenter.x - worldCenter.x * next, y: viewCenter.y - worldCenter.y * next },
    });
  };

  const newProject = () => {
    editorStore.resetDocument(true);
    onStatus('Yeni boş proje açıldı.');
  };

  const loadDemo = () => {
    const demo = createDemoProject();
    editorStore.loadDocument({ objects: demo.objects, layers: demo.layers, grid: demo.grid });
    onStatus('Demo proje (SAD monogramı) yüklendi — tamamı boolean motoruyla üretildi.');
  };

  const saveProject = () => {
    const s = editorStore.getState();
    const file = buildProjectFile(s.objects, s.layers, s.doc, s.grid);
    downloadFile('logo-projesi.json', serializeProject(file), 'application/json');
    onStatus('Proje JSON olarak indirildi.');
  };

  const loadProject = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseProject(text);
      editorStore.loadDocument(parsed);
      onStatus(`Proje yüklendi: ${parsed.objects.length} nesne.${parsed.warnings.length ? ` ${parsed.warnings.length} uyarı.` : ''}`);
    } catch (err) {
      onStatus(`Proje yüklenemedi: ${(err as Error).message}`);
    }
  };

  const importSvgFile = async (file: File) => {
    try {
      const text = await file.text();
      const layerIndex = editorStore.addLayer(`Imported · ${file.name.replace(/\.svg$/i, '')}`);
      const result = importSvg(text, layerIndex, state.doc.artboardSize, true);
      editorStore.addObjects(result.objects, 'SVG içe aktar');
      onStatus(`${result.objects.length} nesne içe aktarıldı.${result.warnings.length ? ` ${result.warnings[0]}` : ''}`);
    } catch (err) {
      onStatus(`SVG içe aktarılamadı: ${(err as Error).message}`);
    }
  };

  const toggleGrid = () => {
    editorStore.setGrid({ enabled: !editorStore.getState().grid.enabled });
  };

  return (
    <header className="toptoolbar">
      <div className="toptoolbar__brand">
        Circle Grid Logo Builder
        <small>Geometric Logo Construction Studio</small>
      </div>

      <span className="toptoolbar__sep" />

      <button type="button" className="tb-btn" onClick={newProject} title="Yeni proje (boş artboard)">
        <IconFile width={14} height={14} /> New
      </button>
      <button type="button" className="tb-btn" onClick={loadDemo} title="Referans videoya benzer SAD demo projesini yükle">
        Demo
      </button>
      <button type="button" className="tb-btn" onClick={saveProject} title="Projeyi JSON olarak indir">
        <IconSave width={14} height={14} /> Save
      </button>
      <button type="button" className="tb-btn" onClick={() => fileInputRef.current?.click()} title="Proje JSON yükle">
        <IconOpen width={14} height={14} /> Load
      </button>
      <button
        type="button"
        className="tb-btn"
        onClick={() => {
          const s = editorStore.getState();
          downloadFile('logo-projesi.json', serializeProject(buildProjectFile(s.objects, s.layers, s.doc, s.grid)), 'application/json');
          onStatus('Proje JSON dışa aktarıldı.');
        }}
        title="Proje JSON dışa aktar"
      >
        Export JSON
      </button>
      <button
        type="button"
        className="tb-btn"
        onClick={() => {
          clearSavedProject();
          onStatus('Kayıtlı yerel proje temizlendi.');
        }}
        title="LocalStorage'daki kayıtlı projeyi sil"
      >
        <IconTrash width={14} height={14} />
      </button>

      <span className="toptoolbar__sep" />

      <button type="button" className="tb-btn tb-btn--ghost" disabled={!state.canUndo} onClick={() => editorStore.undo()} title="Geri al (Ctrl+Z)">
        <IconUndo width={14} height={14} />
      </button>
      <button type="button" className="tb-btn tb-btn--ghost" disabled={!state.canRedo} onClick={() => editorStore.redo()} title="İleri al (Ctrl+Shift+Z)">
        <IconRedo width={14} height={14} />
      </button>
      <button
        type="button"
        className="tb-btn tb-btn--ghost"
        disabled={!state.selection.length}
        onClick={() => {
          const created = editorStore.duplicateSelection();
          if (created.length) onStatus(`${created.length} nesne çoğaltıldı (Ctrl+D).`);
        }}
        title="Çoğalt (Ctrl+D)"
      >
        <IconDuplicate width={14} height={14} />
      </button>

      <span className="toptoolbar__sep" />

      <button
        type="button"
        className={`tb-btn${state.grid.enabled ? ' tb-btn--active' : ''}`}
        onClick={toggleGrid}
        title="Grid göster/gizle (G)"
      >
        <IconGrid width={14} height={14} /> Grid
      </button>
      <button
        type="button"
        className={`tb-btn${state.grid.snap ? ' tb-btn--active' : ''}`}
        onClick={() => editorStore.setGrid({ snap: !editorStore.getState().grid.snap })}
        title="Snap to Grid aç/kapat"
      >
        Snap
      </button>
      <button
        type="button"
        className={`tb-btn${state.doc.outlineMode ? ' tb-btn--active' : ''}`}
        onClick={() => editorStore.setDoc({ outlineMode: !editorStore.getState().doc.outlineMode })}
        title="Outline mod (Ctrl+Y)"
      >
        <IconOutline width={14} height={14} /> Outline
      </button>

      <span className="toptoolbar__sep" />

      <div style={{ display: 'inline-flex', gap: 4, flex: 'none' }}>
        <button
          type="button"
          className={`tb-btn${state.viewMode === 'construction' ? ' tb-btn--active' : ''}`}
          onClick={() => editorStore.setViewMode('construction')}
          title="Construction View — grid, guide ve konstrüksiyon görünür"
        >
          <IconConstruction width={14} height={14} /> Construction
        </button>
        <button
          type="button"
          className={`tb-btn${state.viewMode === 'logo' ? ' tb-btn--active' : ''}`}
          onClick={() => editorStore.setViewMode('logo')}
          title="Logo View — yalnızca nihai logo"
        >
          <IconLogoView width={14} height={14} /> Logo
        </button>
      </div>

      <span className="toptoolbar__sep" />

      <div className="tb-zoom">
        <button type="button" onClick={() => setZoom(state.camera.zoom / 1.25)} title="Zoom out (Ctrl+-)">
          −
        </button>
        <input
          type="text"
          value={`${Math.round(state.camera.zoom * 100)}%`}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value.replace('%', ''));
            if (!Number.isNaN(parsed) && parsed > 0) setZoom(parsed / 100);
          }}
          title="Zoom oranı"
        />
        <button type="button" onClick={() => setZoom(state.camera.zoom * 1.25)} title="Zoom in (Ctrl++)">
          +
        </button>
        <button type="button" onClick={fit} title="Artboard'a sığdır (Ctrl+0)">
          <IconFit width={13} height={13} />
        </button>
        <button type="button" onClick={() => setZoom(1)} title="%100">
          1:1
        </button>
      </div>

      <span className="toptoolbar__spacer" />

      <button
        type="button"
        className="tb-btn"
        onClick={() => {
          editorStore.loadDocument(createDemoProject());
          onStatus('Demo yeniden yüklendi.');
        }}
        title="Demo projeye dön"
      >
        Reset Demo
      </button>
      <button type="button" className="tb-btn tb-btn--primary" onClick={onExport} title="SVG / PNG dışa aktar">
        <IconExport width={14} height={14} /> Export
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.svg,image/svg+xml"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.name.toLowerCase().endsWith('.svg')) await importSvgFile(file);
          else await loadProject(file);
        }}
      />
    </header>
  );
}
