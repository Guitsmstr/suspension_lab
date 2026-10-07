/**
 * Modelo de vehículo multi-cuerpo en tiempo real.
 *
 * Grados de libertad:
 *   - Chasis rígido: 6 DOF (posición + cuaternión, velocidad lineal y angular).
 *   - Cada rueda: 1 DOF vertical (masa no suspendida, "wheel hop") + giro propio.
 *
 * Fuerzas modeladas:
 *   - Muelle + amortiguador con coeficientes distintos en compresión y rebote
 *   - Topes elásticos progresivos (bump/droop stops)
 *   - Barras estabilizadoras (fuerza proporcional a la diferencia de recorrido)
 *   - Neumático: Pacejka simplificado con slip ratio y slip angle combinados
 *   - Transferencia de carga a través del centro de rollo y geometría anti-dive/anti-squat
 *   - Tren motriz (par motor + caja + diferencial), frenos, aerodinámica
 *
 * Integración: semi-implícita de Euler con paso fijo (ver main.ts).
 */
import * as THREE from 'three';
import type { ParamStore } from './params';
import { CARS, chassisVectors, type CarId } from './cars';
import { Drivetrain, splitAxleTorque } from './drivetrain';
import { tireForces, type TireConfig, type TireForces } from './tire';
import {
  BUMP_LIMIT,
  DROOP_LIMIT,
  FRONT_KINEMATICS,
  REAR_KINEMATICS,
  camberAt,
  damperForce,
  stopForce,
  wheelRateAt,
  type AxleKinematics,
} from './suspension';

export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  /** Normal del terreno. Opcional: si falta se usa (0, 1, 0). */
  normalAt?(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Factor de agarre de la superficie (1 = asfalto). Si falta se usa 1. */
  surfaceMuAt?(x: number, z: number): number;
  /** Nombre de la superficie bajo (x, z), para la telemetría. */
  surfaceKindAt?(x: number, z: number): string;
}

/** Obstáculo vertical (roca, tronco): colisionador cilíndrico. */
export interface Obstacle {
  x: number;
  z: number;
  radius: number;
  /** Altura absoluta del borde superior (mundo). */
  top: number;
}

/** Campo de obstáculos consultado por la física. */
export interface ObstacleSampler {
  /** Copia en `out` los obstáculos que pueden tocar un punto en (x, z). */
  near(x: number, z: number, out: Obstacle[]): number;
}

// ---------- Constantes del vehículo ----------
// Valores del deportivo: se mantienen exportados por compatibilidad (tests,
// panel y visual los usan como referencia). El 4x4 vive en `cars.ts` y el
// Vehicle activo expone sus propias dimensiones (ver campos de instancia).
export const CAR_MASS = 1350; // kg
export const COM_HEIGHT = 0.52; // m sobre el suelo
export const WHEELBASE = 2.75; // m
export const TRACK = 1.62; // m
export const WHEEL_RADIUS = 0.34; // m
export const UNSPRUNG_FRONT = 42; // kg por rueda delantera
export const UNSPRUNG_REAR = 46; // kg por rueda trasera
const FRONT_LOAD_SHARE = 0.52; // reparto de peso estático al eje delantero
/** Masa suspendida: el chasis rígido NO incluye las masas no suspendidas. */
export const SPRUNG_MASS = CAR_MASS - 2 * UNSPRUNG_FRONT - 2 * UNSPRUNG_REAR;
/** Masa suspendida por esquina (para las métricas de puesta a punto). */
export const SPRUNG_MASS_FRONT = (SPRUNG_MASS * FRONT_LOAD_SHARE) / 2;
export const SPRUNG_MASS_REAR = (SPRUNG_MASS * (1 - FRONT_LOAD_SHARE)) / 2;
/** Distancia del centro de masas a cada eje (reparto de peso 52/48). */
export const FRONT_AXLE_Z = WHEELBASE * (1 - FRONT_LOAD_SHARE); // +1.32
export const REAR_AXLE_Z = -WHEELBASE * FRONT_LOAD_SHARE; // -1.43
const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const DRAG_AREA = 0.72; // Cd·A [m²]
const LIFT_AREA = 0.55; // Cl·A [m²]
const ROLLING_RESISTANCE = 0.014;
const MAX_BRAKE_TORQUE = 6400; // N·m totales
/** Velocidad máxima marcha atrás [m/s] (~30 km/h, como una reversa real). */
const MAX_REVERSE_SPEED = 8.5;
const HANDBRAKE_TORQUE = 4200; // N·m en el eje trasero
/**
 * Demanda lateral máxima que permite la dirección [g]: por encima de cierta
 * velocidad el tope de giro se recorta para no pedir más que esto. Un turismo
 * real a 70 km/h no admite ni de lejos el tope de parking (pediría ~9 g);
 * 1,6 g deja jugar al límite del neumático (~1 g) sin demandas absurdas.
 */
const MAX_STEER_LAT_G = 1.6;
/** Por debajo de esta velocidad la dirección conserva todo el tope [m/s]. */
const STEER_FULL_LOCK_SPEED = 6;

// ---------- Contacto de la carrocería con el terreno ----------
/**
 * Puntos de la cara inferior de la carrocería, en el frame del cuerpo (y desde
 * el centro de masas). Reproducen la zona baja del visual: deflector, estribos,
 * difusor y esquinas de los paragolpes. Sin ellos el chasis atravesaría el
 * terreno en badenes y pendientes (el coche "se hunde").
 */
