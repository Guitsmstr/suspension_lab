/**
 * Mundo Nürburgring 1:1: fachada que agrupa terreno físico, calzada y hierba
 * con streaming. El mundo pequeño (`Terrain` + `TRACK_ORDER`) sigue intacto;
 * `main.ts` conmuta entre ambos mundos sin reconstruir el vehículo (ver
 * `SwitchableTerrain` más abajo: la física delega en el terreno activo).
 */
import * as THREE from 'three';
import type { Obstacle, ObstacleSampler, TerrainSampler } from '../../vehicle/vehicle';
import { ObstacleField } from '../obstacles';
import { RingTerrain } from './ringTerrain';
import { GroundTiles } from './groundTiles';
import { buildRingRoad, buildRingEdgeLines, buildRingStartLine } from './roadChunks';

/** Muro invisible del mundo grande [m] (el fondo cubre bbox + 1 km). */
export const RING_BOUND = 3900;

/** Delega el muestreo del terreno en el mundo activo (pequeño o anillo). */
export class SwitchableTerrain implements TerrainSampler {
  small: TerrainSampler | null = null;
  ring: RingTerrain | null = null;
  useRing = false;

  private get active(): TerrainSampler {
    const t = this.useRing ? this.ring : this.small;
    if (!t) throw new Error('SwitchableTerrain sin mundo activo');
    return t;
  }

  heightAt(x: number, z: number): number {
    return this.active.heightAt(x, z);
  }
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.active;
    return a.normalAt ? a.normalAt(x, z, out) : out.set(0, 1, 0);
  }
  surfaceMuAt(x: number, z: number): number {
    const a = this.active;
    return a.surfaceMuAt ? a.surfaceMuAt(x, z) : 1;
  }
  surfaceKindAt(x: number, z: number): string {
    const a = this.active;
    return a.surfaceKindAt ? a.surfaceKindAt(x, z) : 'asphalt';
  }
}

/** Delega los obstáculos en el mundo activo (el anillo, fase 1: vacío). */
export class SwitchableObstacles implements ObstacleSampler {
  small: ObstacleSampler | undefined;
  ring: ObstacleSampler | undefined;
  useRing = false;

  near(x: number, z: number, out: Obstacle[]): number {
    const f = this.useRing ? this.ring : this.small;
    return f ? f.near(x, z, out) : 0;
  }
}

export class RingWorld {
  readonly group = new THREE.Group();
  readonly terrain = new RingTerrain();
  readonly obstacles = new ObstacleField();
  private readonly tiles: GroundTiles;

  constructor(onProgress?: (done: number, total: number) => void) {
    this.group.name = 'ring-world';
    const road = buildRingRoad();
    onProgress?.(1, 4);
    const lines = buildRingEdgeLines();
    onProgress?.(2, 4);
    const start = buildRingStartLine();
    this.tiles = new GroundTiles(this.terrain);
    onProgress?.(3, 4);
    this.group.add(road, lines, start, this.tiles.group);
    this.group.visible = false;
    onProgress?.(4, 4);
  }

  /** Precarga las teselas alrededor de la aparición (tras el loader). */
  ensureAround(x: number, z: number): void {
    this.tiles.ensureAround(x, z);
  }

  /** Streaming por fotograma (solo cuando el mundo está visible). */
  update(x: number, z: number): void {
    if (!this.group.visible) return;
    this.tiles.update(x, z);
  }

  /** La rugosidad cambia en vivo: re-mallar las teselas visibles. */
  refreshTiles(): void {
    this.tiles.refreshAll();
  }

  get tileCount(): number {
    return this.tiles.tileCount;
  }
}
