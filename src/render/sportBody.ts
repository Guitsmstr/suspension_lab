/**
 * Carrocería del deportivo modelada en Blender (origen 100 % propio, sin
 * líos de licencia): se carga `sport.glb` en vivo y sustituye a la
 * carrocería procedural. Las ruedas, suspensión y frenos siguen siendo
 * procedurales (ver `CarVisual`): la cáscara no trae ruedas.
 *
 * Contrato de modelado: metros, morro +Z, origen en el CdM, suelo en
 * `groundY` y punto medio entre ejes en `(axleF+axleR)/2`. Al cargar se
 * verifica la caja y se corrigen residuos en X/Y.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSET_URL = '/assets/cars/sport.glb';
const TESLA_ASSET_URL = '/assets/cars/tesla.glb';
const KWID_ASSET_URL = '/assets/cars/kwid_tripo.glb';
const KWID_PROCEDURAL_URL = '/assets/cars/kwid.glb';
/** Ruedas del Kwid: neumático `Wheel_*` + rin `Hub_*` (generadas por
 * `scripts/kwid_wheels_export.py`: centradas en el buje, eje en Z). */
const KWID_WHEELS_URL = '/assets/cars/kwid_wheels.glb';
/** La carrocería Tripo trae los pasos 53 mm por delante de los bujes físicos. */
const KWID_BODY_SHIFT_Z = -0.053;

async function loadBodyFrom(url: string): Promise<THREE.Group | null> {
  let root: THREE.Group;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), url);
    root = gltf.scene as unknown as THREE.Group;
  } catch {
    return null;
  }

  const body = new THREE.Group();
  for (const child of [...root.children]) {
    body.add(child);
  }
  body.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(body);
  // El modelo ya viene en frame del cuerpo (origen = CdM, suelo en
  // groundY): solo se centra en X. El Y NO se toca: usar el mínimo de la
  // caja (splitter/difusor cuelgan bajo el plano del suelo) hundiría la
  // carrocería y enterraría las ruedas en los pasos.
  body.position.set(-(bb.min.x + bb.max.x) / 2, 0, 0);
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return body;
}

export function loadSportBody(): Promise<THREE.Group | null> {
  return loadBodyFrom(ASSET_URL);
}

/** Cáscara del Kwid Outsider (`kwid_tripo.glb`, reconstruido con Tripo). */
export function loadKwidBody(): Promise<THREE.Group | null> {
  return loadBodyFrom(KWID_ASSET_URL);
}

/** Rueda separada en Blender (nodos `Wheel_*` del mismo `glb`). */
export interface KwidWheelNode {
  name: string;
  obj: THREE.Object3D;
}

/**
 * Cáscara con sus propias ruedas: la carrocería va al `bodyGroup` y cada
 * `Wheel_*` se devuelve aparte para acoplarlo al buje físico
 * correspondiente (gira con la dirección y el giro reales). `droppedRims`
 * indica si se descartaron llantas sueltas del `glb` (discos `Circle*` del
 * Tesla): en ese caso la llanta procedural queda a la vista (ver
 * `attachRawBody`). Sin texturas: el `glb` ya trae materiales planos y el
 * contorno se añade en `CarVisual`.
 */
export async function loadRawBody(url: string): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
  droppedRims: boolean;
} | null> {
  let root: THREE.Group;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), url);
    root = gltf.scene as unknown as THREE.Group;
  } catch {
    return null;
  }

  const body = new THREE.Group();
  const wheels: KwidWheelNode[] = [];
  for (const child of [...root.children]) {
    if (child.name.startsWith('Wheel')) wheels.push({ name: child.name, obj: child });
    else body.add(child);
  }
  if (body.children.length === 0) return null;
  body.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(body);
  // Mismo centrado en X que `loadBodyFrom`; las ruedas heredan el offset
  // para que `attach()` las deje en su sitio modelado.
  const offX = -(bb.min.x + bb.max.x) / 2;
  body.position.set(offX, 0, 0);
  for (const w of wheels) w.obj.position.x += offX;
  // Llantas sueltas (`Circle*` en el Tesla): son discos negros planos sin
  // forma de llanta y duplicarían la llanta procedural (radios, aro, pinza).
  // Se emparejan con su rueda por proximidad (centros a <0,6 m) y se
  // descartan: queda un solo juego (neumático del `glb` + llanta procedural,
  // ver `attachRawBody`). Sin llantas sueltas (Kwid), no cambia nada.
  body.updateMatrixWorld(true);
  for (const w of wheels) w.obj.updateMatrixWorld(true);
  const rims: THREE.Object3D[] = [];
  body.traverse((o) => {
    if (o.name.startsWith('Circle')) rims.push(o);
  });
  let droppedRims = false;
  for (const rim of rims) {
    const rc = new THREE.Box3().setFromObject(rim).getCenter(new THREE.Vector3());
    let best: KwidWheelNode | null = null;
    let bestD = 0.6;
    for (const w of wheels) {
      const wc = new THREE.Box3().setFromObject(w.obj).getCenter(new THREE.Vector3());
      const d = rc.distanceTo(wc);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (best) {
      rim.removeFromParent();
      droppedRims = true;
    }
  }
  for (const o of [body, ...wheels.map((w) => w.obj)]) {
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }
  return { body, wheels, droppedRims };
}

