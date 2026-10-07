/**
 * Keyboard + mouse input, normalized to driving controls.
 * Steering is smoothed toward the target so the car is not twitchy.
 */
export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (izq) .. +1 (der)
  handbrake: boolean;
}

const STEER_RATE = 3.2; // unidades/s hacia el objetivo
const STEER_RETURN = 5.0; // unidades/s al centrar

export class Input {
  readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
  };

  private keys = new Set<string>();
  private pressed = new Set<string>(); // flanco de pulsación (una vez por tecla)
  private steerTarget = 0;

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

    s.throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    s.brake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    s.handbrake = this.down('Space');

    const left = this.down('KeyA', 'ArrowLeft');
    const right = this.down('KeyD', 'ArrowRight');
    this.steerTarget = (right ? 1 : 0) - (left ? 1 : 0);

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
