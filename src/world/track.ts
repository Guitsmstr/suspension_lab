/**
 * Circuitos conmutables y barrera perimetral que cierra el mapa pequeño.
 *
 * Cuatro trazados en dos superficies que usan casi todo el mapa (±140 m):
 * (ver listado abajo). El Nürburgring Nordschleife 1:1 vive en su propio
 * mundo grande (`src/world/ring/`, ~6×5 km con streaming) y solo comparte
 * con este módulo la ficha `TRACKS.nurburgring` (menú, minimapa, crono):
 * no entra en TRACK_ORDER y el esculpido/superficies de aquí no lo tocan.
 *
 * - Asfalto:
 *   · `monaco` — "Barranquilla" (~2000 m): anillo en B dibujado por el
 *     usuario por todo el mapa, con perimetral rápida e interior técnico
 *     (id interno histórico `monaco`; 9 m de ancho, salida en la recta oeste).
 *   · `interlagos` — "Interlagos Mini" (~410 m): mixto centro-este con S
 *     inicial, curva ciega, horquilla y subida.
 * - Tierra:
 *   · `baja` — "Baja Whoops" (~450 m): rápida oeste con la recta de badenes
 *     como tramo de saltos y una cerrada al fondo.
 *   · `stadium` — "Estadio Rallycross" (~290 m): técnico centro-oeste
 *     alrededor de la meseta: horquilla y esses.
 *
 * - La calzada es una malla densa (estaciones cada 0,5 m, carriles cada ≤1 m)
 *   ceñida al terreno analítico (la misma función de altura que usa la física),
 *   y el terreno se ESCULPE bajo su corredor (`makeTrackCarve`): los vértices
 *   de la malla de hierba quedan bajo la superficie de la cinta y descienden
 *   en pendiente suave hacia su altura natural, así la hierba nunca asoma por
 *   la pista ni hay que pelear el z-buffer. Es la técnica de los juegos AAA
 *   (landscape-spline de Unreal / Forza): una sola superficie continua, no dos
 *   mallas superpuestas.
 * - El asfalto lleva pianos rojo/blanco en las curvas; la tierra, conos
 *   naranjas marcando la trazada.
 * - La decoración evita los trazados (ver `routeKeepOut()`, usado por scenery).
 * - `enforceTrackBounds()` es el muro invisible: se llama una vez por frame.
 */
import * as THREE from 'three';
import type { Terrain } from './terrain';
import type { Vehicle } from '../vehicle/vehicle';
import { NURBURGRING_DEF } from './ring/ringDef';

export type TrackId = 'monaco' | 'interlagos' | 'baja' | 'stadium' | 'nurburgring';
/** Alias histórico: antes solo había dos modos (asfalto/tierra). */
export type TrackMode = TrackId;
export type TrackSurface = 'asfalto' | 'tierra';

export interface TrackDef {
  id: TrackId;
  /** Nombre del trazado (se muestra en el HUD y el menú). */
  name: string;
  surface: TrackSurface;
  /** Inspiración real y escala (se muestra en el menú). */
  inspiration: string;
  /** Descripción corta de las curvas clave (menú). */
  description: string;
  /** Insignia completa para el HUD. */
  badge: string;
  /** Puntos de paso [x, z]; curva cerrada suavizada. */
  points: Array<[number, number]>;
  /** Ancho de la calzada [m]. */
  width: number;
  /** Longitud exacta [m], si se conoce mejor que la curva (p. ej. el anillo 1:1 horneado). */
  lengthMeters?: number;
  /** Rugosidad del terreno al entrar al circuito (si se define). */
  defaultRoughness?: number;
  /** Líneas de borde blancas (solo asfalto). */
  edgeLines: boolean;
}

