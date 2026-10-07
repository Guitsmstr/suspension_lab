/**
 * Entorno: cielo físico (Sky), sol con sombras, luz ambiental y niebla.
 * El mapa de entorno se genera con PMREM a partir del cielo para que la
 * pintura del coche refleje el exterior de forma coherente.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface Environment {
  sun: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
}

export function buildEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  sunElevationDeg = 28,
  sunAzimuthDeg = 135,
): Environment {
  // ---- Cielo ----
  const sky = new Sky();
  sky.scale.setScalar(45000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 5.5;
  skyUniforms['rayleigh'].value = 1.7;
  skyUniforms['mieCoefficient'].value = 0.004;
  skyUniforms['mieDirectionalG'].value = 0.86;

  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - sunElevationDeg),
    THREE.MathUtils.degToRad(sunAzimuthDeg),
  );
  skyUniforms['sunPosition'].value.copy(sunDirection);

  // ---- Mapa de entorno (reflexiones) ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  scene.add(sky); // el cielo pasa a la escena principal

  // ---- Luces ----
  // El mapa de entorno ya aporta el cielo entero; sinó la suma cielo + sol +
  // hemisferio deja la escena sobreexpuesta y los colores se lavan.
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.3);
  sun.position.copy(sunDirection).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 260;
  const extent = 34;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x3e4a3a, 0.38);
  scene.add(hemi);

  // Intensidad del mapa de entorno (reflexiones) por debajo de 1: da color sin
  // quemar las superficies.
  scene.environmentIntensity = 0.62;

  // ---- Niebla ----
  scene.fog = new THREE.FogExp2(0xbcd2e8, 0.0015);

  return { sun, sunDirection };
}

/**
 * Mantiene el sol apuntando al coche para que la cámara de sombras
 * siga al vehículo sin perder resolución.
 */
export function followSun(env: Environment, target: THREE.Vector3): void {
  env.sun.target.position.copy(target);
  env.sun.position.copy(target).addScaledVector(env.sunDirection, 120);
  env.sun.target.updateMatrixWorld();
}
