import { useCallback, useEffect, useState } from 'react';
import { TopToolbar } from './components/TopToolbar.tsx';
import { LeftToolbar } from './components/LeftToolbar.tsx';
import { CanvasWorkspace } from './components/CanvasWorkspace.tsx';
import { PropertiesPanel } from './components/PropertiesPanel.tsx';
import { LayersPanel } from './components/LayersPanel.tsx';
import { GridPanel } from './components/GridPanel.tsx';
import { IsometricPanel } from './components/IsometricPanel.tsx';
import { BooleanPanel } from './components/BooleanPanel.tsx';
import { MonogramPanel } from './components/MonogramPanel.tsx';
import { ExportDialog } from './components/ExportDialog.tsx';
import { Panel } from './components/ui.tsx';
import { editorStore, useEditorState } from './store/editorStore.ts';
import { createDemoProject } from './core/demoProject.ts';
import { autosave, buildProjectFile, loadAutosave, loadFromLocalStorage } from './core/persistence.ts';
import type { ToolId } from './core/types.ts';

const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  a: 'direct-select',
  r: 'rectangle',
  e: 'circle',
  l: 'line',
  p: 'pen',
  b: 'shape-builder',
  c: 'knife',
  i: 'iso-cube',
  h: 'hand',
  z: 'zoom',
};

export interface VectorStudioProps {
  /** Basit "Grid Draw" moduna dön. */
  onBackToGrid: () => void;
}

