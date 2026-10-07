/**
 * Terreno analítico: la función de altura se evalúa tanto para la malla como
 * para el contacto de los neumáticos, así que la física y el render coinciden
 * exactamente. Incluye colinas suaves, una zona plana de salida, un tramo de
 * "whoops" (badenes) y una meseta.
 */
import * as THREE from 'three';
import type { ParamStore } from '../vehicle/params';
import type { TerrainSampler } from '../vehicle/vehicle';
import { surfaceAt, surfaceMuAt, WHOOPS_CENTER_Z, WHOOPS_HALF_WIDTH } from './surface';

export { WHOOPS_CENTER_Z, WHOOPS_HALF_WIDTH };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class Terrain implements TerrainSampler {
  constructor(private readonly params: ParamStore) {}

  /** Superficie bajo (x, z): la física del neumático la usa para el agarre. */
  surfaceMuAt(x: number, z: number): number {
    return surfaceMuAt(x, z);
  }

  /** Nombre de la superficie bajo (x, z), para la telemetría. */
  surfaceKindAt(x: number, z: number): string {
    return surfaceAt(x, z);
  }

  heightAt(x: number, z: number): number {
    const r = this.params.get('roughness');

    // Colinas de gran escala
    let h =
      1.45 * Math.sin(x * 0.042) * Math.cos(z * 0.035) +
      0.9 * Math.sin(x * 0.021 + 1.3) * Math.sin(z * 0.019 - 0.7) +
      0.34 * Math.sin(x * 0.118) * Math.sin(z * 0.097 + 0.4) +
      0.12 * Math.sin(x * 0.31 + 2.1) * Math.cos(z * 0.27);
    h *= r;

    // Meseta suave al noroeste
    const plateau = 2.6 * Math.exp(-(((x + 32) ** 2) / 320 + ((z - 28) ** 2) / 260));
    h += plateau * r;

    // Zona plana de salida alrededor del origen
    const startFlat = 1 - smoothstep(7, 17, Math.hypot(x, z));
    h *= 1 - startFlat;

    // Tramo de badenes (whoops) a lo largo del eje X
    const inWhoops = smoothstep(WHOOPS_HALF_WIDTH + 2, WHOOPS_HALF_WIDTH - 0.6, Math.abs(z - WHOOPS_CENTER_Z));
    if (inWhoops > 0.001) {
      const envelope = smoothstep(48, 40, Math.abs(x));
      h += inWhoops * envelope * 0.135 * r * (0.5 + 0.5 * Math.sin((x * Math.PI * 2) / 2.8));
    }

    return h;
  }

  /** Normal del terreno por diferencias finitas centrales. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.35;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Construye la malla del terreno con colores por vértice. */
  buildMesh(size = 320, segments = 320): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    const normal = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      this.normalAt(x, z, normal);
      const steep = 1 - Math.max(0, normal.y);

      // Base: hierba con variación procedural
      const noise =
        0.5 +
        0.5 *
          Math.sin(x * 0.07 + 0.6) *
          Math.cos(z * 0.061 - 1.1) *
          (0.6 + 0.4 * Math.sin(x * 0.023 * z * 0.019 + 2.2));
      const hue = 0.245 + 0.028 * noise;
      const light = 0.245 + 0.07 * noise;
      color.setHSL(hue, 0.48, light);

      // En pendientes fuertes, tierra
      const dirt = new THREE.Color().setHSL(0.09, 0.26, 0.24 + 0.05 * noise);
      color.lerp(dirt, Math.min(1, steep * 2.4));

      // Tramo de badenes: superficie de asfalto/grava
      const whoopsMask =
        smoothstep(WHOOPS_HALF_WIDTH + 1.6, WHOOPS_HALF_WIDTH - 0.8, Math.abs(z - WHOOPS_CENTER_Z)) *
        smoothstep(48, 42, Math.abs(x));
      const asphalt = new THREE.Color().setHSL(0.62, 0.04, 0.19 + 0.04 * noise);
      color.lerp(asphalt, whoopsMask * 0.85);

      // Zona plana de salida: ligeramente más clara (paddock)
      color.lerp(new THREE.Color().setHSL(0.13, 0.12, 0.3), 0.22 * (1 - smoothstep(6, 16, Math.hypot(x, z))));

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.35,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}
