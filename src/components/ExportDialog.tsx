import { useEffect, useMemo, useState } from 'react';
import { editorStore, useEditorState } from '../store/editorStore.ts';
import { NumberField, Panel, Toggle } from './ui.tsx';
import type { SvgBackground } from '../core/export.ts';
import { PNG_SIZES, artworkBounds, buildPng, buildSvg, suggestedFilename } from '../core/export.ts';
import { downloadFile } from '../core/persistence.ts';

/**
 * EXPORT paneli (spesifikasyon 27).
 *
 * SVG gerçek vektör olarak üretilir; grid, guide, seçim kutuları, anchor
 * noktaları ve UI hiçbir zaman export edilmez. PNG aynı SVG'den rasterize
 * edilir, böylece görünüm birebir aynı kalır.
 */
export function ExportPanel() {
  const state = useEditorState();
  const [trimToArtwork, setTrimToArtwork] = useState(false);
  const [padding, setPadding] = useState(24);
  const [background, setBackground] = useState<SvgBackground>('artboard');
  const [pngSize, setPngSize] = useState<number>(1024);
  const [pngTransparent, setPngTransparent] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => ({
      objects: state.objects,
      artboardSize: state.doc.artboardSize,
      trimToArtwork,
      padding,
      background,
      precision: 3,
    }),
    [state.objects, state.doc.artboardSize, trimToArtwork, padding, background],
  );

  const built = useMemo(() => {
    try {
      return buildSvg(options);
    } catch {
      return { svg: '', viewBox: { x: 0, y: 0, width: state.doc.artboardSize, height: state.doc.artboardSize } };
    }
  }, [options, state.doc.artboardSize]);

  const bounds = useMemo(() => artworkBounds(state.objects), [state.objects]);

  useEffect(() => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svg)}`;
    setPreview(url);
  }, [built.svg]);

  const exportSvg = () => {
    if (!built.svg) {
      editorStore.setStatus('Export edilecek görünür nesne yok.');
      return;
    }
    downloadFile(`${suggestedFilename('logo')}.svg`, built.svg, 'image/svg+xml');
    editorStore.setStatus(`SVG indirildi (viewBox ${Math.round(built.viewBox.width)}×${Math.round(built.viewBox.height)}).`);
  };

  const exportPng = async () => {
    if (!built.svg) {
      editorStore.setStatus('Export edilecek görünür nesne yok.');
      return;
    }
    setBusy(true);
    try {
      const blob = await buildPng(built.svg, built.viewBox, {
        size: pngSize,
        transparent: pngTransparent,
        trimToArtwork,
        padding,
      });
      downloadFile(`${suggestedFilename('logo')}-${pngSize}.png`, blob, 'image/png');
      editorStore.setStatus(`PNG indirildi (${pngSize}px${pngTransparent ? ', şeffaf' : ''}).`);
    } catch (err) {
      editorStore.setStatus(`PNG oluşturulamadı: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="Export">
        <div className="dialog__preview">
          {preview ? <img src={preview} alt="Export önizleme" /> : <span className="dialog__hint">Önizleme yok</span>}
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={exportSvg} disabled={!built.svg}>
            SVG indir
          </button>
          <button type="button" className="btn" onClick={exportPng} disabled={!built.svg || busy}>
            {busy ? 'PNG…' : 'PNG indir'}
          </button>
        </div>

        <Toggle label="Trim to Artwork (logo sınırlarına kırp)" checked={trimToArtwork} onChange={setTrimToArtwork} />
        {trimToArtwork && (
          <NumberField label="Pad" value={padding} min={0} step={4} onChange={setPadding} />
        )}

        <div className="field">
          <span className="field__label">BG</span>
          <select
            className="field__select"
            value={background}
            onChange={(e) => setBackground(e.target.value as SvgBackground)}
          >
            <option value="artboard">Beyaz arka plan</option>
            <option value="white">Beyaz (trim ile)</option>
            <option value="transparent">Şeffaf</option>
          </select>
        </div>

        <div className="field">
          <span className="field__label">PNG</span>
          <select
            className="field__select"
            value={pngSize}
            onChange={(e) => setPngSize(Number(e.target.value))}
          >
            {PNG_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} × {size}
              </option>
            ))}
          </select>
        </div>
        <Toggle label="Transparent Background (PNG)" checked={pngTransparent} onChange={setPngTransparent} />

        <p className="dialog__hint">
          {bounds
            ? `Artwork sınırları: ${Math.round(bounds.width)} × ${Math.round(bounds.height)} · ${
                state.objects.filter((o) => o.visible && !o.isGuide).length
              } görünür nesne`
            : 'Görünür nesne yok.'}
        </p>
        <p className="dialog__hint">Grid, guide'lar, anchor noktaları ve seçim kutuları export edilmez.</p>
      </Panel>
    </>
  );
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__head">
          <span>Export — SVG / PNG</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Kapat">
            ✕
          </button>
        </div>
        <div className="dialog__body">
          <ExportPanel />
        </div>
        <div className="dialog__foot">
          <button type="button" className="btn" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
