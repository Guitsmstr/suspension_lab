/**
 * Circuitos conmutables y barrera perimetral que cierra el mapa.
 *
 * Cuatro trazados en dos superficies que usan casi todo el mapa (±140 m):
 *
 * - Asfalto:
 *   · `monaco` — "Mónaco GP" (~800 m): gran anillo exterior con rectas
 *     rápidas al sur y al norte, esses en el este, chicane en la recta de
 *     meta y horquilla lenta al oeste.
 *   · `interlagos` — "Interlagos Mini" (~410 m): mixto centro-este con S
 *     inicial, curva ciega, horquilla y subida.
 * - Tierra:
 *   · `baja` — "Baja Whoops" (~450 m): rápida oeste con la recta de badenes
 *     como tramo de saltos y una cerrada al fondo.
 *   · `stadium` — "Estadio Rallycross" (~290 m): técnico centro-oeste
 *     alrededor de la meseta: horquilla y esses.
 *
 * - Las calzadas son cintas 3D ceñidas al terreno analítico (la misma función
 *   de altura que usa la física) con un lift mínimo (3 cm), así que las
 *   ruedas pisan la cinta sin enterrarse… salvo que el usuario cambie la
 *   rugosidad en vivo, en cuyo caso se reconstruyen (ver `refresh()`).
 * - El asfalto lleva pianos rojo/blanco en las curvas; la tierra, conos
 *   naranjas marcando la trazada.
 * - La decoración evita los trazados (ver `routeKeepOut()`, usado por scenery).
 * - `enforceTrackBounds()` es el muro invisible: se llama una vez por frame.
 */
import * as THREE from 'three';
import type { Terrain } from './terrain';
import type { Vehicle } from '../vehicle/vehicle';

export type TrackId = 'monaco' | 'interlagos' | 'baja' | 'stadium';
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
  /** Líneas de borde blancas (solo asfalto). */
  edgeLines: boolean;
}

export const TRACKS: Record<TrackId, TrackDef> = {
  monaco: {
    id: 'monaco',
    name: 'Mónaco GP',
    surface: 'asfalto',
    inspiration: 'Circuito de Mónaco · réplica ≈ 1:6',
    description: 'Anillo exterior: rectas rápidas, esses, chicane y horquilla.',
    badge: '🏁 Mónaco GP · asfalto',
    points: [
      [-100, -100], // recta de meta (salida, 190 m limpios)
      [-30, -108],
      [40, -112], // recta sur rápida
      [90, -100],
      [115, -60], // subida este
      [118, 2], // bajada este
      [108, 50],
      [84, 84], // esses del este
      [42, 100],
      [-8, 106], // recta norte rápida
      [-30, 100], // chicane norte
      [-46, 92],
      [-64, 90],
      [-98, 74], // curvón noroeste
      [-128, 66],
      [-140, 52], // horquilla (la más lenta)
      [-126, 38],
      [-133, -12],
      [-122, -58], // bajada oeste
      [-95, -92], // (a la meta)
    ],
    width: 8,
    edgeLines: true,
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
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});
const curbMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
const coneMat = new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.7, metalness: 0 });
/** La calzada vuela sobre el terreno analítico (ver `buildTrack`). */
const ROAD_LIFT = 0.03;
/** Las líneas y la meta vuelan un poco más para no pelear el z-buffer. */
const PAINT_LIFT = ROAD_LIFT + 0.045;
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
  return trackCurve(def).getLength();
}

/**
 * Cinta de calzada: dos vértices por estación (borde izq./der.), cada uno a la
 * altura del terreno bajo sus propios pies + `lift`. Normales del terreno para
 * que la luz acompañe las pendientes.
 */
