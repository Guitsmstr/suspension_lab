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
 * correspondiente (gira con la dirección y el giro reales). Sin texturas:
 * el `glb` ya trae materiales planos y el contorno se añade en `CarVisual`.
 */
export async function loadRawBody(url: string): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
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
  for (const o of [body, ...wheels.map((w) => w.obj)]) {
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }
  return { body, wheels };
}

export function loadKwidRaw(): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
} | null> {
  return loadRawBody(KWID_ASSET_URL);
}

/** Tesla Model 3 con sus propias ruedas (reemplazo del deportivo). */
export function loadTeslaBody(): Promise<{
  body: THREE.Group;
  wheels: KwidWheelNode[];
} | null> {
  return loadRawBody(TESLA_ASSET_URL);
}

/** Cáscara procedural de respaldo (misma geometría lowpoly hecha a mano). */
export function loadKwidProceduralBody(): Promise<THREE.Group | null> {
  return loadBodyFrom(KWID_PROCEDURAL_URL);
}
