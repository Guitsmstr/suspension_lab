/**
 * Terreno del Nürburgring 1:1: muestreador para la física (`TerrainSampler`).
 *
 * - La referencia de calzada (`roadHeightAt`) es plana transversal y EXACTA:
 *   ancla la abscisa en la estación más cercana y proyecta linealmente, sin
 *   el deslizamiento de la proyección al punto más cercano (que en curvas
 *   cerradas con rasante muestrea la ladera hasta ~1 m por encima del borde
 *   y la GPU la drapaba sobre la cinta). La malla de la calzada, la física y
 *   la hierba comparten esta referencia al centímetro.
 * - Fuera, el terreno funde hacia la cota base del valle (rejilla horneada)
 *   más colinas de Eifel analíticas (baratas, sin costuras entre teselas).
 * - `meshHeightAt` es la variante esculpida para las mallas de hierba: bajo
 *   la calzada queda 4 cm por debajo (técnica AAA de `makeTrackCarve`) y
 *   funde en 3 m de hombro. La física NO la usa.
 */
import * as THREE from 'three';
import type { TerrainSampler } from '../../vehicle/vehicle';
import { SURFACE_MU } from '../surface';
import {
  LOOP_LENGTH,
  RING_STEP,
  baseElevAt,
  curvatureAt,
  elevationAt,
  stationPos,
  tangentAt,
  ROAD_HALF,
} from './centerline';
import { RingIndex, type RingQuery } from './spatialIndex';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Corte completo bajo la cinta + margen de diagonal de vértice [m]. */
const CARVE_FULL = ROAD_HALF + 0.75;
/** Hombro de fusión hacia el terreno natural [m]. */
const CARVE_SHOULDER = 3;
/** Profundidad base del esculpido bajo la cinta [m]. */
const CARVE_DEPTH = 0.04;
/**
 * La cinta curva dentro de la celda de hierba (4 m): el plano de la tesela
 * se separa de la cinta ~celda²/8R en planta. En horquillas (R~18 m) son
 * ~11 cm y el esculpido base no cubre: la profundidad crece con la
 * curvatura (tope 25 cm; la física no esculpe, solo la malla).
 */
const CARVE_CURV_GAIN = 3;
const CARVE_DEPTH_MAX = 0.25;
/** Alcance de la fusión pista → valle [m]. */
const BLEND_OUT = 70;

/**
 * Colinas de Eifel: 3 octavas analíticas (longitudes de onda ~300/120/50 m,
 * amplitud total ~±1,9 m). Determinista y sin costuras: las teselas vecinas
 * coinciden siempre. Se escala con la rugosidad (solo adorno: la pista manda).
 */
function eifelDetail(x: number, z: number): number {
  return (
    1.1 * Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.019 - 0.6) +
    0.55 * Math.sin(x * 0.053 + 0.4) * Math.sin(z * 0.047 + 1.1) +
    0.22 * Math.sin(x * 0.13 + 0.3) * Math.cos(z * 0.11 + 0.5)
  );
}

/** Referencia de calzada: abscisa, lateral con signo y cota plana (ver `roadHeightAt`). */
export interface RoadHeight {
  s: number;
  o: number;
  elev: number;
}

export class RingTerrain implements TerrainSampler {
  readonly index = new RingIndex();
  private roughness = 0.5;
  private readonly q: RingQuery = { found: false, dist: 0, signed: 0, s: 0, elev: 0, tx: 0, tz: 0 };
  /** Scratch para la referencia de calzada (vía caliente: sin asignaciones). */
  private readonly rh: RoadHeight = { s: 0, o: 0, elev: 0 };
  private rhOk = false;
  private readonly st = { x: 0, z: 0, y: 0 };
  private readonly tn = { x: 0, z: 0 };

  setRoughness(r: number): void {
    this.roughness = r;
  }