export const CHASSIS_CONTACTS: ReadonlyArray<THREE.Vector3> = [
  new THREE.Vector3(0, -0.415, 2.02),
  new THREE.Vector3(-0.62, -0.365, 1.96),
  new THREE.Vector3(0.62, -0.365, 1.96),
  new THREE.Vector3(-0.83, -0.385, 0.8),
  new THREE.Vector3(0.83, -0.385, 0.8),
  new THREE.Vector3(-0.83, -0.385, -0.4),
  new THREE.Vector3(0.83, -0.385, -0.4),
  new THREE.Vector3(0, -0.375, -2.02),
  new THREE.Vector3(-0.62, -0.365, -1.96),
  new THREE.Vector3(0.62, -0.365, -1.96),
];
const BODY_K = 1_800_000; // N/m — rigidez del contacto carrocería/terreno
const BODY_C = 26_000; // N·s/m — amortiguación (≈0,5 de la crítica)
const BODY_FMAX = 90_000; // N — techo de la fuerza normal
const BODY_MU = 0.4; // rozamiento del chasis al raspar
const BODY_CT = 5_000; // N·s/m — rozamiento viscoso tangencial
/**
 * Penetración que se tolera en la carrocería [m]; la que exceda de este valor se
 * corrige geométricamente tras la integración para que el contacto nunca se vea
 * como un hundimiento del coche en el terreno.
 */
const BODY_MAX_PEN = 0.02;

// ---------- Contacto con obstáculos (rocas, troncos) ----------
const OBST_K = 400_000; // N/m
const OBST_C = 10_000; // N·s/m
const OBST_FMAX = 80_000; // N
const OBST_MU = 0.5; // rozamiento contra rocas y troncos
const OBST_CT = 4_000; // N·s/m — rozamiento viscoso tangencial

// ---------- Neumático vertical ----------
/** Techo de la fuerza vertical del neumático (≈3,4× la carga estática por rueda). */
const MAX_TIRE_FZ = 45_000; // N
/** Penetración máxima que alimenta al muelle vertical (evita picos de fuerza). */
const MAX_TIRE_PEN = 0.35; // m
/**
 * Suelo blando: en tierra y hierba el neumático se hunde (la goma deja de
 * mandar y aparece la resistencia del suelo, Bekker/Wong). Se modela con más
 * resistencia a la rodadura y menos rigidez vertical (más deflexión = el
 * coche baja unos mm y cuesta moverlo). Referencias: rodadura en hierba
 * ≈0,03-0,05 frente a 0,014 en asfalto.
 */
const SOFT_ROLLING: Record<string, number> = { asphalt: 1, dirt: 2.0, grass: 3.2 };
const SOFT_VERTICAL: Record<string, number> = { asphalt: 1, dirt: 0.85, grass: 0.7 };

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(1, 0, 0);

export interface CornerSpec {
  index: number;
  front: boolean;
  x: number;
  z: number;
  /** Altura del centro de la rueda relativa al CoM en la posición estática. */
  yStatic: number;
  /** Punto de anclaje superior del amortiguador, en el frame del cuerpo. */
  hardpoint: THREE.Vector3;
  unsprungMass: number;
  wheelInertia: number;
  /** Fuerza estática del muelle [N] (precarga). */
  staticLoad: number;
  kin: AxleKinematics;
}

export interface CornerState {
  /** Compresión relativa a la posición estática [m], positiva = comprimido. */
  s: number;
  sdot: number;
  sddot: number;
  wheelOmega: number;
  kappa: number;
  alpha: number;
  steer: number;
  camber: number;
  tireLoad: number;
  tireDeflection: number;
  contact: boolean;
  springForce: number;
  damperForce: number;
  arbForce: number;
}

export interface WheelTelemetry {
  travel: number; // mm, compresión relativa al estático
  travelVel: number; // m/s
  slipRatio: number;
  slipAngle: number; // grados
  tireLoad: number; // N
  steer: number; // grados
  camber: number; // grados
  contact: boolean;
}

export interface VehicleTelemetry {
  speed: number; // m/s
  speedKph: number;
  rpm: number;
  gear: number;
  gLat: number;
  gLong: number;
  roll: number; // grados
  pitch: number; // grados
  /** Superficie bajo el centro del coche ('asphalt' | 'dirt' | 'grass'). */
  surface: string;
  wheels: WheelTelemetry[];
}

interface Corner extends CornerSpec {
  vAttachPrev: THREE.Vector3;
}

function makeCornerState(): CornerState {
  return {
    s: 0,
    sdot: 0,
    sddot: 0,
    wheelOmega: 0,
    kappa: 0,
    alpha: 0,
    steer: 0,
    camber: 0,
    tireLoad: 0,
    tireDeflection: 0,
    contact: true,
    springForce: 0,
    damperForce: 0,
    arbForce: 0,
  };
}

export class Vehicle {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  /** Velocidad angular en el frame del cuerpo. */
  readonly omega = new THREE.Vector3();

  readonly corners: Corner[] = [];
  readonly cornerStates: CornerState[] = [];
  readonly telemetry: VehicleTelemetry;
  /** Veces que la red de seguridad ha reaparecido el coche (NaN o similar). */
  resetCount = 0;
  /** Marcha atrás engranada (selector en R). La pone/quita la lógica de pedales. */
  reversing = false;

  private readonly drivetrain = new Drivetrain();
  /** Config por rueda (sin asignaciones en el bucle): cada una lleva su μ de superficie. */
  private readonly cornerTireCfg: TireConfig[] = [0, 1, 2, 3].map(() => ({
    mu: 1.05,
    loadSens: 0.25,
    fzNominal: 4000,
  }));
  private readonly tf: TireForces = { fx: 0, fy: 0 };
  private readonly inertia = new THREE.Vector3(2200, 2750, 620); // Ixx pitch, Iyy yaw, Izz roll
  private readonly spawn = new THREE.Vector3();
  private spawnYaw = 0;