export const TRACKS: Record<TrackId, TrackDef> = {
  nurburgring: NURBURGRING_DEF,
  monaco: {
    id: 'monaco',
    name: 'Barranquilla',
    surface: 'asfalto',
    inspiration: 'Trazado custom · dibujo del usuario',
    description: 'Anillo en B de ~2 km por todo el mapa: perimetral rápida e interior técnico.',
    badge: '🏁 Barranquilla · asfalto',
    // Trazado dibujado a mano (.launch/espacio_para_dibujar.svg): 200 vértices
    // cada ~10 m con salida en mitad de la recta oeste (la más larga).
    // Se conserva el id interno 'monaco' para no tocar física, crono ni
    // tests; lo visible es Barranquilla.
    points: [
      [-136.2, 8.9],
      [-136.3, -1.1],
      [-136.4, -11.1],
      [-136.5, -21.1],
      [-136.5, -31.2],
      [-136.5, -41.2],
      [-136.4, -51.2],
      [-136.3, -61.2],
      [-136.1, -71.2],
      [-135.8, -81.2],
      [-135.4, -91.2],
      [-134.8, -101.2],
      [-133.9, -111.2],
      [-131.7, -121.0],
      [-125.0, -128.3],
      [-116.3, -133.2],
      [-106.8, -136.5],
      [-97.0, -138.6],
      [-87.1, -139.8],
      [-77.1, -140.0],
      [-67.1, -140.0],
      [-57.1, -140.0],
      [-47.1, -139.7],
      [-37.1, -138.7],
      [-27.2, -137.3],
      [-17.4, -135.3],
      [-8.0, -132.0],
      [0.5, -126.7],
      [6.2, -118.6],
      [7.7, -108.7],
      [6.6, -98.8],
      [4.4, -89.0],
      [2.5, -79.2],
      [0.0, -69.5],
      [-5.2, -61.0],
      [-13.5, -55.5],
      [-23.0, -52.4],
      [-32.8, -50.5],
      [-42.7, -49.0],
      [-52.6, -47.1],
      [-62.3, -44.8],
      [-71.8, -41.7],
      [-80.8, -37.2],
      [-88.9, -31.4],
      [-96.5, -24.8],
      [-103.2, -17.4],
      [-108.6, -9.0],
      [-112.5, 0.2],
      [-114.9, 9.9],
      [-116.0, 19.9],
      [-116.0, 29.9],
      [-114.9, 39.9],
      [-112.9, 49.7],
      [-110.7, 59.4],
      [-110.6, 69.4],
      [-110.4, 79.4],
      [-108.3, 89.2],
      [-103.2, 97.7],
      [-95.2, 103.8],
      [-85.9, 107.3],
      [-76.1, 109.2],
      [-66.4, 107.3],
      [-58.2, 101.6],
      [-51.4, 94.3],
      [-45.3, 86.3],
      [-39.8, 77.9],
      [-34.7, 69.3],
      [-30.0, 60.5],
      [-25.4, 51.6],
      [-21.0, 42.6],
      [-16.8, 33.5],
      [-12.7, 24.3],
      [-8.7, 15.1],
      [-4.8, 5.9],
      [-1.0, -3.3],
      [2.8, -12.6],
      [6.5, -21.9],
      [10.2, -31.2],
      [13.9, -40.5],
      [17.5, -49.9],
      [21.2, -59.2],
      [24.8, -68.5],
      [28.5, -77.8],
      [32.3, -87.1],
      [36.2, -96.3],
      [40.2, -105.5],
      [44.5, -114.6],
      [49.5, -123.3],
      [56.5, -130.3],
      [65.2, -135.2],
      [74.7, -138.2],
      [84.7, -139.2],
      [94.6, -137.9],
      [103.9, -134.2],
      [111.8, -128.2],
      [117.8, -120.2],
      [121.2, -110.8],
      [123.2, -101.0],
      [124.7, -91.1],
      [126.1, -81.2],
      [127.3, -71.2],
      [128.4, -61.3],
      [129.4, -51.3],
      [130.4, -41.3],
      [131.2, -31.3],
      [132.0, -21.3],
      [132.6, -11.4],
      [133.2, -1.4],
      [133.6, 8.7],
      [133.8, 18.7],
      [133.6, 28.7],
      [133.3, 38.7],
      [133.1, 48.7],
      [132.8, 58.7],
      [132.4, 68.7],
      [131.7, 78.7],
      [130.6, 88.7],
      [129.0, 98.6],
      [126.5, 108.3],
      [122.9, 117.6],
      [117.5, 126.0],
      [109.7, 132.2],
      [100.1, 134.7],
      [90.0, 134.8],
      [80.1, 133.8],
      [70.2, 132.0],
      [60.5, 129.8],
      [50.8, 127.2],
      [41.6, 123.3],
      [33.5, 117.3],
      [27.0, 109.8],
      [22.1, 101.1],
      [19.1, 91.5],
      [18.3, 81.6],
      [19.8, 71.7],
      [23.9, 62.6],
      [29.9, 54.6],
      [36.5, 47.1],
      [43.4, 39.7],
      [50.2, 32.4],
      [56.9, 25.0],
      [63.3, 17.3],
      [69.5, 9.4],
      [75.4, 1.3],
      [81.0, -7.0],
      [86.3, -15.5],
      [91.7, -23.9],
      [97.1, -32.4],
      [102.4, -40.9],
      [107.3, -49.6],
      [110.7, -59.0],
      [108.1, -68.1],
      [98.8, -71.5],
      [88.8, -72.4],
      [78.8, -72.2],
      [68.9, -70.6],
      [59.5, -67.2],
      [51.2, -61.6],
      [44.7, -54.1],
      [39.9, -45.3],
      [35.2, -36.4],
      [30.7, -27.5],
      [26.2, -18.5],
      [21.7, -9.6],
      [17.4, -0.6],
      [13.1, 8.5],
      [8.9, 17.6],
      [4.9, 26.8],
      [1.1, 36.0],
      [-2.5, 45.4],
      [-5.7, 54.9],
      [-7.9, 64.7],
      [-7.7, 74.6],
      [-5.6, 84.4],
      [-2.9, 94.1],
      [-2.1, 104.0],
      [-7.3, 112.3],
      [-15.7, 117.7],
      [-24.8, 122.0],
      [-34.2, 125.4],
      [-43.9, 128.0],
      [-53.7, 129.8],
      [-63.7, 131.1],
      [-73.6, 131.8],
      [-83.7, 132.2],
      [-93.7, 132.1],
      [-103.7, 131.2],
      [-113.5, 129.4],
      [-122.8, 125.7],
      [-129.7, 118.7],
      [-131.8, 108.9],
      [-132.7, 99.0],
      [-133.4, 89.0],
      [-134.0, 79.0],
      [-134.5, 69.0],
      [-134.9, 59.0],
      [-135.2, 49.0],
      [-135.5, 38.9],
      [-135.8, 28.9],
      [-136.0, 18.9],
    ],
    width: 10.8,
    edgeLines: true,
    // En esta pista el terreno va casi liso por defecto (ver applyTrack).
    defaultRoughness: 0.1,
  },
  interlagos: {
    id: 'interlagos',
    name: 'Interlagos Mini',
    surface: 'asfalto',
    inspiration: 'Interlagos · escala ≈ 1:12',
    description: 'Mixto centro-este: S inicial, curva ciega, horquilla y subida.',
    badge: '🛣 Interlagos Mini · asfalto',
    points: [
      [40, -40], // salida (S inicial)
      [68, -56],
      [94, -42],
      [100, -12], // curva ciega de la cima
      [84, 10],
      [94, 32], // exterior (a fondo)
      [74, 52],
      [44, 46],
      [24, 62], // horquilla alta
      [-6, 56],
      [-26, 36],
      [-30, 4], // bajada interior
      [-14, -16],
      [12, -26], // (a la meta)
    ],
    width: 7,
    edgeLines: true,
  },
  baja: {
    id: 'baja',
    name: 'Baja Whoops',
    surface: 'tierra',
    inspiration: 'Baja 1000 / Mint 400 · tramo de badenes',
    description: 'Rápida oeste con la recta de badenes como tramo de saltos.',
    badge: '🏜 Baja Whoops · tierra',
    points: [
      [-40, -16], // salida (badenes)
      [0, -17], // tramo de saltos (a fondo)
      [40, -15],
      [64, -4],
      [70, 28], // curvón este
      [46, 58],
      [2, 70], // norte rápida
      [-48, 60],
      [-88, 36],
      [-104, 2], // cerrada del fondo
      [-92, -26],
      [-64, -32], // (a la meta)
    ],
    width: 6,
    edgeLines: false,
  },
  stadium: {
    id: 'stadium',
    name: 'Estadio Rallycross',
    surface: 'tierra',
    inspiration: 'Rallycross / Stadium Super Trucks',
    description: 'Técnico centro-oeste: horquilla y esses sin respiro.',
    badge: '🏜 Estadio Rallycross · tierra',
    points: [
      [-15, 22], // salida
      [15, 26],
      [31, 46], // esses
      [21, 70],
      [-9, 76], // horquilla alta
      [-39, 66],
      [-59, 46],
      [-65, 16], // bajada oeste
      [-49, -4],
      [-25, -8], // (a la meta)
    ],
    width: 5.5,
    edgeLines: false,
  },
};

