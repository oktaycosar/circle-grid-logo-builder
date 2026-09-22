/**
 * Circle Grid Logo Builder — Internal data model.
 *
 * Bkz. Spesifikasyon madde 33: her artwork object yaklaşık olarak
 * id / type / name / x / y / width / height / rotation / fill / stroke /
 * strokeWidth / visible / locked / geometry / layerIndex alanlarını taşır.
 *
 * Tüm koordinatlar artboard (SVG user space) koordinatıdır: 0..1000.
 */

export const ARTBOARD_SIZE = 1000;

export type Vec2 = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number]; // a b c d e f

export type PathCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { cmd: 'Q'; c1x: number; c1y: number; x: number; y: number }
  | { cmd: 'Z' };

export interface SubPath {
  points: Vec2[];
  closed: boolean;
}

// ---------------------------------------------------------------- geometriler

export interface CircleGeometry {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface RectGeometry {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Daire gradyanına uyan, ölçeklenebilir kübik bezier elips. */
export interface EllipseGeometry {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Dış yarıçap ve kalınlıktan üretilen, fill olarak çizilen gerçek halka. */
export interface RingGeometry {
  kind: 'ring';
  cx: number;
  cy: number;
  outerRadius: number;
  thickness: number;
}

export interface LineGeometry {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * keypoint'ler her geometrinin kullanıcıya gösterilen "asıl" tanımıdır.
 * Boolean işlemleri de (unite/subtract/intersect) doğrudan bunlar üzerinden
 * çalışır; böylece birden fazla boolean sonucu tek bir keypoint listesinde
 * birleştirilen poligon olarak temsil edilebilir.
 */
export interface PolygonGeometry {
  kind: 'polygon';
  keypoints: Vec2[];
  /**
   * Ek loop'lar — boolean sonucunda oluşan delikler veya ayrık parçalar.
   * SVG `fill-rule="evenodd"` ile birleştirilir, bu yüzden yön (winding)
   * önemsizdir. `keypoints` her zaman birincil loop'tur.
   */
  extraLoops?: Vec2[][];
}

export interface PathGeometry {
  kind: 'path';
  subpaths: SubPath[];
  /** Alt yolları birbirine bağlayan path'ler (keypoint temsilinde delik açmak için). */
  connectors?: SubPath[];
}

export type Geometry =
  | CircleGeometry
  | RectGeometry
  | EllipseGeometry
  | RingGeometry
  | LineGeometry
  | PolygonGeometry
  | PathGeometry;

export type GeometryKind = Geometry['kind'];

// ------------------------------------------------------------------ objeler

export type ObjectType =
  | 'circle'
  | 'ring'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'path'
  | 'polygon'
  | 'group'
  | 'guide';

export type FillStyle =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: { offset: number; color: string }[] };

export interface ArtboardObject {
  id: string;
  type: ObjectType;
  name: string;
  /** Sonradan Path'e dönüştürülmüş geometrilerde hangi işlemden geldiği. */
  opLabel?: string;
  geometry: Geometry;
  /** Görsel dikdörtgen (unrotated, local space). Türetilmiş, cache edilir. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Derece, obje merkezi etrafında. */
  rotation: number;
  fill: FillStyle;
  stroke: string;
  strokeWidth: number;
  /**
   * 'stretch' — geometri x/y/width/height dikdörtgenini doldurur (rect, ellipse,
   *              ring, polygon, path…). Yeniden boyutlandırma bunları ölçekler.
   * 'uniform' — geometri mutlak ölçü taşır ve merkez etrafında ölçeklenir
   *              (circle r, line koordinatları).
   */
  sizing: 'stretch' | 'uniform';
  visible: boolean;
  locked: boolean;
  layerIndex: number;
  /** Guide objeleri export edilmez (madde 20). */
  isGuide?: boolean;
  /** İzometrik modda objenin ait olduğu küp yüzeyi. */
  isoFace?: IsoFace;
}

export interface GroupObject extends ArtboardObject {
  type: 'group';
  childIds: string[];
}

// -------------------------------------------------------------------- state

export type ToolId =
  | 'select'
  | 'direct-select'
  | 'rectangle'
  | 'circle'
  | 'ring'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'iso-cube'
  | 'shape-builder'
  | 'knife'
  | 'hand'
  | 'zoom';

export interface GridSettings {
  enabled: boolean;
  snap: boolean;
  size: number;
  divisions: number;
  opacity: number;
  majorEvery: number;
}

export interface DocumentSettings {
  artboardSize: number;
  background: string;
  /** Outline modda sadece path çizgileri gösterilir (madde 25). */
  outlineMode: boolean;
  showGuides: boolean;
  showAnchors: boolean;
  showSmartGuides: boolean;
}

export type ViewMode = 'construction' | 'logo';

export interface SnapLabel {
  x: number;
  y: number;
  text: string;
}

export interface SnapResult {
  point: Vec2;
  labels: SnapLabel[];
  guides: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface Camera {
  zoom: number;
  pan: Vec2;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pen tool çapası: `h` = dış kontrol tutamacı (mutlak konum). */
export interface PenAnchor {
  p: Vec2;
  h?: Vec2;
}

// ------------------------------------------------------------- izometrik

/** İzometrik küpün görünen yüzleri. */
export type IsoFace = 'top' | 'right' | 'left';

export const ISO_FACES: IsoFace[] = ['top', 'right', 'left'];

export interface IsoSettings {
  enabled: boolean;
  /** Izgara hücresi = izometrik kenar uzunluğu (artboard birimi). */
  cell: number;
  /** İzometrik latis noktalarına snap. */
  snap: boolean;
  /** Dikey çizgi ailesi gösterilsin mi. */
  showVerticals: boolean;
  /** Sürükleme sırasında hareketi izometrik eksenlere kilitle (Shift). */
  axisLock: boolean;
  opacity: number;
  /** Izgaranın (0,0) noktası — artboard birimi. */
  origin: Vec2;
  /** Üst / sağ / sol yüzeylerin renkleri. */
  faceColors: Record<IsoFace, string>;
  /** Cube tool: varsayılan kenar ve yükseklik (hücre). */
  cubeEdgeCells: number;
  cubeHeightCells: number;
}
