/**
 * Controles táctiles para teléfono: botones de dirección / pedales / freno de
 * mano + dirección por inclinación (acelerómetro).
 *
 * Solo se muestra en dispositivos táctiles (`pointer: coarse`, toques o
 * `?touch=1`); en escritorio no toca nada. Escribe en `Input.touch` /
 * `Input.tilt`, así que la física no distingue teclado de táctil.
 */
import type { Input } from '../input';

export interface TouchActions {
  onReset: () => void;
  onPause: () => void;
}

/** Inclinación lateral (m/s²) para el tope de dirección: ~23°. */
const TILT_FULL = 4.0;
/** Sin datos del sensor en este tiempo, el tilt deja de mandar. */
const TILT_STALE_MS = 500;

function forceFlag(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('touch') === '1') return true;
    if (q.get('touch') === '0') return false;
  } catch {
    /* sin URL válida: se sigue con la detección normal */
  }
  return null;
}

export function isTouchDevice(): boolean {
  const forced = forceFlag();
  if (forced !== null) return forced;
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    /* matchMedia no disponible: se mira el resto */
  }
  // Reserva sin `pointer: coarse` (navegadores viejos): toque + pantalla
  // pequeña, para no activar los botones en portátiles con pantalla táctil.
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  try {
    return touch && Math.min(window.screen.width, window.screen.height) < 820;
  } catch {
    return touch;
  }
}

type DOEvent = DeviceOrientationEvent & { gamma?: number | null; beta?: number | null };

export class TouchControls {
  readonly isTouch: boolean;
  /** El aparato expone algún sensor de orientación/movimiento. */
  readonly hasSensor: boolean;
  private tiltOn = false;
  private invert = false;
  private base: number | null = null;
  private lastSample = 0;
  private statusTimer = 0;
  private els: Record<string, HTMLElement> = {};

