/**
 * Crono y reglas de carrera: tiempo por vuelta, mejor vuelta, aviso de
 * dirección contraria y anulación por saltarse la trazada.
 *
 * Todo sale del mismo seguimiento: la muestra del eje (`trackCenterline`)
 * más cercana al coche, con progreso desenrollado (las vueltas atrás no
 * cuentan). La vuelta solo vale si se pisan los 8 sectores en orden: atajar
 * por la hierba deja sectores sin pisar y la anula. Ir marcha atrás de forma
 * sostenida (>12 m en 3 s) levanta el aviso. No toca la física: solo informa.
 */
import type { TrackDef } from './track';
import { trackCenterline } from './track';

const SAMPLES = 400;
const SECTORS = 8;
/** Retroceso sostenido que dispara el aviso [m en 3 s]. */
const WRONG_WAY_METERS = 12;
const WRONG_WAY_WINDOW = 3;

function fmtTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

export class RaceDirector {
  private samples: Array<{ x: number; z: number }> = [];
  /** Longitud de la vuelta [m] (para pasar de muestras a metros). */
  private lapLength = 1;
  private lastIdx = 0;
  /** Progreso desenrollado en unidades de muestra (negativo = hacia atrás). */
  private progress = 0;
  private sectors = new Set<number>();
  /** La vuelta en curso ya no puede valer (teletransporte). */
  private dirtyLap = false;
  private simTime = 0;
  private lapStart = 0;
  private lapCount = 0;
  private last: number | null = null;
  private best: number | null = null;
  private history: Array<{ t: number; p: number }> = [];
  private wrongWay = false;
  private warnUntil = 0;
  private warnText = '';
  private shownTime = '';

  private readonly elTime: HTMLElement | null;
  private readonly elLast: HTMLElement | null;
  private readonly elBest: HTMLElement | null;
  private readonly elLap: HTMLElement | null;
  private readonly elWarn: HTMLElement | null;

  constructor() {
    this.elTime = document.getElementById('lap-time');
    this.elLast = document.getElementById('lap-last');
    this.elBest = document.getElementById('lap-best');
    this.elLap = document.getElementById('lap-count');
    this.elWarn = document.getElementById('race-warn');
  }

  /** Cambia de circuito: recalibra el eje y borra tiempos. */
  setTrack(def: TrackDef): void {
    const pts = trackCenterline(def, SAMPLES);
    this.samples = pts;
    let len = 0;
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.lapLength = Math.max(1, len);
    this.best = null;
    this.last = null;
    this.reset();
  }

  /** Reaparece en la salida: crono a cero, sin ensuciar la mejor vuelta. */
  reset(): void {
    this.lastIdx = 0;
    this.progress = 0;
    this.sectors.clear();
    this.dirtyLap = false;
    this.lapStart = this.simTime;
    this.lapCount = 0;
    this.history.length = 0;
    this.wrongWay = false;
    this.warnUntil = 0;
    this.paint(true);
  }

  update(dt: number, x: number, z: number, speedKph: number): void {
    if (this.samples.length === 0) return;
    this.simTime += dt;
    const n = this.samples.length;

    let best = 1e18;
    let idx = this.lastIdx;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        idx = i;
      }
    }

    let dIdx = idx - this.lastIdx;
    if (dIdx > n / 2) dIdx -= n;
    else if (dIdx < -n / 2) dIdx += n;

    if (Math.abs(dIdx) > n / 4) {
      // Salto (reaparición, menú): la vuelta en curso ya no vale.
      this.dirtyLap = true;
      this.lastIdx = idx;
    } else {
      const before = Math.floor(this.progress / n);
      this.progress += dIdx;
      this.lastIdx = idx;
      const after = Math.floor(this.progress / n);
      if (after > before) this.crossLine();
    }

    this.sectors.add(Math.floor((idx / n) * SECTORS) % SECTORS);

    this.history.push({ t: this.simTime, p: this.progress });
    while (this.history.length > 0 && this.simTime - this.history[0].t > WRONG_WAY_WINDOW) {
      this.history.shift();
    }
    if (this.history.length > 1) {
      const dp = this.history[this.history.length - 1].p - this.history[0].p;
      const meters = (dp / n) * this.lapLength;
      if (!this.wrongWay && meters < -WRONG_WAY_METERS && speedKph > 5) {
        this.wrongWay = true;
      } else if (this.wrongWay && meters > -2) {
        this.wrongWay = false;
      }
    }

    this.paint();
  }

  /** Cruce de meta hacia delante: cierra la vuelta si los sectores cuadran. */
  private crossLine(): void {
    const time = this.simTime - this.lapStart;
    this.lapStart = this.simTime;
    this.lapCount++;
    if (!this.dirtyLap && this.sectors.size >= SECTORS && time > 5) {
      this.last = time;
      if (this.best === null || time < this.best) this.best = time;
    } else {
      this.last = null;
      this.warn('Vuelta no válida — trazada incompleta', 3);
    }
    this.sectors.clear();
    this.dirtyLap = false;
    this.paint(true);
  }

  private warn(text: string, seconds: number): void {
    this.warnText = text;
    this.warnUntil = this.simTime + seconds;
  }

  private paint(force = false): void {
    const current = this.simTime - this.lapStart;
    const txt = fmtTime(current);
    if (force || txt !== this.shownTime) {
      this.shownTime = txt;
      if (this.elTime) this.elTime.textContent = txt;
    }
    if (force) {
      if (this.elLast) this.elLast.textContent = fmtTime(this.last);
      if (this.elBest) this.elBest.textContent = fmtTime(this.best);
      if (this.elLap) this.elLap.textContent = this.lapCount > 0 ? `V${this.lapCount}` : 'V0';
    }
    if (this.elWarn) {
      let msg: string | null = null;
      if (this.wrongWay) msg = '⬅ Dirección contraria';
      else if (this.simTime < this.warnUntil) msg = this.warnText;
      if (msg) {
        this.elWarn.hidden = false;
        if (this.elWarn.textContent !== msg) this.elWarn.textContent = msg;
      } else if (!this.elWarn.hidden) {
        this.elWarn.hidden = true;
      }
    }
  }
}
