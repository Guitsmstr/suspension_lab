/**
 * Tren motriz: curva de par motor, caja de cambios automática de 6 marchas,
 * diferencial con bloqueo limitado y reparto de par entre ejes.
 */
export interface DrivetrainConfig {
  frontTorqueShare: number; // 0 = tracción trasera, 1 = delantera
  powerScale: number; // multiplicador de par
  /** Marcha atrás: par negativo con la desmultiplicación de reversa. */
  reverse?: boolean;
}

const GEARS = [3.55, 2.2, 1.6, 1.22, 1.0, 0.82];
/** Desmultiplicación de la marcha atrás (≈ 1ª, como en una caja real). */
const REVERSE_RATIO = 3.9;
const FINAL_DRIVE = 3.62;
const DRIVE_EFFICIENCY = 0.92;
const IDLE_RPM = 900;
const REDLINE_RPM = 6800;
const SHIFT_UP_RPM = 6250;
const SHIFT_DOWN_RPM = 2350;
const SHIFT_COOLDOWN = 0.45; // s

/** Curva de par [N·m] en función del régimen [rpm], interpolada linealmente. */
const TORQUE_CURVE: Array<[number, number]> = [
  [700, 130],
  [1200, 215],
  [2000, 285],
  [3000, 322],
  [4300, 340],
  [5200, 328],
  [6000, 298],
  [6800, 252],
  [7400, 190],
];

function curveTorque(rpm: number): number {
  const pts = TORQUE_CURVE;
  if (rpm <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [r1, t1] = pts[i];
    const [r0, t0] = pts[i - 1];
    if (rpm <= r1) return t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0);
  }
  return pts[pts.length - 1][1];
}

export interface WheelTorques {
  /** Par de freno total disponible [N·m] (el vehículo lo reparte por eje). */
  rpm: number;
  gearIndex: number;
  /** Par de tracción total en las ruedas [N·m], repartido por el vehículo. */
  driveTorque: number;
  /** Par de freno motor [N·m] (negativo). */
  engineBrakeTorque: number;
}

export class Drivetrain {
  gearIndex = 0;
  rpm = IDLE_RPM;
  private shiftCooldown = 0;

  reset(): void {
    this.gearIndex = 0;
    this.rpm = IDLE_RPM;
    this.shiftCooldown = 0;
  }

  /**
   * @param dt
   * @param throttle 0..1
   * @param drivenOmega velocidad media de las ruedas motrices [rad/s]
   */
  update(
    dt: number,
    throttle: number,
    drivenOmega: number,
    cfg: DrivetrainConfig,
  ): WheelTorques {
    // Marcha atrás: sin cambios (fija) y par negativo. gearIndex = -1.
    if (cfg.reverse) {
      const wheelRpm = (Math.abs(drivenOmega) * 60) / (2 * Math.PI);
      const rawRpm = wheelRpm * REVERSE_RATIO * FINAL_DRIVE;
      this.rpm = Math.max(IDLE_RPM, Math.min(REDLINE_RPM + 250, rawRpm));
      this.gearIndex = -1;
      this.shiftCooldown = 0;
      const throttleClamped = Math.max(0, Math.min(1, throttle));
      let crankTorque = 0;
      if (throttleClamped > 0.02 && this.rpm < REDLINE_RPM) {
        crankTorque = curveTorque(this.rpm) * throttleClamped * cfg.powerScale;
      }
      const driveTorque = -Math.max(0, crankTorque) * REVERSE_RATIO * FINAL_DRIVE * DRIVE_EFFICIENCY;
      return { rpm: this.rpm, gearIndex: -1, driveTorque, engineBrakeTorque: 0 };
    }

    // Al volver de marcha atrás el índice puede venir en -1: reengancha 1ª.
    if (this.gearIndex < 0) this.gearIndex = 0;
    const gear = GEARS[this.gearIndex];
    // Régimen a partir de las ruedas motrices
    const wheelRpm = (Math.abs(drivenOmega) * 60) / (2 * Math.PI);
    const rawRpm = wheelRpm * gear * FINAL_DRIVE;
    this.rpm = Math.max(IDLE_RPM, Math.min(REDLINE_RPM + 250, rawRpm));

    // Autocambio
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.shiftCooldown <= 0) {
      if (this.rpm > SHIFT_UP_RPM && this.gearIndex < GEARS.length - 1) {
        this.gearIndex++;
        this.shiftCooldown = SHIFT_COOLDOWN;
      } else if (this.rpm < SHIFT_DOWN_RPM && this.gearIndex > 0) {
        this.gearIndex--;
        this.shiftCooldown = SHIFT_COOLDOWN;
      }
    }

    const gearNow = GEARS[this.gearIndex];
    const throttleClamped = Math.max(0, Math.min(1, throttle));

    // Par en el cigüeñal: acelerador * curva, o freno motor cuando no hay
    // aceleración (o al llegar al limitador de régimen)
    let crankTorque: number;
    if (throttleClamped > 0.02 && this.rpm < REDLINE_RPM) {
      crankTorque = curveTorque(this.rpm) * throttleClamped * cfg.powerScale;
    } else {
      crankTorque = -22 * (this.rpm / 1000);
    }

    const driveTorque = Math.max(0, crankTorque) * gearNow * FINAL_DRIVE * DRIVE_EFFICIENCY;
    const engineBrakeTorque = Math.min(0, crankTorque) * gearNow * FINAL_DRIVE;

    return {
      rpm: this.rpm,
      gearIndex: this.gearIndex,
      driveTorque,
      engineBrakeTorque,
    };
  }
}

/**
 * Diferencial: reparte el par del eje entre izquierda y derecha con un
 * factor de bloqueo proporcional a la diferencia de velocidad de giro.
 */
export function splitAxleTorque(
  axleTorque: number,
  omegaLeft: number,
  omegaRight: number,
  lockFactor = 0.35,
): [number, number] {
  const diff = omegaRight - omegaLeft;
  // Tope simétrico al signo del par (en marcha atrás el par es negativo).
  const maxShift = Math.abs(axleTorque) * 0.45;
  const shift = Math.max(-maxShift, Math.min(maxShift, diff * lockFactor * 45));
  return [axleTorque * 0.5 + shift, axleTorque * 0.5 - shift];
}