export const TRACK_ORDER: TrackId[] = ['monaco', 'interlagos', 'baja', 'stadium'];
/**
 * El Nürburgring 1:1 vive fuera del mundo pequeño (ver `src/world/ring/`):
 * no entra en TRACK_ORDER (esculpido, superficies y decoración del mapa de
 * 320 m no lo tocan) y la tecla T solo rota los cuatro trazados clásicos.
 * Se entra desde su sección del menú.
 */
export const RING_TRACK_ID: TrackId = 'nurburgring';

/** Semiextensión del muro invisible [m]; el terreno mide 320 m de lado. */
export const TRACK_BOUND = 148;
/** La barrera visible, un poco por fuera del muro invisible. */
const BARRIER_HALF = 150;

const asphaltMat = new THREE.MeshStandardMaterial({
  color: 0x30343a,
  roughness: 1,
  metalness: 0,
  envMapIntensity: 0.25, // sin reflejo rasante del cielo: debe verse mate
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});
const dirtMat = new THREE.MeshStandardMaterial({
  color: 0x8a6f4d,
  roughness: 1,
  metalness: 0,
  envMapIntensity: 0.25,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});
const lineMat = new THREE.MeshStandardMaterial({
  color: 0xe8e8e8,
  roughness: 0.8,
  metalness: 0,
  envMapIntensity: 0.4,
  polygonOffset: true,
  // La pintura debe ganar SIEMPRE a la calzada: a 8–15 mm de separación y
  // con el far plane a 1200 m, a lo lejos la precisión del depth buffer
  // (~6 mm a 100 m) hacía que el asfalto (bias −4, mayor que el −3 de la
  // pintura) tapara las líneas hasta acercarse. Con −8 la pintura manda.
  polygonOffsetFactor: -8,
  polygonOffsetUnits: -8,
});
const curbMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
const coneMat = new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.7, metalness: 0 });
/**
 * La cinta se apoya exactamente sobre el terreno analítico: la holgura contra
 * la hierba no la da un lift (que enterraría visualmente las ruedas en la
 * calzada) sino el esculpido del terreno bajo el corredor (`makeTrackCarve`).
 */
const ROAD_LIFT = 0;
/** La pintura (líneas y meta) vuela sobre el asfalto (ver bias en `lineMat`). */
const PAINT_LIFT = 0.015;
const CURB_RED = new THREE.Color(0xc23b2e);
const CURB_WHITE = new THREE.Color(0xe8e6e2);

function trackCurve(def: TrackDef): THREE.CatmullRomCurve3 {
  // Centrípeta: sin desbordes ni bucles en los vértices cerrados, así que
  // la calzada sigue a los puntos de paso sin salirse de la trazada.
  return new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
}

/** Eje del trazado muestreado uniformemente (crono y reglas; sin el duplicado final). */
export function trackCenterline(def: TrackDef, divisions = 400): THREE.Vector3[] {
  return trackCurve(def).getSpacedPoints(divisions).slice(0, divisions);
}

/** Punto de aparición del trazado: primer punto + rumbo del primer segmento. */
export function trackSpawn(def: TrackDef): { x: number; z: number; yaw: number } {  const [x, z] = def.points[0];
  const [nx, nz] = def.points[1 % def.points.length];
  // Rumbo del primer segmento (no la tangente de la curva: en curva cerrada
  // esta mezcla la dirección de llegada y sacaría el coche de la calzada).
  return { x, z, yaw: Math.atan2(nx - x, nz - z) };
}

/** Longitud del eje del trazado [m] (para la ficha del menú). */
export function trackLength(def: TrackDef): number {
  if (def.lengthMeters !== undefined) return def.lengthMeters;
  return trackCurve(def).getLength();
}

