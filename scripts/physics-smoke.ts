/**
 * Smoke test de la física, ejecutable sin navegador:
 *
 *   pnpm exec vite build --ssr scripts/physics-smoke.ts --outDir .smoke
 *   node .smoke/physics-smoke.js
 *
 * Comprueba que el modelo se estabiliza, acelera, frena, gira, absorbe los
 * badenes y sigue siendo estable con parámetros extremos.
 */
import * as THREE from 'three';
import { ParamStore } from '../src/vehicle/params';
import { CARS } from '../src/vehicle/cars';
import { Vehicle } from '../src/vehicle/vehicle';
import { Terrain } from '../src/world/terrain';
import { ObstacleField } from '../src/world/obstacles';
import {
  TRACKS,
  TRACK_ORDER,
  TRACK_BOUND,
  buildTrack,
  enforceTrackBounds,
  makeTrackCarve,
  trackCenterline,
  trackLength,
  trackSpawn,
  type TrackId,
} from '../src/world/track';
import { rideMetrics, FRONT_KINEMATICS, REAR_KINEMATICS } from '../src/vehicle/suspension';
import { LOOP_LENGTH, RING_STEP, ROAD_HALF, curvatureAt, stationPos, tangentAt } from '../src/world/ring/centerline';
import { RingTerrain } from '../src/world/ring/ringTerrain';
import { buildRingRoad } from '../src/world/ring/roadChunks';
import { buildBackdropGeometry, RING_BACKDROP, backdropVertexY } from '../src/world/ring/groundTiles';
import { ringSpawn } from '../src/world/ring/ringDef';
import { tireForces, CAMBER_STIFFNESS } from '../src/vehicle/tire';
import { Drivetrain } from '../src/vehicle/drivetrain';
import { SPRUNG_MASS_FRONT, SPRUNG_MASS_REAR } from '../src/vehicle/vehicle';
import { CarVisual, VISUAL_TIRE_DEFLECTION } from '../src/render/carMesh';
import { CameraRig } from '../src/render/cameraRig';

// El script se ejecuta con node, fuera del navegador
declare const process: { exit(code: number): never };

const DT = 1 / 300;
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false };
/**
 * Sonda de hierba abierta para las pruebas de suelo blando: claro sin
 * calzadas con ≥12 m de hierba en un pasillo de 60 m hacia el sur
 * (las maniobras arrancan mirando al +z). Revisar si cambia el mapa.
 */
const GRASS_X = -104;
const GRASS_Z = -112;
/**
 * Sonda para el derrape grande: ese trompo deriva ~70 m al oeste (-x),
 * así que necesita un claro alargado este-oeste en vez del pasillo al sur.
 */
const DRIFT_X = -40;
const DRIFT_Z = -100;

interface Input {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  testMode?: boolean;
}

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function isFiniteVehicle(v: Vehicle): boolean {
  const nums = [
    v.position.x, v.position.y, v.position.z,
    v.velocity.x, v.velocity.y, v.velocity.z,
    v.omega.x, v.omega.y, v.omega.z,
    v.quaternion.x, v.quaternion.y, v.quaternion.z, v.quaternion.w,
  ];
  for (const st of v.cornerStates) {
    nums.push(st.s, st.sdot, st.wheelOmega, st.kappa, st.alpha, st.tireLoad);
  }
  return nums.every((n) => Number.isFinite(n));
}

function run(vehicle: Vehicle, seconds: number, input: Input | ((t: number) => Input)): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const inp = typeof input === 'function' ? input(i * DT) : input;
    vehicle.step(DT, inp);
  }
}

/**
 * Holgura mínima entre la cara inferior de la carrocería y el terreno [m].
 * Negativa = la carrocería está enterrada (el coche "se hunde"). Usa los
 * contactos del coche activo (cada coche tiene los suyos).
 */
function chassisClearance(v: Vehicle, terrain: Terrain): number {
  const p = new THREE.Vector3();
  let min = Infinity;
  for (const c of v.chassisContacts) {
    p.copy(c).applyQuaternion(v.quaternion).add(v.position);
    min = Math.min(min, p.y - terrain.heightAt(p.x, p.z));
  }
  return min;
}

function scenario(name: string, fn: (params: ParamStore, terrain: Terrain, v: Vehicle) => void): void {
  console.log(`\n▶ ${name}`);
  const params = new ParamStore();
  const terrain = new Terrain(params);
  const v = new Vehicle(params, terrain);
  v.setSpawn(0, 0);
  fn(params, terrain, v);
}

// ---------------------------------------------------------------- 1. reposo
scenario('Estabilización en reposo', (_p, terrain, v) => {
  run(v, 6, NO_INPUT);
  const ground = terrain.heightAt(0, 0);
  const heightErr = Math.abs(v.position.y - (ground + v.comHeight));
  const maxVel = Math.max(Math.abs(v.velocity.x), Math.abs(v.velocity.y), Math.abs(v.velocity.z));

  check('valores finitos', isFiniteVehicle(v));
  check('altura de rodaje correcta', heightErr < 0.03, `error ${heightErr.toFixed(4)} m`);
  check('velocidad residual nula', maxVel < 0.02, `${maxVel.toFixed(4)} m/s`);
  check('las 4 ruedas apoyan', v.cornerStates.every((s) => s.contact));
  check('recorrido cerca del estático', v.cornerStates.every((s) => Math.abs(s.s) < 0.015),
    v.cornerStates.map((s) => `${(s.s * 1000).toFixed(1)}mm`).join(' '));
  check('ruedas quietas en reposo (fricción estática)', v.cornerStates.every((s) => Math.abs(s.wheelOmega) < 0.05),
    v.cornerStates.map((s) => `${s.wheelOmega.toFixed(3)}rad/s`).join(' '));
  check('carga vertical razonable', v.cornerStates.every((s) => s.tireLoad > 2500 && s.tireLoad < 6500),
    v.cornerStates.map((s) => `${s.tireLoad.toFixed(0)}N`).join(' '));
});

// ------------------------------------------------------------- 2. aceleración
scenario('Aceleración en línea recta', (_p, _t, v) => {
  // En la recta de meta de Barranquilla (asfalto): medir el tren motriz exige
  // agarre bueno; en hierba (μ≈0.4) un trasera patina, como debe ser.
  const s = trackSpawn(TRACKS.monaco);
  v.setSpawn(s.x, s.z, s.yaw);
  run(v, 1, NO_INPUT);
  let peakGLong = 0;
  let peakKappa = 0;
  let slipSum = 0;
  let slipSamples = 0;
  // 10 s: la recta de meta sube 2 m en los primeros 60 m y eso cuesta ~1 m/s;
  // desde parado honesto (sin pre-giro numérico de las ruedas) el 3er cambio
  // necesita el segundo extra. Umbrales iguales, solo más ventana.
  const steps = Math.round(10 / DT);
  for (let i = 0; i < steps; i++) {
    v.step(DT, { ...NO_INPUT, throttle: 0.85 });
    peakGLong = Math.max(peakGLong, v.telemetry.gLong);
    // el patinaje de arranque es esperable; se mide una vez el coche va
    // rodando y solo sobre asfalto (en hierba patinar es lo correcto). La
    // media cubre todo el tramo rodado en asfalto: si la recta se acaba (el
    // coche gana más velocidad de la prevista y se sale), la muestra sigue
    // siendo válida en vez de quedarse vacía (0/0 = NaN).
    if (v.telemetry.speed > 12 && v.telemetry.surface === 'asphalt') {
      for (const st of v.cornerStates) {
        peakKappa = Math.max(peakKappa, Math.abs(st.kappa));
        slipSum += Math.abs(st.kappa);
        slipSamples += 1;
      }
    }
  }
  const t = v.telemetry;
  const meanSlip = slipSamples > 0 ? slipSum / slipSamples : 0;

  check('valores finitos', isFiniteVehicle(v));
  check('velocidad > 22 m/s', t.speed > 22, `${t.speed.toFixed(1)} m/s (${t.speedKph.toFixed(0)} km/h)`);
  check('ha cambiado de marcha', t.gear >= 3, `marcha ${t.gear}, ${t.rpm.toFixed(0)} rpm`);
  check('sin patinaje persistente', meanSlip < 0.15, `κ medio ${meanSlip.toFixed(3)}`);
  check('patinaje puntual acotado', peakKappa < 6, `κ pico ${peakKappa.toFixed(2)}`);
  check('G longitudinal positiva', peakGLong > 0.2, `pico ${peakGLong.toFixed(2)} g`);
});

// ----------------------------------- 2b. en hierba patina (como en la realidad)
scenario('En hierba el trasera patina al acelerar a fondo', (_p, terrain, v) => {
  // Fuera de pista (hierba, μ≈0.4) el mismo acelerón debe degradarse:
  // menos velocidad y más patinaje que en asfalto. Es física, no un bug.
  v.setSpawn(GRASS_X, GRASS_Z);
  const mu = terrain.surfaceMuAt ? terrain.surfaceMuAt(GRASS_X, GRASS_Z) : 1;
  run(v, 1, NO_INPUT);
  run(v, 6, { ...NO_INPUT, throttle: 1 });

  check('está sobre hierba', mu < 0.5, `μ=${mu.toFixed(2)}`);
  check('valores finitos', isFiniteVehicle(v));
  check('en hierba corre menos que en asfalto', v.telemetry.speed < 22,
    `${v.telemetry.speedKph.toFixed(0)} km/h`);
  check('en hierba patina más', v.cornerStates.some((st) => Math.abs(st.kappa) > 0.15),
    v.cornerStates.map((st) => `κ=${st.kappa.toFixed(2)}`).join(' '));
});

