/**
 * Índice espacial del anillo: rejilla uniforme sobre las estaciones para
 * consultas O(1) de punto más cercano (la física lo llama a 300 Hz).
 *
 * La consulta devuelve la proyección sobre el segmento central más próximo:
 * distancia lateral, distancia recorrida `s`, cota interpolada y tangente.
 * Sin asignaciones en caliente (objeto reutilizable + scratch de módulo).
 */
import { STATION_COUNT, LOOP_LENGTH, RING_STEP, stationPos } from './centerline';

const CELL = 40; // m por celda (el corredor preciso cubre 3×3 celdas = ±60 m)
const QUERY_RADIUS = 62; // alcance máximo de la consulta precisa [m]

export interface RingQuery {
  found: boolean;
  /** Distancia lateral absoluta al eje [m]. */
  dist: number;
  /** Lateral con signo [m] (+ = izquierda del sentido de marcha). */
  signed: number;
  /** Distancia recorrida de la proyección [m]. */
  s: number;
  /** Cota de la pista en la proyección [m]. */
  elev: number;
  /** Tangente horizontal normalizada. */
  tx: number;
  tz: number;
}

const _p0 = { x: 0, z: 0, y: 0 };
const _p1 = { x: 0, z: 0, y: 0 };

export class RingIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly minX: number;
  private readonly minZ: number;

  constructor() {
    // Origen de la rejilla alineado al bbox para claves compactas.
    let x0 = Infinity, z0 = Infinity;
    for (let i = 0; i < STATION_COUNT; i += 7) {
      stationPos(i, _p0);
      if (_p0.x < x0) x0 = _p0.x;
      if (_p0.z < z0) z0 = _p0.z;
    }
    this.minX = Math.floor(x0 / CELL) * CELL;
    this.minZ = Math.floor(z0 / CELL) * CELL;
    // Cada estación se indexa en su celda; la consulta mira 3×3.
    for (let i = 0; i < STATION_COUNT; i++) {
      stationPos(i, _p0);
      const key = this.keyFor(_p0.x, _p0.z);
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private keyFor(x: number, z: number): number {
    const ix = Math.floor((x - this.minX) / CELL);
    const iz = Math.floor((z - this.minZ) / CELL);
    return ix * 100000 + iz;
  }

  /**
   * Rellena `out` con la proyección más cercana. `found=false` si no hay
   * pista a menos de QUERY_RADIUS (terreno lejano: manda la rejilla base).
   *
   * NOTA: la elevación proyectada (`elev`) desliza con la lateral en curvas
   * con peralte de rasante (el punto más cercano no conserva la abscisa): NO
   * usarla como referencia de la calzada —para eso está `nearestStation`,
   * que ancla la abscisa sin deslizar (ver `RingTerrain.roadHeightAt`).
   */
  query(x: number, z: number, out: RingQuery): RingQuery {
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    let bestD2 = QUERY_RADIUS * QUERY_RADIUS;
    let bestI = -1;
    // Candidatos: estaciones de las 3×3 celdas vecinas.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get((cx + dx) * 100000 + (cz + dz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          stationPos(i, _p0);
          const ddx = x - _p0.x;
          const ddz = z - _p0.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestI = i;
          }
        }
      }
    }
    if (bestI < 0) {
      out.found = false;
      out.dist = Infinity;
      return out;
    }
    // Evaluación fina: segmentos alrededor del ganador (±3 estaciones).
    bestD2 = Infinity;
    let bS = 0, bTx = 0, bTz = 0, bE = 0, bSigned = 0;
    for (let j = bestI - 3; j <= bestI + 3; j++) {
      const n = STATION_COUNT;
      const ia = ((j % n) + n) % n;
      const ib = (ia + 1) % n;
      stationPos(ia, _p0);
      stationPos(ib, _p1);
      const dx = _p1.x - _p0.x;
      const dz = _p1.z - _p0.z;
      const len2 = dx * dx + dz * dz;
      let u = len2 > 1e-9 ? ((x - _p0.x) * dx + (z - _p0.z) * dz) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = _p0.x + dx * u;
      const pz = _p0.z + dz * u;
      const ex = x - px;
      const ez = z - pz;
      const d2 = ex * ex + ez * ez;
      if (d2 < bestD2) {
        bestD2 = d2;
        bS = (ia * RING_STEP + u * RING_STEP) % LOOP_LENGTH;
        const len = Math.sqrt(len2) || 1;
        bTx = dx / len; bTz = dz / len;
        bE = _p0.y + (_p1.y - _p0.y) * u;
        bSigned = ex * -bTz + ez * bTx;
      }
    }
    out.found = true;
    out.dist = Math.sqrt(bestD2);
    out.signed = bSigned;
    out.s = bS;
    out.elev = bE;
    out.tx = bTx;
    out.tz = bTz;
    return out;
  }

  /** Consulta nueva (para código frío: mallas, utilidades). */
  freshQuery(x: number, z: number): RingQuery {
    return this.query(x, z, { found: false, dist: 0, signed: 0, s: 0, elev: 0, tx: 0, tz: 0 });
  }

  /**
   * Estación más cercana (por distancia a sus puntos, sin proyectar): ancla
   * la abscisa para la referencia de calzada. -1 si no hay pista cerca.
   */
  nearestStation(x: number, z: number): number {
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    let bestD2 = QUERY_RADIUS * QUERY_RADIUS;
    let bestI = -1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get((cx + dx) * 100000 + (cz + dz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          stationPos(i, _p0);
          const ddx = x - _p0.x;
          const ddz = z - _p0.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestI = i;
          }
        }
      }
    }
    return bestI;
  }

  /**
   * Todas las estaciones a menos de `radius` [m] (vía fría: el clavado del
   * fondo debe respetar TODOS los brazos cercanos, no solo el más próximo).
   */
  stationsWithin(x: number, z: number, radius: number, out: number[]): number[] {
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    const r2 = radius * radius;
    out.length = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get((cx + dx) * 100000 + (cz + dz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          stationPos(i, _p0);
          const ddx = x - _p0.x;
          const ddz = z - _p0.z;
          if (ddx * ddx + ddz * ddz < r2) out.push(i);
        }
      }
    }
    return out;
  }
}