// ---------------- Malla de calzada (malla densa + superficie consultable) ----------------

/** Estaciones cada 0,5 m y carriles cada ≤1 m: sin cuerdas visibles sobre el terreno. */
const ROAD_STATION_SPACING = 0.5;
const ROAD_LANE_SPACING = 1;
/**
 * Holgura bajo la cinta para que la malla del terreno nunca asome [m]. La
 * cinta y la hierba son dos interpolaciones distintas de la misma función de
 * altura: entre vértices, la cuerda de la hierba (paso 1 m) puede quedar sobre
 * la de la cinta en valles y bordes. `CARVE_MIN` cubre el caso plano y
 * `CARVE_CURV`·curvatura el resto (en los badenes, ~11 cm): ver `makeTrackCarve`.
 */
const CARVE_MIN = 0.02;
const CARVE_CURV = 0.25;
const CARVE_MAX = 0.11;
/** Zona de corte completo justo fuera del borde [m]: cubre la diagonal de un vértice de la malla del terreno (paso 1 m). */
const CARVE_FULL = 0.75;
/** Anchura de la bajada hacia la altura natural, medida desde el final del corte completo [m]. */
const CARVE_SHOULDER = 3;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Estación de la malla de calzada: un punto del eje con sus alturas por carril. */
interface RoadStation {
  x: number;
  z: number;
  /** Tangente normalizada en planta (para hallar la lateral). */
  tx: number;
  tz: number;
  /** Distancia acumulada desde la salida [m] (UVs y tramos). */
  dist: number;
  /** Altura de cada carril [m] (terreno analítico bajo el carril + lift). */
  y: number[];
  /** Holgura bajo la cinta en cada carril [m] (ver `CARVE_MIN`). */
  eps: number[];
}

/** Malla de calzada de un trazado: eje muestreado fino y alturas por carril. */
export interface RoadGrid {
  def: TrackDef;
  /** Desplazamiento lateral de cada carril [m], de −ancho/2 a +ancho/2. */
  lanes: number[];
  stations: RoadStation[];
}

/** Construye la malla densa de la calzada: la superficie de referencia del trazado. */
function buildRoadGrid(def: TrackDef, terrain: Terrain, lift: number): RoadGrid {
  const curve = trackCurve(def);
  const n = Math.max(16, Math.ceil(curve.getLength() / ROAD_STATION_SPACING));
  const center = curve.getSpacedPoints(n).slice(0, n);
  const hw = def.width / 2;
  const laneCount = Math.max(2, Math.ceil(def.width / ROAD_LANE_SPACING) + 1);
  const lanes: number[] = [];
  for (let j = 0; j < laneCount; j++) lanes.push(-hw + (def.width * j) / (laneCount - 1));

  const stations: RoadStation[] = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = center[i];
    tangent.subVectors(center[(i + 1) % n], center[(i - 1 + n) % n]).setY(0);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
    else tangent.normalize();
    const sx = -tangent.z;
    const sz = tangent.x;
    const y: number[] = [];
    for (let j = 0; j < laneCount; j++) {
      const o = lanes[j];
      y.push(terrain.heightAt(p.x + sx * o, p.z + sz * o) + lift);
    }
    const dist = i > 0 ? stations[i - 1].dist + Math.hypot(p.x - center[i - 1].x, p.z - center[i - 1].z) : 0;
    stations.push({ x: p.x, z: p.z, tx: tangent.x, tz: tangent.z, dist, y, eps: [] });
  }

  // Holgura por carril: la curvatura local (segundas diferencias de las alturas
  // de la propia cinta, normalizadas a paso 1 m) mide el máximo que la cuerda
  // de la malla del terreno puede levantarse sobre la cinta.
  for (let i = 0; i < n; i++) {
    const a = stations[(i - 1 + n) % n];
    const b = stations[i];
    const c = stations[(i + 1) % n];
    const laneStep = lanes.length > 1 ? lanes[1] - lanes[0] : 1;
    for (let j = 0; j < laneCount; j++) {
      const d2Along = Math.abs(a.y[j] - 2 * b.y[j] + c.y[j]) / (ROAD_STATION_SPACING * ROAD_STATION_SPACING);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(laneCount - 1, j + 1);
      const d2Lat =
        j0 === j1 ? 0 : Math.abs(b.y[j0] - 2 * b.y[j] + b.y[j1]) / (laneStep * laneStep);
      b.eps[j] = Math.min(CARVE_MAX, CARVE_MIN + CARVE_CURV * Math.max(d2Along, d2Lat));
    }
  }

  return { def, lanes, stations };
}

/** Muestra de la cinta: altura y holgura interpoladas en una lateral. */
interface GridSample {
  y: number;
  eps: number;
}

// Scratch para las consultas (el esculpido evalúa muchos vértices sin asignar).
const sampleA: GridSample = { y: 0, eps: 0 };
const sampleB: GridSample = { y: 0, eps: 0 };

/** Altura de la cinta y holgura en una estación, interpoladas en la lateral `o` (clampeada al borde). */
function gridSample(grid: RoadGrid, station: RoadStation, o: number, out: GridSample): GridSample {
  const lanes = grid.lanes;
  const n = lanes.length;
  const oc = Math.min(lanes[n - 1], Math.max(lanes[0], o));
  let j = 0;
  while (j < n - 2 && lanes[j + 1] < oc) j++;
  const span = lanes[j + 1] - lanes[j];
  const f = span > 1e-9 ? (oc - lanes[j]) / span : 0;
  out.y = station.y[j] + (station.y[j + 1] - station.y[j]) * f;
  out.eps = station.eps[j] + (station.eps[j + 1] - station.eps[j]) * f;
  return out;
}

