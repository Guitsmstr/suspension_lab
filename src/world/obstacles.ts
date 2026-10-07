/**
 * Campo de obstáculos cilíndricos (rocas, troncos) para la física.
 *
 * Rejilla uniforme: las consultas ocurren dentro del bucle de física, así que
 * no se asigna memoria por consulta y el coste es independiente del número de
 * obstáculos del mundo.
 */
import type { Obstacle, ObstacleSampler } from '../vehicle/vehicle';

const HALF_EXTENT = 170; // el terreno mide 320 m; margen amplio
const CELL = 10; // m por celda
const GRID = Math.ceil((HALF_EXTENT * 2) / CELL);

export class ObstacleField implements ObstacleSampler {
  readonly obstacles: Obstacle[] = [];
  private readonly cells: Obstacle[][] = new Array(GRID * GRID);

  constructor() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  /** Añade un obstáculo y lo indexa en todas las celdas que su círculo toca. */
  add(o: Obstacle): void {
    this.obstacles.push(o);
    const minX = this.cellIndex(o.x - o.radius);
    const maxX = this.cellIndex(o.x + o.radius);
    const minZ = this.cellIndex(o.z - o.radius);
    const maxZ = this.cellIndex(o.z + o.radius);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        this.cell(cx, cz).push(o);
      }
    }
  }

  /**
   * Escribe en `out` los obstáculos cuyo círculo puede tocar (x, z) y devuelve
   * cuántos se han escrito (como mucho `out.length`).
   */
  near(x: number, z: number, out: Obstacle[]): number {
    const list = this.cell(this.cellIndex(x), this.cellIndex(z));
    const n = Math.min(list.length, out.length);
    for (let i = 0; i < n; i++) out[i] = list[i];
    return n;
  }

  private cellIndex(v: number): number {
    const i = Math.floor((v + HALF_EXTENT) / CELL);
    return i < 0 ? 0 : i >= GRID ? GRID - 1 : i;
  }

  private cell(cx: number, cz: number): Obstacle[] {
    return this.cells[cz * GRID + cx];
  }
}