  /**
   * Referencia de calzada en (x, z): abscisa sin deslizar + lateral + cota
   * plana transversal. Es EXACTAMENTE la superficie de la malla de la cinta
   * dentro del corredor (la cinta es lineal entre estaciones de 3 m y plana
   * entre carriles: la misma interpolación). `false` sin pista cerca.
   */
  roadHeightAt(x: number, z: number, out: RoadHeight): boolean {
    const i = this.index.nearestStation(x, z);
    if (i < 0) return false;
    stationPos(i, this.st);
    tangentAt(i * RING_STEP, this.tn);
    const dx = x - this.st.x;
    const dz = z - this.st.z;
    const along = dx * this.tn.x + dz * this.tn.z;
    out.s = (((i * RING_STEP + along) % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
    out.o = dx * -this.tn.z + dz * this.tn.x;
    out.elev = elevationAt(out.s);
    return true;
  }

  /** Superficie física (y de la calzada) en (x, z). */
  heightAt(x: number, z: number): number {
    const base = baseElevAt(x, z);
    const detail = eifelDetail(x, z) * this.roughness;
    this.rhOk = this.roadHeightAt(x, z, this.rh);
    if (!this.rhOk) return base + detail;
    const ao = Math.abs(this.rh.o);
    if (ao <= CARVE_FULL) return this.rh.elev;
    if (ao >= BLEND_OUT) return base + detail;
    const w = smoothstep(CARVE_FULL, BLEND_OUT, ao);
    return this.rh.elev + (base - this.rh.elev) * w + detail * w;
  }

  /** Altura esculpida para las mallas de hierba (siempre ≤ física en el corredor). */
  meshHeightAt(x: number, z: number): number {
    const trueH = this.heightAt(x, z);
    if (!this.rhOk) return trueH;
    const ao = Math.abs(this.rh.o);
    if (ao >= CARVE_FULL + CARVE_SHOULDER) return trueH;
    const w = smoothstep(CARVE_FULL, CARVE_FULL + CARVE_SHOULDER, ao);
    const depth = Math.min(CARVE_DEPTH_MAX, CARVE_DEPTH + CARVE_CURV_GAIN * Math.abs(curvatureAt(this.rh.s)));
    return trueH - depth * (1 - w);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.5;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Asfalto sobre la pista (+margen), hierba en el resto (fase 1). */
  surfaceMuAt(x: number, z: number): number {
    const q = this.index.query(x, z, this.q);
    if (q.found && q.dist <= ROAD_HALF + 1.5) return SURFACE_MU.asphalt;
    return SURFACE_MU.grass;
  }

  /**
   * Cota mínima de calzada a menos de `radius` [m]: respeta todos los brazos
   * cercanos (el clavado del fondo debe quedar bajo CADA cinta vecina).
   * `null` sin pista cerca.
   */
  minRoadElev(x: number, z: number, radius: number): number | null {
    const ids = this.index.stationsWithin(x, z, radius, []);
    if (ids.length === 0) return null;
    let m = Infinity;
    for (let k = 0; k < ids.length; k++) {
      stationPos(ids[k], this.st);
      if (this.st.y < m) m = this.st.y;
    }
    return m;
  }

  /**
   * Proximidad a la pista (vía fría: asigna; la usan las mallas, no la física).
   * `null` si no hay pista a menos de QUERY_RADIUS. La cota es la referencia
   * de calzada (plana transversal, sin deslizar).
   */
  trackProximity(x: number, z: number): { dist: number; elev: number } | null {
    const r: RoadHeight = { s: 0, o: 0, elev: 0 };
    if (!this.roadHeightAt(x, z, r)) return null;
    return { dist: Math.abs(r.o), elev: r.elev };
  }

  surfaceKindAt(x: number, z: number): string {
    const q = this.index.query(x, z, this.q);
    if (q.found && q.dist <= ROAD_HALF + 1.5) return 'asphalt';
    return 'grass';
  }
}
