/**
 * Nürburgring Nordschleife 1:1 — acceso a la línea central horneada.
 *
 * Datos: bucle Touristenfahrten (~20,8 km reales, medidos 20758 m en la
 * traza), estaciones uniformes cada 3 m, x = este [m], z = sur [m]
 * (norte = −z), y = cota SRTM suavizada [m].
 *
 * Procedencia y licencia:
 * - Traza en planta: `maciejb2k/nurburgring-nordschleife-geojson`
 *   (`touristenfahrten.geojson`, LineString de ~3000 pts, realineada a mano
 *   sobre la carretera real). Geometría de una vía pública (hechos).
 * - Elevación: SRTM vía API de open-meteo, suavizada para quitar los
 *   escalones de 30 m del DEM conservando las crestas reales (~100 m).
 * - La capa vial de OSM se publica bajo ODbL 1.0: este uso lleva atribución.
 *   © OpenStreetMap contributors (ODbL) · traza vía maciejb2k · SRTM vía open-meteo.
 *
 * Generado por `scripts/bake-ring.mjs` → `centerline-data.ts` (no editar).
 */
import {
  RING_STEP,
  RING_LENGTH,
  RING_ORIGIN,
  RING_BBOX,
  RING_STATIONS,
  RING_CURVATURE,
  RING_GRID,
  RING_BASE_ELEV,
} from './centerline-data';

export { RING_STEP, RING_LENGTH, RING_ORIGIN, RING_BBOX };

/** Nº de estaciones (el anillo es circular: el índice envuelve). */
export const STATION_COUNT = RING_STATIONS.length / 3;

/** Longitud del bucle [m]. */
export const LOOP_LENGTH = RING_LENGTH;

/** Ancho de la calzada [m] (la real varía 8–11 m; fase 1: constante). */
export const ROAD_WIDTH = 10;
export const ROAD_HALF = ROAD_WIDTH / 2;

/** Posición de la estación `i` (envuelve). Sin asignaciones si se pasa `out`. */
export function stationPos(i: number, out: { x: number; z: number; y: number }): { x: number; z: number; y: number } {
  const n = STATION_COUNT;
  const k = ((Math.round(i) % n) + n) % n;
  out.x = RING_STATIONS[k * 3];
  out.z = RING_STATIONS[k * 3 + 1];
  out.y = RING_STATIONS[k * 3 + 2];
  return out;
}

/**
 * Cota de la pista en la distancia `s` [m] (interpola entre estaciones).
 * Es LA superficie de referencia: la malla de la calzada y la física usan
 * exactamente esta función, al centímetro.
 */
export function elevationAt(s: number): number {
  const n = STATION_COUNT;
  const f = ((((s % RING_LENGTH) + RING_LENGTH) % RING_LENGTH) / RING_STEP) % n;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % n;
  const t = f - i0;
  return RING_STATIONS[i0 * 3 + 2] * (1 - t) + RING_STATIONS[i1 * 3 + 2] * t;
}

/** Tangente horizontal normalizada en `s` (para laterales y rumbo). */
export function tangentAt(s: number, out: { x: number; z: number }): { x: number; z: number } {
  const n = STATION_COUNT;
  const f = ((((s % RING_LENGTH) + RING_LENGTH) % RING_LENGTH) / RING_STEP) % n;
  const i0 = Math.floor(f);
  const ax = RING_STATIONS[((i0 - 1 + n) % n) * 3];
  const az = RING_STATIONS[((i0 - 1 + n) % n) * 3 + 1];
  const bx = RING_STATIONS[((i0 + 2) % n) * 3];
  const bz = RING_STATIONS[((i0 + 2) % n) * 3 + 1];
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  out.x = dx / len;
  out.z = dz / len;
  return out;
}

/** Curvatura firmada [rad/m] en `s` (+ = giro a la derecha). */
export function curvatureAt(s: number): number {
  const n = STATION_COUNT;
  const f = ((((s % RING_LENGTH) + RING_LENGTH) % RING_LENGTH) / RING_STEP) % n;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % n;
  const t = f - i0;
  return RING_CURVATURE[i0] * (1 - t) + RING_CURVATURE[i1] * t;
}

/**
 * Cota base del terreno lejano [m]: rejilla gruesa horneada (vecino más
 * cercano + desenfoque) con interpolación bilineal. Describe el valle en el
 * que va encajada la pista, sin dientes de Voronoi en tiempo real.
 */
export function baseElevAt(x: number, z: number): number {
  const { x0, z0, nx, nz, cell } = RING_GRID;
  const fx = (x - x0) / cell;
  const fz = (z - z0) / cell;
  const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
  const iz = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const a = RING_BASE_ELEV[iz * nx + ix];
  const b = RING_BASE_ELEV[iz * nx + ix + 1];
  const c = RING_BASE_ELEV[(iz + 1) * nx + ix];
  const d = RING_BASE_ELEV[(iz + 1) * nx + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** ¿Hay cota real (SRTM) o el bake fue plano? */
export function hasElevation(): boolean {
  for (let i = 0; i < RING_STATIONS.length; i += 3 * 500) {
    if (RING_STATIONS[i + 2] !== 0) return true;
  }
  return false;
}