/**
 * Altura del terreno ya esculpido en la lateral `o` de una estación: bajo la
 * calzada queda `holgura` por debajo de la cinta y hacia fuera desciende en
 * pendiente suave hasta su altura natural. Es la misma superficie que genera
 * `makeTrackCarve` (el mobiliario debe apoyarse en ella).
 */
function carvedHeight(
  grid: RoadGrid,
  terrain: Terrain,
  x: number,
  z: number,
  station: RoadStation,
  o: number,
): number {
  const hw = grid.def.width / 2;
  const ao = Math.abs(o);
  const w = 1 - smoothstep(hw + CARVE_FULL, hw + CARVE_FULL + CARVE_SHOULDER, ao);
  const natural = terrain.heightAt(x, z);
  if (w <= 0) return natural;
  // Mismo criterio que `makeTrackCarve`: ancla en el borde fuera de la
  // calzada, sin relleno y con la holgura mínima.
  gridSample(grid, station, ao <= hw ? o : o < 0 ? -hw : hw, sampleA);
  const target = Math.min(sampleA.y - sampleA.eps, natural - CARVE_MIN);
  return natural + (target - natural) * w;
}

/**
 * Malla de la calzada: rejilla estación × carril siguiendo el terreno
 * analítico. Devanado antihorario visto desde arriba (+Y).
 */
function roadGeometry(grid: RoadGrid, terrain: Terrain): THREE.BufferGeometry {
  const n = grid.stations.length;
  const laneCount = grid.lanes.length;
  const positions = new Float32Array(n * laneCount * 3);
  const normals = new Float32Array(n * laneCount * 3);
  const uvs = new Float32Array(n * laneCount * 2);
  const nrm = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const st = grid.stations[i];
    const sx = -st.tz;
    const sz = st.tx;
    for (let j = 0; j < laneCount; j++) {
      const o = grid.lanes[j];
      const x = st.x + sx * o;
      const z = st.z + sz * o;
      const k = i * laneCount + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = st.y[j];
      positions[k * 3 + 2] = z;
      terrain.normalAt(x, z, nrm);
      normals[k * 3] = nrm.x;
      normals[k * 3 + 1] = nrm.y;
      normals[k * 3 + 2] = nrm.z;
      uvs[k * 2] = st.dist / 8;
      uvs[k * 2 + 1] = (o + grid.def.width / 2) / grid.def.width;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < laneCount - 1; j++) {
      const a = i * laneCount + j;
      const b = i * laneCount + j + 1;
      const c = ((i + 1) % n) * laneCount + j;
      const d = ((i + 1) % n) * laneCount + j + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Cinta fina de pintura (líneas de borde) sobre la calzada: dos vértices por
 * estación a ambos lados de la lateral pedida, sobre la altura de la cinta.
 */
function paintGeometry(
  grid: RoadGrid,
  lateral: number,
  halfWidth: number,
  lift: number,
  terrain: Terrain,
): THREE.BufferGeometry {
  const n = grid.stations.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const nrm = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const st = grid.stations[i];
    const sx = -st.tz;
    const sz = st.tx;
    for (let s = 0; s < 2; s++) {
      const o = lateral + (s === 0 ? -halfWidth : halfWidth);
      const x = st.x + sx * o;
      const z = st.z + sz * o;
      const y = gridSample(grid, st, o, sampleA).y + lift;
      const k = i * 2 + s;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      terrain.normalAt(x, z, nrm);
      normals[k * 3] = nrm.x;
      normals[k * 3 + 1] = nrm.y;
      normals[k * 3 + 2] = nrm.z;
      uvs[k * 2] = st.dist / 8;
      uvs[k * 2 + 1] = s;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = ((i + 1) % n) * 2 + 1;
    index.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

export interface TrackHandle {
  group: THREE.Group;
  /** Reconstruye la geometría (tras cambiar la rugosidad en vivo). */
  refresh(): void;
}

/**
 * Pianos rojo/blanco en las curvas del asfalto: donde el cambio de rumbo por
 * estación supera el umbral se colocan dos losas (una por borde) alternando
 * color cada ~4 m. Apoyadas sobre el terreno ya esculpido. Instanciado en una
 * sola malla.
 */
function buildCurbs(
  def: TrackDef,
  grid: RoadGrid,
  terrain: Terrain,
  group: THREE.Group,
): void {
  const n = grid.stations.length;
  const spots: Array<{ x: number; z: number; y: number; yaw: number; red: boolean }> = [];
  let dist = 0;
  let prevDist = 0;
  for (let i = 0; i < n; i += 8) {
    const p0 = grid.stations[(i - 8 + n) % n];
    const p1 = grid.stations[i];
    const p2 = grid.stations[(i + 8) % n];
    prevDist = dist;
    dist = p1.dist;
    const ax = p1.x - p0.x;
    const az = p1.z - p0.z;
    const bx = p2.x - p1.x;
    const bz = p2.z - p1.z;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const turn = la > 1e-6 && lb > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)))) : 0;
    if (turn < 0.11) continue; // solo curvas de verdad
    const red = Math.floor((prevDist + dist) / 8) % 2 === 0;
    for (const s of [-1, 1]) {
      const o = s * (def.width / 2 + 0.35);
      // Cada piano son 3 losas de 1 m (como los reales) sobre 3 estaciones
      // seguidas: cada una toma su lateral, altura esculpida, rumbo y caída
      // con la normal del terreno. Una losa larga deja sus extremos flotando
      // en las curvas cerradas y las laderas.
      for (let j = -2; j <= 2; j += 2) {
        const st = grid.stations[(i + j + n) % n];
        const cx = st.x - st.tz * o;
        const cz = st.z + st.tx * o;
        spots.push({
          x: cx,
          z: cz,
          y: carvedHeight(grid, terrain, cx, cz, st, o) + 0.02,
          yaw: Math.atan2(st.tx, st.tz),
          red,
        });
      }
    }
  }
  if (spots.length === 0) return;
  const geo = new THREE.BoxGeometry(0.7, 0.07, 1.02);
  const inst = new THREE.InstancedMesh(geo, curbMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    // Rumbo de la losa + caída con la normal del terreno: el hombro desciende
    // hacia fuera y una losa plana flotaría sobre él. Se incrusta 1,5 cm.
    q.setFromAxisAngle(up, s.yaw);
    terrain.normalAt(s.x, s.z, nrm);
    tilt.setFromUnitVectors(up, nrm);
    q.premultiply(tilt);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, sc);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, s.red ? CURB_RED : CURB_WHITE);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.receiveShadow = true;
  group.add(inst);
}

