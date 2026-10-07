/**
 * Cinemática de una suspensión de doble horquilla.
 *
 * En lugar de resolver las barras como restricciones multibody, usamos el
 * modelo estándar de dinámica de vehículo: relaciones de movimiento
 * instantáneas (motion ratio) alrededor de la posición estática. Esto
 * captura el efecto real de una horquilla:
 *   - la tasa en rueda = rigidez del muelle · MR²
 *   - el camber cambia con el recorrido (camber gain)
 *   - la altura del centro de rollo fija el brazo de momento lateral
 */
export interface AxleKinematics {
  /** Relación recorrido-muelle / recorrido-rueda en la posición estática. */
  motionRatio: number;
  /** Variación del MR por metro de recorrido (rueda sube -> MR cambia). */
  motionRatioSlope: number;
  /** Camber estático [rad], negativo = rueda inclinada hacia el coche. */
  camberStatic: number;
  /** Ganancia de camber [rad/m] de compresión. */
  camberGain: number;
  /** Altura del centro de rollo sobre el suelo [m]. */
  rollCenter: number;
  /** Fracción de la fuerza longitudinal reaccionada por las barras (anti-dive/anti-squat). */
  antiGeometry: number;
}

export const FRONT_KINEMATICS: AxleKinematics = {
  motionRatio: 0.85,
  motionRatioSlope: -0.12,
  camberStatic: -0.031, // -1.8°
  camberGain: -0.62, // rad/m de compresión
  rollCenter: 0.07,
  antiGeometry: 0.35,
};

export const REAR_KINEMATICS: AxleKinematics = {
  motionRatio: 0.9,
  motionRatioSlope: -0.09,
  camberStatic: -0.026, // -1.5°
  camberGain: -0.48,
  rollCenter: 0.12,
  antiGeometry: 0.3,
};

/** Recorrido de trabajo de la suspensión relativo a la posición estática [m]. */
export const BUMP_LIMIT = 0.095;
export const DROOP_LIMIT = -0.075;
/** A partir de aquí entran los topes elásticos (bump stops). */
export const BUMPSTOP_START = 0.055;
export const DROOPSTOP_START = -0.05;

/** Rigidez progresiva de los topes [N/m²] (cuadrática): ~4 kN al llegar al límite. */
const STOP_STIFFNESS = 2_600_000;

export function motionRatioAt(kin: AxleKinematics, s: number): number {
  return Math.max(0.4, kin.motionRatio + kin.motionRatioSlope * s);
}

/** Tasa en rueda [N/m] a partir de la rigidez del muelle [N/m]. */
export function wheelRateAt(springRate: number, kin: AxleKinematics, s: number): number {
  const mr = motionRatioAt(kin, s);
  return springRate * mr * mr;
}

/** Camber actual [rad] según el recorrido de compresión s [m]. */
export function camberAt(kin: AxleKinematics, s: number): number {
  return kin.camberStatic + kin.camberGain * s;
}

/**
 * Fuerza de los topes elásticos [N]. Positiva = empuja la rueda hacia fuera
 * del cuerpo: frena la compresión más allá del límite y, con signo negativo,
 * frena la extensión más allá del límite de droop.
 */
export function stopForce(s: number): number {
  if (s > BUMPSTOP_START) {
    const x = s - BUMPSTOP_START;
    return STOP_STIFFNESS * x * Math.abs(x);
  }
  if (s < DROOPSTOP_START) {
    const x = s - DROOPSTOP_START; // negativo -> fuerza negativa (tira de la rueda)
    return STOP_STIFFNESS * x * Math.abs(x);
  }
  return 0;
}

/**
 * Fuerza del amortiguador [N] según la velocidad de compresión [m/s].
 * Compresión y rebote tienen coeficientes distintos (típico en un amortiguador
 * real: más fuerza en rebote que en compresión).
 */
export function damperForce(
  sdot: number,
  bumpCoeff: number,
  reboundCoeff: number,
  kin: AxleKinematics,
  s: number,
): number {
  const mr2 = motionRatioAt(kin, s) ** 2;
  return (sdot >= 0 ? bumpCoeff : reboundCoeff) * mr2 * sdot;
}

/**
 * Calcula la frecuencia de balanceo [Hz] y el ratio de amortiguamiento
 * crítico para una esquina, para mostrarlos en la UI.
 */
export function rideMetrics(
  springRate: number,
  bumpCoeff: number,
  reboundCoeff: number,
  kin: AxleKinematics,
  sprungMass: number,
): { frequency: number; zetaBump: number; zetaRebound: number } {
  const kw = wheelRateAt(springRate, kin, 0);
  const frequency = Math.sqrt(kw / sprungMass) / (2 * Math.PI);
  const critical = 2 * Math.sqrt(kw * sprungMass);
  const mr2 = kin.motionRatio ** 2;
  return {
    frequency,
    zetaBump: (bumpCoeff * mr2) / critical,
    zetaRebound: (reboundCoeff * mr2) / critical,
  };
}