export function VectorStudio({ onBackToGrid }: VectorStudioProps) {
  const state = useEditorState();
  const [exportOpen, setExportOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // ------------------------------------------------------------- açılış

  useEffect(() => {
    if (booted) return;
    setBooted(true);

    const autosaved = loadAutosave();
    const saved = autosaved ?? loadFromLocalStorage();
    if (saved && saved.objects.length) {
      editorStore.loadDocument(saved);
      editorStore.setStatus(`Son proje geri yüklendi (${saved.objects.length} nesne).`);
      return;
    }
    const demo = createDemoProject();
    editorStore.loadDocument(demo);
    editorStore.setStatus(
      'Demo proje yüklendi: SAD monogramı — tüm harfler boolean unite/subtract/intersect ile üretildi.',
    );
  }, [booted]);

  // -------------------------------------------------------- otomatik kayıt

  useEffect(() => {
    const timer = window.setInterval(() => {
      const s = editorStore.getState();
      if (!s.objects.length) return;
      autosave(buildProjectFile(s.objects, s.layers, s.doc, s.grid));
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  // ------------------------------------------------------------- klavye

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        editorStore.undo();
        return;
      }
      if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
        event.preventDefault();
        editorStore.redo();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        const created = editorStore.duplicateSelection();
        if (created.length) editorStore.setStatus(`${created.length} nesne çoğaltıldı.`);
        return;
      }
      if (mod && key === 'a') {
        event.preventDefault();
        editorStore.setSelection(editorStore.getState().objects.filter((o) => !o.locked).map((o) => o.id));
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        editorStore.setDoc({ outlineMode: !editorStore.getState().doc.outlineMode });
        return;
      }
      if (mod && (key === '0' || key === 'numpad0')) {
        event.preventDefault();
        window.dispatchEvent(new Event('logo-builder:fit'));
        return;
      }
      if (mod && (key === '+' || key === '=' || key === 'add')) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('logo-builder:zoom', { detail: 1.25 }));
        return;
      }
      if (mod && (key === '-' || key === 'subtract')) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('logo-builder:zoom', { detail: 1 / 1.25 }));
        return;
      }
      if (mod) return;

      if (key === 'g') {
        event.preventDefault();
        editorStore.setGrid({ enabled: !editorStore.getState().grid.enabled });
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        editorStore.deleteSelection();
        return;
      }
      if (key === 'escape') {
        editorStore.setSelection([]);
        editorStore.setSelectedNodes([]);
        return;
      }

      const tool = TOOL_SHORTCUTS[key];
      if (tool) {
        event.preventDefault();
        // Shift+E → ellipse, Shift+R → ring
        if (event.shiftKey && key === 'e') {
          editorStore.setTool('ellipse');
          return;
        }
        if (event.shiftKey && key === 'r') {
          editorStore.setTool('ring');
          return;
        }
        editorStore.setTool(tool);
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const onZoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail ?? 1.25;
      const ws = document.querySelector('.workspace')?.getBoundingClientRect();
      const cam = editorStore.getState().camera;
      const center = ws ? { x: ws.width / 2, y: ws.height / 2 } : { x: 600, y: 400 };
      const next = Math.min(64, Math.max(0.02, cam.zoom * factor));
      const world = { x: (center.x - cam.pan.x) / cam.zoom, y: (center.y - cam.pan.y) / cam.zoom };
      editorStore.setCamera({ zoom: next, pan: { x: center.x - world.x * next, y: center.y - world.y * next } });
    };
    window.addEventListener('logo-builder:zoom', onZoom);
    return () => window.removeEventListener('logo-builder:zoom', onZoom);
  }, []);

  const status = state.statusMessage || 'Hazır';
  const selectedCount = state.selection.length;

  return (
    <div className="app">
      <div className="modebar">
        <button type="button" className="modebar__back" onClick={onBackToGrid}>
          ← Grid Draw (basit mod)
        </button>
        <span className="modebar__label">Vector Studio — tam vektör editör</span>
      </div>

      <TopToolbar onExport={() => setExportOpen(true)} onStatus={(m) => editorStore.setStatus(m)} />

      <div className="app__middle">
        <LeftToolbar tool={state.tool} onSelect={(t) => editorStore.setTool(t)} />
        <CanvasWorkspace onStatus={(m) => editorStore.setStatus(m)} />

        <aside className="panels">
          <div className="tabs">
            <span className="tabs__tab tabs__tab--active">Properties</span>
          </div>
          <PropertiesPanel />
          <BooleanPanel />
          <MonogramPanel />
          <IsometricPanel />
          <GridPanel />
          <LayersPanel />
          <Panel title="Klavye kısayolları" defaultOpen={false}>
            <div className="shortcut-list">
              <span className="kbd">V</span>
              <span>Select</span>
              <span className="kbd">A</span>
              <span>Direct Selection (node edit)</span>
              <span className="kbd">R</span>
              <span>Rectangle</span>
              <span className="kbd">E</span>
              <span>Circle · Shift+E: Ellipse</span>
              <span className="kbd">Shift+R</span>
              <span>Circle Ring</span>
              <span className="kbd">L</span>
              <span>Line</span>
              <span className="kbd">P</span>
              <span>Pen</span>
              <span className="kbd">B</span>
              <span>Shape Builder</span>
              <span className="kbd">C</span>
              <span>Knife / Trim</span>
              <span className="kbd">I</span>
              <span>Isometric Cube</span>
              <span className="kbd">H</span>
              <span>Hand</span>
              <span className="kbd">Z</span>
              <span>Zoom (Alt+tık = uzaklaş)</span>
              <span className="kbd">G</span>
              <span>Grid aç/kapat</span>
              <span className="kbd">Ctrl+Z</span>
              <span>Geri al</span>
              <span className="kbd">Ctrl+Shift+Z</span>
              <span>İleri al</span>
              <span className="kbd">Ctrl+D</span>
              <span>Çoğalt</span>
              <span className="kbd">Alt+drag</span>
              <span>Kopyalayarak sürükle</span>
              <span className="kbd">Ctrl+Y</span>
              <span>Outline mod</span>
              <span className="kbd">Ctrl+0</span>
              <span>Artboard'a sığdır</span>
              <span className="kbd">Boşluk+drag</span>
              <span>Pan</span>
              <span className="kbd">Del</span>
              <span>Seçiliyi sil</span>
            </div>
          </Panel>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="statusbar__item">
          Araç: <strong>{state.tool}</strong>
        </span>
        <span className="statusbar__item">
          Seçim: <strong>{selectedCount}</strong>
        </span>
        <span className="statusbar__item">
          Nesne: <strong>{state.objects.length}</strong>
        </span>
        <span className="statusbar__item">
          Zoom: <strong>{Math.round(state.camera.zoom * 100)}%</strong>
        </span>
        <span className="statusbar__item">
          Grid: <strong>{state.grid.enabled ? `${state.grid.size}px / ${state.grid.divisions}` : 'kapalı'}</strong>
        </span>
        <span className="statusbar__item">
          Snap: <strong>{state.grid.snap ? 'açık' : 'kapalı'}</strong>
        </span>
        <span className="statusbar__item">
          Görünüm: <strong>{state.viewMode === 'construction' ? 'Construction' : 'Logo'}</strong>
        </span>
        {state.historyLabel && (
          <span className="statusbar__item">
            Son işlem: <strong>{state.historyLabel}</strong>
          </span>
        )}
        <span className="statusbar__spacer" />
        <span className="statusbar__item" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {status}
        </span>
      </footer>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