// ------------------------------------------------------------------ 3. frenada
scenario('Frenada desde alta velocidad', (_p, _t, v) => {
  const s = trackSpawn(TRACKS.monaco);
  v.setSpawn(s.x, s.z, s.yaw);
  run(v, 6, { ...NO_INPUT, throttle: 0.85 });
  const before = v.telemetry.speed;
  const fwdB = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  let minGLong = 0;
  let unstable = false;
  const brakeSteps = Math.round(3 / DT);
  for (let i = 0; i < brakeSteps; i++) {
    v.step(DT, { ...NO_INPUT, brake: 1 });
    minGLong = Math.min(minGLong, v.telemetry.gLong);
    // Solo rodando hacia delante: parado con S mantenido entra la R
    // (las traseras giran atrás a propósito).
    if (v.velocity.dot(fwdB) > 2) {
      for (const st of v.cornerStates) {
        if (Math.abs(st.kappa) >= 6) unstable = true;
      }
    }
  }
  const after = v.telemetry.speed;

  check('valores finitos', isFiniteVehicle(v));
  check('frena enérgicamente', after < before * 0.35, `${before.toFixed(1)} → ${after.toFixed(1)} m/s`);
  check('sin bloqueo inestable', !unstable,
    v.cornerStates.map((st) => `κ=${st.kappa.toFixed(2)}`).join(' '));
  check('pico de frenada ≈ μ (≈-1 g en asfalto)', minGLong < -0.7, `${minGLong.toFixed(2)} g`);
});

// --------------------------------------- 3c. marcha atrás
scenario('Marcha atrás al mantener el freno', (_p, _t, v) => {
  run(v, 1, NO_INPUT); // asentado, parado
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);
  const z0 = v.position.clone();
  run(v, 1, { ...NO_INPUT, brake: 1 }); // asegura parado + engrana R
  check('parado y con freno engrana atrás', v.reversing, `reversing=${v.reversing}`);

  let maxBack = 0;
  // Reversa corta (2 s): basta para varios metros sin salir del paddock; los
  // trazados nuevos cruzan la zona y una reversa larga acaba en otra
  // superficie, que no es lo que aquí se comprueba.
  const steps = Math.round(2 / DT);
  for (let i = 0; i < steps; i++) {
    v.step(DT, { ...NO_INPUT, brake: 1 });
    maxBack = Math.max(maxBack, -v.velocity.dot(fwd));
  }
  const dist = v.position.clone().sub(z0).dot(fwd);

  check('valores finitos', isFiniteVehicle(v));
  check('retrocede varios metros', dist < -4, `${dist.toFixed(1)} m`);
  check('limitada a ~30 km/h', maxBack < 10, `${(maxBack * 3.6).toFixed(0)} km/h`);

  // W desengrana y vuelve a tirar hacia delante (desde marcha atrás
  // lanzada cuesta recuperar: lo que se comprueba es que vuelve a avanzar)
  run(v, 5, { ...NO_INPUT, throttle: 0.6 });
  const fwdEnd = v.velocity.dot(fwd);
  check('W desengrana la reversa', !v.reversing, `reversing=${v.reversing}`);
  check('W vuelve a avanzar', fwdEnd > 0.5, `${fwdEnd.toFixed(1)} m/s`);
});

scenario('No engrana atrás en marcha', (_p, _t, v) => {
  v.velocity.set(0, 0, 15);
  run(v, 2, { ...NO_INPUT, brake: 1 });
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);
  const fwdSpeed = v.velocity.dot(fwd);

  check('valores finitos', isFiniteVehicle(v));
  check('frenando a 15 m/s no entra la reversa', !v.reversing && fwdSpeed > 0,
    `reversing=${v.reversing} v=${fwdSpeed.toFixed(1)} m/s`);
});

// --------------------------------------- 3b. sentido de la dirección
scenario('La dirección no está invertida (D = girar a la derecha)', (_p, _t, v) => {
  // Con el chasis en identidad el morro apunta a +Z y la derecha del coche es
  // −X: con steer=+1 (tecla D) el morro debe irse hacia −X.
  v.velocity.set(0, 0, 12);
  run(v, 2, { ...NO_INPUT, steer: 1 });
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);

  check('valores finitos', isFiniteVehicle(v));
  check('D gira a la derecha (morro hacia −X)', fwd.x < -0.05, `fwd.x=${fwd.x.toFixed(3)}`);
  check('la trayectoria se curva a la derecha', v.position.x < -0.5, `x=${v.position.x.toFixed(2)} m`);
});

scenario('A gira a la izquierda (simetría)', (_p, _t, v) => {
  v.velocity.set(0, 0, 12);
  run(v, 2, { ...NO_INPUT, steer: -1 });
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);

  check('valores finitos', isFiniteVehicle(v));
  check('A gira a la izquierda (morro hacia +X)', fwd.x > 0.05, `fwd.x=${fwd.x.toFixed(3)}`);
});

// ---------------------------------------------------------------- 4. curva
scenario('Curva sostenida (transferencia de carga)', (p, _t, v) => {
  p.set('roughness', 0); // plano: la transferencia de carga queda aislada de los baches
  // Velocidad fijada en 11 m/s: la curva se evalúa igual siempre, sin heredar
  // la historia de la arrancada (el corte de par del cambio la alarga, como
  // en un automático real).
  v.velocity.set(0, 0, 11);
  run(v, 1, NO_INPUT); // ruedas sincronizadas con la velocidad
  const speed0 = v.telemetry.speed;
  let maxTravel = 0;
  let maxRoll = 0;
  let peakGLat = 0;
  const steps = Math.round(1.2 / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    v.step(DT, { throttle: 0.45, brake: 0, steer: Math.min(0.3, t * 1.2), handbrake: false });
    for (const s of v.cornerStates) maxTravel = Math.max(maxTravel, Math.abs(s.s));
    peakGLat = Math.max(peakGLat, Math.abs(v.telemetry.gLat));
    // El alabeo se mide cuando de verdad hay aceleración lateral; sobre terreno
    // ondulado una muestra suelta no significa nada.
    if (Math.abs(v.telemetry.gLat) > 0.3) maxRoll = Math.max(maxRoll, Math.abs(v.telemetry.roll));
  }
  const t = v.telemetry;

  check('valores finitos', isFiniteVehicle(v));
  check('mantiene la velocidad', t.speed > speed0 * 0.6, `${speed0.toFixed(1)} → ${t.speed.toFixed(1)} m/s`);
  check('acelera lateralmente', peakGLat > 0.38, `pico ${peakGLat.toFixed(2)} g`);
  check('el cuerpo alabea', maxRoll > 0.8, `alabeo máx ${maxRoll.toFixed(2)}°`);
  check('alabeo en rango físico', maxRoll < 6, `alabeo máx ${maxRoll.toFixed(2)}°`);
  check('sin topes en curva normal', maxTravel < 0.085, `recorrido máx ${(maxTravel * 1000).toFixed(1)} mm`);
  // Con steer>0 el giro es a la derecha: el exterior es la izquierda del coche
  // (índice 1, x>0) y el interior la derecha (índice 0, x<0).
  check('carga exterior > interior', t.wheels[1].tireLoad > t.wheels[0].tireLoad * 1.3,
    `izq-ext ${t.wheels[1].tireLoad.toFixed(0)}N / der-int ${t.wheels[0].tireLoad.toFixed(0)}N`);
});

// ------------------------------------------------- 4b. maniobra de límite
scenario('Volante a tope a 22 m/s (límite)', (_p, _t, v) => {
  run(v, 6, { ...NO_INPUT, throttle: 0.55 });
  let maxLoad = 0;
  let maxSpeed = 0;
  const steps = Math.round(2.5 / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    v.step(DT, { throttle: 0.45, brake: 0, steer: Math.min(1, t * 2), handbrake: false });
    for (const s of v.cornerStates) maxLoad = Math.max(maxLoad, s.tireLoad);
    maxSpeed = Math.max(maxSpeed, v.telemetry.speed);
  }
  const t = v.telemetry;

  check('valores finitos', isFiniteVehicle(v));
  // En una maniobra de límite sobre terreno ondulado la carga puntual puede
  // superar 4× la estática; se comprueba que no hay divergencia.
  check('carga vertical acotada', maxLoad < 20000, `pico ${maxLoad.toFixed(0)} N`);
  check('sin vuelco', Math.abs(t.roll) < 15, `alabeo ${t.roll.toFixed(1)}°`);
  check('el coche sigue en el suelo', v.position.y > -3, `y=${v.position.y.toFixed(2)} m`);
  check('la velocidad se mantiene acotada', maxSpeed < 40, `pico ${maxSpeed.toFixed(1)} m/s`);
});

// ------------------------------------------------------ 5. badenes (whoops)
scenario('Paso por badenes a 22 m/s', (_p, _t, v) => {
  // El tramo de badenes está en z = -16 a lo largo del eje X: se conduce hacia +X
  v.setSpawn(-34, -16);
  v.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  v.velocity.set(22, 0, 0);

  let maxTravel = 0;
  let maxUnsprung = 0;
  const steps = Math.round(4.5 / DT);
  for (let i = 0; i < steps; i++) {
    v.step(DT, { throttle: 0.35, brake: 0, steer: 0, handbrake: false });
    for (const s of v.cornerStates) {
      maxTravel = Math.max(maxTravel, Math.abs(s.s));
      maxUnsprung = Math.max(maxUnsprung, Math.abs(s.sddot));
    }
  }

  check('valores finitos', isFiniteVehicle(v));
  check('la suspensión trabaja', maxTravel > 0.012, `recorrido máx ${(maxTravel * 1000).toFixed(1)} mm`);
  check('la masa no suspendida reacciona', maxUnsprung > 8, `sddot máx ${maxUnsprung.toFixed(1)} m/s²`);
  check('el coche no se desestabiliza', Math.abs(v.telemetry.roll) < 25, `alabeo ${v.telemetry.roll.toFixed(1)}°`);
  check('sigue sobre el terreno', v.position.y > -2, `y=${v.position.y.toFixed(2)} m`);
});