/**
 * Conos naranjas cada ~18 m en ambos bordes de la tierra: marcan la trazada
 * donde no hay líneas pintadas. Sobre el terreno ya esculpido.
 */
function buildCones(
  def: TrackDef,
  grid: RoadGrid,
  terrain: Terrain,
  group: THREE.Group,
): void {
  const n = grid.stations.length;
  const spots: Array<{ x: number; z: number; y: number }> = [];
  for (let i = 0; i < n; i += 36) {
    const st = grid.stations[i];
    const sx = -st.tz;
    const sz = st.tx;
    for (const s of [-1, 1]) {
      const o = s * (def.width / 2 + 0.8);
      const x = st.x + sx * o;
      const z = st.z + sz * o;
      spots.push({ x, z, y: carvedHeight(grid, terrain, x, z, st, o) });
    }
  }
  if (spots.length === 0) return;
  const geo = new THREE.ConeGeometry(0.22, 0.55, 10);
  geo.translate(0, 0.28, 0);
  const inst = new THREE.InstancedMesh(geo, coneMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((s, i) => {
    m.makeTranslation(s.x, s.y, s.z);
    inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = true;
  group.add(inst);
}

export function buildTrack(def: TrackDef, terrain: Terrain): TrackHandle {
  const group = new THREE.Group();
  group.name = `track-${def.id}`;

  const build = (): void => {
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh;
      const anyMesh = mesh as unknown as { geometry?: THREE.BufferGeometry };
      anyMesh.geometry?.dispose();
      group.remove(child);
    }
    // Malla densa de la calzada: estaciones cada 0,5 m y carriles cada ≤1 m.
    // La cinta sigue el terreno analítico exacto (la misma función que la
    // física) y el terreno se esculpe bajo ella (`makeTrackCarve`), así que la
    // hierba nunca asoma: la holgura la da el esculpido, no un lift, para que
    // las ruedas no queden visualmente enterradas en la calzada.
    const grid = buildRoadGrid(def, terrain, ROAD_LIFT);
    const mat = def.surface === 'asfalto' ? asphaltMat : dirtMat;
    const road = new THREE.Mesh(roadGeometry(grid, terrain), mat);
    road.receiveShadow = true;
    group.add(road);

    if (def.edgeLines) {
      for (const lateral of [-def.width / 2 + 0.45, def.width / 2 - 0.45]) {
        const line = new THREE.Mesh(paintGeometry(grid, lateral, 0.18, PAINT_LIFT, terrain), lineMat);
        line.receiveShadow = true;
        group.add(line);
      }
      buildCurbs(def, grid, terrain, group);
    } else {
      buildCones(def, grid, terrain, group);
    }

    // Línea de salida/meta atravesada en el primer punto: cuatro esquinas
    // sobre la cinta (altura de la calzada, no del terreno natural).
    const st0 = grid.stations[0];
    const hw = def.width / 2;
    const sx = -st0.tz;
    const sz = st0.tx;
    const yL = gridSample(grid, st0, -hw, sampleA).y + PAINT_LIFT;
    const yR = gridSample(grid, st0, hw, sampleA).y + PAINT_LIFT;
    const startGeo = new THREE.BufferGeometry();
    startGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          st0.x + sx * -hw - st0.tx * 0.6, yL, st0.z + sz * -hw - st0.tz * 0.6,
          st0.x + sx * -hw + st0.tx * 0.6, yL, st0.z + sz * -hw + st0.tz * 0.6,
          st0.x + sx * hw - st0.tx * 0.6, yR, st0.z + sz * hw - st0.tz * 0.6,
          st0.x + sx * hw + st0.tx * 0.6, yR, st0.z + sz * hw + st0.tz * 0.6,
        ]),
        3,
      ),
    );
    startGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    startGeo.setIndex([0, 2, 1, 1, 2, 3]);
    startGeo.computeBoundingSphere();
    const start = new THREE.Mesh(startGeo, lineMat);
    group.add(start);
  };

  build();
  return { group, refresh: build };
}

// ---------------- Esculpido del terreno bajo las calzadas ----------------

