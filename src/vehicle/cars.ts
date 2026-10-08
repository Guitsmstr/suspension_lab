/**
 * Los tres coches del garaje: cada uno con su geometría, masas y preset de
 * parámetros (el preset se aplica al ParamStore al cambiar de coche; el
 * usuario puede seguir ajustando después en el panel).
 *
 * - `sport`: Tesla Model 3 Long Range AWD (datos: 1847 kg, batalla 2,875 m,
 *   vías ~1,58 m, ~258 kW; el preset de potencia lo deja en ~250 kW).
 * - `offroad`: un 4x4 de estilo baja (alto, pesado, ruedas grandes, 4WD).
 * - `kwid`: Renault Kwid 1.0 (datos: ~775 kg + conductor ≈ 820 kg, 50 kW/68 CV,
 *   batalla 2,422 m, vía 1,41 m — estrechada a 1,23 m por los pasos del
 *   modelo Tripo (ruedas a ±0,615) —, ruedas 165/70 R13, CdM alto de
 *   crossover económico).
 */
import * as THREE from 'three';

export type CarId = 'sport' | 'offroad' | 'kwid';

export interface CarSpec {
  id: CarId;
  /** Nombre corto para el menú y la insignia. */
  name: string;
  badge: string;
  blurb: string;
  /** Masa total [kg] (incluye masas no suspendidas). */
  mass: number;
  /** Altura del CdM sobre el suelo [m]. */
  comHeight: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  unsprungFront: number;
  unsprungRear: number;
  /** Reparto de peso estático al eje delantero. */
  frontShare: number;
  wheelInertiaFront: number;
  wheelInertiaRear: number;
  /** Inercia del chasis [Ixx cabeceo, Iyy guiñada, Izz alabeo]. */
  inertia: [number, number, number];
  /** Puntos bajos de la carrocería en el frame del cuerpo (anti-hundimiento). */
  chassisContacts: Array<[number, number, number]>;
  /** Altura del ojo del conductor para la cámara del capó [m, frame cuerpo]. */
  hoodY: number;
  /** Preset de parámetros que se aplica al elegir el coche. */
  preset: Record<string, number>;
}

export const SPORT_CONTACTS: Array<[number, number, number]> = [
  [0, -0.445, 2.4],
  [-0.7, -0.425, 2.32],
  [0.7, -0.425, 2.32],
  [-0.95, -0.415, 0.9],
  [0.95, -0.415, 0.9],
  [-0.95, -0.415, -0.5],
  [0.95, -0.415, -0.5],
  [0, -0.435, -2.36],
  [-0.7, -0.425, -2.3],
  [0.7, -0.425, -2.3],
];

// El 4x4 pisa 16 cm más alto: los contactos suben con la carrocería y se
// ensanchan con las protecciones de bajos.
const OFFROAD_CONTACTS: Array<[number, number, number]> = [
  [0, -0.5, 2.1],
  [-0.66, -0.455, 2.04],
  [0.66, -0.455, 2.04],
  [-0.9, -0.475, 0.85],
  [0.9, -0.475, 0.85],
  [-0.9, -0.475, -0.45],
  [0.9, -0.475, -0.45],
  [0, -0.465, -2.1],
  [-0.66, -0.455, -2.04],
  [0.66, -0.455, -2.04],
];

/**
 * Kwid Outsider: crossover urbano de tracción delantera (medidas reales del
 * modelo Blender `public/assets/cars/kwid.glb`: batalla 2.42 m, vía 1.42 m,
 * rueda r=0.325 m, ejedelantero +1.02 / trasero -1.40 -> frontShare 0.578).
 * Los contactos cuelgan ~3 cm bajo la geometría (bajos -0.41).
 */
const KWID_CONTACTS: Array<[number, number, number]> = [
  [0, -0.45, 1.62],
  [-0.55, -0.42, 1.58],
  [0.55, -0.42, 1.58],
  [-0.79, -0.41, 0.5],
  [0.79, -0.41, 0.5],
  [-0.79, -0.41, -0.4],
  [0.79, -0.41, -0.4],
  [0, -0.44, -1.88],
  [-0.55, -0.42, -1.84],
  [0.55, -0.42, -1.84],
];

