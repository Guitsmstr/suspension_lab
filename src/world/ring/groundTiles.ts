/**
 * Hierba del Nordschleife con streaming: el mundo mide ~6×5 km y no cabe en
 * una sola malla densa, así que se renderiza por teselas bajo demanda
 * ("rendering the environment as we are going"):
 *
 * - Teselas de 256 m con paso de 4 m (65×65 vértices) en un radio de ~800 m
 *   alrededor del coche; fuera de ~1150 m se liberan. Presupuesto: 2 teselas
 *   nuevas por fotograma como mucho (cada una cuesta ~5 ms).
 * - Fondo de baja resolución (paso 64 m sobre bbox + 1 km) siempre visible
 *   para el horizonte; pierde contra las teselas y la calzada por
 *   polygonOffset donde se solapan.
 * - Todas las mallas muestrean `meshHeightAt` (esculpida bajo la calzada):
 *   la hierba nunca asoma por la pista, igual que en el mundo pequeño.
 */
import * as THREE from 'three';
import { RING_BBOX, ROAD_HALF } from './centerline';
import type { RingTerrain, RoadHeight } from './ringTerrain';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const TILE_SIZE = 256;
const TILE_SEG = 64;
const VISIBLE_RADIUS = 800;
const DISPOSE_RADIUS = 1150;
const MAX_BUILD_PER_UPDATE = 2;

const tileMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.96,
  metalness: 0,
  envMapIntensity: 0.35,
});
const backdropMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.96,
  metalness: 0,
  envMapIntensity: 0.35,
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 2,
});

const _color = new THREE.Color();
const _dirt = new THREE.Color();
const _floor = new THREE.Color();

function paintVertex(
  colors: Float32Array,
  vi: number,
  x: number,
  z: number,
  normalY: number,
  forestShade: number,
): void {
  const noise =
    0.5 +
    0.5 *
      Math.sin(x * 0.07 + 0.6) *
      Math.cos(z * 0.061 - 1.1) *
      (0.6 + 0.4 * Math.sin(x * 0.023 * z * 0.019 + 2.2));
  const hue = 0.245 + 0.028 * noise;
  const light = 0.245 + 0.07 * noise;
  _color.setHSL(hue, 0.48, light);
  // Sotobosque: manchas oscuras de bosque (Eifel = hayedos y abetos).
  _floor.setHSL(0.29, 0.42, 0.16);
  _color.lerp(_floor, forestShade * 0.65);
  // En pendientes fuertes, tierra.
  const steep = 1 - Math.max(0, normalY);
  _dirt.setHSL(0.09, 0.26, 0.24 + 0.05 * noise);
  _color.lerp(_dirt, Math.min(1, steep * 2.4));
  colors[vi * 3] = _color.r;
  colors[vi * 3 + 1] = _color.g;
  colors[vi * 3 + 2] = _color.b;
}

/** Sombra de bosque [0..1] por ruido de baja frecuencia (rodales). */
function forestShadeAt(x: number, z: number): number {
  const v = Math.sin(x * 0.004 + 1.2) * Math.cos(z * 0.0037 - 0.5) +
    0.5 * Math.sin(x * 0.009 - 0.4) * Math.sin(z * 0.008 + 0.9);
  return Math.max(0, Math.min(1, (v + 0.4) / 1.6));
}

/**
 * Rejilla del fondo (origen de la esquina ix=0, iy=0 en mundo): la exporta
 * para que el barrido anti-hierba reproduzca la interpolación exacta.
 */
export const RING_BACKDROP = ((): { step: number; nx: number; nz: number; ox: number; ozTop: number } => {
  const m = 1200; // margen más allá del bbox [m]
  const w = RING_BBOX.x1 - RING_BBOX.x0 + m * 2;
  const d = RING_BBOX.z1 - RING_BBOX.z0 + m * 2;
  const step = 32;
  const nx = Math.ceil(w / step);
  const nz = Math.ceil(d / step);
  const cx = (RING_BBOX.x0 + RING_BBOX.x1) / 2;
  const cz = (RING_BBOX.z0 + RING_BBOX.z1) / 2;
  return { step, nx, nz, ox: cx - (nx * step) / 2, ozTop: cz + (nz * step) / 2 };
})();
/**
 * Altura de vértice del fondo con clavado al corredor. El clavado respeta
 * todos los brazos cercanos (mínimo a 32 m, una celda) menos 4 m (3 de
 * resguardo + 1 de cuerda en hondonadas R≥128 m y dispersión de rasante).
 * Así las cuerdas entre vértices clavados nunca superan ninguna cinta
 * vecina. Fuera de 45 m el clavado funde hasta 80 m para no dejar
 * peldaños (las teselas precisas cubren el campo cercano de todos modos).
 */
export function backdropVertexY(terrain: RingTerrain, x: number, z: number): number {
  const y = terrain.meshHeightAt(x, z);
  const r: RoadHeight = { s: 0, o: 0, elev: 0 };
  if (!terrain.roadHeightAt(x, z, r)) return y;
  const ao = Math.abs(r.o);
  if (ao >= BACKDROP_PIN_BLEND) return y;
  // Mínimo sobre TODOS los brazos a 32 m (una celda): el vértice queda bajo
  // cada cinta vecina, no solo bajo la más próxima.
  const eMin = terrain.minRoadElev(x, z, 32) ?? r.elev;
  const full = Math.min(y, eMin - BACKDROP_PIN_DEPTH);
  const w = 1 - smoothstep(ROAD_HALF + BACKDROP_PIN_ZONE, BACKDROP_PIN_BLEND, ao);
  return y + (full - y) * w;
}