/**
 * Esculpido del terreno bajo las calzadas (lo que hacen los "landscape splines"
 * de Unreal o los circuitos de Forza): la pista y la hierba son dos
 * interpolaciones distintas de la misma función de altura y se cruzan en valles
 * y bordes — la hierba asomaba por la calzada. La solución de los juegos AAA no
 * es una malla flotando sobre otra sino esculpir el terreno bajo el corredor de
 * la calzada y fundirlo en pendiente suave con su altura natural.
 *
 * La función devuelta da la altura FINAL del terreno en (x, z): bajo la
 * calzada queda `CARVE_MIN` + curvatura por debajo de la cinta (en los badenes
 * ~11 cm: la cuerda de la malla del terreno se levanta sobre la cinta en los
 * valles) y desde el borde desciende en pendiente suave hasta el terreno
 * natural, sin peldaño: la pendiente de integración de los circuitos reales.
 * Solo se rebaja el terreno, nunca se rellena, así la hierba es imposible que
 * asome por la pista sea cual sea la pendiente.
 *
 * Se pasa a `Terrain.buildMesh`. La física no se toca: `Terrain.heightAt`
 * sigue siendo la superficie analítica de contacto y la cinta la sigue al
 * centímetro. Solo hay una malla visible por encima de otra dentro del
 * corredor, y siempre por debajo de ella.
 */
export interface TrackCarve {
  /** Altura final del terreno en (x, z): natural esculpida bajo las calzadas. */
  (x: number, z: number): number;
  /** Altura de la cinta bajo (x, z); `null` si no hay calzada ahí. */
  roadHeight(x: number, z: number): number | null;
}
export function makeTrackCarve(terrain: Terrain): TrackCarve {
  // Se usa la misma `buildRoadGrid` que la malla de la calzada: esculpido y
  // cinta comparten superficie por construcción.
  const grids = TRACK_ORDER.map((id) => buildRoadGrid(TRACKS[id], terrain, ROAD_LIFT));

  // Índice de segmentos por celda: cada consulta solo mira las calzadas cercanas.
  const CELL = 4;
  const index = new Map<string, Array<{ grid: RoadGrid; i: number }>>();
  for (const grid of grids) {
    const reach = Math.ceil((grid.def.width / 2 + CARVE_SHOULDER) / CELL) + 1;
    for (let i = 0; i < grid.stations.length; i++) {
      const st = grid.stations[i];
      const cx = Math.floor(st.x / CELL);
      const cz = Math.floor(st.z / CELL);
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dz = -reach; dz <= reach; dz++) {
          const key = `${cx + dx},${cz + dz}`;
          const entry = { grid, i };
          const list = index.get(key);
          if (list) list.push(entry);
          else index.set(key, [entry]);
        }
      }
    }
  }

  // Resultado de la última consulta (sin asignar en el bucle de esculpido).
  const res = { w: 0, roadY: 0, target: 0, absO: Infinity, hw: 0 };

  const find = (x: number, z: number, natural: number): void => {
    res.w = 0;
    res.roadY = 0;
    res.target = 0;
    res.absO = Infinity;
    res.hw = 0;
    const list = index.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return;
    let bestDist = Infinity;
    let bestTarget = 0;
    for (let k = 0; k < list.length; k++) {
      const grid = list[k].grid;
      const hw = grid.def.width / 2;
      const st0 = grid.stations[list[k].i];
      const st1 = grid.stations[(list[k].i + 1) % grid.stations.length];
      const dx = st1.x - st0.x;
      const dz = st1.z - st0.z;
      const len2 = dx * dx + dz * dz;
      const uRaw = len2 > 1e-9 ? ((x - st0.x) * dx + (z - st0.z) * dz) / len2 : 0;
      const u = uRaw < 0 ? 0 : uRaw > 1 ? 1 : uRaw;
      const ddx = x - (st0.x + dx * u);
      const ddz = z - (st0.z + dz * u);
      const dist = Math.hypot(ddx, ddz);
      // Distancia EUCLÍDEA al segmento (con la proyección clampeada): la
      // prueba de cápsula de la polilínea. Con el filtro de `u` estricto, un
      // punto que cae sobre la unión entre dos segmentos (el punto más
      // cercano es la propia unión) proyectaba fuera de AMBOS y dejaba huecos
      // de vértices sin esculpir — la hierba asomaba por la pista justo ahí.
      if (dist > hw + CARVE_FULL + CARVE_SHOULDER) continue;
      if (dist > bestDist + 1e-9) continue;
      // lateral firmada respecto a la tangente de la estación (0,5 m: el
      // desvío entre segmentos es despreciable)
      const o = ddx * -st0.tz + ddz * st0.tx;
      const ao = Math.abs(o);
      // Bajo la calzada la lateral está dentro de los carriles y la altura de
      // la cinta es la del propio punto. Fuera, se ancla en el borde de la
      // MISMA estación: clampear la lateral a los carriles traería alturas de
      // metros de cinta a través de la pendiente (minaba o levantaba el
      // hombro en las laderas fuertes).
      const oUse = ao <= hw ? o : o < 0 ? -hw : hw;
      gridSample(grid, st0, oUse, sampleA);
      gridSample(grid, st1, oUse, sampleB);
      const roadY = sampleA.y + (sampleB.y - sampleA.y) * u;
      const eps = sampleA.eps + (sampleB.eps - sampleA.eps) * u;
      // Nunca se rellena: el terreno queda como mucho `CARVE_MIN` por debajo
      // de su altura natural y, bajo la calzada, `holgura` por debajo de la
      // cinta. Con esto la hierba es imposible que asoma por la pista (la
      // cuerda de la malla nunca se levanta sobre los valores recortados más
      // de lo que cubre `eps`, ver CARVE_CURV) y el borde baja en pendiente
      // suave hasta el terreno natural, sin peldaño.
      const target = Math.min(roadY - eps, natural - CARVE_MIN);
      // Manda el corredor más cercano: en las curvas cerradas varios segmentos
      // tocan el mismo punto y sus alturas difieren en la pendiente — tomar la
      // mayor mezclaba superficies incoherentes entre puntos vecinos. Con
      // calzadas solapadas (cruces) gana la más alta.
      if (dist > bestDist - 1e-9 && target <= bestTarget) continue;
      bestDist = dist;
      bestTarget = target;
      res.roadY = roadY;
      res.absO = ao;
      res.hw = hw;
    }
    if (bestDist < Infinity) {
      res.w = 1 - smoothstep(res.hw + CARVE_FULL, res.hw + CARVE_FULL + CARVE_SHOULDER, res.absO);
      res.target = bestTarget;
    }
  };

  const carve = ((x: number, z: number): number => {
    const natural = terrain.heightAt(x, z);
    find(x, z, natural);
    return res.w > 0 ? natural + (res.target - natural) * res.w : natural;
  }) as TrackCarve;

  carve.roadHeight = (x: number, z: number): number | null => {
    find(x, z, terrain.heightAt(x, z));
    return res.w > 0 && res.absO <= res.hw + 1e-6 ? res.roadY : null;
  };

  return carve;
}