  constructor(
    private readonly input: Input,
    private readonly actions: TouchActions,
  ) {
    this.isTouch = isTouchDevice();
    this.hasSensor =
      typeof window !== 'undefined' &&
      ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window);
    if (!this.isTouch) return;
    this.build();
    if (this.hasSensor) this.watchStale();
  }

  get tiltEnabled(): boolean {
    return this.tiltOn;
  }

  // ---------------- Construcción ----------------

  private build(): void {
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.setAttribute('aria-label', 'Controles táctiles');
    root.innerHTML = `
      <div class="tc-row tc-sys">
        <div class="tc-group">
          <button class="tc-chip tc-tilt-toggle" data-tc="tilt" aria-label="Conducir con el giroscopio">📱 Girar: OFF</button>
          <button class="tc-chip tc-tilt-cal hidden" data-tc="cal" aria-label="Centrar la dirección">🎯</button>
          <button class="tc-chip tc-tilt-inv hidden" data-tc="inv" aria-label="Invertir la dirección">↔️</button>
        </div>
        <div class="tc-group">
          <button class="tc-chip" data-tc="handbrake" aria-label="Freno de mano">🔥 MANO</button>
          <button class="tc-chip" data-tc="reset" aria-label="Reiniciar">↺</button>
          <button class="tc-chip" data-tc="pause" aria-label="Pausa">⏸</button>
        </div>
      </div>
      <div class="tc-row tc-drive">
        <div class="tc-cluster tc-steer">
          <button class="tc-btn tc-left" data-tc="left" aria-label="Girar a la izquierda">◀</button>
          <button class="tc-btn tc-right" data-tc="right" aria-label="Girar a la derecha">▶</button>
        </div>
        <div class="tc-cluster tc-pedals">
          <button class="tc-btn tc-brake" data-tc="brake" aria-label="Frenar">FRENO</button>
          <button class="tc-btn tc-gas" data-tc="gas" aria-label="Acelerar">GAS</button>
        </div>
      </div>
      <div class="tc-row tc-status"><span class="tc-hint">Botones o inclina el móvil</span></div>`;
    document.body.appendChild(root);
    for (const b of root.querySelectorAll<HTMLElement>('[data-tc]')) {
      const key = b.dataset.tc ?? '';
      this.els[key] = b;
    }
    if (!this.hasSensor) this.els['tilt']?.classList.add('hidden');

    // Botones de mantener: pointerdown/up (+cancel/leave/contextmenu).
    this.hold('left', (v) => (this.input.touch.left = v));
    this.hold('right', (v) => (this.input.touch.right = v));
    this.hold('gas', (v) => (this.input.touch.throttle = v ? 1 : 0));
    this.hold('brake', (v) => (this.input.touch.brake = v ? 1 : 0));
    this.hold('handbrake', (v) => (this.input.touch.handbrake = v));

    this.tap('reset', () => this.actions.onReset());
    this.tap('pause', () => this.actions.onPause());
    this.tap('tilt', () => void this.toggleTilt());
    this.tap('cal', () => this.recalibrate());
    this.tap('inv', () => this.toggleInvert());
  }

  /** Mantener pulsado: activa el flag al bajar y lo suelta al subir/cancelar. */
  private hold(key: string, set: (v: boolean) => void): void {
    const el = this.els[key];
    if (!el) return;
    const on = (e: Event): void => {
      e.preventDefault();
      try {
        (e as PointerEvent).pointerId !== undefined && el.setPointerCapture?.((e as PointerEvent).pointerId);
      } catch {
        /* captura no disponible: no pasa nada */
      }
      set(true);
      el.classList.add('on');
    };
    const off = (e: Event): void => {
      e.preventDefault();
      set(false);
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', () => {
      set(false);
      el.classList.remove('on');
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private tap(key: string, fn: () => void): void {
    this.els[key]?.addEventListener('click', (e) => {
      e.preventDefault();
      fn();
    });
  }

  // ---------------- Acelerómetro ----------------

  private async toggleTilt(): Promise<void> {
    if (this.tiltOn) {
      this.setTilt(false);
      return;
    }
    // iOS exige pedir permiso dentro del gesto del usuario.
    try {
      const DOE = window.DeviceOrientationEvent as unknown as
        | { requestPermission?: () => Promise<string> }
        | undefined;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') {
          this.hint('Permiso denegado');
          return;
        }
      }
      const DME = window.DeviceMotionEvent as unknown as
        | { requestPermission?: () => Promise<string> }
        | undefined;
      if (DME && typeof DME.requestPermission === 'function') {
        const res = await DME.requestPermission();
        if (res !== 'granted') {
          this.hint('Permiso denegado');
          return;
        }
      }
    } catch {
      this.hint('Sin acelerómetro');
      return;
    }
    this.base = null; // la próxima muestra calibra el centro
    this.setTilt(true);
    this.attachSensors();
    this.hint('Sujeta y pulsa 🎯');
  }

  private setTilt(on: boolean): void {
    this.tiltOn = on;
    this.input.tilt.enabled = on;
    if (!on) {
      this.input.tilt.active = false;
      this.input.tilt.steer = 0;
    }
    this.els['tilt']?.classList.toggle('on', on);
    if (this.els['tilt']) this.els['tilt'].textContent = on ? '📱 Girar: ON' : '📱 Girar: OFF';
    for (const k of ['cal', 'inv']) this.els[k]?.classList.toggle('hidden', !on);
    document.getElementById('touch-controls')?.classList.toggle('tilting', on);
  }

  private recalibrate(): void {
    this.base = null;
    this.hint('Centrado…');
  }

  private toggleInvert(): void {
    this.invert = !this.invert;
    this.els['inv']?.classList.toggle('on', this.invert);
  }

  private attached = false;
  private attachSensors(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('devicemotion', (e) => this.onMotion(e), { passive: true });
    window.addEventListener('deviceorientation', (e) => this.onOrientation(e as DOEvent), {
      passive: true,
    });
  }

  /** Ángulo de la pantalla: 0 retrato, ±90 apaisado, 180 boca abajo. */
  private screenAngle(): number {
    try {
      const a = window.screen?.orientation?.angle;
      if (typeof a === 'number') return a;
    } catch {
      /* screen.orientation no disponible */
    }
    const w = window.orientation as number | undefined;
    return typeof w === 'number' ? w : 0;
  }

  /**
   * Gravedad lateral en el eje X de la pantalla (m/s²): rota el vector del
   * sensor según la orientación para que funcione en retrato y apaisado.
   */
  private onMotion(e: DeviceMotionEvent): void {
    if (!this.tiltOn) return;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    const a = this.screenAngle();
    let lateral: number;
    if (a === 90 || a === -270) lateral = -(g.y ?? 0);
    else if (a === -90 || a === 270) lateral = g.y ?? 0;
    else if (a === 180) lateral = -(g.x ?? 0);
    else lateral = g.x ?? 0;
    this.pushSample(lateral);
  }

  /** Respaldo si no hay `devicemotion`: gamma/beta (grados) a lateral aprox. */
  private onOrientation(e: DOEvent): void {
    if (!this.tiltOn) return;
    if (this.lastSample > 0 && performance.now() - this.lastSample < 50) return; // manda motion
    const gamma = e.gamma ?? null;
    const beta = e.beta ?? null;
    if (gamma === null && beta === null) return;
    const a = this.screenAngle();
    const deg2acc = 9.81 / 90; // pendiente ≈ g a 90°
    let lateral: number;
    if (a === 90 || a === -270 || a === -90 || a === 270) lateral = ((beta ?? 0) - 90) * deg2acc;
    else lateral = (gamma ?? 0) * deg2acc;
    this.pushSample(lateral);
  }

  private pushSample(lateral: number): void {
    if (!Number.isFinite(lateral)) return;
    if (this.base === null) {
      this.base = lateral;
      this.hint('¡Listo!');
      return;
    }
    const sign = this.invert ? -1 : 1;
    const steer = ((lateral - this.base) * sign) / TILT_FULL;
    this.input.tilt.steer = Math.max(-1, Math.min(1, steer));
    this.input.tilt.active = true;
    this.input.tilt.enabled = true;
    this.lastSample = performance.now();
  }

  /** Si el sensor deja de emitir, los botones vuelven a mandar. */
  private watchStale(): void {
    window.setInterval(() => {
      if (this.tiltOn && this.lastSample > 0 && performance.now() - this.lastSample > TILT_STALE_MS) {
        this.input.tilt.active = false;
      }
    }, 250);
  }

  private hint(text: string): void {
    const el = document.querySelector('#touch-controls .tc-hint');
    if (!el) return;
    el.textContent = text;
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      el.textContent = 'Botones o inclina el móvil';
    }, 1800);
  }
}
