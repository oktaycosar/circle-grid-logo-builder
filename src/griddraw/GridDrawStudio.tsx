import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '../core/types.ts';
import { buildPng } from '../core/export.ts';
import { downloadFile } from '../core/persistence.ts';
import {
  DEFAULT_GRID_DRAW,
  GRID_PRESETS,
  MAX_DIVISIONS,
  MIRROR_LABELS,
  MIN_DIVISIONS,
  buildGridDrawPlan,
  circleGuide,
  guideGeometry,
  guideNear,
  intersectIds,
  lineGuide,
  mergeFilledRegions,
  mirrorRegions,
  normalizeSettings,
  regionsInDisc,
  regionsInRect,
  regionsOnSide,
  remapFills,
  regionAt,
  snapToGridPoint,
  strokeRegions,
  type GridDrawPlan,
  type GridDrawSettings,
  type GridPreset,
  type GuideCircle,
  type GuideLine,
  type GuideShape,
  type MergedShape,
  type MirrorMode,
} from './regions.ts';
import { DEFAULT_GRID_DRAW_STYLE, buildGridDrawSvg, type GridDrawStyle } from './gridDrawSvg.ts';
import { clearGridDraw, loadGridDraw, saveGridDraw } from './gridDrawStorage.ts';
import './griddraw.css';

/**
 * Grid Draw — tek ekranlık basit mod.
 *
 * Amaç: kare boyamak değil, **ızgara ile kullanıcının çizdiği daire/çizgilerin
 * arasında oluşan kapalı gözleri** doldurmak (Illustrator Live Paint mantığı).
 *
 * Tasarım kararları:
 *   • Izgara DÜŞEY ve YATAYDA EŞİTTİR ve artboard karedir; böylece hücreler
 *     kare olur ve köşeden köşeye çaprazlar her hücreyi tam ikiye böler.
 *   • Başlangıçta YALNIZCA ızgara vardır. Daire ve çizgiler opsiyoneldir ve
 *     kullanıcı tarafından çizilir.
 *   • Komşu dolu gözler tek silüete indirilir; paylaşılan kenar ve anti-alias
 *     boşluğu tamamen kaybolur.
 */

/**
 * Ayarların GEOMETRİ imzası: kılavuz KİMLİKLERİ hariç yalnızca şekil.
 *
 * Plan yalnızca imza değişince yeniden kurulur. Hazır grid uygulamak gibi
 * "aynı geometriyi yeni kimliklerle kurma" durumları imzayı değiştirmediği
 * için plan boşuna yeniden hesaplanmaz ve geri alma dolguları doğrudan
 * yerine koyar.
 */
function gridSignature(s: GridDrawSettings): string {
  return [
    s.grid,
    s.size,
    ...s.guides.map((g) =>
      g.kind === 'circle' ? `c${g.cx},${g.cy},${g.r}` : `l${g.ax},${g.ay},${g.bx},${g.by}`,
    ),
  ].join('|');
}

const MAX_HISTORY = 200;
const MIRROR_MODES: MirrorMode[] = ['none', 'x', 'y', 'quad'];

/** Yakınlaştırma sınırları ve adımı. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

/** Editörde kabul edilen en küçük kılavuz ölçüleri. */
const MIN_GUIDE_RADIUS = 4;
const MIN_GUIDE_LENGTH = 8;

/** Ondalığı iki basamağa yuvarlar. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Fırça modu: doldur ya da boşalt. */
type PaintTool = 'fill' | 'erase';
const PAINT_LABELS: Record<PaintTool, string> = { fill: 'Doldur', erase: 'Boşalt' };

/** Çizim / taşıma aracı. */
type GuideTool = 'none' | 'circle' | 'line' | 'move';

/** Sürükleme sırasındaki kılavuz önizlemesi. */
type GuideDraft =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; a: Vec2; b: Vec2 };

/** Sürüklenerek taşınan kılavuzun önizlemesi. */
type GuideMove = { id: string; from: Vec2; dx: number; dy: number };

/** Shift + sürükle ile taranan dikdörtgen alan. */
type AreaRect = { from: Vec2; to: Vec2 };

/**
 * Tutamak sürüklemesi (boyut/yarıçap/çizgi ucu).
 *
 * Sürüklerken yalnızca ÖNİZLEME güncellenir (plan yeniden kurulmaz, ızgara
 * yeniden hesaplanmaz); bırakınca tek seferde uygulanır. Aksi halde her fare
 * olayı ~200 ms'lik bölge hesabı tetiklerdi.
 */
type HandleDraft =
  | { guideId: string; kind: 'radius'; r: number }
  | { guideId: string; kind: 'a' | 'b'; point: Vec2 };

/** Son toplu doldurma işlemi — geometri değişince kendiliğinden tazelenir. */
type BulkOp =
  | { kind: 'ring'; outerId: string; innerId: string }
  | { kind: 'disc'; id: string; mode: 'in' | 'out' };

/**
 * Geçmiş anlık görüntüsü.
 *
 * AYARLAR ve DOLGULAR birlikte saklanır; böylece çizilen kılavuz, taşıma,
 * silme ve ızgara değişikliği de `Ctrl+Z` ile geri alınabilir.
 */
type Snapshot = { settings: GridDrawSettings; fills: number[] };

export interface GridDrawStudioProps {
  /** Tam vektör editöre geç. */
  onOpenStudio: () => void;
}

function formatGuide(guide: GuideShape): string {
  if (guide.kind === 'circle') {
    return `◯ r ${Math.round(guide.r)}`;
  }
  const angle = Math.round((((Math.atan2(guide.by - guide.ay, guide.bx - guide.ax) * 180) / Math.PI) + 180) % 180);
  const length = Math.round(Math.hypot(guide.bx - guide.ax, guide.by - guide.ay));
  return `╱ ${angle}° · ${length}`;
}