/**
 * Puntos de exclusión para la decoración: la vegetación y las rocas no deben
 * nacer sobre la calzada. Paso por distancia (~6 m) con radio generoso: con
 * paso fijo por índice los trazados largos quedaban con huecos.
 */
export function routeKeepOut(): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = [];
  for (const id of TRACK_ORDER) {
    const def = TRACKS[id];
    const curve = trackCurve(def);
    const n = Math.min(220, Math.max(60, Math.ceil(curve.getLength() / 6)));
    const pts = curve.getSpacedPoints(n).slice(0, n);
    for (const p of pts) {
      out.push({ x: p.x, z: p.z, r: def.width / 2 + 3 });
    }
  }
  return out;
}

export interface TrackSample {
  x: number;
  z: number;
  /** Radio cubierto por la calzada (+ margen) [m]. */
  r: number;
  surface: TrackSurface;
}

let cachedSamples: TrackSample[] | null = null;

/**
 * Muestreo de las calzadas para la física de superficies (ver surface.ts):
 * cada muestra cubre su trozo de pista con el ancho real + margen. Paso por
 * distancia (~4 m): con paso fijo por índice los trazados largos dejaban
 * huecos de hierba sobre el asfalto.
 */
export function trackSurfaceSamples(): TrackSample[] {
  if (!cachedSamples) {
    cachedSamples = [];
    for (const id of TRACK_ORDER) {
      const def = TRACKS[id];
      const curve = trackCurve(def);
      const n = Math.min(440, Math.max(120, Math.ceil(curve.getLength() / 2)));
      const pts = curve.getSpacedPoints(n).slice(0, n);
      for (let i = 0; i < pts.length; i += 2) {
        cachedSamples.push({ x: pts[i].x, z: pts[i].z, r: def.width / 2 + 1.5, surface: def.surface });
      }
    }
  }
  return cachedSamples;
}

// ---------------- Barrera perimetral y muro invisible ----------------

const barrierGeo = new THREE.BoxGeometry(2, 0.9, 0.5);
const barrierMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
const BARRIER_RED = new THREE.Color(0xc23b2e);
const BARRIER_WHITE = new THREE.Color(0xe8e6e2);

export function buildBoundary(terrain: Terrain): TrackHandle {
  const group = new THREE.Group();
  group.name = 'boundary';
  const COUNT_PER_SIDE = 150; // 300 m / 2 m
  const inst = new THREE.InstancedMesh(barrierGeo, barrierMat, COUNT_PER_SIDE * 4);
  inst.receiveShadow = true;
  group.add(inst);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3(1, 1, 1);

  const build = (): void => {
    let k = 0;
    for (let side = 0; side < 4; side++) {
      q.setFromAxisAngle(up, (side * Math.PI) / 2);
      for (let i = 0; i < COUNT_PER_SIDE; i++) {
        const t = -BARRIER_HALF + (i + 0.5) * (BARRIER_HALF * 2 / COUNT_PER_SIDE);
        // Lados 0/2: z=±150 (variando x); lados 1/3: x=±150 (variando z).
        const along = side % 2 === 0;
        const x = along ? t : side === 1 ? BARRIER_HALF : -BARRIER_HALF;
        const z = along ? (side === 0 ? -BARRIER_HALF : BARRIER_HALF) : t;
        m.compose(new THREE.Vector3(x, terrain.heightAt(x, z) + 0.45, z), q, s);
        inst.setMatrixAt(k, m);
        inst.setColorAt(k, i % 2 === 0 ? BARRIER_RED : BARRIER_WHITE);
        k++;
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };

  build();
  return { group, refresh: build };
}

/**
 * Muro invisible del mapa: recorta la posición y amortigua la componente de
 * la velocidad que apunta hacia fuera (pequeño rebote seco, sin túneles
 * porque el recorte es absoluto). `bound` permite reutilizarlo en el mundo
 * grande del anillo (ver `RING_BOUND`).
 */
export function enforceTrackBounds(v: Vehicle, bound = TRACK_BOUND): void {
  const p = v.position;
  const vel = v.velocity;
  if (p.x > bound) {
    p.x = bound;
    if (vel.x > 0) vel.x *= -0.2;
  } else if (p.x < -bound) {
    p.x = -bound;
    if (vel.x < 0) vel.x *= -0.2;
  }
  if (p.z > bound) {
    p.z = bound;
    if (vel.z > 0) vel.z *= -0.2;
  } else if (p.z < -bound) {
    p.z = -bound;
    if (vel.z < 0) vel.z *= -0.2;
  }
}