  // --- dimensiones del coche activo (ver `cars.ts`) ---
  carId: CarId = 'sport';
  /** Puntos bajos de la carrocería activa (anti-hundimiento). */
  chassisContacts: THREE.Vector3[] = [];
  comHeight = COM_HEIGHT;
  wheelRadius = WHEEL_RADIUS;
  trackWidth = TRACK;
  wheelbase = WHEELBASE;
  frontAxleZ = WHEELBASE * (1 - 0.52);
  rearAxleZ = -WHEELBASE * 0.52;
  sprungMass = SPRUNG_MASS;
  sprungMassFront = SPRUNG_MASS_FRONT;
  sprungMassRear = SPRUNG_MASS_REAR;
  /** Altura del ojo del conductor para la cámara del capó. */
  hoodY = 1.18;

  // --- acumuladores ---
  private readonly forceAccum = new THREE.Vector3();
  private readonly torqueAccum = new THREE.Vector3();
  private readonly forceApp = new THREE.Vector3(); // sin gravedad, para telemetría

  // --- temporales reutilizados (evitan asignaciones en el bucle de física) ---
  private readonly omegaWorld = new THREE.Vector3();
  private readonly upWorld = new THREE.Vector3();
  private readonly fwdWorld = new THREE.Vector3();
  private readonly pWheel = new THREE.Vector3();
  private readonly pAttach = new THREE.Vector3();
  private readonly pBody = new THREE.Vector3();
  private readonly vBody = new THREE.Vector3();
  private readonly nBody = new THREE.Vector3(0, 1, 0);
  private readonly vAttach = new THREE.Vector3();
  private readonly vWheel = new THREE.Vector3();
  private readonly fwdWheel = new THREE.Vector3();
  private readonly rightWheel = new THREE.Vector3();
  private readonly fLat = new THREE.Vector3();
  private readonly fLong = new THREE.Vector3();
  private readonly appPoint = new THREE.Vector3();
  private readonly armVec = new THREE.Vector3();
  private readonly fVec = new THREE.Vector3();
  private readonly tauBody = new THREE.Vector3();
  private readonly iOmega = new THREE.Vector3();
  private readonly gyro = new THREE.Vector3();
  private readonly dragVec = new THREE.Vector3();
  private readonly downVec = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly qInv = new THREE.Quaternion();
  private readonly qDelta = new THREE.Quaternion();
  private readonly driveTorques: number[] = [0, 0, 0, 0];
  /** Par de freno motor por rueda [N·m, ≤0], repartido como el par motriz. */
  private readonly engineBrakeTorques: number[] = [0, 0, 0, 0];
  /** Búfer sin asignaciones para las consultas al campo de obstáculos. */
  private readonly nearObstacles: Obstacle[] = new Array(24);

  constructor(
    private readonly params: ParamStore,
    private readonly terrain: TerrainSampler,
    private readonly obstacles?: ObstacleSampler,
    carId: CarId = 'sport',
  ) {
    this.telemetry = {
      speed: 0,
      speedKph: 0,
      rpm: 900,
      gear: 1,
      gLat: 0,
      gLong: 0,
      roll: 0,
      pitch: 0,
      surface: 'asphalt',
      wheels: [],
    };

    this.setCar(carId);
  }

  /** Cambia de coche: reconstruye esquinas con la nueva geometría y reaparece. */
  setCar(carId: CarId): void {
    const spec = CARS[carId];
    this.carId = carId;
    this.comHeight = spec.comHeight;
    this.wheelRadius = spec.wheelRadius;
    this.trackWidth = spec.track;
    this.wheelbase = spec.wheelbase;
    this.frontAxleZ = spec.wheelbase * (1 - spec.frontShare);
    this.rearAxleZ = -spec.wheelbase * spec.frontShare;
    this.sprungMass = spec.mass - 2 * spec.unsprungFront - 2 * spec.unsprungRear;
    this.sprungMassFront = (this.sprungMass * spec.frontShare) / 2;
    this.sprungMassRear = (this.sprungMass * (1 - spec.frontShare)) / 2;
    this.inertia.set(spec.inertia[0], spec.inertia[1], spec.inertia[2]);
    this.chassisContacts = chassisVectors(spec);
    this.hoodY = spec.hoodY;

    const g = GRAVITY;
    const loadF = (this.sprungMass * g * spec.frontShare) / 2;
    const loadR = (this.sprungMass * g * (1 - spec.frontShare)) / 2;

    const defs: Array<Omit<Corner, 'vAttachPrev'>> = [
      {
        index: 0,
        front: true,
        x: -spec.track / 2,
        z: this.frontAxleZ,
        yStatic: -spec.comHeight + spec.wheelRadius,
        hardpoint: new THREE.Vector3(-0.52, 0.16, this.frontAxleZ - 0.1),
        unsprungMass: spec.unsprungFront,
        wheelInertia: spec.wheelInertiaFront,
        staticLoad: loadF,
        kin: FRONT_KINEMATICS,
      },
      {
        index: 1,
        front: true,
        x: spec.track / 2,
        z: this.frontAxleZ,
        yStatic: -spec.comHeight + spec.wheelRadius,
        hardpoint: new THREE.Vector3(0.52, 0.16, this.frontAxleZ - 0.1),
        unsprungMass: spec.unsprungFront,
        wheelInertia: spec.wheelInertiaFront,
        staticLoad: loadF,
        kin: FRONT_KINEMATICS,
      },
      {
        index: 2,
        front: false,
        x: -spec.track / 2,
        z: this.rearAxleZ,
        yStatic: -spec.comHeight + spec.wheelRadius,
        hardpoint: new THREE.Vector3(-0.54, 0.18, this.rearAxleZ + 0.1),
        unsprungMass: spec.unsprungRear,
        wheelInertia: spec.wheelInertiaRear,
        staticLoad: loadR,
        kin: REAR_KINEMATICS,
      },
      {
        index: 3,
        front: false,
        x: spec.track / 2,
        z: this.rearAxleZ,
        yStatic: -spec.comHeight + spec.wheelRadius,
        hardpoint: new THREE.Vector3(0.54, 0.18, this.rearAxleZ + 0.1),
        unsprungMass: spec.unsprungRear,
        wheelInertia: spec.wheelInertiaRear,
        staticLoad: loadR,
        kin: REAR_KINEMATICS,
      },
    ];

    this.corners.length = 0;
    this.cornerStates.length = 0;
    for (const d of defs) {
      this.corners.push({ ...d, vAttachPrev: new THREE.Vector3() });
      this.cornerStates.push(makeCornerState());
    }
    this.telemetry.wheels = this.cornerStates.map(() => ({
      travel: 0,
      travelVel: 0,
      slipRatio: 0,
      slipAngle: 0,
      tireLoad: 0,
      steer: 0,
      camber: 0,
      contact: true,
    }));

    this.reset();
  }