/** Semiancho con clavado completo [m]: la celda (32 m) que pisa la cinta
 *  tiene esquinas hasta 37 m fuera; todas van clavadas. */
const BACKDROP_PIN_ZONE = 40;
/** Alcance de la fusión del clavado [m]. */
const BACKDROP_PIN_BLEND = 80;
/** Resguardo bajo la cota mínima local [m]. */
const BACKDROP_PIN_DEPTH = 4;

/** Fondo de baja resolución con clavado al corredor (ver `backdropVertexY`). */
export function buildBackdropGeometry(terrain: RingTerrain): THREE.BufferGeometry {
  const { step, nx, nz } = RING_BACKDROP;
  const geo = new THREE.PlaneGeometry(nx * step, nz * step, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const cx = (RING_BBOX.x0 + RING_BBOX.x1) / 2;
  const cz = (RING_BBOX.z0 + RING_BBOX.z1) / 2;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, backdropVertexY(terrain, x, z), z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    paintVertex(colors, i, pos.getX(i), pos.getZ(i), nrm.getY(i), forestShadeAt(pos.getX(i), pos.getZ(i)));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class GroundTiles {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, { mesh: THREE.Mesh; cx: number; cz: number }>();

  constructor(private readonly terrain: RingTerrain) {
    this.group.name = 'ring-ground';
    this.group.add(this.buildBackdrop());
  }

  private buildBackdrop(): THREE.Mesh {
    const geo = buildBackdropGeometry(this.terrain);
    const mesh = new THREE.Mesh(geo, backdropMat);
    mesh.receiveShadow = false;
    mesh.name = 'ring-backdrop';
    return mesh;
  }

  private tileKey(tx: number, tz: number): string {
    return `${tx},${tz}`;
  }

  private buildTile(tx: number, tz: number): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TILE_SEG, TILE_SEG);
    geo.rotateX(-Math.PI / 2);
    const ox = tx * TILE_SIZE + TILE_SIZE / 2;
    const oz = tz * TILE_SIZE + TILE_SIZE / 2;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox;
      const z = pos.getZ(i) + oz;
      pos.setXYZ(i, x, this.terrain.meshHeightAt(x, z), z);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      paintVertex(colors, i, pos.getX(i), pos.getZ(i), nrm.getY(i), forestShadeAt(pos.getX(i), pos.getZ(i)));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, tileMat);
    mesh.receiveShadow = true;
    mesh.name = `ring-tile-${tx},${tz}`;
    return mesh;
  }

  /** Teselas necesarias alrededor de (x, z): carga síncrona (arranque/spawn). */
  ensureAround(x: number, z: number): void {
    const tx0 = Math.floor((x - VISIBLE_RADIUS) / TILE_SIZE);
    const tx1 = Math.floor((x + VISIBLE_RADIUS) / TILE_SIZE);
    const tz0 = Math.floor((z - VISIBLE_RADIUS) / TILE_SIZE);
    const tz1 = Math.floor((z + VISIBLE_RADIUS) / TILE_SIZE);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = this.tileKey(tx, tz);
        if (this.tiles.has(key)) continue;
        const cx = tx * TILE_SIZE + TILE_SIZE / 2;
        const cz = tz * TILE_SIZE + TILE_SIZE / 2;
        if (Math.hypot(cx - x, cz - z) > VISIBLE_RADIUS + TILE_SIZE * 0.75) continue;
        const mesh = this.buildTile(tx, tz);
        this.tiles.set(key, { mesh, cx, cz });
        this.group.add(mesh);
      }
    }
  }

  /** Streaming por fotograma: construye ≤2 teselas y libera las lejanas. */
  update(x: number, z: number): void {
    let built = 0;
    const tx0 = Math.floor((x - VISIBLE_RADIUS) / TILE_SIZE);
    const tx1 = Math.floor((x + VISIBLE_RADIUS) / TILE_SIZE);
    const tz0 = Math.floor((z - VISIBLE_RADIUS) / TILE_SIZE);
    const tz1 = Math.floor((z + VISIBLE_RADIUS) / TILE_SIZE);
    // Candidatos ordenados por cercanía (el centro primero).
    const want: Array<{ tx: number; tz: number; d: number }> = [];
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.tiles.has(this.tileKey(tx, tz))) continue;
        const cx = tx * TILE_SIZE + TILE_SIZE / 2;
        const cz = tz * TILE_SIZE + TILE_SIZE / 2;
        const d = Math.hypot(cx - x, cz - z);
        if (d < VISIBLE_RADIUS + TILE_SIZE * 0.75) want.push({ tx, tz, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (built >= MAX_BUILD_PER_UPDATE) break;
      const mesh = this.buildTile(w.tx, w.tz);
      this.tiles.set(this.tileKey(w.tx, w.tz), {
        mesh,
        cx: w.tx * TILE_SIZE + TILE_SIZE / 2,
        cz: w.tz * TILE_SIZE + TILE_SIZE / 2,
      });
      this.group.add(mesh);
      built++;
    }
    // Liberación de lejanas (sin asignaciones calientes: iterador del Map).
    for (const [key, t] of this.tiles) {
      if (Math.hypot(t.cx - x, t.cz - z) > DISPOSE_RADIUS) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
  }

  /** Reconstruye las visibles (tras cambiar la rugosidad en vivo). */
  refreshAll(): void {
    for (const [, t] of this.tiles) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    this.tiles.clear();
  }

  get tileCount(): number {
    return this.tiles.size;
  }
}