// ------------------------------- 5b. la carrocería no se hunde en el terreno
scenario('Sin hundimiento sobre terreno rugoso', (p, terrain, v) => {
  p.set('roughness', 1.6);
  let clearance = Infinity;
  const steps = Math.round(9 / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    // Recorrido con guiado suave: lo que se comprueba es que el coche circula
    // por terreno desigual sin hundirse ni perder el control.
    v.step(DT, { throttle: 0.75, brake: 0, steer: Math.sin(t * 0.35) * 0.12, handbrake: false });
    clearance = Math.min(clearance, chassisClearance(v, terrain));
  }

  const moved = Math.hypot(v.position.x, v.position.z);
  check('valores finitos', isFiniteVehicle(v));
  check('la carrocería no se hunde en las colinas', clearance > -0.03,
    `holgura mínima ${(clearance * 1000).toFixed(1)} mm`);
  check('el coche sigue avanzando', moved > 60 && v.telemetry.speed > 10,
    `${moved.toFixed(1)} m recorridos, ${v.telemetry.speedKph.toFixed(0)} km/h`);
});

scenario('Sin hundimiento en los badenes', (_p, terrain, v) => {
  v.setSpawn(-34, -16);
  v.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  v.velocity.set(22, 0, 0);

  let clearance = Infinity;
  const steps = Math.round(4.5 / DT);
  for (let i = 0; i < steps; i++) {
    v.step(DT, { throttle: 0.35, brake: 0, steer: 0, handbrake: false });
    clearance = Math.min(clearance, chassisClearance(v, terrain));
  }

  check('valores finitos', isFiniteVehicle(v));
  check('el chasis raspa sin hundirse en los badenes', clearance > -0.03,
    `holgura mínima ${(clearance * 1000).toFixed(1)} mm`);
  check('sigue en la carretera de pruebas', Math.abs(v.position.z + 16) < 12,
    `z=${v.position.z.toFixed(1)}`);
});

scenario('Aparición sobre la meseta sin enterrarse', (_p, terrain, v) => {
  v.setSpawn(-32, 28); // zona de meseta, con pendiente
  const clearance0 = chassisClearance(v, terrain);
  run(v, 3, NO_INPUT);
  const clearance = chassisClearance(v, terrain);

  check('aparece por encima del terreno', clearance0 > -0.005,
    `holgura inicial ${(clearance0 * 1000).toFixed(1)} mm`);
  check('se asienta sin hundirse', clearance > -0.02,
    `holgura ${(clearance * 1000).toFixed(1)} mm`);
  check('las ruedas apoyan', v.cornerStates.every((s) => s.contact));
});

// ------------------------------------------------ 5c. obstáculos sólidos
scenario('Las rocas y troncos son sólidos', (p, terrain, _v) => {
  const field = new ObstacleField();
  field.add({ x: 0, z: 14, radius: 1.3, top: terrain.heightAt(0, 14) + 2.5 });
  const solid = new Vehicle(p, terrain, field);
  solid.setSpawn(0, 0);

  run(solid, 6, { throttle: 1, brake: 0, steer: 0, handbrake: false });

  check('valores finitos', isFiniteVehicle(solid));
  check('el coche no atraviesa el obstáculo', solid.position.z < 13.4,
    `z=${solid.position.z.toFixed(2)} m`);
  check('no rebota con violencia', Math.abs(solid.velocity.z) < 12,
    `vz=${solid.velocity.z.toFixed(2)} m/s`);
  check('no se queda clavado', solid.position.y > terrain.heightAt(0, solid.position.z) + 0.3,
    `y=${solid.position.y.toFixed(2)} m`);

  // Sin obstáculo el mismo recorrido sí llega más allá (la colisión hace efecto)
  const free = new Vehicle(p, terrain);
  free.setSpawn(0, 0);
  run(free, 6, { throttle: 1, brake: 0, steer: 0, handbrake: false });
  check('el obstáculo frena el paso', free.position.z > solid.position.z + 4,
    `libre z=${free.position.z.toFixed(2)} vs bloqueado z=${solid.position.z.toFixed(2)}`);
});

// --------------------------------------- 5d. circuito y mapa cerrado
scenario('El mapa está cerrado (muro invisible)', (_p, _t, v) => {
  v.position.set(200, 5, 0);
  v.velocity.set(30, 0, -10);
  enforceTrackBounds(v);

  check('recorta fuera del límite', v.position.x === TRACK_BOUND, `x=${v.position.x}`);
  check('amortigua la salida sin rebotar', v.velocity.x <= 0 && v.velocity.x > -10,
    `vx=${v.velocity.x.toFixed(2)} m/s`);
  check('respeta el otro eje', v.position.z === 0 && v.velocity.z === -10);

  v.position.set(10, 1, -20);
  v.velocity.set(5, 0, 5);
  enforceTrackBounds(v);
  check('no toca a quien está dentro', v.position.x === 10 && v.position.z === -20 &&
    v.velocity.x === 5 && v.velocity.z === 5);
});

scenario('Las calzadas ciñen el terreno y caben en el mapa', (_p, terrain, _v) => {
  for (const id of TRACK_ORDER) {
    const def = TRACKS[id];
    const handle = buildTrack(def, terrain);
    let verts = 0;
    let badPos = 0;
    const wp = new THREE.Vector3();
    handle.group.updateMatrixWorld(true);
    const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh =>
      (o as THREE.InstancedMesh).isInstancedMesh === true;
    handle.group.traverse((o) => {
      if (isInstanced(o)) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        verts++;
        wp.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        if (!Number.isFinite(wp.x + wp.y + wp.z)) badPos++;
        if (Math.abs(wp.x) > 156 || Math.abs(wp.z) > 156) badPos++;
        if (wp.y < -8 || wp.y > 40) badPos++;
      }
    });
    let furniture = 0;
    handle.group.traverse((o) => {
      if (isInstanced(o)) furniture += o.count;
    });

    check(`trazado ${def.name}: malla válida`, verts > 800 && badPos === 0,
      `${verts} vértices en cinta + ${furniture} piezas de mobiliario`);

    // La calzada debe mirar al cielo: un devanado invertido la haría invisible
    // (backface culling) aunque los vértices sean correctos.
    const road = handle.group.children[0] as THREE.Mesh;
    const idx = road.geometry.getIndex();
    if (idx) {
      const pa = new THREE.Vector3().fromBufferAttribute(
        road.geometry.getAttribute('position') as THREE.BufferAttribute, idx.getX(0));
      const pb = new THREE.Vector3().fromBufferAttribute(
        road.geometry.getAttribute('position') as THREE.BufferAttribute, idx.getX(1));
      const pc = new THREE.Vector3().fromBufferAttribute(
        road.geometry.getAttribute('position') as THREE.BufferAttribute, idx.getX(2));
      const faceNy = new THREE.Vector3()
        .subVectors(pb, pa)
        .cross(new THREE.Vector3().subVectors(pc, pa)).normalize().y;
      check(`trazado ${def.name}: mira hacia arriba`, faceNy > 0.9, `ny=${faceNy.toFixed(3)}`);
    }

    // Trazado interesante y conducible: ni óvalo soso ni horquillas imposibles.
    // El tope (2500 m) cubre la Barranquilla de ~2 km por todo el mapa.
    const len = trackLength(def);
    check(`trazado ${def.name}: longitud de circuito`, len > 250 && len < 2500,
      `${len.toFixed(0)} m`);
    const s = trackSpawn(def);
    check(`trazado ${def.name}: salida dentro del mapa`,
      Math.abs(s.x) < 145 && Math.abs(s.z) < 145 && Number.isFinite(s.yaw),
      `(${s.x}, ${s.z}) yaw=${s.yaw.toFixed(2)}`);
  }
});

// --------------------------------------- 5d. rugosidad al mínimo y al máximo
scenario('Rugosidad 0 y 2: el coche sigue apoyado y nada se hunde', (p, _terrain, v) => {
  for (const r of [0, 2]) {
    p.set('roughness', r);
    const s = trackSpawn(TRACKS.monaco);
    v.setSpawn(s.x, s.z, s.yaw);
    run(v, 2, NO_INPUT);

    check(`rugosidad ${r}: valores finitos`, isFiniteVehicle(v));
    check(`rugosidad ${r}: las 4 ruedas apoyan`, v.cornerStates.every((st) => st.contact));
    check(`rugosidad ${r}: altura de rodaje sana`, v.position.y > -5 && v.position.y < 30,
      `y=${v.position.y.toFixed(2)} m`);
  }
  p.set('roughness', 1);

  p.set('roughness', 1);
});

// ------------------- 5d-ter. el terreno nunca asoma por las calzadas
/**
 * Superficie renderizada del terreno en (x, z): la malla es una rejilla de
 * paso 1 m cuyos vértices valen `carve(x, z)`, y entre ellos la GPU interpola
 * linealmente — esta función reproduce esa interpolación.
 */