export function GridDrawStudio({ onOpenStudio }: GridDrawStudioProps) {
  const saved = useRef(loadGridDraw()).current;
  const pendingFills = useRef<Set<number> | null>(saved?.fills?.length ? new Set(saved.fills) : null);

  const [settings, setSettings] = useState<GridDrawSettings>(() =>
    normalizeSettings(saved?.settings ?? DEFAULT_GRID_DRAW),
  );
  const [style, setStyle] = useState<GridDrawStyle>(() => ({ ...DEFAULT_GRID_DRAW_STYLE, ...saved?.style }));
  const [mirror, setMirror] = useState<MirrorMode>(saved?.mirror ?? 'none');
  const [showGridLines, setShowGridLines] = useState(true);
  const [guideTool, setGuideTool] = useState<GuideTool>('none');
  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const [moving, setMoving] = useState<GuideMove | null>(null);
  /**
   * Taslak ve taşıma durumunun OTORİTESİ ref'tedir.
   *
   * React aynı karede gelen birden çok pointer olayını birleştirdiğinde,
   * kapanıştaki `draft`/`moving` bayat kalabiliyor; bayat kapanış çoktan
   * tamamlanmış bir çizimi diriltip ikinci kez ekliyordu. Ref senkron okunur.
   */
  const draftRef = useRef<GuideDraft | null>(null);
  const movingRef = useRef<GuideMove | null>(null);
  const [rect, setRect] = useState<AreaRect | null>(null);
  const rectRef = useRef<AreaRect | null>(null);
  const [handleDraft, setHandleDraft] = useState<HandleDraft | null>(null);
  const handleRef = useRef<HandleDraft | null>(null);
  /** Geometri değişince yeniden uygulanacak toplu doldurma (ör. halka). */
  const pendingBulkRef = useRef<BulkOp | null>(null);
  const lastBulkRef = useRef<BulkOp | null>(null);
  const [handleHover, setHandleHover] = useState(false);
  const [paintTool, setPaintTool] = useState<PaintTool>('fill');
  const [snapDraw, setSnapDraw] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<string | null>(null);
  const [hoverGuide, setHoverGuide] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [stageBox, setStageBox] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const artboardRef = useRef<HTMLDivElement | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  /** Yakınlaştırma sırasında ekranda sabit kalacak nokta. */
  const zoomAnchorRef = useRef<{ u: number; v: number; sx: number; sy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;
  const spaceRef = useRef(spaceDown);
  spaceRef.current = spaceDown;

  const [plan, setPlan] = useState<GridDrawPlan | null>(null);
  const [building, setBuilding] = useState(true);
  const [merged, setMerged] = useState<MergedShape | null>(null);
  const [fills, setFills] = useState<Set<number>>(() => new Set());
  const [hover, setHover] = useState(0);
  const [status, setStatus] = useState('Izgara hazırlanıyor…');

  const planRef = useRef<GridDrawPlan | null>(null);
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const paintRef = useRef<boolean | null>(null);
  /** Fırça izinin son boyanan noktası (ara hücreler atlanmasın). */
  const lastPaintRef = useRef<Vec2 | null>(null);
  /** Geri alma sırasında dolguların "yeniden eşleme"ye uğramadan yüklenmesi. */
  const restoreRef = useRef<Set<number> | null>(null);
  const mirrorRef = useRef<MirrorMode>(mirror);
  mirrorRef.current = mirror;

  // Kılavuz imzası: ayarlar değişince plan yeniden hesaplanır.
  const signature = useMemo(() => gridSignature(settings), [settings]);

  /** Kılavuz geometrisi — çizim, kenetleme ve tuval çizimi için ortak. */
  const guides = useMemo(() => guideGeometry(settings), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Kâğıdın ekran pikseli cinsinden kenarı (zoom bu ölçüyü büyütür). */
  const paperSize = Math.round((stageBox || 620) * zoom);

  /**
   * Taşıma/seçim isabet toleransı (artboard birimi).
   *
   * Ekran ölçeğine bağlıdır: ~14 piksellik bir yakalama alanı her zoom
   * seviyesinde aynı hissi verir. Alt sınır hücrenin %35'i.
   */
  const hitTol = Math.max(guides.cell * 0.35, 14 * (guides.size / Math.max(1, paperSize)));

  // ------------------------------------------- tuval ölçüsü ve yakınlaştırma

  useEffect(() => {
    const node = artboardRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setStageBox(Math.max(80, Math.min(rect.width, rect.height) - 24));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Ctrl + tekerlek: İMLECİN ÜZERİNDEKİ noktayı sabit tutarak yakınlaştır.
  useEffect(() => {
    const node = artboardRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return; // Ctrl yok: normal kaydırma
      event.preventDefault();
      zoomAtRef.current(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // ------------------------------------------------ görünüm: zoom + gezdirme

  /**
   * Yakınlaştırmayı, verilen ekran noktasını sabit tutarak uygular.
   *
   * Böylece zoom yaparken baktığınız şey (ör. dairenin merkezi) ekrandan
   * kaymaz; sahne merkezden uzaklaşmış gibi görünmez.
   */
  const zoomAtRef = useRef<(clientX: number, clientY: number, factor: number) => void>(() => {});
  zoomAtRef.current = (clientX, clientY, factor) => {
    const paper = paperRef.current;
    if (!paper) {
      zoomBy(factor);
      return;
    }
    const rect = paper.getBoundingClientRect();
    const scale = rect.width / guides.size;
    zoomAnchorRef.current = {
      u: (clientX - rect.left) / scale,
      v: (clientY - rect.top) / scale,
      sx: clientX,
      sy: clientY,
    };
    zoomBy(factor);
  };

  /** Butonlarla yakınlaştırma: görünen alanın ortası sabit kalır. */
  const zoomAtCenter = (factor: number) => {
    const scroller = artboardRef.current;
    if (!scroller) {
      zoomBy(factor);
      return;
    }
    const rect = scroller.getBoundingClientRect();
    zoomAtRef.current(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  /** %100'e döner ve görünümü ortalar. */
  const resetView = () => {
    setZoom(1);
    const scroller = artboardRef.current;
    if (!scroller) return;
    window.requestAnimationFrame(() => {
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    });
  };

  // Yakınlaştırma bittikten sonra sabitlenen nokta aynı yerde kalsın.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const paper = paperRef.current;
    const scroller = artboardRef.current;
    if (!anchor || !paper || !scroller) return;
    zoomAnchorRef.current = null;
    const rect = paper.getBoundingClientRect();
    const scale = rect.width / guides.size;
    scroller.scrollLeft += rect.left + anchor.u * scale - anchor.sx;
    scroller.scrollTop += rect.top + anchor.v * scale - anchor.sy;
  }, [zoom, guides.size]);

  /** Sahneyi elle kaydırma (orta tuş, boşluk+sürükle ya da ✋ aracı). */
  const panMoveRef = useRef<(event: PointerEvent) => void>(() => {});
  panMoveRef.current = (event) => {
    const pan = panRef.current;
    const scroller = artboardRef.current;
    if (!pan || !scroller) return;
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
  };

  const startPan = (clientX: number, clientY: number) => {
    const scroller = artboardRef.current;
    if (!scroller) return;
    panRef.current = { x: clientX, y: clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    setPanning(true);
    const move = (event: PointerEvent) => panMoveRef.current(event);
    const up = () => {
      panRef.current = null;
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // ------------------------------------------------------- planı hesapla
  useEffect(() => {
    let cancelled = false;
    setBuilding(true);
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      const next = buildGridDrawPlan(settings);
      const previous = planRef.current;
      planRef.current = next;
      setPlan(next);

      // Ref'ler güncelleyicinin DIŞINDA okunur: React (StrictMode/eşzamanlı
      // mod) güncelleyiciyi iki kez çağırabilir ve içindeki yan etki ikinci
      // çağrıda kayıtlı dolguları kaybettirir.
      const explicit = restoreRef.current;
      restoreRef.current = null;
      const restored = explicit ?? pendingFills.current;
      pendingFills.current = null;

      // Tutamakla geometri değiştiyse son toplu doldurma tazelenir.
      const bulk = pendingBulkRef.current;
      pendingBulkRef.current = null;

      const circleOf = (id: string): GuideCircle | null => {
        const found = settings.guides.find((g) => g.id === id);
        return found && found.kind === 'circle' ? found : null;
      };

      if (bulk && bulk.kind === 'ring') {
        const outer = circleOf(bulk.outerId);
        const inner = circleOf(bulk.innerId);
        if (outer && inner) {
          const innerIds = new Set(regionsInDisc(next, inner.cx, inner.cy, inner.r, 'in'));
          const ring = regionsInDisc(next, outer.cx, outer.cy, outer.r, 'in').filter((id) => !innerIds.has(id));
          setFills(new Set(ring));
          setStatus(`Halka tazelendi (r ${Math.round(inner.r)}–${Math.round(outer.r)}): ${ring.length} göz.`);
        }
      } else if (bulk && bulk.kind === 'disc') {
        const circle = circleOf(bulk.id);
        if (circle) {
          const ids = regionsInDisc(next, circle.cx, circle.cy, circle.r, bulk.mode);
          setFills(new Set(ids));
          setStatus(`Dolgu tazelendi: ${ids.length} göz.`);
        }
      } else if (restored && restored.size) {
        // Geri alma ya da açılışta yükleme: dolgular doğrudan uygulanır.
        const valid = [...restored].filter((id) => next.byId[id]);
        setFills(new Set(valid));
        if (!explicit && !previous) {
          setStatus(
            valid.length
              ? `Kayıtlı tasarım yüklendi (${valid.length} bölge).`
              : 'Kayıt vardı ama yeni ızgarada geçerli bölge bulunamadı.',
          );
        }
      } else if (previous) {
        setFills((current) => remapFills(current, previous, next));
      }

      setBuilding(false);
      // Eylem mesajları ("Kılavuz taşındı", "Dairenin içi: …") ezilmesin;
      // yalnızca varsayılan bilgi satırı güncellenir.
      const actionMessages = [
        'Kayıtlı tasarım',
        'Kayıt vardı',
        'Kılavuz',
        'Dairenin',
        'Çizginin',
        'Geri alındı',
        'İleri alındı',
        'Halka tazelendi',
        'Dolgu tazelendi',
      ];
      setStatus((prev) =>
        actionMessages.some((prefix) => prev.startsWith(prefix))
          ? prev
          : `${next.regions.length} bölge bulundu. Boyamak için tıklayın.`,
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // -------------------------------------------------- birleşik silüet (gecikmeli)
  useEffect(() => {
    if (!plan || !style.merge || !fills.size) {
      setMerged(null);
      return;
    }
    const handle = window.setTimeout(() => setMerged(mergeFilledRegions(plan, fills)), 90);
    return () => window.clearTimeout(handle);
  }, [plan, fills, style.merge]);

  // ------------------------------------------------------------- geçmiş

  const zoomBy = useCallback((factor: number) => setZoom((z) => clampZoom(z * factor)), []);

  /** Son işlenen durumun bağımsız kopyası (olay anında taze değer). */
  const stateRef = useRef<Snapshot>({ settings, fills: [] });
  stateRef.current = { settings, fills: [...fills] };

  /** Aynı düzenleme serisinin tek adım sayılması için son push bilgisi. */
  const lastPushRef = useRef<{ key: string; time: number } | null>(null);

  /**
   * Geçmişe anlık görüntü ekler.
   *
   * `key` aynı kalırsa (ör. ok tuşlarıyla arka arkaya kaydırma ya da bir sayı
   * alanına yazma) 800 ms içindeki tekrarlar TEK adım sayılır; Ctrl+Z kullanıcıyı
   * harf harf geri götürmez.
   */
  const pushHistory = useCallback((key: string) => {
    const now = Date.now();
    const last = lastPushRef.current;
    lastPushRef.current = { key, time: now };
    if (last && last.key === key && now - last.time < 800) return;
    undoRef.current.push(stateRef.current);
    if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
    redoRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const applySnapshotRef = useRef<(target: Snapshot) => void>(() => {});
  applySnapshotRef.current = (target) => {
    // Plan YALNIZCA geometri imzasına göre yeniden kurulur. İmza aynıysa
    // (ör. hazır grid uygulandıktan sonra geri alma: aynı daireler, yeni
    // kimlikler) plan hâlâ geçerlidir; dolgular doğrudan geri konur.
    if (gridSignature(target.settings) === signature) {
      setFills(new Set(target.fills));
    } else {
      // Plan yeniden kurulacak; dolgular efekt içinde doğrudan uygulanır.
      restoreRef.current = new Set(target.fills);
      setSettings(target.settings);
    }
    lastPushRef.current = null;
  };

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(stateRef.current);
    applySnapshotRef.current(previous);
    setStatus('Geri alındı.');
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(stateRef.current);
    applySnapshotRef.current(next);
    setStatus('İleri alındı.');
    setHistoryTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        const lower = event.key.toLowerCase();
        if (event.key === 'Escape') {
          setGuideTool('none');
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomBy(ZOOM_STEP);
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomBy(1 / ZOOM_STEP);
        } else if (event.key === '0') {
          setZoom(1);
        } else if (lower === 'f') {
          setGuideTool('none');
          // Boyama moduna geçiş gezdirme modunu kapatır: ✋ açıkken tıklama
          // sahneyi kaydırır ve kullanıcı "neden boyayamıyorum?" durumunda kalır.
          setPanMode(false);
          setPaintTool('fill');
        } else if (lower === 'h') {
          setGuideTool('none');
          setPanMode((v) => !v);
        } else if (event.key === ' ' || event.code === 'Space') {
          // Boşluk: geçici gezdirme aracı (Illustrator/Photoshop gibi)
          event.preventDefault();
          setSpaceDown(true);
        } else if (lower === 'e') {
          setGuideTool('none');
          setPanMode(false);
          setPaintTool('erase');
        } else if (lower === 'm') {
          setPanMode(false);
          setGuideTool((t) => (t === 'move' ? 'none' : 'move'));
        } else if (event.key.startsWith('Arrow') && nudgeRef.current(event.key, event.shiftKey)) {
          event.preventDefault();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        // Boşluk bırakıldığında odaktaki düğmeyi TETİKLEMESİN (tarayıcı
        // varsayılanı: boşluk, odaklı düğmeye tıklama sayılır).
        event.preventDefault();
        setSpaceDown(false);
      }
    };
    const onBlur = () => setSpaceDown(false);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [undo, redo, zoomBy]);

  // -------------------------------------------------------- otomatik kayıt

  useEffect(() => {
    const handle = window.setTimeout(() => {
      saveGridDraw({ version: 2, settings, style, mirror, fills: [...fills] });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [signature, settings, style, mirror, fills]);

  // ------------------------------------------------------------ ayarlar

  /**
   * Ayar güncellemesi. Geçmiş SİLİNMEZ: anlık görüntüler ayarları da
   * sakladığı için yapı değişiklikleri de geri alınabilir.
   */
  const patchSettings = (next: Partial<GridDrawSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    setHistoryTick((t) => t + 1);
  };

  const addGuides = (added: GuideShape[], label: string) => {
    if (!added.length) return;
    pushHistory('kılavuz ekleme');
    patchSettings({ guides: [...settings.guides, ...added] });
    setStatus(`${label} eklendi (Ctrl+Z ile geri alınır). Toplam ${settings.guides.length + added.length} kılavuz.`);
  };

  const removeGuide = (id: string) => {
    pushHistory('kılavuz silme');
    if (selectedGuide === id) setSelectedGuide(null);
    if (hoverGuide === id) setHoverGuide(null);
    patchSettings({ guides: settings.guides.filter((g) => g.id !== id) });
    setStatus('Kılavuz silindi (Ctrl+Z ile geri alınır).');
  };

  // ------------------------------------------------- kılavuzları düzenleme

  /** Daireyi sayısal olarak düzenler (yarıçap en az MIN_GUIDE_RADIUS kalır). */
  const updateCircle = (id: string, patch: Partial<Omit<GuideCircle, 'id' | 'kind'>>, push = true) => {
    if (push) pushHistory(`kılavuz düzenleme:${id}`);
    patchSettings({
      guides: settings.guides.map((guide) => {
        if (guide.id !== id || guide.kind !== 'circle') return guide;
        const num = (value: number | undefined, fallback: number) =>
          Number.isFinite(value) ? round2(value as number) : fallback;
        return {
          ...guide,
          cx: num(patch.cx, guide.cx),
          cy: num(patch.cy, guide.cy),
          r: Math.max(MIN_GUIDE_RADIUS, num(patch.r, guide.r)),
        };
      }),
    });
  };

  /** Çizgiyi sayısal olarak düzenler. */
  const updateLine = (id: string, patch: Partial<Omit<GuideLine, 'id' | 'kind'>>, push = true) => {
    if (push) pushHistory(`kılavuz düzenleme:${id}`);
    patchSettings({
      guides: settings.guides.map((guide) => {
        if (guide.id !== id || guide.kind !== 'line') return guide;
        const num = (value: number | undefined, fallback: number) =>
          Number.isFinite(value) ? round2(value as number) : fallback;
        return {
          ...guide,
          ax: num(patch.ax, guide.ax),
          ay: num(patch.ay, guide.ay),
          bx: num(patch.bx, guide.bx),
          by: num(patch.by, guide.by),
        };
      }),
    });
  };

  /** Çizgiyi, başlangıcı ve açısı sabit kalarak yeniden boyutlandırır. */
  const resizeLine = (guide: GuideLine, length: number) => {
    const dx = guide.bx - guide.ax;
    const dy = guide.by - guide.ay;
    const current = Math.hypot(dx, dy);
    if (current < 0.001) return;
    const k = Math.max(MIN_GUIDE_LENGTH, Number.isFinite(length) ? length : current) / current;
    updateLine(guide.id, { bx: round2(guide.ax + dx * k), by: round2(guide.ay + dy * k) });
  };

  // ---------------------------------------------------------- bölge boyama

  const toArtboard = (event: React.PointerEvent<SVGSVGElement>): Vec2 | null => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  /**
   * Kılavuz uçlarının ızgaraya kenetlenip kenetlenmeyeceği.
   *
   * Varsayılan KAPALI: daire ve çaprazlar istenen boyutta serbest çizilir.
   * Ctrl basılı tutmak kenetlenmeyi tersine çevirir.
   */
  const anchorPoint = (event: React.PointerEvent<SVGSVGElement>, point: Vec2): Vec2 => {
    const wantSnap = event.ctrlKey || event.metaKey ? !snapDraw : snapDraw;
    return wantSnap ? snapToGridPoint(point, guides) : point;
  };

  const withMirror = (active: GridDrawPlan, id: number): number[] => {
    const mode = mirrorRef.current;
    if (mode === 'none') return [id];
    return [id, ...mirrorRegions(active, [id], mode)];
  };

  /** Bir kılavuzun içini/dışını ya da bir yanını topluca doldurur. */
  const fillBulk = (ids: number[], label: string) => {
    if (!ids.length) return;
    pushHistory('toplu doldurma');
    setFills((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
    setHistoryTick((t) => t + 1);
    setStatus(`${label}: ${ids.length} bölge dolduruldu.`);
  };

  const fillDisc = (circle: GuideCircle, mode: 'in' | 'out') => {
    if (!plan) return;
    lastBulkRef.current = { kind: 'disc', id: circle.id, mode };
    fillBulk(
      regionsInDisc(plan, circle.cx, circle.cy, circle.r, mode),
      mode === 'in' ? 'Dairenin içi' : 'Dairenin dışı',
    );
  };

  /**
   * Halkayı doldurur: seçili daire ile YARIÇAPÇA EN YAKIN diğer daire arası.
   *
   * Taraf önemli değildir — iç ya da dış daireyi seçmek aynı sonucu verir.
   * Kılavuz çizgileri ve çaprazlar halkayı parçalara böldüğü için yay uçları
   * tam kılavuzlarda kesilir.
   */
  const fillRing = (guide: GuideCircle) => {
    if (!plan) return;
    const partner = ringPartner(guide);
    if (!partner) {
      setStatus('Halka için ikinci bir daire çizin (iki daire arası doldurulur).');
      return;
    }
    const outer = guide.r >= partner.r ? guide : partner;
    const inner = outer === guide ? partner : guide;
    const innerIds = new Set(regionsInDisc(plan, inner.cx, inner.cy, inner.r, 'in'));
    const ring = regionsInDisc(plan, outer.cx, outer.cy, outer.r, 'in').filter((id) => !innerIds.has(id));
    lastBulkRef.current = { kind: 'ring', outerId: outer.id, innerId: inner.id };
    fillBulk(ring, `Halka (r ${Math.round(inner.r)}–${Math.round(outer.r)})`);
  };

  /** Yarıçapça en yakın diğer daire — halka eşi. */
  const ringPartner = (circle: GuideCircle): GuideCircle | null =>
    settings.guides
      .filter((g): g is GuideCircle => g.kind === 'circle' && g.id !== circle.id)
      .sort((a, b) => Math.abs(a.r - circle.r) - Math.abs(b.r - circle.r))[0] ?? null;

  /**
   * DARALT: mevcut dolguyu seçili kılavuza göre keser (Pathfinder → Intersect).
   *
   * Halkayı bir çizginin bir yanıyla daralttığınızda **yay** elde edilir:
   * yayın uçları tam çizgi üzerinde kesilir. Üst üste uygulanabilir.
   */
  const narrowBy = (guide: GuideShape, mode: 'in' | 'out' | 1 | -1) => {
    if (!plan) return;
    if (!fills.size) {
      setStatus('Daraltmak için önce bir alanı boyayın (ör. ◍ halka).');
      return;
    }
    let keep: number[];
    let label: string;
    if (guide.kind === 'circle') {
      const where = mode === 'out' ? 'out' : 'in';
      keep = regionsInDisc(plan, guide.cx, guide.cy, guide.r, where);
      label = where === 'in' ? 'dairenin içi' : 'dairenin dışı';
    } else {
      const side = mode === -1 ? -1 : 1;
      keep = regionsOnSide(plan, { x: guide.ax, y: guide.ay }, { x: guide.bx, y: guide.by }, side);
      label = side === 1 ? 'çizginin bir yanı' : 'çizginin öbür yanı';
    }
    const next = intersectIds(fills, keep);
    if (!next.size) {
      setStatus(`Daraltma boş kaldı — dolgu ${label} ile kesişmiyor.`);
      return;
    }
    pushHistory('daraltma');
    setFills(next);
    setHistoryTick((t) => t + 1);
    setStatus(`Daraltıldı (${label}): ${next.size} göz kaldı. Ctrl+Z ile geri alınır.`);
  };

  const fillSide = (line: GuideLine, side: 1 | -1) => {
    if (!plan) return;
    fillBulk(
      regionsOnSide(plan, { x: line.ax, y: line.ay }, { x: line.bx, y: line.by }, side),
      side === 1 ? 'Çizginin bir yanı' : 'Çizginin öbür yanı',
    );
  };

  /** Seçili kılavuzun düzenleyicisi (tuvalde de vurgulanır). */
  const edited = settings.guides.find((g) => g.id === selectedGuide) ?? null;

  /**
   * Ok tuşlarıyla ince ayar. En güncel kapanışı ref'e yazarız; klavye
   * dinleyicisi bir kez bağlanıp her seferinde buradan çağırır.
   */
  const nudgeRef = useRef<(key: string, shift: boolean) => boolean>(() => false);
  nudgeRef.current = (key, shift) => {
    const guide = settings.guides.find((g) => g.id === selectedGuide);
    if (!guide) return false;
    const step = snapDraw ? guides.cell : shift ? 10 : 1;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return false;
    if (guide.kind === 'circle') {
      updateCircle(guide.id, { cx: round2(guide.cx + dx), cy: round2(guide.cy + dy) });
    } else {
      updateLine(guide.id, {
        ax: round2(guide.ax + dx),
        ay: round2(guide.ay + dy),
        bx: round2(guide.bx + dx),
        by: round2(guide.by + dy),
      });
    }
    return true;
  };

  const applyRegions = (ids: number[], value: boolean) => {
    setFills((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of ids) {
        if (value === next.has(id)) continue;
        if (value) next.add(id);
        else next.delete(id);
        changed = true;
      }
      return changed ? next : current;
    });
  };

  /** Taslağı state ve ref üzerinde birlikte günceller. */
  const writeDraft = (next: GuideDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  /** Taşıma önizlemesini state ve ref üzerinde birlikte günceller. */
  const writeMoving = (next: GuideMove | null) => {
    movingRef.current = next;
    setMoving(next);
  };

  /** Alan (dikdörtgen) seçimini state ve ref üzerinde birlikte günceller. */
  const writeRect = (next: AreaRect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  /** Tutamak sürüklemesini state ve ref üzerinde birlikte günceller. */
  const writeHandle = (next: HandleDraft | null) => {
    handleRef.current = next;
    setHandleDraft(next);
  };

  /** Tutamak boyutu (ekranda ~12 px): zoom ile birlikte büyür. */
  const handleSize = Math.max(6, 12 * (guides.size / Math.max(1, paperSize)));

  /**
   * Seçili kılavuzun tutamakları: dairede yarıçap (sağdaki kare), çizgide iki uç.
   * Önizleme (handleDraft) varsa tutamaklar önizlenen geometride çizilir.
   */
  const handleMarks = useMemo(() => {
    const guide = settings.guides.find((g) => g.id === selectedGuide);
    if (!guide) return [];
    const draftState = handleDraft && handleDraft.guideId === guide.id ? handleDraft : null;
    if (guide.kind === 'circle') {
      const r = draftState && draftState.kind === 'radius' ? draftState.r : guide.r;
      // Dört yönde tutamak: hangi taraftan çekerseniz çekin daire MERKEZDEN
      // büyür/küçülür — oranı ve merkezi hiçbir zaman bozulmaz.
      return [
        { guideId: guide.id, kind: 'radius' as const, point: { x: guide.cx + r, y: guide.cy } },
        { guideId: guide.id, kind: 'radius' as const, point: { x: guide.cx, y: guide.cy + r } },
        { guideId: guide.id, kind: 'radius' as const, point: { x: guide.cx - r, y: guide.cy } },
        { guideId: guide.id, kind: 'radius' as const, point: { x: guide.cx, y: guide.cy - r } },
      ];
    }
    const a = draftState && draftState.kind === 'a' ? draftState.point : { x: guide.ax, y: guide.ay };
    const b = draftState && draftState.kind === 'b' ? draftState.point : { x: guide.bx, y: guide.by };
    return [
      { guideId: guide.id, kind: 'a' as const, point: a },
      { guideId: guide.id, kind: 'b' as const, point: b },
    ];
  }, [settings.guides, selectedGuide, handleDraft]);

  /** Verilen nokta bir tutamağa denk geliyor mu? */
  const handleUnder = (p: Vec2) =>
    handleMarks.find((mark) => Math.hypot(mark.point.x - p.x, mark.point.y - p.y) <= hitTol) ?? null;

  /**
   * Geometri değiştiğinde son toplu doldurmayı (halka/disk) yeniden uygular.
   * Böylece halkayı tutamakla kalınlaştırınca dolgu da kendiliğinden tazelenir.
   */
  const scheduleBulkRefresh = (guideId: string) => {
    const op = lastBulkRef.current;
    if (!op) return;
    if (op.kind === 'ring' && (op.outerId === guideId || op.innerId === guideId)) {
      pendingBulkRef.current = op;
    } else if (op.kind === 'disc' && op.id === guideId) {
      pendingBulkRef.current = op;
    }
  };

  /** Kılavuzu yakalar ve taşıma önizlemesini başlatır (önizleme plan kurmaz). */
  const grabGuide = (guide: GuideShape, from: Vec2) => {
    setSelectedGuide(guide.id);
    setHoverGuide(guide.id);
    writeMoving({ id: guide.id, from, dx: 0, dy: 0 });
    setStatus(`${formatGuide(guide)} — sürükleyerek taşıyın · ok tuşları = ince ayar · Esc = bitir`);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return; // orta/sağ tuş: gezdirme artboard'da yakalanır
    if (panModeRef.current || spaceRef.current) return; // gezdirme modunda çizim yok
    const raw = toArtboard(event);
    if (!raw) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    // --- Tutamak her araç modunda önceliklidir: seçili daireyi büyüt/küçült
    const mark = handleUnder(raw);
    const markedGuide = mark ? settings.guides.find((g) => g.id === mark.guideId) : null;
    if (mark && markedGuide) {
      if (mark.kind === 'radius' && markedGuide.kind === 'circle') {
        writeHandle({ guideId: markedGuide.id, kind: 'radius', r: markedGuide.r });
        setStatus('Yarıçapı sürükleyin — daire merkezden büyür/küçülür, oranı bozulmaz.');
      } else if (markedGuide.kind === 'line' && mark.kind !== 'radius') {
        writeHandle({ guideId: markedGuide.id, kind: mark.kind, point: mark.point });
        setStatus('Çizgi ucunu sürükleyin.');
      } else {
        return;
      }
      return;
    }

    // --- Kılavuz çizme modu
    if (guideTool === 'circle' || guideTool === 'line') {
      const start = anchorPoint(event, raw);
      writeDraft(
        guideTool === 'circle'
          ? { kind: 'circle', cx: start.x, cy: start.y, r: 0 }
          : { kind: 'line', a: start, b: start },
      );
      return;
    }

    if (!plan) return;
    const hit = guideNear(settings.guides, raw, hitTol);
    const target = regionAt(plan, raw);
    const onRegion = Boolean(target && plan.byId[target]);

    /*
     * Taşıma modunda kılavuz önceliklidir. Boyama modunda ise yalnızca bölge
     * YOKSA (ızgara çizgisi / kılavuz duvarı üstünde) taşımaya geçilir; böylece
     * bölge boyama hiçbir zaman engellenmez ve kullanıcı modda takılı kalmaz.
     */
    if (hit && (guideTool === 'move' || !onRegion)) {
      grabGuide(hit, raw);
      return;
    }

    if (!onRegion) {
      setStatus('Bu noktada bölge yok — ızgara çizgisinin üstündesiniz.');
      return;
    }

    // Shift + sürükle: dikdörtgen alanı süpür (büyük dolgular için).
    if (event.shiftKey) {
      pushHistory('alan boyama');
      paintRef.current = paintTool === 'fill';
      writeRect({ from: raw, to: raw });
      setStatus('Alan seçimi: sürükleyip bırakın — içindeki bütün gözler boyanır.');
      return;
    }

    pushHistory('boyama');
    lastPaintRef.current = raw;
    const ids = withMirror(plan, target);
    const value = paintTool === 'fill';
    paintRef.current = value;
    applyRegions(ids, value);
    setStatus(
      value
        ? `${ids.length} bölge dolduruldu${mirrorRef.current !== 'none' ? ' (aynalı)' : ''}`
        : `${ids.length} bölge boşaltıldı`,
    );
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const raw = toArtboard(event);
    if (!raw) return;

    // --- Tutamak sürüklemesi (canlı önizleme; plan sadece bırakınca yenilenir)
    const activeHandle = handleRef.current;
    if (activeHandle) {
      const guide = settings.guides.find((g) => g.id === activeHandle.guideId);
      if (guide?.kind === 'circle' && activeHandle.kind === 'radius') {
        const distance = Math.hypot(raw.x - guide.cx, raw.y - guide.cy);
        const stepped = snapDraw ? Math.round(distance / guides.cell) * guides.cell : distance;
        const r = Math.max(MIN_GUIDE_RADIUS, round2(stepped));
        writeHandle({ guideId: guide.id, kind: 'radius', r });
        setStatus(`Yarıçap: ${Math.round(r)}`);
      } else if (guide?.kind === 'line' && activeHandle.kind !== 'radius') {
        writeHandle({ guideId: guide.id, kind: activeHandle.kind, point: anchorPoint(event, raw) });
      }
      return;
    }

    // --- Alan (dikdörtgen) seçimi
    const activeRect = rectRef.current;
    if (activeRect) {
      writeRect({ ...activeRect, to: raw });
      return;
    }

    // --- Kılavuz taşıma (canlı önizleme; plan sadece bırakınca yenilenir)
    const active = movingRef.current;
    if (active) {
      const step = snapDraw ? guides.cell : 1;
      writeMoving({
        ...active,
        dx: Math.round((raw.x - active.from.x) / step) * step,
        dy: Math.round((raw.y - active.from.y) / step) * step,
      });
      return;
    }

    // --- Kılavuz önizlemesi
    const current = draftRef.current;
    if (current) {
      writeDraft(
        current.kind === 'circle'
          ? { ...current, r: Math.hypot(raw.x - current.cx, raw.y - current.cy) }
          : { ...current, b: anchorPoint(event, raw) },
      );
      return;
    }

    // --- İmlecin altındaki kılavuz: taşımaya hazır olduğunu göster
    setHoverGuide(guideNear(settings.guides, raw, hitTol)?.id ?? null);
    setHandleHover(handleUnder(raw) !== null);

    // Çizim araçları açıkken bölge etkileşimi yoktur.
    if (guideTool === 'circle' || guideTool === 'line') return;

    // --- Bölge vurgusu + boyama
    if (!plan) return;
    const id = regionAt(plan, raw);
    setHover(plan.byId[id] ? id : 0);

    const mode = paintRef.current;
    if (mode === null) return;
    // Fırça izi: son nokta ile şimdiki nokta arasındaki bütün hücreler boyanır
    // (fare olayları arasında kalan kareler atlanmaz).
    const swept = strokeRegions(plan, lastPaintRef.current ?? raw, raw);
    lastPaintRef.current = raw;
    if (!swept.length) return;
    const ids: number[] = [];
    for (const sweptId of swept) ids.push(...withMirror(plan, sweptId));
    applyRegions(ids, mode);
    setStatus(`${mode ? 'Dolduruldu' : 'Boşaltıldı'}: ${swept.length} göz (fırça izi).`);
  };

  const endPointer = () => {
    // --- Tutamak bırakıldı: tek seferde uygula
    const handled = handleRef.current;
    if (handled) {
      writeHandle(null);
      const guide = settings.guides.find((g) => g.id === handled.guideId);
      if (guide && handled.kind === 'radius' && guide.kind === 'circle') {
        if (Math.abs(guide.r - handled.r) > 0.01) {
          updateCircle(guide.id, { r: handled.r });
          scheduleBulkRefresh(guide.id);
          setStatus(`Yarıçap ${Math.round(handled.r)} (Ctrl+Z ile geri alınır).`);
        }
      } else if (guide && guide.kind === 'line' && handled.kind !== 'radius') {
        updateLine(
          guide.id,
          handled.kind === 'a'
            ? { ax: handled.point.x, ay: handled.point.y }
            : { bx: handled.point.x, by: handled.point.y },
        );
        setStatus('Çizgi ucu taşındı (Ctrl+Z ile geri alınır).');
      }
      return;
    }

    // --- Alan seçimini uygula
    const area = rectRef.current;
    if (area) {
      writeRect(null);
      const value = paintRef.current;
      paintRef.current = null;
      if (plan && value !== null) {
        const swept = regionsInRect(plan, area.from, area.to);
        const ids: number[] = [];
        for (const sweptId of swept) ids.push(...withMirror(plan, sweptId));
        applyRegions(ids, value);
        setHistoryTick((t) => t + 1);
        setStatus(
          `${value ? 'Dolduruldu' : 'Boşaltıldı'}: ${swept.length} göz (alan seçimi).`,
        );
      }
      return;
    }

    const handledMove = movingRef.current;
    if (handledMove) {
      const guide = settings.guides.find((g) => g.id === handledMove.id);
      const dx = round2(handledMove.dx);
      const dy = round2(handledMove.dy);
      writeMoving(null);
      if (guide && (dx || dy)) {
        pushHistory('kılavuz taşıma');
        if (guide.kind === 'circle') {
          updateCircle(guide.id, { cx: round2(guide.cx + dx), cy: round2(guide.cy + dy) }, false);
        } else {
          updateLine(
            guide.id,
            {
              ax: round2(guide.ax + dx),
              ay: round2(guide.ay + dy),
              bx: round2(guide.bx + dx),
              by: round2(guide.by + dy),
            },
            false,
          );
        }
        setStatus(`Kılavuz taşındı — ${dx} / ${dy} birim (Ctrl+Z ile geri alınır).`);
      }
      return;
    }
    const committed = draftRef.current;
    if (committed) {
      writeDraft(null);
      const rounded = committed.kind === 'circle' ? { ...committed, r: Math.round(committed.r) } : committed;
      // Neredeyse hiç sürüklenmemiş bir çizim denemesi = "seçme tıklaması".
      // Altında bir kılavuz varsa onu seçer; böylece hangi araç açık olursa
      // olsun çembere tıklayıp tutamağı çıkarmak mümkün olur.
      const tooSmall =
        rounded.kind === 'circle'
          ? rounded.r < MIN_GUIDE_RADIUS
          : Math.hypot(rounded.b.x - rounded.a.x, rounded.b.y - rounded.a.y) < MIN_GUIDE_LENGTH;
      const tap = rounded.kind === 'circle' ? { x: rounded.cx, y: rounded.cy } : rounded.a;
      const under = tooSmall ? guideNear(settings.guides, tap, hitTol) : null;
      if (under) {
        setSelectedGuide(under.id);
        setHoverGuide(under.id);
        setStatus(`${formatGuide(under)} seçildi — tuvaldeki ◻ tutamağı sürükleyerek boyutlandırın.`);
        return;
      }
      if (rounded.kind === 'circle') {
        if (rounded.r >= MIN_GUIDE_RADIUS) {
          addGuides([circleGuide(Math.round(rounded.cx), Math.round(rounded.cy), rounded.r)], `Daire (r ${rounded.r})`);
        } else {
          setStatus('Daire çok küçük — sürükleyerek yarıçapı belirleyin.');
        }
      } else {
        const length = Math.hypot(rounded.b.x - rounded.a.x, rounded.b.y - rounded.a.y);
        if (length >= MIN_GUIDE_LENGTH) {
          addGuides([lineGuide(rounded.a, rounded.b)], 'Kılavuz çizgisi');
        } else {
          setStatus('Çizgi çok kısa — sürükleyerek çizin.');
        }
      }
      return;
    }
    if (paintRef.current !== null) setHistoryTick((t) => t + 1);
    paintRef.current = null;
    lastPaintRef.current = null;
  };

  // ------------------------------------------------------------- çıktı

  const cleanSvg = useMemo(
    () => (plan ? buildGridDrawSvg(plan, fills, style, merged) : ''),
    [plan, fills, style, merged],
  );

  const previewUrl = useMemo(
    () => (cleanSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}` : ''),
    [cleanSvg],
  );

  const exportSvg = () => {
    if (!fills.size) {
      setStatus('Önce birkaç bölge doldurun.');
      return;
    }
    downloadFile('grid-logo.svg', cleanSvg, 'image/svg+xml');
    setStatus('SVG indirildi — kılavuzlar çıktıya dahil edilmedi.');
  };

  const [pngBusy, setPngBusy] = useState(false);
  const exportPng = async () => {
    if (!plan || !fills.size) {
      setStatus('Önce birkaç bölge doldurun.');
      return;
    }
    setPngBusy(true);
    try {
      const blob = await buildPng(
        cleanSvg,
        { x: 0, y: 0, width: plan.width, height: plan.height },
        { size: 2048, transparent: style.transparent, trimToArtwork: false, padding: 0 },
      );
      downloadFile('grid-logo-2048.png', blob, 'image/png');
      setStatus('PNG indirildi (2048px).');
    } catch (error) {
      setStatus(`PNG oluşturulamadı: ${(error as Error).message}`);
    } finally {
      setPngBusy(false);
    }
  };

  /** Yalnızca dolguları siler; ızgara ve kılavuzlar yerinde kalır. */
  const clearFills = () => {
    if (!fills.size) return;
    pushHistory('dolguları temizleme');
    setFills(new Set());
    setHistoryTick((t) => t + 1);
    setStatus('Tüm dolgular temizlendi — ızgara ve kılavuzlar yerinde.');
  };

  /** Ekranı sıfırlar: dolgular ve kılavuzlar silinir, ızgara 24×24'e döner. */
  const clearScreen = () => {
    pushHistory('ekranı temizleme');
    setFills(new Set());
    writeDraft(null);
    writeMoving(null);
    setSelectedGuide(null);
    setGuideTool('none');
    setSettings(normalizeSettings(DEFAULT_GRID_DRAW));
    clearGridDraw();
    setHistoryTick((t) => t + 1);
    setStatus(`Ekran temizlendi — ${DEFAULT_GRID_DRAW.grid}×${DEFAULT_GRID_DRAW.grid} ızgara, kılavuz yok.`);
  };

  /**
   * HAZIR GRID uygular: ızgara + kılavuzlar gelir, dolgular temizlenir.
   *
   * Şablon bir BAŞLANGIÇTIR ("logo hariç"): tuval boş açılır, çizim/ boyama
   * kullanıcıya kalır. Geri al ile şablon öncesi durum geri gelir.
   */
  const applyPreset = (preset: GridPreset) => {
    const next = preset.build(settings.size);
    pushHistory(`hazır ızgara:${preset.id}`);
    setFills(new Set());
    writeDraft(null);
    writeMoving(null);
    setSelectedGuide(null);
    setGuideTool('none');
    setSettings((current) => ({ ...current, grid: next.grid, guides: next.guides }));
    setHistoryTick((t) => t + 1);
    setStatus(
      `${preset.label} yüklendi — ${next.grid}×${next.grid} ızgara, ${next.guides.length} kılavuz. Tuval boş: boyamaya hazır.`,
    );
  };

  // ------------------------------------------------------------ kılavuz

  const gridLinePath = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i <= guides.cols; i++) {
      const x = Math.round(i * guides.cellW * 100) / 100;
      parts.push(`M ${x} 0 L ${x} ${guides.size}`);
    }
    for (let j = 0; j <= guides.rows; j++) {
      const y = Math.round(j * guides.cellH * 100) / 100;
      parts.push(`M 0 ${y} L ${guides.size} ${y}`);
    }
    return parts.join(' ');
  }, [guides]);

  const hoverRegion = plan && plan.byId[hover] ? plan.byId[hover] : null;
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  void historyTick;

  const mergedInfo = style.merge
    ? merged
      ? `${merged.parts} parça`
      : fills.size
        ? 'hesaplanıyor…'
        : 'dolgu yok'
    : 'kapalı';

  const circleCount = settings.guides.filter((g) => g.kind === 'circle').length;
  const lineCount = settings.guides.length - circleCount;

  return (
    <div className="gd">
      <header className="gd__top">
        <div className="gd__brand">
          <span className="gd__mark">✦</span>
          <span>
            Logo<span className="gd__muted">Studio</span>
          </span>
          <small>GRID DRAW</small>
        </div>
        <div className="gd__actions">
          <button
            type="button"
            className={paintTool === 'fill' && guideTool === 'none' ? 'gd__btn gd__btn--primary' : 'gd__btn'}
            onClick={() => {
              setGuideTool('none');
              setPanMode(false);
              setPaintTool('fill');
              setStatus('Doldur (F): gözün üstüne tıklayın ya da sürükleyin.');
            }}
            title="Doldur — tıkla ya da sürükle (F)"
          >
            ✚ Doldur
          </button>
          <button
            type="button"
            className={paintTool === 'erase' && guideTool === 'none' ? 'gd__btn gd__btn--primary' : 'gd__btn'}
            onClick={() => {
              setGuideTool('none');
              setPanMode(false);
              setPaintTool('erase');
              setStatus('Boşalt (E): tıklayın ya da sürükleyin — dolgular silinir.');
            }}
            title="Boşalt — tıkla ya da sürükle (E)"
          >
            ⊖ Boşalt
          </button>

          <span className="gd__sep" />

          <button type="button" className="gd__btn" onClick={undo} disabled={!canUndo} title="Geri al (Ctrl+Z)">
            ↶ Geri al
          </button>
          <button type="button" className="gd__btn" onClick={redo} disabled={!canRedo} title="İleri al (Ctrl+Shift+Z)">
            ↷ İleri al
          </button>

          <span className="gd__sep" />

          <div className="gd__zoom" title="Yakınlaştır / uzaklaştır (Ctrl + tekerlek, + / −)">
            <button
              type="button"
              className={panMode ? 'gd__zoom-pan gd__zoom-pan--on' : 'gd__zoom-pan'}
              onClick={() => {
                setGuideTool('none');
                setPanMode((v) => !v);
                setStatus('Gezdirme: sahneyi fare ile sürükleyin (boşluk tuşu da çalışır).');
              }}
              title="Sahneyi gezdir (H veya boşluk tuşu) — büyütünce kaydırmak için"
            >
              ✋
            </button>
            <button type="button" onClick={() => zoomAtCenter(1 / ZOOM_STEP)} title="Uzaklaştır (−)">
              −
            </button>
            <button type="button" className="gd__zoom-pct" onClick={resetView} title="Sığdır ve ortala (0)">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => zoomAtCenter(ZOOM_STEP)} title="Yakınlaştır (+)">
              +
            </button>
          </div>

          <span className="gd__sep" />

          <button
            type="button"
            className="gd__btn"
            onClick={clearScreen}
            disabled={!fills.size && settings.guides.length === 0}
            title="Dolguları ve kılavuzları siler, ızgara başa döner"
          >
            🧹 Ekranı temizle
          </button>
          <button type="button" className="gd__btn" onClick={onOpenStudio} title="Tam vektör editöre geç">
            Vector Studio →
          </button>
          <button type="button" className="gd__btn gd__btn--primary" onClick={exportSvg} disabled={!fills.size}>
            SVG indir ↓
          </button>
        </div>
      </header>

      <div className="gd__body">
        {/* ------------------------------------------------------ sol panel */}
        <aside className="gd__panel">
          <div className="gd__panel-title">IZGARA VE KILAVUZLAR</div>

          <label className="gd__label">IZGARA (DÜŞEY = YATAY)</label>
          <div className="gd__field">
            <span>Bölme</span>
            <input
              type="number"
              min={MIN_DIVISIONS}
              max={MAX_DIVISIONS}
              value={settings.grid}
              onChange={(e) => {
                pushHistory('ızgara');
                patchSettings({ grid: Number(e.target.value) });
              }}
            />
          </div>
          <p className="gd__note">
            Hücre <strong>{Math.round(guides.cell)}×{Math.round(guides.cell)}</strong> birim — kare. Kare hücre
            sayesinde köşe çaprazları her kareyi <strong>tam ikiye</strong> böler.
          </p>

          <label className="gd__label">HAZIR GRIDLER</label>
          <div className="gd__presets">
            {GRID_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="gd__preset"
                onClick={() => applyPreset(preset)}
                title={`${preset.hint} — dolgular temizlenir, tuval boş açılır (geri alınabilir)`}
              >
                <span className="gd__preset-label">{preset.label}</span>
                <span className="gd__preset-hint">{preset.hint}</span>
              </button>
            ))}
          </div>
          <p className="gd__note">
            Hazır grid <strong>ızgara + kılavuzları</strong> kurar; dolgu koymaz. Böylece aynı sistemin üzerinde
            <strong> kendi logonuzu</strong> çizersiniz. <strong>Ctrl+Z</strong> ile geri alınır.
          </p>

          <label className="gd__label">KILAVUZ ÇİZ / TAŞI</label>
          <div className="gd__btnrow">
            <button
              type="button"
              className={guideTool === 'circle' ? 'gd__btn gd__btn--primary' : 'gd__btn'}
              onClick={() => {
                setPanMode(false);
                setGuideTool((t) => (t === 'circle' ? 'none' : 'circle'));
                setStatus('Daire: merkezden dışa sürükleyin — istediğiniz yarıçapta. Esc = bitir.');
              }}
            >
              ◯ Daire
            </button>
            <button
              type="button"
              className={guideTool === 'line' ? 'gd__btn gd__btn--primary' : 'gd__btn'}
              onClick={() => {
                setPanMode(false);
                setGuideTool((t) => (t === 'line' ? 'none' : 'line'));
                setStatus('Çizgi: baştan sona sürükleyin — istediğiniz uzunluk ve açıda. Esc = bitir.');
              }}
            >
              ╱ Çizgi
            </button>
            <button
              type="button"
              className={guideTool === 'move' ? 'gd__btn gd__btn--primary' : 'gd__btn'}
              onClick={() => {
                setPanMode(false);
                setGuideTool((t) => (t === 'move' ? 'none' : 'move'));
                setStatus('Taşı (M): çizdiğiniz dairenin çemberine/çizginin üzerine basıp sürükleyin.');
              }}
              title="Çizilmiş daireyi/çizgiyi taşı (M)"
            >
              ✥ Taşı
            </button>
          </div>

          <button
            type="button"
            className={snapDraw ? 'gd__wide gd__wide--on' : 'gd__wide'}
            onClick={() => setSnapDraw((v) => !v)}
            title="Kılavuz uçlarını ızgara kavşaklarına kenetler"
          >
            ⌗ Izgaraya kenetle — {snapDraw ? 'AÇIK' : 'KAPALI'}
          </button>
          <p className="gd__note">
            Kenetlenme kapalıyken daire ve çaprazları <strong>istediğiniz boyutta</strong> çizersiniz. Ctrl
            basılı tutmak kenetlenmeyi tersine çevirir. Taşımak için <strong>✥ Taşı</strong> (kısayol <strong>M</strong>):
            dairenin çemberine ya da çizginin üzerine basıp sürükleyin — imleç kılavuzun üstünde tutma şekline döner.
          </p>
          {guideTool !== 'none' && (
            <p className="gd__note gd__note--active">
              <strong>{guideTool === 'move' ? 'Taşıma modu açık.' : 'Çizim modu açık.'}</strong>{' '}
              {guideTool === 'move'
                ? 'Kılavuzun üzerine basıp sürükleyin; kılavuz dışında normal boyarsınız.'
                : 'Bölge boyama geçici olarak kapalı.'}{' '}
              Bitirmek için <strong>Esc</strong>.
            </p>
          )}

          {settings.guides.length > 0 && (
            <>
              <div className="gd__guide-head">
                <span>KILAVUZLAR ({settings.guides.length})</span>
                <button
                  type="button"
                  className="gd__mini"
                  onClick={() => {
                    pushHistory('tüm kılavuzları silme');
                    patchSettings({ guides: [] });
                    setSelectedGuide(null);
                    setStatus('Tüm kılavuzlar silindi — yalnızca ızgara kaldı.');
                  }}
                >
                  tümünü sil
                </button>
              </div>
              <ul className="gd__guide-list">
                {settings.guides.map((guide) => (
                  <li
                    key={guide.id}
                    className={selectedGuide === guide.id ? 'gd__guide-item gd__guide-item--on' : 'gd__guide-item'}
                  >
                    <button
                      type="button"
                      className="gd__guide-pick"
                      onClick={() => setSelectedGuide((s) => (s === guide.id ? null : guide.id))}
                      title="Seç — tuvalde vurgulanır, sayısal düzenleyici açılır"
                    >
                      {formatGuide(guide)}
                    </button>
                    <button type="button" className="gd__mini" onClick={() => removeGuide(guide.id)} title="Sil">
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              {edited && (
                <div className="gd__nums">
                  <p className="gd__note gd__nums-wide">
                    <strong>Seçili kılavuz:</strong> tuvaldeki <strong>◻ tutamağı</strong> sürükleyerek boyutu/yarıçapı
                    fareyle oynatın (halka kalınlığı böyle değişir); aşağıdan da doldurup ince ayar yapabilirsiniz.
                  </p>
                  {edited.kind === 'circle' ? (
                    <>
                      <button type="button" className="gd__btn gd__btn--primary" onClick={() => fillDisc(edited, 'in')}>
                        ⬤ İçini doldur
                      </button>
                      <button type="button" className="gd__btn" onClick={() => fillDisc(edited, 'out')}>
                        ⬡ Dışını doldur
                      </button>
                      <button
                        type="button"
                        className="gd__btn gd__nums-wide"
                        onClick={() => fillRing(edited)}
                        disabled={!ringPartner(edited)}
                        title={
                          ringPartner(edited)
                            ? 'İki daire arasındaki halkayı doldurur (kalın yay/çember)'
                            : 'Halka için ikinci bir daire çizin'
                        }
                      >
                        ◍ Aradaki halkayı doldur
                        {ringPartner(edited)
                          ? ` (r ${Math.round(Math.min(edited.r, ringPartner(edited)!.r))}–${Math.round(
                              Math.max(edited.r, ringPartner(edited)!.r),
                            )})`
                          : ''}
                      </button>
                      <p className="gd__note gd__nums-wide">
                        <strong>Daralt (kes):</strong> mevcut dolguyu bu daireyle kesiştirir — halkayı çizgiyle kesip
                        yay elde edin.
                      </p>
                      <button
                        type="button"
                        className="gd__btn"
                        onClick={() => narrowBy(edited, 'in')}
                        title="Yalnızca bu dairenin içinde kalanları bırak"
                      >
                        ∩ İçine daralt
                      </button>
                      <button
                        type="button"
                        className="gd__btn"
                        onClick={() => narrowBy(edited, 'out')}
                        title="Yalnızca bu dairenin dışında kalanları bırak"
                      >
                        ∩ Dışına daralt
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="gd__btn gd__btn--primary" onClick={() => fillSide(edited, 1)}>
                        ◀ Bir yanı doldur
                      </button>
                      <button type="button" className="gd__btn" onClick={() => fillSide(edited, -1)}>
                        ▶ Öbür yanı doldur
                      </button>
                      <p className="gd__note gd__nums-wide">
                        <strong>Daralt (kes):</strong> mevcut dolguyu bu çizginin bir yanıyla kesiştirir.
                      </p>
                      <button
                        type="button"
                        className="gd__btn"
                        onClick={() => narrowBy(edited, 1)}
                        title="Yalnızca çizginin bir yanında kalanları bırak"
                      >
                        ∩◀ Yanına daralt
                      </button>
                      <button
                        type="button"
                        className="gd__btn"
                        onClick={() => narrowBy(edited, -1)}
                        title="Yalnızca çizginin öbür yanında kalanları bırak"
                      >
                        ∩▶ Yanına daralt
                      </button>
                    </>
                  )}

                  {/* Sayısal alanlar */}
                  {edited.kind === 'circle' ? (
                    <>
                      <label>
                        <span>X</span>
                        <input
                          type="number"
                          value={round2(edited.cx)}
                          onChange={(e) => updateCircle(edited.id, { cx: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Y</span>
                        <input
                          type="number"
                          value={round2(edited.cy)}
                          onChange={(e) => updateCircle(edited.id, { cy: Number(e.target.value) })}
                        />
                      </label>
                      <label className="gd__nums-wide">
                        <span>Yarıçap</span>
                        <input
                          type="number"
                          min={MIN_GUIDE_RADIUS}
                          value={round2(edited.r)}
                          onChange={(e) => updateCircle(edited.id, { r: Number(e.target.value) })}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>X1</span>
                        <input
                          type="number"
                          value={round2(edited.ax)}
                          onChange={(e) => updateLine(edited.id, { ax: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Y1</span>
                        <input
                          type="number"
                          value={round2(edited.ay)}
                          onChange={(e) => updateLine(edited.id, { ay: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>X2</span>
                        <input
                          type="number"
                          value={round2(edited.bx)}
                          onChange={(e) => updateLine(edited.id, { bx: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Y2</span>
                        <input
                          type="number"
                          value={round2(edited.by)}
                          onChange={(e) => updateLine(edited.id, { by: Number(e.target.value) })}
                        />
                      </label>
                      <label className="gd__nums-wide">
                        <span>Uzunluk</span>
                        <input
                          type="number"
                          min={MIN_GUIDE_LENGTH}
                          value={Math.round(Math.hypot(edited.bx - edited.ax, edited.by - edited.ay))}
                          onChange={(e) => resizeLine(edited, Number(e.target.value))}
                        />
                      </label>
                    </>
                  )}
                  <p className="gd__note gd__nums-wide">
                    Ok tuşları ile ince ayar: 1 birim · Shift = 10 birim
                    {snapDraw ? ' · kenetleme açık: hücre adımı' : ''}
                  </p>
                </div>
              )}
            </>
          )}
          {settings.guides.length === 0 && (
            <p className="gd__note">
              Kılavuz yok — yalnızca ızgara. Daire/çizgi çizmek için yukarıdaki araçları kullanın; çizdiklerinizi
              <strong> ✥ Taşı</strong> ile kaydırabilirsiniz.
            </p>
          )}

          <button
            type="button"
            className={showGridLines ? 'gd__wide gd__wide--on' : 'gd__wide'}
            onClick={() => setShowGridLines((v) => !v)}
          >
            ▦ Izgara çizgilerini göster
          </button>

          <label className="gd__label">AYNALAMA</label>
          <div className="gd__chips">
            {MIRROR_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={mirror === mode ? 'gd__chip gd__chip--on' : 'gd__chip'}
                onClick={() => setMirror(mode)}
              >
                {MIRROR_LABELS[mode]}
              </button>
            ))}
          </div>

          <label className="gd__label">LOGO RENGİ</label>
          <div className="gd__color">
            <input
              type="color"
              value={style.color}
              onChange={(e) => setStyle((s) => ({ ...s, color: e.target.value }))}
            />
            <code>{style.color}</code>
          </div>

          <label className="gd__label">ZEMİN</label>
          <div className="gd__color">
            <input
              type="color"
              value={style.background}
              onChange={(e) => setStyle((s) => ({ ...s, background: e.target.value }))}
            />
            <code>{style.background}</code>
          </div>
          <button
            type="button"
            className={style.transparent ? 'gd__wide gd__wide--on' : 'gd__wide'}
            onClick={() => setStyle((s) => ({ ...s, transparent: !s.transparent }))}
          >
            ▨ Şeffaf zemin
          </button>

          <label className="gd__label">ÇIKTI</label>
          <button
            type="button"
            className={style.merge ? 'gd__wide gd__wide--on' : 'gd__wide'}
            onClick={() => setStyle((s) => ({ ...s, merge: !s.merge }))}
            title="Komşu gözleri tek silüete indirir; paylaşılan kenarlar ve boşluklar kaybolur"
          >
            ⬚ Birleştir (tek silüet)
          </button>
          <button
            type="button"
            className={style.outline ? 'gd__wide gd__wide--on' : 'gd__wide'}
            onClick={() => setStyle((s) => ({ ...s, outline: !s.outline }))}
          >
            ◯ Kontur çiz
          </button>
          {style.outline && (
            <div className="gd__field">
              <span>Kalınlık</span>
              <input
                type="number"
                min={1}
                max={60}
                value={style.outlineWidth}
                onChange={(e) => setStyle((s) => ({ ...s, outlineWidth: Number(e.target.value) }))}
              />
            </div>
          )}
        </aside>

        {/* -------------------------------------------------------- tuval */}
        <section className="gd__stage">
          <div className="gd__stage-head">
            <span>
              BÖLGE BOYAMA · <strong>{plan ? plan.regions.length : '…'}</strong> göz
            </span>
            <div className="gd__live">
              <i />
              {building
                ? 'HESAPLANIYOR'
                : panMode || spaceDown
                  ? 'GEZDİRME'
                  : guideTool === 'move'
                    ? 'TAŞIMA MODU'
                    : guideTool !== 'none'
                      ? 'ÇİZİM MODU'
                      : `CANLI · ${PAINT_LABELS[paintTool].toUpperCase()}`}
            </div>
          </div>

          <div
            className={panMode || panning ? 'gd__artboard gd__artboard--pan' : 'gd__artboard'}
            ref={artboardRef}
            onPointerDown={(event) => {
              // Orta tuş ya da gezdirme modu: sahneyi kaydır (çizim yapma).
              if (event.button === 1 || panModeRef.current || spaceRef.current) {
                event.preventDefault();
                startPan(event.clientX, event.clientY);
              }
            }}
            onAuxClick={(event) => event.preventDefault()}
          >
            <div
              className={style.transparent ? 'gd__paper gd__paper--checker' : 'gd__paper'}
              ref={paperRef}
              style={{
                width: paperSize,
                height: paperSize,
                background: style.transparent ? undefined : style.background,
              }}
            >
            <svg
              viewBox={`0 0 ${guides.size} ${guides.size}`}
              className={[
                'gd__svg',
                building ? 'gd__svg--busy' : '',
                guideTool === 'circle' || guideTool === 'line' ? 'gd__svg--draw' : '',
                hoverGuide || handleHover ? 'gd__svg--grab' : '',
                panMode || spaceDown ? 'gd__svg--pan' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerLeave={() => {
                endPointer();
                setHover(0);
                setHoverGuide(null);
              }}
            >
              {/* Izgara — çıktıya girmez */}
              {showGridLines && <path d={gridLinePath} className="gd__grid" />}

              {/* Kullanıcı kılavuzları (taşınan kılavuz canlı kaydırılır) */}
              {settings.guides.map((guide) => {
                const offset = moving && moving.id === guide.id ? moving : { dx: 0, dy: 0 };
                const active = selectedGuide === guide.id || hoverGuide === guide.id;
                const draftState = handleDraft && handleDraft.guideId === guide.id ? handleDraft : null;
                if (guide.kind === 'circle') {
                  const r = draftState && draftState.kind === 'radius' ? draftState.r : guide.r;
                  return (
                    <circle
                      key={guide.id}
                      cx={guide.cx + offset.dx}
                      cy={guide.cy + offset.dy}
                      r={r}
                      className={active ? 'gd__circle gd__circle--on' : 'gd__circle'}
                    />
                  );
                }
                const a = draftState && draftState.kind === 'a' ? draftState.point : { x: guide.ax, y: guide.ay };
                const b = draftState && draftState.kind === 'b' ? draftState.point : { x: guide.bx, y: guide.by };
                return (
                  <line
                    key={guide.id}
                    x1={a.x + offset.dx}
                    y1={a.y + offset.dy}
                    x2={b.x + offset.dx}
                    y2={b.y + offset.dy}
                    className={active ? 'gd__diagonal gd__diagonal--on' : 'gd__diagonal'}
                  />
                );
              })}

              {/* Tutamaklar: seçili kılavuzun boyutu/yarıçapı fareyle değiştirilir */}
              {handleMarks.map((mark, i) => (
                <rect
                  key={`${mark.guideId}:${mark.kind}:${i}`}
                  x={mark.point.x - handleSize / 2}
                  y={mark.point.y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  className="gd__handle"
                />
              ))}

              {/* Yarıçap etiketi: seçili dairenin boyutu tuvalde okunur */}
              {edited && edited.kind === 'circle' && (
                <text
                  x={edited.cx + (handleDraft && handleDraft.kind === 'radius' ? handleDraft.r : edited.r) + handleSize}
                  y={edited.cy - handleSize * 0.6}
                  className="gd__handle-label"
                  style={{ fontSize: Math.max(9, 11 * (guides.size / Math.max(1, paperSize))) }}
                >
                  r {Math.round(handleDraft && handleDraft.kind === 'radius' ? handleDraft.r : edited.r)}
                </text>
              )}

              {/* Çizim önizlemesi */}
              {draft && draft.kind === 'circle' && draft.r > 0 && (
                <circle cx={draft.cx} cy={draft.cy} r={draft.r} className="gd__draft" />
              )}
              {draft && draft.kind === 'line' && (
                <line x1={draft.a.x} y1={draft.a.y} x2={draft.b.x} y2={draft.b.y} className="gd__draft" />
              )}

              {/*
                Doldurulmuş alan. "Birleştir" açıkken ÇIKTININ AYNISI gösterilir:
                birleştirme, ızgara çizgisine neredeyse teğet kalan saç teli
                inceliğindeki parçaları da kapattığı için tuval ile indirilen
                dosya birebir aynı görünür (yoksa tuvalde ince bir düz kesik
                kalıyordu). Birleştirme henüz hesaplanmadıysa göz göz çizilir.
              */}
              <g
                fill={style.color}
                fillRule="evenodd"
                stroke={style.color}
                strokeWidth={0.9}
                strokeLinejoin="round"
              >
                {merged ? (
                  <path d={merged.pathData} />
                ) : (
                  plan &&
                  [...fills].map((id) => {
                    const region = plan.byId[id];
                    if (!region) return null;
                    return <path key={id} d={region.pathData} />;
                  })
                )}
              </g>

              {/* Alan seçimi önizlemesi */}
              {rect && (
                <rect
                  x={Math.min(rect.from.x, rect.to.x)}
                  y={Math.min(rect.from.y, rect.to.y)}
                  width={Math.abs(rect.to.x - rect.from.x)}
                  height={Math.abs(rect.to.y - rect.from.y)}
                  className="gd__area"
                />
              )}

              {/* Fare altındaki bölge vurgusu */}
              {guideTool === 'none' && hoverRegion && !fills.has(hoverRegion.id) && (
                <path d={hoverRegion.pathData} className="gd__hover" fillRule="evenodd" />
              )}
              {guideTool === 'none' && hoverRegion && fills.has(hoverRegion.id) && (
                <path d={hoverRegion.pathData} className="gd__hover gd__hover--filled" fillRule="evenodd" />
              )}
            </svg>
            </div>
          </div>

          <div className="gd__stage-foot">
            <span>
              <strong>{fills.size}</strong> bölge dolu
              {hoverRegion && guideTool === 'none' ? ` · imleç: #${hoverRegion.id} (${hoverRegion.area} örnek)` : ''}
            </span>
            <span>Silüet: {mergedInfo}</span>
            <span>
              {panMode || spaceDown
                ? 'Gezdirme açık: tıklama sahneyi kaydırır — boyamak için ✋ kapatın (H) ya da F/E'
                : guideTool === 'move'
                  ? 'Kılavuza basıp sürükleyin · dışına basarsanız boyarsınız · ok tuşları = ince ayar'
                  : guideTool !== 'none'
                    ? 'Sürükleyerek çizin · Ctrl = kenetlenmeyi tersine çevir · Esc = bitir'
                    : `${PAINT_LABELS[paintTool]} aracı: tıkla/sürükle · boşluk+çek = sahne kaydır`}
            </span>
          </div>
        </section>

        {/* ------------------------------------------------------ sağ panel */}
        <aside className="gd__panel gd__panel--right">
          <div className="gd__panel-title">
            TEMİZ ÖNİZLEME <span>CLEAN</span>
          </div>
          <div className="gd__preview" style={{ background: style.transparent ? 'transparent' : style.background }}>
            {fills.size ? <img src={previewUrl} alt="Logo önizleme" /> : <span>Henüz dolgu yok</span>}
          </div>
          <p className="gd__note">
            Önizlemede ve çıktıda ızgara ve kılavuzlar <strong>yoktur</strong>. Yalnızca doldurduğunuz gözler kalır —
            hepsi gerçek vektör.
          </p>
          {style.merge && fills.size > 1 && (
            <p className="gd__note">
              <strong>Birleştir açık:</strong> komşu gözler tek silüet olduğu için paylaşılan kenarlar ve aralarındaki
              boşluklar kaybolur.
            </p>
          )}
          <div className="gd__btnrow">
            <button type="button" className="gd__btn gd__btn--primary" onClick={exportSvg} disabled={!fills.size}>
              SVG indir
            </button>
            <button type="button" className="gd__btn" onClick={exportPng} disabled={!fills.size || pngBusy}>
              {pngBusy ? 'PNG…' : 'PNG indir'}
            </button>
          </div>
          <button type="button" className="gd__wide" onClick={clearFills} disabled={!fills.size}>
            ⌫ Dolguları temizle (kılavuzlar kalsın)
          </button>

          <div className="gd__panel-title">NASIL ÇALIŞIR</div>
          <ol className="gd__help">
            <li>Üstteki <strong>Doldur</strong> aracıyla gözün üstüne tıkla ya da sürükle.</li>
            <li><strong>Boşalt</strong> aynı şekilde siler; Geri al her adımı saklar.</li>
            <li>Daireyi/çizgiyi <strong>Kılavuz çiz</strong> ile kendin çizersin; kesişimler bölge olur.</li>
            <li><strong>✥ Taşı</strong> ile çizdiğin daireyi ya da çizgiyi sürükleyip kaydır.</li>
            <li>Listeden bir kılavuz seç: tuvaldeki <strong>◻ tutamağı</strong> sürükleyip boyutunu/yarıçapını değiştir.</li>
            <li><strong>Gezdirme:</strong> <strong>✋</strong> (kısayol <strong>H</strong>) ya da <strong>boşluk</strong>+sürükle veya <strong>orta tuş</strong>+sürükle · tekerlek = kaydır, <strong>Ctrl</strong>+tekerlek = imlecin üstünde yakınlaştır.</li>
            <li><strong>Daireyi büyüt/küçült:</strong> çembere tıkla (hangi araç açık olursa olsun seçilir) → ◻ tutamaklardan birini çek; daire merkezden büyür, oranı bozulmaz.</li>
            <li>Halkayı kalınlaştır/incelt: iç daireyi seç, tutamağı çek — dolgu kendiliğinden tazelenir.</li>
            <li><strong>Shift + sürükle</strong> = dikdörtgen alan: içindeki bütün gözleri topluca boyar/siler.</li>
            <li><strong>Ctrl+Z</strong> her adımı geri alır: boyama, kılavuz çizme/taşıma/silme, ızgara değişikliği.</li>
            <li>SVG/PNG indir — kılavuzlar çıktıya girmez, tasarım tarayıcıda saklanır.</li>
          </ol>
        </aside>
      </div>

      <footer className="gd__status">
        <span className="gd__status-dot" />
        {status}
        <span className="gd__spacer" />
        <span>
          {guides.grid}×{guides.grid} ızgara · {circleCount} daire · {lineCount} çizgi ·{' '}
          {PAINT_LABELS[paintTool].toLowerCase()} · aynalama: {MIRROR_LABELS[mirror].toLowerCase()} ·{' '}
          {Math.round(zoom * 100)}%
        </span>
      </footer>
    </div>
  );
}
