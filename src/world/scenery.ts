/**
 * Decoración del terreno: árboles, rocas, arbustos, césped y troncos instanciados
 * a partir de modelos CC0 (Kenney Nature Kit, ver public/assets/nature/LICENSE.md).
 *
 * Todo se dibuja con InstancedMesh: pocos draw calls pese a cientos de piezas.
 * Las piezas grandes publican además un colisionador cilíndrico para que la
 * física no las atraviese (ver ObstacleField).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Terrain } from './terrain';
import { ObstacleField } from './obstacles';

const ASSET_BASE = '/assets/nature/';
const UP = new THREE.Vector3(0, 1, 0);

interface Kind {
  name: string;
  files: string[];
  count: number;
  scale: [number, number];
  /** Distancia mínima entre piezas de este tipo [m]. */
  clearance: number;
  /** Colisionador cilíndrico (solo piezas que el coche no debe atravesar). */
  collider: boolean;
  /** Mínimo radio para considerar colisionador [m]. */
  minColliderRadius: number;
  castShadow: boolean;
  /** Inclinación máxima al alinearse con la pendiente [rad]. */
  tilt: number;
}

const KINDS: Kind[] = [
  {
    name: 'árboles',
    files: ['tree_pineDefaultA', 'tree_pineTallB', 'tree_oak', 'tree_small', 'tree_thin'],
    count: 110,
    scale: [0.85, 1.8],
    clearance: 4.5,
    collider: true,
    minColliderRadius: 0.22,
    castShadow: true,
    tilt: 0.05,
  },
  {
    name: 'rocas',
    files: ['rock_largeA', 'rock_largeC', 'rock_tallA', 'rock_smallA', 'rock_smallC', 'rock_smallFlatA'],
    count: 190,
    scale: [0.8, 2.4],
    clearance: 2.1,
    collider: true,
    minColliderRadius: 0.38,
    castShadow: true,
    tilt: 0.35,
  },
  {
    name: 'troncos y tocones',
    files: ['log', 'stump_round'],
    count: 35,
    scale: [1, 1.7],
    clearance: 4,
    collider: true,
    minColliderRadius: 0.3,
    castShadow: true,
    tilt: 0.12,
  },
  {
    name: 'arbustos',
    files: ['plant_bush', 'plant_bushSmall'],
    count: 180,
    scale: [0.9, 2.1],
    clearance: 1.7,
    collider: false,
    minColliderRadius: 0,
    castShadow: false,
    tilt: 0.2,
  },
  {
    name: 'césped',
    files: ['grass', 'grass_large'],
    count: 700,
    scale: [0.9, 1.9],
    clearance: 1.1,
    collider: false,
    minColliderRadius: 0,
    castShadow: false,
    tilt: 0.25,
  },
];

/** PRNG determinista (mulberry32) para que la decoración sea reproducible. */function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placement {
  file: string;
  matrix: THREE.Matrix4;
  x: number;
  z: number;
  radius: number;
  top: number;
}

export interface SceneryHandle {
  group: THREE.Group;
  obstacles: ObstacleField;
  instances: number;
  /** Cuenta las piezas situadas dentro de un radio [m] de un punto del terreno. */
  countNear(x: number, z: number, radius: number): number;
}

/**
 * La paleta del pack Kenney es estilizada (vegetación turquesa, madera salmón);
 * se desplaza hacia tonos naturales para que combine con el terreno.
 */
function naturalize(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.color) return;
  const hsl = { h: 0, s: 0, l: 0 };
  m.color.getHSL(hsl);
  if (hsl.s < 0.12) return; // blancos y grises se dejan como están
  if (hsl.h > 0.33 && hsl.h < 0.56) {
    // Vegetación turquesa → verde natural
    m.color.setHSL(0.24 + (hsl.h - 0.45) * 0.25, Math.min(0.75, hsl.s * 1.15), hsl.l * 0.82);
  } else if (hsl.h < 0.13) {
    // Madera y tierra salmón → marrón
    m.color.setHSL(0.075, hsl.s * 0.72, hsl.l * 0.72);
  }
}

/**
 * Zona reservada: el paddock de salida y el tramo de badenes se dejan libres
 * para que se puedan hacer maniobras y pruebas sin estorbar. `keepOut` añade
 * los trazados del circuito para que nada nazca sobre la calzada.
 */
function isReserved(
  x: number,
  z: number,
  keepOut: ReadonlyArray<{ x: number; z: number; r: number }> = [],
): boolean {
  if (Math.hypot(x, z) < 10) return true;
  if (Math.abs(z + 16) < 7 && Math.abs(x) < 56) return true;
  for (const k of keepOut) {
    const dx = x - k.x;
    const dz = z - k.z;
    if (dx * dx + dz * dz < k.r * k.r) return true;
  }
  return false;
}