  reset(): void {
    const x = this.spawn.x;
    const z = this.spawn.z;

    // Se toma el terreno más alto bajo cualquier rueda o punto de carrocería:
    // si no, el coche aparecería enterrado al spawnear en pendiente.
    let ground = this.terrain.heightAt(x, z);
    for (let i = 0; i < this.corners.length; i++) {
      const c = this.corners[i];
      ground = Math.max(ground, this.terrain.heightAt(x + c.x, z + c.z));
    }
    for (let i = 0; i < this.chassisContacts.length; i++) {
      const p = this.chassisContacts[i];
      ground = Math.max(ground, this.terrain.heightAt(x + p.x, z + p.z) - p.y);
    }

    this.position.set(x, ground + this.comHeight + 0.02, z);
    this.quaternion.setFromAxisAngle(UP, this.spawnYaw);
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.reversing = false;
    this.drivetrain.reset();

    for (let i = 0; i < this.corners.length; i++) {
      const st = this.cornerStates[i];
      st.s = 0;
      st.sdot = 0;
      st.sddot = 0;
      st.wheelOmega = 0;
      st.kappa = 0;
      st.alpha = 0;
      st.steer = 0;
      st.tireLoad = 0;
      st.tireDeflection = 0;
      st.contact = true;
      this.corners[i].vAttachPrev.set(0, 0, 0);
    }
    this.updateTelemetry();
  }

  /** Ajusta la posición (y rumbo) de aparición. `yaw` en radianes, 0 = +Z. */
  setSpawn(x: number, z: number, yaw = 0): void {
    this.spawn.set(x, 0, z);
    this.spawnYaw = yaw;
    this.reset();
  }