export const CARS: Record<CarId, CarSpec> = {
  sport: {
    id: 'sport',
    name: 'Tesla Model 3',
    badge: '⚡ Tesla · total',
    blurb: 'Berlina eléctrica de tracción total. Pesada, baja y con patada instantánea.',
    mass: 1840,
    comHeight: 0.5,
    wheelbase: 2.87,
    track: 1.6,
    wheelRadius: 0.34,
    unsprungFront: 50,
    unsprungRear: 52,
    frontShare: 0.48,
    wheelInertiaFront: 1.6,
    wheelInertiaRear: 1.7,
    inertia: [2800, 3400, 800],
    chassisContacts: SPORT_CONTACTS,
    hoodY: 1.05,
    preset: {
      fSpring: 40,
      fBump: 3600,
      fRebound: 5550,
      fArb: 20,
      fPreload: 0,
      rSpring: 52,
      rBump: 3350,
      rRebound: 5250,
      rArb: 15,
      rPreload: 0,
      tireMu: 1.05,
      tireVertStiff: 240,
      tireVertDamp: 700,
      tireLoadSens: 0.15,
      enginePower: 1.65,
      driveBias: 0.5,
      brakeStrength: 1.15,
      steerLock: 32,
    },
  },
  offroad: {
    id: 'offroad',
    name: 'Todoterreno 4x4',
    badge: '🛻 Todoterreno · 4x4',
    blurb: 'Pick-up de rally-raid. Alto, blando y con tracción total.',
    mass: 1850,
    comHeight: 0.68,
    wheelbase: 2.9,
    track: 1.78,
    wheelRadius: 0.42,
    unsprungFront: 58,
    unsprungRear: 62,
    frontShare: 0.5,
    wheelInertiaFront: 2.4,
    wheelInertiaRear: 2.6,
    inertia: [2900, 3500, 850],
    chassisContacts: OFFROAD_CONTACTS,
    hoodY: 1.45,
    preset: {
      fSpring: 24,
      fBump: 2800,
      fRebound: 4300,
      fArb: 8,
      fPreload: 12,
      rSpring: 27,
      rBump: 2700,
      rRebound: 4100,
      rArb: 8,
      rPreload: 12,
      tireMu: 0.95,
      tireVertStiff: 170,
      tireVertDamp: 900,
      tireLoadSens: 0.15,
      enginePower: 1.15,
      driveBias: 0.5,
      brakeStrength: 1.1,
      steerLock: 38,
    },
  },
  kwid: {
    id: 'kwid',
    name: 'Kwid Outsider',
    badge: '🚗 Kwid · delantera',
    blurb: 'Crossover urbano de tracción delantera. Ligero y ágil.',
    mass: 820,
    comHeight: 0.55,
    wheelbase: 2.42,
    track: 1.23, // vía estrechada a los pasos del Tripo (±0.615)
    wheelRadius: 0.31,
    unsprungFront: 30,
    unsprungRear: 28,
    frontShare: 0.6,
    wheelInertiaFront: 0.7,
    wheelInertiaRear: 0.65,
    inertia: [1300, 1600, 400],
    chassisContacts: KWID_CONTACTS,
    hoodY: 1.22,
    preset: {
      fSpring: 24,
      fBump: 2600,
      fRebound: 4000,
      fArb: 24,
      fPreload: 0,
      rSpring: 20,
      rBump: 2500,
      rRebound: 3900,
      rArb: 18,
      rPreload: 0,
      tireMu: 0.92,
      tireVertStiff: 200,
      tireVertDamp: 700,
      tireLoadSens: 0.15,
      enginePower: 0.35,
      driveBias: 1,
      brakeStrength: 0.9,
      steerLock: 36,
    },
  },
};

export const CAR_ORDER: CarId[] = ['sport', 'offroad', 'kwid'];

/** Contactos como vectores three.js (la física los necesita en ese formato). */
export function chassisVectors(spec: CarSpec): THREE.Vector3[] {
  return spec.chassisContacts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}