export function loadKwidRaw(): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
  droppedRims: boolean;
} | null> {
  return loadRawBody(KWID_ASSET_URL);
}

/** Tesla Model 3 con sus propias ruedas (reemplazo del deportivo). */
export function loadTeslaBody(): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
  droppedRims: boolean;
} | null> {
  return loadRawBody(TESLA_ASSET_URL);
}

/** Rueda del Kwid por piezas: neumático (`Wheel_*`) + rin (`Hub_*`). */
export interface KwidWheelPart {
  name: string;
  /** Neumático y rin (una o varias mallas: uno o dos materiales). */
  tire: THREE.Object3D;
  /** Rin separado; `null` cuando la rueda viene en una sola pieza. */
  rim: THREE.Object3D | null;
}

/** Mallas bajo un nodo (el nodo puede ser malla o grupo multimaterial). */
function collectWheelMeshes(node: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** Caja de un nodo ya rotado al frame del juego (geometrías clonadas). */
function wheelNodeBox(node: THREE.Object3D, rot: THREE.Matrix4): THREE.Box3 | null {
  const box = new THREE.Box3();
  let found = false;
  for (const m of collectWheelMeshes(node)) {
    const geo = (m.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(rot);
    geo.computeBoundingBox();
    box.union(geo.boundingBox!);
    geo.dispose();
    found = true;
  }
  return found ? box : null;
}

/**
 * Viste una pieza (neumático o rin): clona sus mallas, las rota al frame
 * del juego, las escala y las centra en el buje. Cada pieza se centra en
 * su propia caja: rin y neumático quedan concéntricos aunque el modelo
 * traiga desfases entre ellos.
 *
 * Opciones:
 * - `flipY`: gira 180° sobre Y (frame del juego): pone la cara vista del
 *   rin hacia fuera. Los `Hub_*` llegan con las aspas hacia −X/+X invertido
 *   (hacia el interior); sin giro quedan mirando al coche.
 * - `radialScale`: escala el plano radial (Y/Z, eje X) del rin para
 *   agrandarlo sin ensancharlo.
 * - `bead`: comprime el flanco del neumático hacia la banda (`r' = newR +
 *   (r − oldR) · k`, en el plano radial Y/Z): la banda exterior no se mueve
 *   y el talón sube a `newR`. Hay que recalcular normales tras escalas no
 *   uniformes.
 */
function dressWheelPart(
  node: THREE.Object3D,
  rot: THREE.Matrix4,
  s: number,
  opts: {
    flipY?: boolean;
    radialScale?: number;
    bead?: { oldR: number; newR: number; k: number };
  } = {},
): THREE.Group | null {
  const parts = collectWheelMeshes(node).map((m) => {
    const geo = (m.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(rot);
    if (opts.flipY) geo.rotateY(Math.PI);
    geo.scale(s, s, s);
    if (opts.radialScale !== undefined || opts.bead) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const k = opts.radialScale;
      const bead = opts.bead;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i);
        let z = pos.getZ(i);
        if (k !== undefined) {
          y *= k;
          z *= k;
        }
        if (bead) {
          const r = Math.hypot(y, z);
          if (r > 1e-6) {
            const rn = bead.newR + (r - bead.oldR) * bead.k;
            const f = rn / r;
            y *= f;
            z *= f;
          }
        }
        pos.setY(i, y);
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    return { geo, mat: m.material };
  });
  if (parts.length === 0) return null;
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.geo.boundingBox!);
  const center = box.getCenter(new THREE.Vector3());
  const group = new THREE.Group();
  for (const p of parts) {
    p.geo.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(p.geo, p.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Rango radial (plano Y/Z del frame del juego, eje X) de un nodo ya rotado. */
function wheelRadialRange(node: THREE.Object3D, rot: THREE.Matrix4): { min: number; max: number } | null {
  let min = Infinity;
  let max = 0;
  let found = false;
  for (const m of collectWheelMeshes(node)) {
    const geo = (m.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(rot);
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) {
      geo.dispose();
      continue;
    }
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getY(i), pos.getZ(i));
      if (r < min) min = r;
      if (r > max) max = r;
    }
    geo.dispose();
    found = true;
  }
  return found ? { min, max } : null;
}

/**
 * Cáscara Tripo sin sus ruedas + ruedas (`kwid_wheels.glb`, generadas por
 * `scripts/kwid_wheels_export.py`: `Wheel_FL…` + `Hub_FL…`).
 * El glb viene en frame Y-up del exportador (X=largo, Y=arriba, Z=ancho,
 * eje de la rueda en Z): se rota −90° sobre Y al frame del juego
 * (X=ancho, Y=arriba, Z=largo), se escala al diámetro físico y se centra
 * en el buje (dirección sin excentricidad). La carrocería se desplaza en
 * Z para que los pasos caigan sobre los bujes.
 *
 * Rines: se giran 180° sobre Y para que las aspas miren hacia fuera y se
 * agrandan en el plano radial hasta el talón nuevo. Neumáticos: perfil
 * bajo (flanco al 50 %): el talón sube y la banda exterior no se mueve,
 * así que el diámetro físico (`wheelRadius`) no cambia.
 */
export async function loadKwidShell(wheelRadius: number): Promise<{
  body: THREE.Group;
  wheels: KwidWheelPart[];
} | null> {
  let tripoRoot: THREE.Group;
  let wheelsRoot: THREE.Group;
  try {
    const [tripoRes, wheelsRes] = await Promise.all([fetch(KWID_ASSET_URL), fetch(KWID_WHEELS_URL)]);
    if (!tripoRes.ok || !wheelsRes.ok) return null;
    const [tripoGltf, wheelsGltf] = await Promise.all([
      new GLTFLoader().parseAsync(await tripoRes.arrayBuffer(), KWID_ASSET_URL),
      new GLTFLoader().parseAsync(await wheelsRes.arrayBuffer(), KWID_WHEELS_URL),
    ]);
    tripoRoot = tripoGltf.scene as unknown as THREE.Group;
    wheelsRoot = wheelsGltf.scene as unknown as THREE.Group;
  } catch {
    return null;
  }

  const body = new THREE.Group();
  for (const child of [...tripoRoot.children]) {
    if (!child.name.startsWith('Wheel')) body.add(child);
  }
  if (body.children.length === 0) return null;
  body.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(body);
  body.position.set(-(bb.min.x + bb.max.x) / 2, 0, KWID_BODY_SHIFT_Z);

  const wheels: KwidWheelPart[] = [];
  const rot = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
  /** Flanco al 50 %: cuánto se comprime el perfil hacia la banda. */
  const PROFILE_KEEP = 0.5;
  for (const suffix of ['FL', 'FR', 'RL', 'RR']) {
    const tireNode = wheelsRoot.getObjectByName(`Wheel_${suffix}`);
    if (!tireNode) return null;
    // Escala por el diámetro del neumático; el rin hereda la misma para
    // no romper la proporción modelada entre ambos.
    const tireBox = wheelNodeBox(tireNode, rot);
    if (!tireBox) return null;
    const size = tireBox.getSize(new THREE.Vector3());
    const s = (wheelRadius * 2) / Math.max(size.y, size.z);
    // Talón nuevo a mitad de flanco (medido en el modelo para que valga
    // ante cualquier reexport del .blend): banda fija, flanco al 50 %.
    const tireRad = wheelRadialRange(tireNode, rot);
    const rimNode = wheelsRoot.getObjectByName(`Hub_${suffix}`);
    const rimRad = rimNode ? wheelRadialRange(rimNode, rot) : null;
    const outer = tireRad ? tireRad.max * s : wheelRadius;
    const beadOld = tireRad ? tireRad.min * s : wheelRadius * 0.55;
    const beadNew = outer - (outer - beadOld) * PROFILE_KEEP;
    const tire = dressWheelPart(tireNode, rot, s, {
      bead: { oldR: beadOld, newR: beadNew, k: PROFILE_KEEP },
    });
    // El rin crece en el plano radial hasta el talón nuevo (sin ensanchar)
    // y se gira para que las aspas miren hacia fuera.
    const rimK = rimRad && rimRad.max > 1e-6 ? beadNew / (rimRad.max * s) : null;
    const rim = rimNode
      ? dressWheelPart(rimNode, rot, s, { flipY: true, ...(rimK ? { radialScale: rimK } : {}) })
      : null;
    if (!tire) return null;
    wheels.push({ name: `Wheel_${suffix}`, tire, rim });
  }
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { body, wheels };
}

/** Cáscara procedural de respaldo (misma geometría lowpoly hecha a mano). */
export function loadKwidProceduralBody(): Promise<THREE.Group | null> {
  return loadBodyFrom(KWID_PROCEDURAL_URL);
}