  /** Avanza la simulación un paso fijo dt (segundos). */
  step(dt: number, input: { throttle: number; brake: number; steer: number; handbrake: boolean }): void {
    const P = this.params.values;
    const q = this.quaternion;

    this.omegaWorld.copy(this.omega).applyQuaternion(q);
    this.upWorld.copy(UP).applyQuaternion(q);
    this.fwdWorld.copy(FORWARD).applyQuaternion(q);

    this.forceAccum.set(0, 0, 0);
    this.torqueAccum.set(0, 0, 0);
    this.forceApp.set(0, 0, 0);

    // ---------------- Dirección ----------------
    // Tope de giro dependiente de la velocidad: el ángulo que a 5 m/s aparca,
    // a 30 m/s pediría varios g laterales. Se recorta al ángulo que demanda
    // como máximo MAX_STEER_LAT_G (modelo bicicleta: δ = atan(a·L/v²)).
    const lockRad = ((P.steerLock * Math.PI) / 180) * input.steer;
    const vSteer = Math.max(this.velocity.length(), STEER_FULL_LOCK_SPEED);
    const maxByG = Math.atan((MAX_STEER_LAT_G * GRAVITY * this.wheelbase) / (vSteer * vSteer));
    const steerInput = Math.sign(lockRad) * Math.min(Math.abs(lockRad), maxByG);

    // ---------------- Tren motriz ----------------
    const frontShare = P.driveBias;
    let drivenOmega = 0;
    let drivenCount = 0;
    for (let i = 0; i < 4; i++) {
      const isDriven = i < 2 ? frontShare > 0.02 : frontShare < 0.98;
      if (isDriven) {
        drivenOmega += this.cornerStates[i].wheelOmega;
        drivenCount++;
      }
    }
    drivenOmega = drivenCount > 0 ? drivenOmega / drivenCount : 0;

    // Selector automático: con el coche parado, seguir pisando el freno
    // engrana la marcha atrás (como un automático real al mover la palanca
    // a R); el acelerador la quita. En R el pedal S pasa a ser el gas.
    const fwdSpeed = this.velocity.dot(this.fwdWorld);
    const slowEnough = this.velocity.lengthSq() < 0.36 && Math.abs(fwdSpeed) < 0.4;
    if (!this.reversing && input.brake > 0.5 && input.throttle < 0.05 && slowEnough) {
      this.reversing = true;
    } else if (this.reversing && input.throttle > 0.05) {
      this.reversing = false;
    }
    let reverseThrottle = 0;
    if (this.reversing) {
      const backSpeed = Math.max(0, -fwdSpeed);
      reverseThrottle = input.brake * Math.max(0, 1 - backSpeed / MAX_REVERSE_SPEED);
    }

    const dtv = this.drivetrain.update(dt, this.reversing ? reverseThrottle : input.throttle, drivenOmega, {
      frontTorqueShare: frontShare,
      powerScale: P.enginePower,
      reverse: this.reversing,
    });

    const [tfl, tfr] = splitAxleTorque(
      dtv.driveTorque * frontShare,
      this.cornerStates[0].wheelOmega,
      this.cornerStates[1].wheelOmega,
    );
    const [trl, trr] = splitAxleTorque(
      dtv.driveTorque * (1 - frontShare),
      this.cornerStates[2].wheelOmega,
      this.cornerStates[3].wheelOmega,
    );
    this.driveTorques[0] = tfl;
    this.driveTorques[1] = tfr;
    this.driveTorques[2] = trl;
    this.driveTorques[3] = trr;

    // Freno motor por rueda: sigue el mismo camino que el par motriz (solo
    // llega a las ruedas motrices, repartido por el diferencial). Antes se
    // calculaba en el Drivetrain pero nunca se aplicaba: soltar el gas solo
    // dejaba aero + rodadura y el coche retenía menos que uno real.
    const [ebfl, ebfr] = splitAxleTorque(
      dtv.engineBrakeTorque * frontShare,
      this.cornerStates[0].wheelOmega,
      this.cornerStates[1].wheelOmega,
    );
    const [ebrl, ebrr] = splitAxleTorque(
      dtv.engineBrakeTorque * (1 - frontShare),
      this.cornerStates[2].wheelOmega,
      this.cornerStates[3].wheelOmega,
    );
    this.engineBrakeTorques[0] = ebfl;
    this.engineBrakeTorques[1] = ebfr;
    this.engineBrakeTorques[2] = ebrl;
    this.engineBrakeTorques[3] = ebrr;

    const brakeBase = (this.reversing ? 0 : input.brake) * MAX_BRAKE_TORQUE * P.brakeStrength;
    const brakeTorques = [
      brakeBase * 0.31,
      brakeBase * 0.31,
      brakeBase * 0.19 + (input.handbrake ? HANDBRAKE_TORQUE : 0),
      brakeBase * 0.19 + (input.handbrake ? HANDBRAKE_TORQUE : 0),
    ];

    // ---------------- Esquinas ----------------
    for (let i = 0; i < 4; i++) {
      const c = this.corners[i];
      const st = this.cornerStates[i];
      const kin = c.kin;
      const axle = c.front ? 'f' : 'r';

      // --- geometría ---
      this.pWheel.set(c.x, c.yStatic + st.s, c.z).applyQuaternion(q).add(this.position);
      this.pAttach.copy(c.hardpoint).applyQuaternion(q).add(this.position);
      // μ del neumático: compuesto (slider) × superficie bajo la rueda
      // (asfalto 1.0, tierra 0.6, hierba 0.4 — ver surface.ts). Cada rueda
      // lleva la suya: frenar pisando dos superficies genera guiñada real.
      {
        const cfg = this.cornerTireCfg[i];
        cfg.loadSens = P.tireLoadSens;
        cfg.mu = this.terrain.surfaceMuAt
          ? P.tireMu * this.terrain.surfaceMuAt(this.pWheel.x, this.pWheel.z)
          : P.tireMu;
      }
      this.vAttach
        .copy(this.velocity)
        .add(this.tmpA.copy(this.omegaWorld).cross(this.tmpB.copy(this.pAttach).sub(this.position)));

      // aceleración del punto de anclaje sobre el eje de suspensión (excitación de la masa no suspendida)
      const aBase = this.tmpA.copy(this.vAttach).sub(c.vAttachPrev).dot(this.upWorld) / dt;
      c.vAttachPrev.copy(this.vAttach);

      // --- fuerzas de la suspensión ---
      const springRate = P[`${axle}Spring`] * 1000; // N/mm -> N/m
      const preload = P[`${axle}Preload`] / 1000; // mm -> m
      const kWheel = wheelRateAt(springRate, kin, st.s);
      const fSpring = kWheel * (st.s + preload) + c.staticLoad;
      const fDamper = damperForce(st.sdot, P[`${axle}Bump`], P[`${axle}Rebound`], kin, st.s);
      const fStop = stopForce(st.s);
      const arbRate = P[`${axle}Arb`] * 1000;
      const fArb = arbRate * (st.s - this.cornerStates[i ^ 1].s); // FL<->FR, RL<->RR
      const fSus = fSpring + fDamper + fStop + fArb;

      st.springForce = fSpring;
      st.damperForce = fDamper;
      st.arbForce = fArb;

      // --- velocidad del centro de la rueda ---
      this.vWheel
        .copy(this.vAttach)
        .add(this.tmpA.copy(this.omegaWorld).cross(this.tmpB.copy(this.pWheel).sub(this.position)))
        .addScaledVector(this.upWorld, st.sdot);

      // --- obstáculos bajo la rueda (rocas, troncos) ---
      this.applyObstacleContacts(this.pWheel, this.vWheel);

      // --- neumático vertical ---
      const groundY = this.terrain.heightAt(this.pWheel.x, this.pWheel.z);
      const gap = this.pWheel.y - this.wheelRadius - groundY; // >0 = en el aire
      // Suelo blando: más resistencia a la rodadura y menos rigidez vertical.
      const surfKind = this.terrain.surfaceKindAt
        ? this.terrain.surfaceKindAt(this.pWheel.x, this.pWheel.z)
        : 'asphalt';
      const rrMul = SOFT_ROLLING[surfKind] ?? 1;
      const vertMul = SOFT_VERTICAL[surfKind] ?? 1;
      let fTz = 0;
      if (gap < 0) {
        // La penetración se acota: sin ello, un aterrizaje fuerte dispara la
        // fuerza del muelle del neumático y el integrador se vuelve inestable.
        const pen = Math.min(-gap, MAX_TIRE_PEN);
        fTz = Math.min(
          MAX_TIRE_FZ,
          Math.max(0, P.tireVertStiff * vertMul * 1000 * pen - P.tireVertDamp * this.vWheel.y),
        );
      }
      st.tireLoad = fTz;
      st.contact = gap < 0;
      st.tireDeflection = gap < 0 ? -gap : 0;

      // --- dinámica de la masa no suspendida (1 DOF vertical) ---
      st.sddot = (fTz - fSus) / c.unsprungMass - GRAVITY + aBase;
      st.sdot += st.sddot * dt;
      st.s += st.sdot * dt;

      if (st.s > BUMP_LIMIT) {
        st.s = BUMP_LIMIT;
        if (st.sdot > 0) st.sdot = 0;
      } else if (st.s < DROOP_LIMIT) {
        st.s = DROOP_LIMIT;
        if (st.sdot < 0) st.sdot = 0;
      }

      // --- dirección (Ackermann en el eje delantero) ---
      // Signo: la derecha del coche es −X (morro a +Z, Y arriba), así que con
      // steer>0 (tecla D, girar a la derecha) las ruedas deben apuntar hacia
      // −X, es decir, rotar en negativo sobre +Y. La rueda interior del giro a
      // la derecha es la de x<0.
      let steer = 0;
      if (c.front && Math.abs(steerInput) > 1e-5) {
        const radius = this.wheelbase / Math.tan(Math.abs(steerInput));
        const inner = Math.atan(this.wheelbase / Math.max(0.5, radius - this.trackWidth / 2));
        const outer = Math.atan(this.wheelbase / (radius + this.trackWidth / 2));
        const isInner = Math.sign(steerInput) !== Math.sign(c.x);
        steer = -Math.sign(steerInput) * (isInner ? inner : outer);
      }
      st.steer = steer;
      st.camber = camberAt(kin, st.s);

      // --- marco de la rueda y deslizamiento ---
      this.fwdWheel.copy(this.fwdWorld).applyAxisAngle(this.upWorld, steer);
      this.rightWheel.copy(this.upWorld).cross(this.fwdWheel).normalize();

      const vLong = this.vWheel.dot(this.fwdWheel);
      const vLat = this.vWheel.dot(this.rightWheel);
      const vRef = Math.max(Math.abs(vLong), 1.2);
      const kappaTarget = (st.wheelOmega * this.wheelRadius - vLong) / vRef;
      const alphaTarget = Math.atan2(vLat, vRef);

      const speed2d = Math.hypot(vLong, vLat);
      if (speed2d < 2) {
        st.kappa = kappaTarget;
        st.alpha = alphaTarget;
      } else {
        // longitud de relajación: el neumático necesita distancia para generar fuerza
        const rate = Math.min(1, (speed2d / 0.35) * dt);
        st.kappa += (kappaTarget - st.kappa) * rate;
        st.alpha += (alphaTarget - st.alpha) * rate;
      }

      // --- fuerzas del neumático ---
      const f = tireForces(
        fTz,
        st.kappa,
        st.alpha,
        this.cornerTireCfg[i],
        this.tf,
        st.camber,
        c.x < 0 ? -1 : 1,
      );
      let fx = f.fx;
      if (Math.abs(vLong) > 0.3) fx -= ROLLING_RESISTANCE * rrMul * fTz * Math.sign(vLong);
      const fy = f.fy;

      // --- giro de la rueda ---
      st.wheelOmega += ((this.driveTorques[i] - fx * this.wheelRadius) / c.wheelInertia) * dt;
      const engBrake = this.engineBrakeTorques[i];
      if (engBrake < 0 && Math.abs(st.wheelOmega) > 1e-3) {
        // Freno motor: se opone al giro sin invertirlo (como los frenos).
        const dOmega = (-engBrake * dt) / c.wheelInertia;
        st.wheelOmega -= Math.sign(st.wheelOmega) * Math.min(dOmega, Math.abs(st.wheelOmega));
      }
      const brakeTorque = brakeTorques[i];
      if (brakeTorque > 0) {
        const dOmega = (brakeTorque * dt) / c.wheelInertia;
        if (Math.abs(st.wheelOmega) <= dOmega) st.wheelOmega = 0;
        else st.wheelOmega -= Math.sign(st.wheelOmega) * dOmega;
      }

      // --- aplicación de fuerzas al chasis ---
      // Reacción de la suspensión en el punto de anclaje (empuja el chasis hacia arriba)
      this.forceAccum.addScaledVector(this.upWorld, fSus);
      this.forceApp.addScaledVector(this.upWorld, fSus);
      this.armVec.copy(this.pAttach).sub(this.position);
      this.fVec.copy(this.upWorld).multiplyScalar(fSus);
      this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fVec));