function meshSurfaceAt(carve: (x: number, z: number) => number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const h00 = carve(x0, z0);
  const h10 = carve(x0 + 1, z0);
  const h01 = carve(x0, z0 + 1);
  const h11 = carve(x0 + 1, z0 + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

scenario('El terreno esculpido nunca asoma por las calzadas', (p, terrain, _v) => {
  // La pista y la hierba son dos interpolaciones distintas de la misma función
  // de altura: sin esculpir el terreno bajo el corredor, la cuerda de la
  // hierba (paso 1 m) se cuela por encima de la cinta en valles y curvas —
  // "la hierba asoma por la pista". Aquí se mide la garantía real: malla del
  // terreno por debajo de la cinta en todo el corredor, y el borde bajando en
  // pendiente suave (sin peldaño de arcén).
  for (const r of [0, 1, 2]) {
    p.set('roughness', r);
    const carve = makeTrackCarve(terrain);
    // Ejes para detectar cruces entre calzadas (no dependen de la rugosidad).
    const axes = new Map<TrackId, Array<{ x: number; z: number }>>();
    for (const id of TRACK_ORDER) axes.set(id, trackCenterline(TRACKS[id], 600));
    // ¿El punto cae dentro de la cinta de OTRO trazado? Ahí hay carretera
    // sobre carretera (sin puentes en el juego): la malla sirve a la más
    // alta y la garantía de "hierba por debajo" solo aplica a la cinta
    // superior, que sí tapa. Se excluyen esos puntos (+1 m por el paso del
    // muestreo del eje); fuera de los cruces la garantía sigue intacta.
    const underOtherRoad = (id: TrackId, x: number, z: number): boolean => {
      for (const id2 of TRACK_ORDER) {
        if (id2 === id) continue;
        const hw2 = TRACKS[id2].width / 2 + 1;
        const cl = axes.get(id2) as Array<{ x: number; z: number }>;
        for (let k = 0; k < cl.length; k += 2) {
          const dx = x - cl[k].x;
          const dz = z - cl[k].z;
          if (dx * dx + dz * dz < hw2 * hw2) return true;
        }
      }
      return false;
    };
    let minGap = Infinity;
    let minGapAt = '';
    let maxLipNormal = 0;
    let maxLipWhoops = 0;
    for (const id of TRACK_ORDER) {
      const def = TRACKS[id];
      const hw = def.width / 2;
      const center = trackCenterline(def, Math.round(trackLength(def) / 2));
      const n = center.length;
      for (let i = 0; i < n; i += 2) {
        const c = center[i];
        const nx = center[(i + 1) % n];
        const px = center[(i - 1 + n) % n];
        const tx = nx.x - px.x;
        const tz = nx.z - px.z;
        const len = Math.hypot(tx, tz) || 1;
        const sx = -tz / len;
        const sz = tx / len;
        for (const frac of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
          const o = frac * hw;
          const x = c.x + sx * o;
          const z = c.z + sz * o;
          if (underOtherRoad(id, x, z)) continue;
          const road = carve.roadHeight(x, z);
          if (road === null) continue;
          const gap = road - meshSurfaceAt(carve, x, z);
          if (gap < minGap) {
            minGap = gap;
            minGapAt = `[${x.toFixed(1)}, ${z.toFixed(1)}] (eje ${def.id})`;
          }
          if (Math.abs(frac) > 0.9) {
            // Franja de badenes (coherente con terrain.ts): donde el terreno
            // ondula a propósito el hombro no se percibe.
            const inWhoops = Math.abs(z + 16) < 10 && Math.abs(x) < 55;
            if (inWhoops) maxLipWhoops = Math.max(maxLipWhoops, gap);
            else maxLipNormal = Math.max(maxLipNormal, gap);
          }
        }
      }
    }
    check(`rugosidad ${r}: la hierba no asoma por la pista`, minGap > 0.003,
      `holgura mín ${(minGap * 1000).toFixed(1)} mm en ${minGapAt}`);
    // El borde debe bajar en pendiente, no en peldaño: en llano la holgura es
    // la mínima (2 cm) y crece con la curvatura local (la cuerda de la malla
    // se levanta sobre la cinta en los valles). En la franja de badenes la
    // ondulación del terreno de tierra la absorbe.
    check(`rugosidad ${r}: el borde baja en pendiente en terreno normal`, maxLipNormal < 0.03 + 0.085 * r,
      `salto máx ${(maxLipNormal * 1000).toFixed(0)} mm (<${((0.03 + 0.085 * r) * 1000).toFixed(0)} mm)`);
    check(`rugosidad ${r}: en badenes el hombro se absorbe en la ondulación`, maxLipWhoops < 0.03 + 0.11 * r,
      `salto máx ${(maxLipWhoops * 1000).toFixed(0)} mm (<${((0.03 + 0.11 * r) * 1000).toFixed(0)} mm)`);
  }
  p.set('roughness', 1);
});

// --------------------------------------- 5e. la cámara no tiembla a velocidad
scenario('La cámara de persecución no mete tirones a 25 m/s', (_p, _t, _v) => {
  const rig = new CameraRig();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1200);
  const fake = {
    position: new THREE.Vector3(0, 1, 0),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(0, 0, 25),
    hoodY: 0.9,
    // API de pose interpolada (física a paso fijo → dibujo a dt de frame)
    renderPosition(_alpha: number, out: THREE.Vector3) {
      return out.copy(this.position);
    },
    renderQuaternion(_alpha: number, out: THREE.Quaternion) {
      return out.copy(this.quaternion);
    },
  };
  const internals = rig as unknown as { smoothPos: THREE.Vector3 };
  const dt = 1 / 60;
  let maxJump = 0;
  let prev = new THREE.Vector3();
  let first = true;
  for (let i = 0; i < 300; i++) {
    fake.position.z += 25 * dt; // el coche avanza a 90 km/h
    rig.apply(camera, fake as never, dt);
    if (i > 60) {
      maxJump = Math.max(maxJump, camera.position.distanceTo(prev));
    }
    prev.copy(camera.position);
    if (first) {
      first = false;
    }
  }
  const dx = camera.position.x - fake.position.x;
  const dz = camera.position.z - fake.position.z;
  const sep = Math.hypot(dx, dz);

  // La cámara es una copia del punto suavizado: ningún recorte posterior al
  // lerp (ese recorte era el tembleque a alta velocidad).
  check('la cámara sale del suavizado sin recortes', camera.position.distanceTo(internals.smoothPos) < 1e-9);
  check('a 90 km/h no hay saltos por fotograma', maxJump < 0.8, `${(maxJump * 100).toFixed(0)} cm/fotograma`);
  check('la distancia converge al tope del 5 %', sep <= rig.distance * 1.05 + 0.05,
    `sep=${sep.toFixed(2)} m, tope=${(rig.distance * 1.05).toFixed(2)} m`);
});

// ------------------------- 5e-bis. el render interpolado no tiembla
scenario('El render interpolado no tiembla con fotogramas irregulares a 25 m/s', (_p, _t, v) => {
  // La física corre a paso fijo (1/300 s) y el dibujo a dt de frame: sin
  // interpolar entre subpasos, el render muestrea la fase del acumulador y el
  // coche da vaivenes de varios cm por fotograma (proporcional a la
  // velocidad), que es la "vibración a alta velocidad". Con la interpolación
  // el movimiento es uniforme salvo ruido físico.
  let throttle = 0;
  for (let i = 0; i < 300 * 30 && v.velocity.z < 25; i++) {
    throttle = Math.max(0, Math.min(1, throttle + (25 - v.velocity.z) * 0.02));
    v.step(DT, { ...NO_INPUT, throttle });
  }
  const frameTimes = [1 / 60, 1.07 / 60, 0.91 / 60, 1 / 60, 1.11 / 60, 0.94 / 60];
  let acc = 0;
  let fi = 0;
  let t = 0;
  const zs: number[] = [];
  const raws: number[] = [];
  const vzs: number[] = [];
  const ts: number[] = [];
  const pos = new THREE.Vector3();
  for (let frame = 0; frame < 240; frame++) {
    const frameDt = frameTimes[fi++ % frameTimes.length];
    t += frameDt;
    acc += frameDt;
    while (acc >= DT) {
      acc -= DT;
      throttle = Math.max(0, Math.min(1, throttle + (25 - v.velocity.z) * 0.02));
      v.step(DT, { ...NO_INPUT, throttle });
    }
    v.renderPosition(acc / DT, pos);
    zs.push(pos.z);
    raws.push(v.position.z);
    vzs.push(v.velocity.z);
    ts.push(t);
  }
  let maxJit = 0;
  let maxRaw = 0;
  for (let i = 1; i < zs.length; i++) {
    const dtf = ts[i] - ts[i - 1];
    const vAvg = (vzs[i] + vzs[i - 1]) / 2;
    maxJit = Math.max(maxJit, Math.abs(zs[i] - zs[i - 1] - vAvg * dtf));
    maxRaw = Math.max(maxRaw, Math.abs(raws[i] - raws[i - 1] - vAvg * dtf));
  }
  check('valores finitos', isFiniteVehicle(v));
  check('el coche avanza a la velocidad de crucero', v.velocity.z > 20,
    `${v.velocity.z.toFixed(1)} m/s`);
  check('la pose interpolada es uniforme (<0,5 mm/fotograma)', maxJit < 0.0005,
    `${(maxJit * 1000).toFixed(3)} mm`);
  check('sin interpolar sí temblaba (la prueba mide lo que importa)', maxRaw > 0.01,
    `${(maxRaw * 1000).toFixed(1)} mm/fotograma`);
});

// ------------------------- 5e-ter. sin ringing del giro de rueda
scenario('Sin ringing del giro de rueda al rodar con freno motor', (p, _t, v) => {
  // Subir a 8 m/s y dejar rodar hasta casi pararse. Con κ instantánea (vRef
  // clampeado a 1,2 m/s) el integrador explícito del giro entraba en ciclo
  // límite: ringing de 120-150 Hz por debajo de 2 m/s con |κ| ~ 0,03 y
  // aceleraciones alternas de más de 1 g. Ahora la κ va amortiguada.
  // Terreno plano: aquí se mide el modo numérico, no la excitación del terreno.
  // Se rueda por la recta oeste de Barranquilla (asfalto, 190 m): el carril
  // de tierra/hierba mete su propia dinámica de suelo blando en la medida.
  p.set('roughness', 0);
  const ms = trackSpawn(TRACKS.monaco);
  v.setSpawn(ms.x, ms.z, ms.yaw);
  let throttle = 0;
  for (let i = 0; i < 300 * 20 && v.velocity.z < 7.8; i++) {
    throttle = Math.max(0, Math.min(1, throttle + (8 - v.velocity.z) * 0.02));
    v.step(DT, { ...NO_INPUT, throttle });
  }
  // Se suelta el gas en rampa (1,5 s) en vez de cortarlo de golpe: tras un
  // acelerón con patinaje, el volante motor guarda inercia y un corte
  // seco la descarga de golpe sobre el coche (empujón real, no ringing).
  // Aquí se mide la rodadura posterior, no el transitorio de soltar el gas.
  for (let i = 0; i < Math.round(1.5 / DT); i++) {
    throttle = Math.max(0, throttle - DT / 1.5);
    v.step(DT, { ...NO_INPUT, throttle });
  }
  run(v, 1, NO_INPUT); // transitorio de soltar el gas fuera de la medición
  let peakKappa = 0;
  let peakSlipV = 0;
  let maxDeltaV = 0;
  let prevVz = v.velocity.z;
  for (let i = 0; i < 300 * 30 && v.velocity.z > 0.3; i++) {
    v.step(DT, NO_INPUT);
    for (const st of v.cornerStates) {
      peakKappa = Math.max(peakKappa, Math.abs(st.kappa));
      // solo la banda baja: a más velocidad el freno motor genera un
      // deslizamiento negativo pequeño y físico (κ ~ 0,02).
      if (v.velocity.z < 3) {
        peakSlipV = Math.max(peakSlipV, Math.abs(st.wheelOmega * v.wheelRadius - v.velocity.z));
      }
    }
    maxDeltaV = Math.max(maxDeltaV, Math.abs(v.velocity.z - prevVz));
    prevVz = v.velocity.z;
  }
  check('valores finitos', isFiniteVehicle(v));
  check('ha rodado hasta casi pararse', v.velocity.z < 0.6, `${v.velocity.z.toFixed(2)} m/s`);
  check('κ sin ciclo límite', peakKappa < 0.02, `|κ| pico ${peakKappa.toFixed(4)}`);
  check('deslizamiento acotado a baja velocidad', peakSlipV < 0.02,
    `|ωR − v| pico ${peakSlipV.toFixed(4)} m/s`);
  check('sin tirones de velocidad por paso', maxDeltaV < 0.004,
    `|Δv| pico ${maxDeltaV.toFixed(4)} m/s`);
});

// --------------------------------------- 5f. el todoterreno también funciona
scenario('Todoterreno 4x4: se estabiliza con su altura', (p, terrain, _v) => {
  const spec = CARS.offroad;
  p.applyPreset(spec.preset);
  const v = new Vehicle(p, terrain, undefined, 'offroad');
  v.setSpawn(0, 0);
  run(v, 6, NO_INPUT);
  const ground = terrain.heightAt(0, 0);
  const heightErr = Math.abs(v.position.y - (ground + spec.comHeight));

  check('valores finitos', isFiniteVehicle(v));
  check('altura de rodaje del 4x4', heightErr < 0.04, `error ${heightErr.toFixed(4)} m`);
  check('las 4 ruedas apoyan', v.cornerStates.every((s) => s.contact));
  check('no se hunde en reposo', chassisClearance(v, terrain) > -0.02,
    `holgura ${(chassisClearance(v, terrain) * 1000).toFixed(1)} mm`);
});

scenario('Todoterreno: la tracción total acelera sin patinar', (p, terrain, _v) => {
  const spec = CARS.offroad;
  p.applyPreset(spec.preset);
  const v = new Vehicle(p, terrain, undefined, 'offroad');
  v.setSpawn(0, 0);
  run(v, 1, NO_INPUT);
  run(v, 8, { ...NO_INPUT, throttle: 1 });

  check('valores finitos', isFiniteVehicle(v));
  check('el 4x4 acelera', v.telemetry.speed > 20,
    `${v.telemetry.speed.toFixed(1)} m/s (${v.telemetry.speedKph.toFixed(0)} km/h)`);
  check('sin vuelco con el CdM alto', Math.abs(v.telemetry.roll) < 8,
    `alabeo ${v.telemetry.roll.toFixed(1)}°`);
});

scenario('Todoterreno: sin hundimiento en los badenes', (p, terrain, _v) => {
  const spec = CARS.offroad;
  p.applyPreset(spec.preset);
  const v = new Vehicle(p, terrain, undefined, 'offroad');
  v.setSpawn(-34, -16);
  v.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  v.velocity.set(22, 0, 0);

  let clearance = Infinity;
  const steps = Math.round(4.5 / DT);
  for (let i = 0; i < steps; i++) {
    v.step(DT, { throttle: 0.35, brake: 0, steer: 0, handbrake: false });
    clearance = Math.min(clearance, chassisClearance(v, terrain));
  }

  check('valores finitos', isFiniteVehicle(v));
  check('el 4x4 raspa sin hundirse', clearance > -0.03,
    `holgura mínima ${(clearance * 1000).toFixed(1)} mm`);
});

// -------------------------------------------------- 6. parámetros extremos
scenario('Estabilidad con parámetros extremos', (p, _t, v) => {  p.set('fSpring', 85);
  p.set('rSpring', 90);
  p.set('fBump', 400);
  p.set('rBump', 400);
  p.set('fRebound', 800);
  p.set('rRebound', 800);
  p.set('fArb', 70);
  p.set('rArb', 70);
  p.set('tireVertStiff', 520);
  p.set('tireVertDamp', 100);
  p.set('roughness', 2);
  p.set('enginePower', 2);
  p.set('steerLock', 50);

  run(v, 4, (t) => ({ throttle: 1, brake: 0, steer: Math.sin(t * 3), handbrake: false }));

  check('valores finitos', isFiniteVehicle(v));
  check('posición acotada', Math.abs(v.position.x) < 400 && Math.abs(v.position.z) < 400,
    `(${v.position.x.toFixed(1)}, ${v.position.z.toFixed(1)})`);
  check('recorrido dentro de límites físicos', v.cornerStates.every((s) => s.s > -0.09 && s.s < 0.11),
    v.cornerStates.map((s) => `${(s.s * 1000).toFixed(0)}mm`).join(' '));
});

// ------------------------------- 6b. visual sincronizado con la física
scenario('Visual del coche sincronizado con la física', (_p, _t, v) => {
  const car = new CarVisual();
  run(v, 2, { ...NO_INPUT, throttle: 0.8 });
  run(v, 1.5, (t) => ({ throttle: 0.5, brake: 0, steer: Math.sin(t * 2) * 0.5, handbrake: false }));
  car.update(v, 1 / 60);

  check('grupo del coche coincide con el chasis', car.group.position.distanceTo(v.position) < 1e-9);
  check('orientación del coche coincide', Math.abs(car.group.quaternion.dot(v.quaternion)) > 1 - 1e-9);

  let wheelsOk = true;
  const springScales: number[] = [];
  for (let i = 0; i < 4; i++) {
    const st = v.cornerStates[i];
    const c = v.corners[i];
    const expected = c.yStatic + st.s + Math.min(st.tireDeflection, VISUAL_TIRE_DEFLECTION);
    const w = car.wheels[i];
    if (Math.abs(w.pivot.position.y - expected) > 1e-6) wheelsOk = false;
    if (Math.abs(w.pivot.rotation.y - st.steer) > 1e-9) wheelsOk = false;
    springScales.push(w.spring.scale.y);
  }
  const spread = Math.max(...springScales) - Math.min(...springScales);
  check('las ruedas siguen el recorrido físico', wheelsOk);
  check('los muelles responden al recorrido', spread > 0.02, `dispersión ${(spread * 100).toFixed(1)}%`);

  let bad = 0;
  let count = 0;
  car.group.traverse((o) => {
    count++;
    const p = o.position;
    if (!Number.isFinite(p.x + p.y + p.z)) bad++;
    const q = o.quaternion;
    if (!Number.isFinite(q.x + q.y + q.z + q.w)) bad++;
  });
  check('todas las transformaciones son finitas', bad === 0 && count > 40, `${count} objetos, ${bad} inválidos`);
});

// --------------------------------------- 6c. ley de carga potencial
scenario('Ley de carga potencial del neumático', (_p, _t, _v) => {
  // Milliken & Milliken (RCVD fig. 2.9): al duplicar la carga el μ cae
  // ~12 % (1.10 → 0.97), es decir F ∝ Fz^0.85, no lineal.
  const fz0 = 4000;
  const cfg = { mu: 1, loadSens: 0.15, fzNominal: fz0 };
  const f1 = tireForces(fz0, 0.05, 0.05, cfg, { fx: 0, fy: 0 });
  const f2 = tireForces(2 * fz0, 0.05, 0.05, cfg, { fx: 0, fy: 0 });
  const mu1 = Math.hypot(f1.fx, f1.fy) / fz0;
  const mu2 = Math.hypot(f2.fx, f2.fy) / (2 * fz0);
  const ratio = mu2 / mu1;

  check('a carga nominal el μ es el del compuesto', Math.abs(mu1 - 1) < 0.02, `μ=${mu1.toFixed(3)}`);
  check('duplicar la carga quita ~10 % de μ', ratio > 0.87 && ratio < 0.93, `×${ratio.toFixed(3)}`);
  check('la fuerza total sigue creciendo con la carga', Math.hypot(f2.fx, f2.fy) > Math.hypot(f1.fx, f1.fy));
});

// --------------------------------------- 6d. mapa de superficies
scenario('El agarre depende de la superficie', (_p, terrain, _v) => {
  const muAt = (x: number, z: number): number =>
    terrain.surfaceMuAt ? terrain.surfaceMuAt(x, z) : 1;
  const meta = trackSpawn(TRACKS.monaco);
  const baja = trackSpawn(TRACKS.baja);

  check('la meta de Barranquilla es asfalto', muAt(meta.x, meta.z) > 0.95,
    `μ=${muAt(meta.x, meta.z).toFixed(2)}`);
  check('la salida de Baja es tierra', muAt(baja.x, baja.z) > 0.5 && muAt(baja.x, baja.z) < 0.7,
    `μ=${muAt(baja.x, baja.z).toFixed(2)}`);
  check('el paddock es asfalto', muAt(0, 0) > 0.95, `μ=${muAt(0, 0).toFixed(2)}`);
  check('el campo es hierba', muAt(GRASS_X, GRASS_Z) < 0.5, `μ=${muAt(GRASS_X, GRASS_Z).toFixed(2)}`);
  check('asfalto > tierra > hierba',
    muAt(meta.x, meta.z) > muAt(baja.x, baja.z) && muAt(baja.x, baja.z) > muAt(GRASS_X, GRASS_Z));
});

// --------------------------------------- 6e. pico de G = μ (alce)
scenario('El pico de G lateral iguala al agarre (asfalto vs hierba)', (p, terrain, v) => {
  // Maniobra del alce a 16 m/s: en asfalto el pico debe rozar μ (≈1 g con
  // el compuesto sport); en hierba (μ≈0.4) tiene que caer a menos de la mitad.
  const runMoose = (x: number, z: number, yaw: number): number => {
    v.setSpawn(x, z, yaw);
    v.velocity.set(Math.sin(yaw) * 16, 0, Math.cos(yaw) * 16);
    run(v, 0.5, NO_INPUT);
    let peak = 0;
    const steps = Math.round(2.2 / DT);
    for (let i = 0; i < steps; i++) {
      const t = i * DT;
      v.step(DT, {
        throttle: 0.25,
        brake: 0,
        steer: 0.6 * Math.sin(t * 2 * Math.PI * 0.45),
        handbrake: false,
      });
      peak = Math.max(peak, Math.abs(v.telemetry.gLat));
    }
    return peak;
  };
  const s = trackSpawn(TRACKS.monaco);
  const gAsphalt = runMoose(s.x, s.z, s.yaw);
  const gGrass = runMoose(GRASS_X, GRASS_Z, 0);

  check('en asfalto el pico roza μ (≈1 g)', gAsphalt > 0.8 && gAsphalt < 1.4,
    `pico ${gAsphalt.toFixed(2)} g (compuesto ${p.get('tireMu')})`);
  check('en hierba el pico cae (<0.65 g)', gGrass < 0.65, `pico ${gGrass.toFixed(2)} g`);
  check('el asfalto agarra más que la hierba', gAsphalt > gGrass + 0.25,
    `${gAsphalt.toFixed(2)}g vs ${gGrass.toFixed(2)}g`);
  void terrain;
});

// -------------------------------------------- 7. métricas de puesta a punto
scenario('Métricas de puesta a punto', (p, _t, _v) => {
  const base = rideMetrics(p.get('fSpring') * 1000, p.get('fBump'), p.get('fRebound'), FRONT_KINEMATICS, SPRUNG_MASS_FRONT);
  const stiff = rideMetrics(60_000, p.get('fBump'), p.get('fRebound'), FRONT_KINEMATICS, SPRUNG_MASS_FRONT);
  const rear = rideMetrics(p.get('rSpring') * 1000, p.get('rBump'), p.get('rRebound'), REAR_KINEMATICS, SPRUNG_MASS_REAR);

  check('frecuencia delantera en rango', base.frequency > 1 && base.frequency < 2.2, `${base.frequency.toFixed(2)} Hz`);
  check('frecuencia trasera en rango', rear.frequency > 1 && rear.frequency < 2.4, `${rear.frequency.toFixed(2)} Hz`);
  check('muelle más duro → más frecuencia', stiff.frequency > base.frequency * 1.35,
    `${base.frequency.toFixed(2)} → ${stiff.frequency.toFixed(2)} Hz`);
  check('amortiguamiento razonable', base.zetaBump > 0.15 && base.zetaRebound > base.zetaBump,
    `ζ comp=${base.zetaBump.toFixed(2)} reb=${base.zetaRebound.toFixed(2)}`);
});

// -------------------------------------------- 8. realismo (freno motor, dirección, camber, cambios, suelo)
scenario('El freno motor retiene al soltar el gas', (p, terrain, v) => {
  // En llano (rugosidad 0), soltando el gas a 25 m/s la deceleración debe
  // superar claramente la de aero + rodadura sola (~0,29 m/s² en el Tesla):
  // el freno motor aporta ~0,2 m/s² más en marcha larga.
  p.set('roughness', 0);
  v.setSpawn(0, 0, 0);
  v.velocity.set(0, 0, 25);
  run(v, 8, NO_INPUT); // la caja llega a marchas largas
  const v0 = v.telemetry.speed;
  run(v, 2, NO_INPUT);
  const v1 = v.telemetry.speed;
  const decel = (v0 - v1) / 2;

  check('valores finitos', isFiniteVehicle(v));
  check('retiene más que aero + rodadura', decel > 0.38, `${decel.toFixed(2)} m/s²`);
  check('no se clava (retención creíble)', decel < 1.2, `${decel.toFixed(2)} m/s²`);
  void terrain;
});

scenario('La dirección se recorta con la velocidad', (p, _t, v) => {
  // A 3 m/s el tope completo; a 30 m/s el ángulo debe quedar muy por debajo
  // del tope de parking (32°), aunque sin llegar a cero.
  const lockDeg = p.get('steerLock');
  v.setSpawn(0, 0, 0);
  v.velocity.set(0, 0, 3);
  run(v, 0.5, { ...NO_INPUT, steer: 1 });
  const slowSteer = Math.max(...v.cornerStates.map((s) => Math.abs(s.steer))) * 180 / Math.PI;

  v.setSpawn(0, 0, 0);
  v.velocity.set(0, 0, 30);
  run(v, 0.5, { ...NO_INPUT, steer: 1 });
  const fastSteer = Math.max(...v.cornerStates.map((s) => Math.abs(s.steer))) * 180 / Math.PI;

  // Modo prueba (Shift): 25 % más de volante a alta velocidad, sin pasar del
  // tope de cremallera.
  v.setSpawn(0, 0, 0);
  v.velocity.set(0, 0, 30);
  run(v, 0.5, { ...NO_INPUT, steer: 1, testMode: true });
  const boostSteer = Math.max(...v.cornerStates.map((s) => Math.abs(s.steer))) * 180 / Math.PI;

  check('valores finitos', isFiniteVehicle(v));
  check('en parado/casi parado hay tope completo', slowSteer > lockDeg - 2, `${slowSteer.toFixed(1)}°`);
  check('a 108 km/h se recorta (<12°)', fastSteer < 12, `${fastSteer.toFixed(1)}°`);
  check('a 108 km/h sigue habiendo dirección', fastSteer > 1, `${fastSteer.toFixed(1)}°`);
  check('Shift da un 25 % más de volante', boostSteer > fastSteer * 1.2 && boostSteer < fastSteer * 1.3,
    `${fastSteer.toFixed(1)}° → ${boostSteer.toFixed(1)}°`);
  check('ni con Shift se pasa del tope', boostSteer <= lockDeg + 1e-6, `${boostSteer.toFixed(1)}°`);
});

scenario('El camber empuja pero no tira en recta', () => {
  // Con el mismo camber en ambos lados la resultante lateral es nula
  // (simetría en espejo); y el empuje por rueda es apreciable (~100 N).
  const cfg = { mu: 1, loadSens: 0.15, fzNominal: 4000 };
  const left = tireForces(4000, 0, 0, cfg, { fx: 0, fy: 0 }, -0.03, -1);
  const right = tireForces(4000, 0, 0, cfg, { fx: 0, fy: 0 }, -0.03, 1);
  const plain = tireForces(4000, 0, 0, cfg, { fx: 0, fy: 0 });

  check('el camber genera empuje', Math.abs(left.fy) > 50, `${left.fy.toFixed(0)} N`);
  check('simétrico: no tira a ningún lado', Math.abs(left.fy + right.fy) < 1,
    `${(left.fy + right.fy).toFixed(2)} N`);
  check('orden de magnitud realista', Math.abs(left.fy) < CAMBER_STIFFNESS * 4000 * 0.05 + 200,
    `${left.fy.toFixed(0)} N`);
  void plain;
});

scenario('Los cambios cortan el par', () => {
  // Caja directa: al subir de marcha el par de la siguiente ventana debe
  // caer (corte) y recuperarse después.
  const dt = new Drivetrain();
  const cfg = { frontTorqueShare: 0, powerScale: 1, reverse: false };
  let omega = 20;
  let prevGear = 0;
  let dip = 1;
  let recovered = 0;
  for (let i = 0; i < 4000; i++) {
    omega += 0.02;
    const out = dt.update(DT, 1, omega, cfg);
    if (out.gearIndex !== prevGear) {
      prevGear = out.gearIndex;
      // Ventana de corte: los 0,22 s siguientes (~66 pasos)
      let minT = Infinity;
      for (let j = 0; j < 70; j++) {
        omega += 0.02;
        const o2 = dt.update(DT, 1, omega, cfg);
        minT = Math.min(minT, o2.driveTorque);
      }
      // Tras el corte el par vuelve (misma marcha, más rpm)
      for (let j = 0; j < 200; j++) {
        omega += 0.005;
        const o3 = dt.update(DT, 1, omega, cfg);
        recovered = Math.max(recovered, o3.driveTorque);
      }
      dip = minT;
      break;
    }
  }
  check('hubo cambio de marcha', prevGear > 0, `marcha ${prevGear + 1}`);
  check('el par cae durante el cambio', dip < recovered * 0.5,
    `corte ${dip.toFixed(0)} N·m vs ${recovered.toFixed(0)} N·m`);
});

scenario('Balance en curva: subviraje en régimen medio', (p, _t, _v) => {
  // En la recta de Barranquilla a 12 m/s con volante fijo (demanda ≈0,7 g), los
  // tres coches deben ir de morro (alpha delantero > trasero) y sin
  // insinuar el trompo: es el balance seguro de un turismo de calle.
  const s = trackSpawn(TRACKS.monaco);
  const fwdX = Math.sin(s.yaw);
  const fwdZ = Math.cos(s.yaw);
  for (const car of ['sport', 'offroad', 'kwid'] as const) {
    p.applyPreset(CARS[car].preset);
    const v = new Vehicle(p, _t, undefined, car);
    v.setSpawn(s.x, s.z, s.yaw);
    v.velocity.set(fwdX * 12, 0, fwdZ * 12);
    for (let i = 0; i < Math.round(0.5 / DT); i++) {
      v.step(DT, { throttle: 0.25, brake: 0, steer: 0, handbrake: false });
    }
    let dSum = 0;
    let n = 0;
    let peakBeta = 0;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      v.step(DT, { throttle: 0.25, brake: 0, steer: 0.25, handbrake: false });
      if (i > Math.round(1 / DT)) {
        const aF = (Math.abs(v.cornerStates[0].alpha) + Math.abs(v.cornerStates[1].alpha)) / 2;
        const aR = (Math.abs(v.cornerStates[2].alpha) + Math.abs(v.cornerStates[3].alpha)) / 2;
        dSum += aF - aR;
        n++;
        const q = v.quaternion;
        const fx = 2 * (q.x * q.z + q.w * q.y);
        const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
        const sp = Math.hypot(v.velocity.x, v.velocity.z);
        if (sp > 0.5) {
          peakBeta = Math.max(
            peakBeta,
            Math.acos(Math.max(-1, Math.min(1, (v.velocity.x * fx + v.velocity.z * fz) / sp))),
          );
        }
      }
    }
    const meanDiff = (dSum / Math.max(1, n)) * 180 / Math.PI;
    check(`${car} va de morro en apoyo (aF>aR)`, meanDiff > 0.15, `${car} Δ=${meanDiff.toFixed(2)}°`);
    check(`${car} estable (sin amago de trompo)`, peakBeta < 0.17, `${car} β=${(peakBeta * 180 / Math.PI).toFixed(1)}°`);
  }
});