export async function buildScenery(
  terrain: Terrain,
  onProgress?: (done: number, total: number) => void,
  seed = 20261005,
  keepOut: ReadonlyArray<{ x: number; z: number; r: number }> = [],
): Promise<SceneryHandle> {
  // ---------------- Carga de modelos ----------------
  const files = [...new Set(KINDS.flatMap((k) => k.files))];
  const loader = new GLTFLoader();
  let done = 0;

  const loaded = await Promise.all(
    files.map(async (file) => {
      const gltf = await loader.loadAsync(`${ASSET_BASE}${file}.glb`);
      gltf.scene.updateMatrixWorld(true);
      done++;
      onProgress?.(done, files.length);
      return [file, gltf.scene] as const;
    }),
  );

  const meshesByFile = new Map<string, THREE.Mesh[]>();
  const boxByFile = new Map<string, THREE.Box3>();
  const size = new THREE.Vector3();

  for (const [file, scene] of loaded) {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes.push(m);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) naturalize(mat);
    });
    meshesByFile.set(file, meshes);
    boxByFile.set(file, new THREE.Box3().setFromObject(scene));
  }

  // ---------------- Reparto de posiciones ----------------
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'scenery';
  const obstacles = new ObstacleField();
  const placements: Placement[] = [];

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tiltQ = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();

  for (const kind of KINDS) {
    const taken: Array<{ x: number; z: number; r: number }> = [];
    let placed = 0;
    let attempts = 0;

    while (placed < kind.count && attempts < kind.count * 30) {
      attempts++;

      // 45 % cerca del origen (puntos de referencia alrededor del paddock),
      // 55 % repartido por todo el mapa hasta la barrera: los circuitos usan
      // las esquinas y también allí hacen falta referencias visuales.
      const nearField = rng() < 0.45;
      const r = nearField ? 7 + 60 * Math.pow(rng(), 1.15) : 50 + 90 * rng();
      const ang = rng() * Math.PI * 2;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (isReserved(x, z, keepOut)) continue;

      // Separación mínima entre piezas del mismo tipo
      const s = kind.scale[0] + rng() * (kind.scale[1] - kind.scale[0]);
      const file = kind.files[Math.floor(rng() * kind.files.length)];
      const box = boxByFile.get(file)!;
      box.getSize(size);
      const footprint = 0.5 * Math.max(size.x, size.z) * s;
      const minDist = kind.clearance * (0.75 + 0.5 * s);
      let tooClose = false;
      for (const t of taken) {
        const dx = t.x - x;
        const dz = t.z - z;
        if (dx * dx + dz * dz < (minDist + t.r) * (minDist + t.r)) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const y = terrain.heightAt(x, z);
      terrain.normalAt(x, z, normal);

      pos.set(x, y - box.min.y * s, z);
      quat.setFromAxisAngle(UP, rng() * Math.PI * 2);
      if (kind.tilt > 0.001) {
        tiltQ.setFromUnitVectors(UP, normal);
        quat.slerp(quat.clone().multiply(tiltQ), kind.tilt * (0.35 + rng()));
      }
      scaleV.setScalar(s);
      matrix.compose(pos, quat, scaleV);

      taken.push({ x, z, r: footprint });
      placements.push({
        file,
        matrix: matrix.clone(),
        x,
        z,
        radius: footprint,
        top: y + size.y * s,
      });

      if (kind.collider && footprint >= kind.minColliderRadius) {
        obstacles.add({ x, z, radius: Math.min(footprint, 1.6), top: y + size.y * s * 0.85 });
      }
      placed++;
    }
  }

  // ---------------- Instanciado ----------------
  const byFile = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = byFile.get(p.file);
    if (list) list.push(p);
    else byFile.set(p.file, [p]);
  }

  const tmp = new THREE.Matrix4();
  for (const [file, items] of byFile) {
    const kind = KINDS.find((k) => k.files.includes(file))!;
    for (const src of meshesByFile.get(file)!) {
      const inst = new THREE.InstancedMesh(src.geometry, src.material, items.length);
      inst.name = `${file}`;
      inst.castShadow = kind.castShadow;
      inst.receiveShadow = true;
      for (let i = 0; i < items.length; i++) {
        tmp.copy(items[i].matrix).multiply(src.matrixWorld);
        inst.setMatrixAt(i, tmp);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }

  return {
    group,
    obstacles,
    instances: placements.length,
    countNear(x: number, z: number, radius: number): number {
      const r2 = radius * radius;
      let n = 0;
      for (const p of placements) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz <= r2) n++;
      }
      return n;
    },
  };
}
