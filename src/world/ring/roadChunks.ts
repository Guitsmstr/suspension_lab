/**
 * Calzada del Nordschleife 1:1: cinta continua de ~20,8 km ceñida a la cota
 * real (la misma `elevationAt` que la física).
 *
 * - Una sola malla (6919 estaciones × 11 carriles ≈ 76k vértices, ~150k
 *   triángulos): cabe siempre en memoria y en un draw call; el streaming de
 *   la fase 1 se aplica solo a las teselas de hierba.
 * - Sin lift: la holgura contra la hierba la da el esculpido (`meshHeightAt`),
 *   no la separación, para que las ruedas no queden enterradas visualmente.
 *   El z-fighting a distancia lo resuelve el polygonOffset (como en track.ts).
 * - Líneas de borde blancas + línea de meta en la estación 0.
 *   (Pianos y guardarraíles: fase 2.)
 */
import * as THREE from 'three';
import { STATION_COUNT, LOOP_LENGTH, ROAD_WIDTH, stationPos, tangentAt } from './centerline';

const LANES = 11; // carriles cada 1 m sobre 10 m de ancho
const PAINT_LIFT = 0.015;

const asphaltMat = new THREE.MeshStandardMaterial({
  color: 0x30343a,
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
  polygonOffsetFactor: -8,
  polygonOffsetUnits: -8,
});

const _tan = { x: 0, z: 0 };
const _pos = { x: 0, z: 0, y: 0 };

/** Cinta de la calzada completa (devanado antihorario visto desde +Y). */
export function buildRingRoad(): THREE.Mesh {
  const n = STATION_COUNT;
  const hw = ROAD_WIDTH / 2;
  const positions = new Float32Array(n * LANES * 3);
  const uvs = new Float32Array(n * LANES * 2);
  for (let i = 0; i < n; i++) {
    const s = (i / n) * LOOP_LENGTH;
    stationPos(i, _pos);
    tangentAt(s, _tan);
    const sx = -_tan.z;
    const sz = _tan.x;
    for (let j = 0; j < LANES; j++) {
      const o = -hw + (ROAD_WIDTH * j) / (LANES - 1);
      const k = i * LANES + j;
      positions[k * 3] = _pos.x + sx * o;
      positions[k * 3 + 1] = _pos.y;
      positions[k * 3 + 2] = _pos.z + sz * o;
      uvs[k * 2] = s / 8;
      uvs[k * 2 + 1] = j / (LANES - 1);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    for (let j = 0; j < LANES - 1; j++) {
      const a = i * LANES + j;
      const b = i * LANES + j + 1;
      const c = ni * LANES + j;
      const d = ni * LANES + j + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, asphaltMat);
  mesh.receiveShadow = true;
  mesh.name = 'ring-road';
  mesh.frustumCulled = false; // 20 km: el cálculo de corte por esfera gigante estorba más que ayuda
  return mesh;
}

/** Líneas de borde blancas (dos cintas finas sobre la calzada). */
export function buildRingEdgeLines(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ring-edge-lines';
  const n = STATION_COUNT;
  const hw = ROAD_WIDTH / 2;
  for (const lateral of [-hw + 0.45, hw - 0.45]) {
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) {
      const s = (i / n) * LOOP_LENGTH;
      stationPos(i, _pos);
      tangentAt(s, _tan);
      const sx = -_tan.z;
      const sz = _tan.x;
      for (let e = 0; e < 2; e++) {
        const o = lateral + (e === 0 ? -0.18 : 0.18);
        const k = i * 2 + e;
        positions[k * 3] = _pos.x + sx * o;
        positions[k * 3 + 1] = _pos.y + PAINT_LIFT;
        positions[k * 3 + 2] = _pos.z + sz * o;
        uvs[k * 2] = s / 8;
        uvs[k * 2 + 1] = e;
      }
    }
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
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, lineMat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

/** Línea de meta sobre la estación 0 (banda blanca atravesada). */
export function buildRingStartLine(): THREE.Mesh {
  stationPos(0, _pos);
  tangentAt(0, _tan);
  const hw = ROAD_WIDTH / 2;
  const sx = -_tan.z;
  const sz = _tan.x;
  const y = _pos.y + PAINT_LIFT;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        _pos.x + sx * -hw - _tan.x * 0.6, y, _pos.z + sz * -hw - _tan.z * 0.6,
        _pos.x + sx * -hw + _tan.x * 0.6, y, _pos.z + sz * -hw + _tan.z * 0.6,
        _pos.x + sx * hw - _tan.x * 0.6, y, _pos.z + sz * hw - _tan.z * 0.6,
        _pos.x + sx * hw + _tan.x * 0.6, y, _pos.z + sz * hw + _tan.z * 0.6,
      ]),
      3,
    ),
  );
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, lineMat);
  mesh.name = 'ring-start-line';
  return mesh;
}