scenario('Recuperación de derrape con contravolante', (p, terrain, _v) => {
  // En hierba lisa: derrape de potencia y recuperación. Con control
  // proporcional (manos que modulan) un derrape moderado se endereza; con
  // contravolante a tope un derrape grande también (el tope de dirección se
  // amplía a la deriva + 4° al corregir). Sin esa ampliación, el derrape
  // grande sería irrecuperable.
  p.set('roughness', 0);
  const betaAbs = (v: Vehicle): number => {
    const q = v.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const sp = Math.hypot(v.velocity.x, v.velocity.z);
    if (sp < 0.5) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (v.velocity.x * fx + v.velocity.z * fz) / sp)));
  };
  const sigma = (v: Vehicle): number => {
    const q = v.quaternion;
    const rx = -(1 - 2 * (q.y * q.y + q.z * q.z));
    const ry = -(2 * (q.x * q.y + q.w * q.z));
    const rz = -(2 * (q.x * q.z - q.w * q.y));
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const vl = v.velocity.x * rx + v.velocity.y * ry + v.velocity.z * rz;
    const vo = Math.abs(v.velocity.x * fx + v.velocity.y * fy + v.velocity.z * fz);
    return Math.atan2(vl, vo + 1e-3);
  };
  const attempt = (
    powerTime: number,
    proportional: boolean,
  ): { b0: number; b1: number; peak: number } => {
    p.applyPreset(CARS.sport.preset);
    const v = new Vehicle(p, terrain, undefined, 'sport');
    v.setSpawn(DRIFT_X, DRIFT_Z, 0);
    v.velocity.set(0, 0, 10);
    run(v, 0.5, { ...NO_INPUT, throttle: 0.3 });
    run(v, powerTime, { throttle: 1, brake: 0, steer: 0.25, handbrake: false });
    const b0 = betaAbs(v);
    let peak = b0;
    const steps = Math.round(3 / DT);
    for (let i = 0; i < steps; i++) {
      const st = proportional
        ? Math.max(-1, Math.min(1, ((sigma(v) * 180) / Math.PI) * 0.06))
        : -0.6;
      v.step(DT, { throttle: 0.3, brake: 0, steer: st, handbrake: false });
      peak = Math.max(peak, betaAbs(v));
    }
    return { b0, b1: betaAbs(v), peak };
  };
  const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(1)}°`;

  const mod = attempt(2.5, true);
  check('derrape moderado: hay deslizamiento', mod.b0 > 0.05, `β=${deg(mod.b0)}`);
  check(
    'derrape moderado se recupera modulando',
    mod.b1 < 0.11 && mod.peak < mod.b0 + 0.21,
    `${deg(mod.b0)} → ${deg(mod.b1)} (pico ${deg(mod.peak)})`,
  );
  const big = attempt(4, false);
  check('derrape grande: hay deslizamiento', big.b0 > 0.21, `β=${deg(big.b0)}`);
  check(
    'derrape grande se recupera con contravolante',
    big.b1 < 0.11 && big.peak < big.b0 + 0.21,
    `${deg(big.b0)} → ${deg(big.b1)} (pico ${deg(big.peak)})`,
  );
  void _v;
});

scenario('El suelo blando frena y hunde', (p, _t, v) => {
  // En llano (rugosidad 0): soltado a 15 m/s, en hierba debe perder más
  // velocidad que en asfalto; y parado, la rueda debe hundirse más.
  p.set('roughness', 0);
  const coast = (x: number, z: number): number => {
    v.setSpawn(x, z, 0);
    v.velocity.set(0, 0, 15);
    run(v, 1, NO_INPUT);
    const a = v.telemetry.speed;
    run(v, 3, NO_INPUT);
    return a - v.telemetry.speed;
  };
  const dropAsphalt = coast(0, 0);
  const dropGrass = coast(GRASS_X, GRASS_Z);

  const settle = (x: number, z: number): number => {
    v.setSpawn(x, z, 0);
    run(v, 4, NO_INPUT);
    return Math.max(...v.cornerStates.map((s) => s.tireDeflection));
  };
  const deflAsphalt = settle(0, 0);
  const deflGrass = settle(GRASS_X, GRASS_Z);

  check('valores finitos', isFiniteVehicle(v));
  check('en hierba retiene ~el doble que en asfalto', dropGrass > dropAsphalt * 1.8,
    `asfalto -${dropAsphalt.toFixed(2)} m/s vs hierba -${dropGrass.toFixed(2)} m/s`);
  check('en hierba la rueda se hunde más', deflGrass > deflAsphalt + 0.003,
    `${(deflAsphalt * 1000).toFixed(0)} → ${(deflGrass * 1000).toFixed(0)} mm`);
});

// --------------------------------------- 9. Nürburgring Nordschleife 1:1
scenario('Nordschleife 1:1: geometría, cotas y calzada', (_p, _t, _v) => {
  // Longitud oficial del bucle sin GP: 20832 m (traza Touristenfahrten).
  check('longitud 1:1 (≈20,8 km)', Math.abs(LOOP_LENGTH - 20758) < 400, `${LOOP_LENGTH.toFixed(0)} m`);
  // Desnivel oficial: ~320 m (Breidscheid) a ~627 m (Hohe Acht).
  let mn = Infinity, mx = -Infinity;
  const probe = { x: 0, z: 0, y: 0 };
  for (let i = 0; i < 6919; i += 7) {
    stationPos(i, probe);
    if (probe.y < mn) mn = probe.y;
    if (probe.y > mx) mx = probe.y;
  }
  check('desnivel 1:1 (~300 m)', mn > 300 && mn < 360 && mx > 600 && mx < 660,
    `${mn.toFixed(0)} → ${mx.toFixed(0)} m`);
  // La física pisa la cota exacta de la pista en todo el anillo.
  const rt = new RingTerrain();
  let maxErr = 0;
  for (let s = 0; s < LOOP_LENGTH; s += 211) {
    const i = Math.round(s / 3.0002) % 6919;
    stationPos(i, probe);
    maxErr = Math.max(maxErr, Math.abs(rt.heightAt(probe.x, probe.z) - probe.y));
  }
  check('la física coincide con la cota (≤1 mm)', maxErr < 0.001, `err máx ${(maxErr * 1000).toFixed(2)} mm`);
  // Perfil vial: sin rampas imposibles ni rasantes que lancen el coche.
  let gmax = 0;
  let kMin = Infinity;
  const pa = { x: 0, z: 0, y: 0 };
  const pb = { x: 0, z: 0, y: 0 };
  const pc = { x: 0, z: 0, y: 0 };
  for (let i = 0; i < 6919; i++) {
    stationPos(i, pa);
    stationPos((i + 1) % 6919, pb);
    stationPos((i + 2) % 6919, pc);
    const d = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
    gmax = Math.max(gmax, Math.abs(pb.y - pa.y) / d);
    const k = Math.abs(pa.y - 2 * pb.y + pc.y) / (d * d);
    if (k > 1e-9) kMin = Math.min(kMin, 1 / k);
  }
  check('pendiente máxima de carretera (<15 %)', gmax < 0.15, `${(gmax * 100).toFixed(1)} %`);
  check('rasantes suaves (Rmin > 100 m)', kMin > 100, `Rmin ${kMin.toFixed(0)} m`);
  // Esculpido: bajo la cinta la hierba queda por debajo (4 cm en recta,
  // más en curva: la cinta curva dentro de la celda y el plano la cortaría).
  stationPos(100, probe);
  const wantCarve = Math.min(0.25, 0.04 + 3 * Math.abs(curvatureAt(100 * RING_STEP)));
  const onRoad = rt.meshHeightAt(probe.x, probe.z);
  check('esculpido bajo la cinta (regla adaptativa)', Math.abs(onRoad - (probe.y - wantCarve)) < 0.002,
    `${((probe.y - onRoad) * 100).toFixed(1)} cm (regla ${(wantCarve * 100).toFixed(1)} cm)`);
  const far = rt.heightAt(probe.x + 400, probe.z + 400);
  check('lejos de la pista no hay esculpido', Math.abs(rt.meshHeightAt(probe.x + 400, probe.z + 400) - far) < 1e-9);
  // La salida es asfalto y la malla de la calzada es válida.
  const sp = ringSpawn();
  check('la salida pisa asfalto', (rt.surfaceMuAt?.(sp.x, sp.z) ?? 0) > 0.95);
  check('la salida mira en el sentido de marcha', Number.isFinite(sp.yaw));
  const road = buildRingRoad();
  const posAttr = road.geometry.getAttribute('position') as THREE.BufferAttribute;
  let bad = 0;
  for (let i = 0; i < posAttr.count; i += 13) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    if (!Number.isFinite(x + y + z) || y < 300 || y > 660) bad++;
  }
  check('malla de 20,8 km válida', posAttr.count > 50000 && bad === 0, `${posAttr.count} vértices`);
  // El fondo (paso 32 m) no puede tapar la cinta: sus cuerdas se levantarían
  // hasta 1 m en las hondonadas, así que sus vértices del corredor van 2 m
  // por debajo de la cota (antes, con paso 64 m y sin clavado, la hierba
  // enterraba la pista a lo lejos).
  const backGeo = buildBackdropGeometry(rt);
  const backPos = backGeo.getAttribute('position') as THREE.BufferAttribute;
  let backBad = 0;
  let backCorr = 0;
  for (let i = 0; i < backPos.count; i += 3) {
    const x = backPos.getX(i), y = backPos.getY(i), z = backPos.getZ(i);
    if (!Number.isFinite(x + y + z) || y < 100 || y > 900) {
      backBad++;
      continue;
    }
    const p = rt.trackProximity(x, z);
    if (p && p.dist < ROAD_HALF + 40) {
      backCorr++;
      if (y > p.elev - 2.9) backBad++;
    }
  }
  check('el fondo no tapa la cinta', backBad === 0 && backCorr > 100,
    `${backCorr} vértices de corredor clavados`);
  backGeo.dispose();
});

// --------------------------------------- 9c. barrido anti-hierba del anillo
/**
 * Detección exacta de hierba sobre la cinta en los 20,8 km: reproduce la
 * interpolación de la GPU (los dos triángulos de cada quad de PlaneGeometry)
 * sobre la rejilla de teselas (4 m, alineada global) y la del fondo (32 m),
 * y la compara con la cota de la calzada en cada estación × carril. Donde la
 * hierba interpolada supera la cinta >3 mm el píxel se ve verde: el barrido
 * informa `s` (distancia recorrida) para teletransportarse al punto y verlo.
 */
scenario('Nordschleife 1:1: barrido anti-hierba por interpolación exacta', (_p, _t, _v) => {
  const rt = new RingTerrain();
  // Superficie GPU en (x, z) sobre una rejilla de paso `step` con esquina
  // (ox, ozTop) = mundo del vértice (ix=0, iy=0). `yAt` = altura de vértice.
  const triSurfaceAt = (
    ox: number, ozTop: number, step: number,
    x: number, z: number, yAt: (vx: number, vz: number) => number,
  ): number => {
    const fx = (x - ox) / step;
    const fy = (ozTop - z) / step;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const u = fx - ix;
    const v = fy - iy;
    const x0 = ox + ix * step;
    const z0 = ozTop - iy * step;
    if (u + v <= 1) {
      const ha = yAt(x0, z0);
      const hb = yAt(x0, z0 - step);
      const hd = yAt(x0 + step, z0);
      return ha + u * (hd - ha) + v * (hb - ha);
    }
    const hb = yAt(x0, z0 - step);
    const hc = yAt(x0 + step, z0 - step);
    const hd = yAt(x0 + step, z0);
    return hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  };
  const tileYAt = (x: number, z: number): number => rt.meshHeightAt(x, z);
  // Misma regla que la geometría real (sin derivas): ver `backdropVertexY`.
  const backYAt = (x: number, z: number): number => backdropVertexY(rt, x, z);
  const probe = { x: 0, z: 0, y: 0 };
  const tan = { x: 0, z: 0 };
  const pokes: Array<{ s: number; o: number; depth: number; layer: string; x: number; z: number }> = [];
  const N = 6919;
  for (let i = 0; i < N; i++) {
    stationPos(i, probe);
    tangentAt(i * RING_STEP, tan);
    const sx = -tan.z;
    const sz = tan.x;
    for (let o = -5; o <= 5; o++) {
      const x = probe.x + sx * o;
      const z = probe.z + sz * o;
      const roadY = probe.y;
      const tileH = triSurfaceAt(0, 0, 4, x, z, tileYAt);
      if (tileH > roadY + 0.003) {
        pokes.push({ s: i * RING_STEP, o, depth: tileH - roadY, layer: 'tesela', x, z });
      }
      const backH = triSurfaceAt(RING_BACKDROP.ox, RING_BACKDROP.ozTop, RING_BACKDROP.step, x, z, backYAt);
      if (backH > roadY + 0.003) {
        pokes.push({ s: i * RING_STEP, o, depth: backH - roadY, layer: 'fondo', x, z });
      }
    }
  }
  pokes.sort((a, b) => b.depth - a.depth);
  const tilePokes = pokes.filter((p) => p.layer === 'tesela');
  const backPokes = pokes.filter((p) => p.layer === 'fondo');
  console.log(`    barrido: ${N * 11} muestras · ${tilePokes.length} tesela · ${backPokes.length} fondo`);
  for (const p of tilePokes.slice(0, 10)) {
    console.log(`    tesela s=${p.s.toFixed(0)}m lat=${p.o}m +${(p.depth * 1000).toFixed(0)}mm @(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
  for (const p of backPokes.slice(0, 5)) {
    console.log(`    fondo s=${p.s.toFixed(0)}m lat=${p.o}m +${(p.depth * 1000).toFixed(0)}mm @(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
  check('las teselas no asoman por la cinta', tilePokes.length === 0,
    tilePokes.length ? `peor +${(tilePokes[0].depth * 1000).toFixed(0)}mm en s=${tilePokes[0].s.toFixed(0)}m` : 'limpio');
  check('el fondo no asoma por la cinta', backPokes.length === 0,
    backPokes.length ? `${backPokes.length} puntos (ver arriba)` : 'limpio');
});

scenario('Nordschleife 1:1: el coche se asienta y rueda en la pista real', (p, _t, _v) => {
  const rt = new RingTerrain();
  rt.setRoughness(p.get('roughness'));
  const v = new Vehicle(p, rt, undefined, 'sport');
  const sp = ringSpawn();
  v.setSpawn(sp.x, sp.z, sp.yaw);
  run(v, 3, NO_INPUT);
  check('valores finitos en la cota real', isFiniteVehicle(v));
  check('las 4 ruedas apoyan en el asfalto real', v.cornerStates.every((s) => s.contact));
  check('superficie bajo el coche: asfalto', v.telemetry.surface === 'asphalt', v.telemetry.surface);
  // Rodar 6 s a medio gas por Döttinger Höhe sin divergir ni hundirse.
  run(v, 6, { ...NO_INPUT, throttle: 0.6 });
  check('rueda por el anillo sin divergir', isFiniteVehicle(v) && v.telemetry.speed > 15,
    `${v.telemetry.speedKph.toFixed(0)} km/h`);
  check('sigue sobre la pista (cota coherente)',
    Math.abs(v.position.y - rt.heightAt(v.position.x, v.position.z) - v.comHeight) < 0.5,
    `y=${v.position.y.toFixed(1)} m`);
});

console.log(`\n${failures === 0 ? '✅ TODAS LAS PRUEBAS PASAN' : `❌ ${failures} PRUEBA(S) FALLAN`}`);
process.exit(failures === 0 ? 0 : 1);