function ribbonGeometry(
  center: THREE.Vector3[],
  halfWidth: number,
  lateral: number,
  lift: number,
  terrain: Terrain,
): THREE.BufferGeometry {
  const n = center.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  let dist = 0;

  for (let i = 0; i < n; i++) {
    const p = center[i];
    tangent.subVectors(center[(i + 1) % n], center[(i - 1 + n) % n]);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
    else tangent.normalize();
    side.set(-tangent.z, 0, tangent.x);
    if (i > 0) dist += center[i].distanceTo(center[i - 1]);

    for (let s = 0; s < 2; s++) {
      const off = lateral + (s === 0 ? -halfWidth : halfWidth);
      const x = p.x + side.x * off;
      const z = p.z + side.z * off;
      const y = terrain.heightAt(x, z) + lift;
      const k = i * 2 + s;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      if (terrain.normalAt) terrain.normalAt(x, z, nrm);
      else nrm.set(0, 1, 0);
      normals[k * 3] = nrm.x;
      normals[k * 3 + 1] = nrm.y;
      normals[k * 3 + 2] = nrm.z;
      uvs[k * 2] = dist / 8;
      uvs[k * 2 + 1] = s;
    }
  }

  // Devando antihorario visto desde arriba (+Y): la calzada mira al cielo.
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
 * color cada ~4 m. Instanciado en una sola malla.
 */
function buildCurbs(
  def: TrackDef,
  center: THREE.Vector3[],
  terrain: Terrain,
  group: THREE.Group,
): void {
  const n = center.length;
  const spots: Array<{ x: number; z: number; y: number; yaw: number; red: boolean }> = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let dist = 0;
  for (let i = 0; i < n; i += 2) {
    const p0 = center[(i - 2 + n) % n];
    const p1 = center[i];
    const p2 = center[(i + 2) % n];
    a.subVectors(p1, p0).setY(0);
    b.subVectors(p2, p1).setY(0);
    dist += a.length();
    const turn = a.lengthSq() > 1e-6 && b.lengthSq() > 1e-6 ? a.angleTo(b) : 0;
    if (turn < 0.11) continue; // solo curvas de verdad
    const yaw = Math.atan2(b.x, b.z);
    const dir = new THREE.Vector3().subVectors(p2, p0).setY(0).normalize();
    const sx = -dir.z;
    const sz = dir.x;
    const red = Math.floor(dist / 4) % 2 === 0;
    for (const s of [-1, 1]) {
      const x = p1.x + sx * s * (def.width / 2 + 0.35);
      const z = p1.z + sz * s * (def.width / 2 + 0.35);
      spots.push({ x, z, y: terrain.heightAt(x, z) + ROAD_LIFT + 0.035, yaw, red });
    }
  }
  if (spots.length === 0) return;
  const geo = new THREE.BoxGeometry(0.7, 0.07, 2.4);
  const inst = new THREE.InstancedMesh(geo, curbMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
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
 * donde no hay líneas pintadas.
 */
function buildCones(
  def: TrackDef,
  center: THREE.Vector3[],
  terrain: Terrain,
  group: THREE.Group,
): void {
  const n = center.length;
  const spots: Array<{ x: number; z: number; y: number }> = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i < n; i += 9) {
    const p = center[i];
    tangent.subVectors(center[(i + 1) % n], center[(i - 1 + n) % n]).setY(0).normalize();
    const sx = -tangent.z;
    const sz = tangent.x;
    for (const s of [-1, 1]) {
      const x = p.x + sx * s * (def.width / 2 + 0.8);
      const z = p.z + sz * s * (def.width / 2 + 0.8);
      spots.push({ x, z, y: terrain.heightAt(x, z) });
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
  const curve = trackCurve(def);

  const build = (): void => {
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh;
      const anyMesh = mesh as unknown as { geometry?: THREE.BufferGeometry };
      anyMesh.geometry?.dispose();
      group.remove(child);
    }
    // getSpacedPoints en curva cerrada repite el primero al final: se quita.
    const center = curve.getSpacedPoints(420).slice(0, 420);
    const mat = def.surface === 'asfalto' ? asphaltMat : dirtMat;
    // La malla del terreno interpola linealmente entre vértices (paso 1 m)
    // mientras la cinta sigue la altura analítica exacta: en los badenes
    // (onda de 2,8 m) la cuerda de la malla puede quedar ~10 cm por debajo
    // del valle real. El lift deja la calzada por encima también ahí, pero
    // lo justo (3 cm: la física rueda sobre el terreno analítico, así que un
    // lift mayor entierra visualmente las ruedas en la calzada).
    const road = new THREE.Mesh(ribbonGeometry(center, def.width / 2, 0, ROAD_LIFT, terrain), mat);
    road.receiveShadow = true;
    group.add(road);

    if (def.edgeLines) {
      for (const lateral of [-def.width / 2 + 0.45, def.width / 2 - 0.45]) {
        const line = new THREE.Mesh(ribbonGeometry(center, 0.18, lateral, PAINT_LIFT, terrain), lineMat);
        line.receiveShadow = true;
        group.add(line);
      }
      buildCurbs(def, center, terrain, group);
    } else {
      buildCones(def, center, terrain, group);
    }

    // Línea de salida/meta atravesada en el primer punto
    const p0 = center[0];
    const p1 = center[1];
    const tangent = new THREE.Vector3().subVectors(p1, p0).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const hw = def.width / 2;
    const y0 = terrain.heightAt(p0.x + side.x * -hw, p0.z + side.z * -hw) + PAINT_LIFT;
    const y1 = terrain.heightAt(p0.x + side.x * hw, p0.z + side.z * hw) + PAINT_LIFT;
    const startGeo = new THREE.BufferGeometry();
    startGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          p0.x + side.x * -hw - tangent.x * 0.6, y0, p0.z + side.z * -hw - tangent.z * 0.6,
          p0.x + side.x * -hw + tangent.x * 0.6, y0, p0.z + side.z * -hw + tangent.z * 0.6,
          p0.x + side.x * hw - tangent.x * 0.6, y1, p0.z + side.z * hw - tangent.z * 0.6,
          p0.x + side.x * hw + tangent.x * 0.6, y1, p0.z + side.z * hw + tangent.z * 0.6,
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
 * porque el recorte es absoluto).
 */
export function enforceTrackBounds(v: Vehicle): void {
  const p = v.position;
  const vel = v.velocity;
  if (p.x > TRACK_BOUND) {
    p.x = TRACK_BOUND;
    if (vel.x > 0) vel.x *= -0.2;
  } else if (p.x < -TRACK_BOUND) {
    p.x = -TRACK_BOUND;
    if (vel.x < 0) vel.x *= -0.2;
  }
  if (p.z > TRACK_BOUND) {
    p.z = TRACK_BOUND;
    if (vel.z > 0) vel.z *= -0.2;
  } else if (p.z < -TRACK_BOUND) {
    p.z = -TRACK_BOUND;
    if (vel.z < 0) vel.z *= -0.2;
  }
}