      if (Math.abs(fx) > 0.5 || Math.abs(fy) > 0.5) {
        // La fuerza lateral se aplica a la altura del centro de rollo (transferencia
        // de carga lateral); la longitudinal a la altura que fija la geometría
        // anti-dive/anti-squat.
        const hLateral = groundY + kin.rollCenter;
        const hLong = groundY + kin.rollCenter + kin.antiGeometry * (this.comHeight - kin.rollCenter);

        this.fLat.copy(this.rightWheel).multiplyScalar(fy);
        this.fLong.copy(this.fwdWheel).multiplyScalar(fx);

        this.forceAccum.add(this.fLat).add(this.fLong);
        this.forceApp.add(this.fLat).add(this.fLong);

        this.appPoint.set(this.pWheel.x, hLateral, this.pWheel.z);
        this.armVec.copy(this.appPoint).sub(this.position);
        this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fLat));

        this.appPoint.set(this.pWheel.x, hLong, this.pWheel.z);
        this.armVec.copy(this.appPoint).sub(this.position);
        this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fLong));
      }
    }

    // ---------------- Contacto de la carrocería con el terreno ----------------
    // La rueda muestrea el terreno bajo su eje, pero la carrocería es sólida:
    // sin estos puntos el chasis atraviesa el suelo en badenes, pendientes y
    // aterrizajes (el coche "se hunde" visualmente y se queda atascado).
    for (let i = 0; i < this.chassisContacts.length; i++) {
      this.pBody.copy(this.chassisContacts[i]).applyQuaternion(q).add(this.position);
      this.vBody
        .copy(this.velocity)
        .add(this.tmpA.copy(this.omegaWorld).cross(this.tmpB.copy(this.pBody).sub(this.position)));

      this.applyObstacleContacts(this.pBody, this.vBody);

      const pen = this.terrain.heightAt(this.pBody.x, this.pBody.z) - this.pBody.y;
      if (pen <= 0) continue;

      if (this.terrain.normalAt) this.terrain.normalAt(this.pBody.x, this.pBody.z, this.nBody);
      else this.nBody.copy(UP);

      const vn = this.vBody.dot(this.nBody);
      let fn = BODY_K * pen + BODY_C * Math.max(0, -vn);
      if (fn > BODY_FMAX) fn = BODY_FMAX;
      if (fn <= 0) continue;

      this.armVec.copy(this.pBody).sub(this.position);
      this.fVec.copy(this.nBody).multiplyScalar(fn);
      this.forceAccum.add(this.fVec);
      this.forceApp.add(this.fVec);
      this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fVec));

      // Rozamiento tangencial: la carrocería raspa el suelo en vez de patinar
      this.tmpA.copy(this.vBody).addScaledVector(this.nBody, -vn);
      const vTan = this.tmpA.length();
      if (vTan > 1e-4) {
        const ft = Math.min(BODY_MU * fn, BODY_CT * vTan);
        this.fVec.copy(this.tmpA).multiplyScalar(-ft / vTan);
        this.forceAccum.add(this.fVec);
        this.forceApp.add(this.fVec);
        this.torqueAccum.add(this.tmpB.copy(this.armVec).cross(this.fVec));
      }
    }

    // ---------------- Aerodinámica ----------------
    const speed = this.velocity.length();
    if (speed > 0.05) {
      const qDyn = 0.5 * AIR_DENSITY * speed * speed;
      this.dragVec.copy(this.velocity).normalize().multiplyScalar(-qDyn * DRAG_AREA);
      this.downVec.copy(this.upWorld).multiplyScalar(-qDyn * LIFT_AREA);
      this.forceAccum.add(this.dragVec).add(this.downVec);
      this.forceApp.add(this.dragVec).add(this.downVec);
    }

    // ---------------- Gravedad + integración ----------------
    // La gravedad actúa sobre la masa suspendida; las masas no suspendidas
    // llevan la suya propia en su ecuación vertical.
    this.forceAccum.y -= this.sprungMass * GRAVITY;

    this.velocity.addScaledVector(this.forceAccum, dt / this.sprungMass);
    this.position.addScaledVector(this.velocity, dt);

    // Rotacional en el frame del cuerpo: I·ω̇ = τ - ω × (I·ω)
    this.qInv.copy(q).invert();
    this.tauBody.copy(this.torqueAccum).applyQuaternion(this.qInv);
    const I = this.inertia;
    this.iOmega.set(this.omega.x * I.x, this.omega.y * I.y, this.omega.z * I.z);
    this.gyro.copy(this.omega).cross(this.iOmega);
    this.omega.x += ((this.tauBody.x - this.gyro.x) / I.x) * dt;
    this.omega.y += ((this.tauBody.y - this.gyro.y) / I.y) * dt;
    this.omega.z += ((this.tauBody.z - this.gyro.z) / I.z) * dt;

    this.qDelta
      .set(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 1)
      .normalize();
    this.quaternion.multiply(this.qDelta).normalize();

    // Amortiguación numérica mínima para evitar deriva
    this.omega.multiplyScalar(1 - 0.12 * dt);
    if (this.velocity.lengthSq() < 0.0025 && input.throttle < 0.02) {
      this.velocity.multiplyScalar(0.92);
    }

    // ---------------- Corrección de penetración de la carrocería ----------------
    // Las fuerzas penales solas dejan penetración transitoria en los impactos
    // fuertes; se recupera el exceso para que el coche nunca se vea hundido.
    let maxPen = 0;
    let nX = 0;
    let nY = 1;
    let nZ = 0;
    for (let i = 0; i < this.chassisContacts.length; i++) {
      this.pBody.copy(this.chassisContacts[i]).applyQuaternion(q).add(this.position);
      const pen = this.terrain.heightAt(this.pBody.x, this.pBody.z) - this.pBody.y;
      if (pen > maxPen) {
        maxPen = pen;
        if (this.terrain.normalAt) {
          this.terrain.normalAt(this.pBody.x, this.pBody.z, this.nBody);
          nX = this.nBody.x;
          nY = this.nBody.y;
          nZ = this.nBody.z;
        } else {
          nX = 0;
          nY = 1;
          nZ = 0;
        }
      }
    }
    if (maxPen > BODY_MAX_PEN) {
      const lift = (maxPen - BODY_MAX_PEN) * 0.8;
      this.position.x += nX * lift;
      this.position.y += nY * lift;
      this.position.z += nZ * lift;
      // Se amortigua el avance hacia el suelo: la proyección no debe añadir energía
      const vn = this.velocity.x * nX + this.velocity.y * nY + this.velocity.z * nZ;
      if (vn < 0) {
        this.velocity.x -= nX * vn * 0.6;
        this.velocity.y -= nY * vn * 0.6;
        this.velocity.z -= nZ * vn * 0.6;
      }
    }

    if (!this.isFiniteState()) {
      // Red de seguridad: un choque numérico deja el coche colgado en NaN.
      this.resetCount++;
      this.reset();
      return;
    }

    this.updateTelemetry();
    this.telemetry.rpm = dtv.rpm;
    this.telemetry.gear = this.reversing ? 0 : dtv.gearIndex + 1;
    this.telemetry.speed = speed;
    this.telemetry.speedKph = speed * 3.6;
  }

  /** Empuja un punto del vehículo fuera de los obstáculos cilíndricos cercanos. */
  private applyObstacleContacts(p: THREE.Vector3, v: THREE.Vector3): void {
    const field = this.obstacles;
    if (!field) return;

    const count = field.near(p.x, p.z, this.nearObstacles);
    for (let i = 0; i < count; i++) {
      const o = this.nearObstacles[i];
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const r2 = dx * dx + dz * dz;
      if (r2 >= o.radius * o.radius || p.y > o.top) continue;

      const d = Math.sqrt(Math.max(r2, 1e-8));
      this.nBody.set(dx / d, 0, dz / d);

      const vn = v.x * this.nBody.x + v.z * this.nBody.z;
      let fn = OBST_K * (o.radius - d) + OBST_C * Math.max(0, -vn);
      if (fn > OBST_FMAX) fn = OBST_FMAX;
      if (fn <= 0) continue;

      this.armVec.copy(p).sub(this.position);
      this.fVec.copy(this.nBody).multiplyScalar(fn);
      this.forceAccum.add(this.fVec);
      this.forceApp.add(this.fVec);
      this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fVec));

      // Rozamiento tangencial: el coche no debe deslizar por la roca como si
      // estuviera engrasada.
      this.tmpA.set(v.x - this.nBody.x * vn, v.y, v.z - this.nBody.z * vn);
      const vTan = this.tmpA.length();
      if (vTan > 1e-4) {
        const ft = Math.min(OBST_MU * fn, OBST_CT * vTan);
        this.fVec.copy(this.tmpA).multiplyScalar(-ft / vTan);
        this.forceAccum.add(this.fVec);
        this.forceApp.add(this.fVec);
        this.torqueAccum.add(this.tmpA.copy(this.armVec).cross(this.fVec));
      }
    }
  }

  private isFiniteState(): boolean {
    const p = this.position;
    const v = this.velocity;
    const w = this.omega;
    const q = this.quaternion;
    return (
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.z) &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      Number.isFinite(v.z) &&
      Number.isFinite(w.x) &&
      Number.isFinite(w.y) &&
      Number.isFinite(w.z) &&
      Number.isFinite(q.x) &&
      Number.isFinite(q.y) &&
      Number.isFinite(q.z) &&
      Number.isFinite(q.w)
    );
  }

  private updateTelemetry(): void {
    const t = this.telemetry;

    // Ejes del cuerpo en el mundo: el cuaternión ya incluye cabeceo y alabeo,
    // así que la componente Y del eje derecho es exactamente el alabeo.
    const fwd = this.tmpA.copy(FORWARD).applyQuaternion(this.quaternion);
    const right = this.tmpB.copy(RIGHT).applyQuaternion(this.quaternion);

    // Aceleración sentida por el chasis (sin gravedad), en ejes del cuerpo
    t.gLong = this.forceApp.dot(fwd) / (this.sprungMass * GRAVITY);
    t.gLat = this.forceApp.dot(right) / (this.sprungMass * GRAVITY);

    // Cabeceo positivo = morro arriba · alabeo positivo = cae el lado derecho
    t.pitch = (Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180) / Math.PI;
    t.roll = (-Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI;

    // Superficie bajo el centro del coche (para el HUD y la depuración)
    if (this.terrain.surfaceKindAt) {
      t.surface = this.terrain.surfaceKindAt(this.position.x, this.position.z);
    }

    for (let i = 0; i < this.cornerStates.length; i++) {
      const st = this.cornerStates[i];
      const w = t.wheels[i];
      w.travel = st.s * 1000;
      w.travelVel = st.sdot;
      w.slipRatio = st.kappa;
      w.slipAngle = (st.alpha * 180) / Math.PI;
      w.tireLoad = st.tireLoad;
      w.steer = (st.steer * 180) / Math.PI;
      w.camber = (st.camber * 180) / Math.PI;
      w.contact = st.contact;
    }
  }
}
