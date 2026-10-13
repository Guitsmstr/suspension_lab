/**
 * Keyboard + mouse + touch input, normalized to driving controls.
 * Steering is smoothed toward the target so the car is not twitchy.
 *
 * Touch buttons and the tilt (accelerometer) steering write into the public
 * `touch` / `tilt` fields (see `TouchControls`); `update` merges them with
 * the keyboard so both work at the same time.
 */
export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (izq) .. +1 (der)
  handbrake: boolean;
  /** Modo prueba (Shift): libera un 25 % más de dirección (ver `Vehicle.step`). */
  testMode: boolean;
}

const STEER_RATE = 3.2; // unidades/s hacia el objetivo
const STEER_RETURN = 5.0; // unidades/s al centrar

export class Input {
  readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    testMode: false,
  };

  private keys = new Set<string>();
  private pressed = new Set<string>(); // flanco de pulsación (una vez por tecla)
  private steerTarget = 0;

  /** Botones táctiles (los escribe `TouchControls`, los lee `update`). */
  readonly touch = {
    left: false,
    right: false,
    throttle: 0, // 0..1
    brake: 0, // 0..1
    handbrake: false,
  };

  /**
   * Dirección por inclinación (acelerómetro). Cuando `enabled` y hay datos
   * recientes (`active`), sustituye a los botones como objetivo de dirección.
   */
  readonly tilt = {
    enabled: false,
    active: false,
    steer: 0, // -1..1, ya calibrado y con signo aplicado
  };

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Evita el scroll con las flechas / espacio
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      if (e.repeat) return; // el auto-repeat del sistema no re-dispara acciones
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Llamar cada frame con dt en segundos. */
  update(dt: number): void {
    const s = this.state;

    const keyThrottle = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    const keyBrake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    s.throttle = Math.max(keyThrottle, Math.max(0, Math.min(1, this.touch.throttle)));
    s.brake = Math.max(keyBrake, Math.max(0, Math.min(1, this.touch.brake)));
    s.handbrake = this.down('Space') || this.touch.handbrake;
    s.testMode = this.down('ShiftLeft', 'ShiftRight');

    const left = this.down('KeyA', 'ArrowLeft') || this.touch.left;
    const right = this.down('KeyD', 'ArrowRight') || this.touch.right;
    // El acelerómetro manda sobre los botones cuando está activo: da un
    // objetivo analógico (-1..1) en vez de todo/nada.
    this.steerTarget =
      this.tilt.enabled && this.tilt.active
        ? Math.max(-1, Math.min(1, this.tilt.steer))
        : (right ? 1 : 0) - (left ? 1 : 0);

    const rate = this.steerTarget === 0 ? STEER_RETURN : STEER_RATE;
    const diff = this.steerTarget - s.steer;
    const step = rate * dt;
    s.steer += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    s.steer = Math.max(-1, Math.min(1, s.steer));
  }

  /** Devuelve true una sola vez cuando se pulsa la tecla (flanco). */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }
}
