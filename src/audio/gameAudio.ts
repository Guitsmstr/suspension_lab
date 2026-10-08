/**
 * Audio del juego (Web Audio): capas continuas —motor, rodadura, neumáticos,
 * viento— derivadas de la telemetría + one-shots de eventos (suspensión,
 * impactos, UI, cuenta atrás).
 *
 * El módulo solo LEE estado (telemetría, velocidad, inputs): la física no
 * depende de él. Los bucles se arrancan una sola vez y se modulan con
 * ganancias/playbackRate suavizados vía `setTargetAtTime` (sin asignaciones
 * por frame). Los one-shots crean nodos bajo demanda con cooldowns.
 *
 * Ficheros: `public/sfx/` (generados por scripts/gen-sounds.mjs, ver
 * `manifest.json` para ganancias y frecuencia base de cada bucle).
 */
import type { CarId } from '../vehicle/cars';
import type { Vehicle } from '../vehicle/vehicle';

const SFX_DIR = '/sfx';

type LoopName =
  | 'engine_offroad_loop'
  | 'engine_kwid_loop'
  | 'engine_ev_loop'
  | 'roll_asphalt_loop'
  | 'roll_dirt_loop'
  | 'roll_grass_loop'
  | 'tire_squeal_loop'
  | 'wheelspin_loop'
  | 'scrape_loop'
  | 'wind_loop';

type OneShotName =
  | 'susp_bottomout'
  | 'susp_bottomout_heavy'
  | 'susp_clunk'
  | 'land_thump'
  | 'whoops_rumble'
  | 'impact_light'
  | 'impact_heavy'
  | 'rollover'
  | 'ui_click'
  | 'countdown_beep'
  | 'countdown_go';

/** Motor por coche (los bucles de motor tienen fundamental 60 Hz de encendido). */
const ENGINE_BY_CAR: Record<CarId, LoopName> = {
  sport: 'engine_ev_loop',
  offroad: 'engine_offroad_loop',
  kwid: 'engine_kwid_loop',
};

/** Todos los bucles de motor: solo suena el del coche activo. */
const ENGINE_LOOPS: LoopName[] = ['engine_offroad_loop', 'engine_kwid_loop', 'engine_ev_loop'];

const ALL_LOOPS: LoopName[] = [
  'engine_offroad_loop', 'engine_kwid_loop', 'engine_ev_loop',
  'roll_asphalt_loop', 'roll_dirt_loop', 'roll_grass_loop',
  'tire_squeal_loop', 'wheelspin_loop', 'scrape_loop', 'wind_loop',
];

const ALL_ONESHOTS: OneShotName[] = [
  'susp_bottomout', 'susp_bottomout_heavy', 'susp_clunk', 'land_thump', 'whoops_rumble',
  'impact_light', 'impact_heavy', 'rollover', 'ui_click', 'countdown_beep', 'countdown_go',
];

/** Ganancias estáticas de mezcla (equilibrio entre capas). */
const MIX = {
  engine: 0.55,
  roll: 0.6,
  squeal: 0.5,
  wheelspin: 0.45,
  scrape: 0.4,
  wind: 0.5,
  master: 0.9,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface LoopLayer {
  src: AudioBufferSourceNode | null;
  gain: GainNode;
  rate: number;
}

export class GameAudio {
  private mutedFlag = false;
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<LoopName, LoopLayer>();
  private ready = false;
  private carId: CarId = 'sport';

  // Estado derivado para detectar eventos (sin asignaciones por frame)
  private prevVx = 0;
  private prevVz = 0;
  private prevContact = [true, true, true, true];
  private readonly cooldown = new Map<string, number>();
  private slip = 0;

  constructor() {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.ctx = null;
      this.master = null;
      return;
    }
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = MIX.master;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /** Carga todos los buffers y arranca los bucles en silencio. Nunca lanza. */
  async load(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const names = [...ALL_LOOPS, ...ALL_ONESHOTS];
    await Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(`${SFX_DIR}/${name}.wav`);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          // audio no esencial: degradar en silencio
        }
      }),
    );
    for (const name of ALL_LOOPS) {
      const buffer = this.buffers.get(name);
      if (!buffer) continue;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.loops.set(name, { src, gain, rate: 1 });
    }
    this.ready = true;
  }

  /** Reanuda el contexto tras el primer gesto del usuario (política de autoplay). */
  unlock(): void {
    void this.ctx?.resume().catch(() => undefined);
  }

  setCar(id: CarId): void {
    if (id === this.carId) return;
    this.carId = id;
    // Los bucles de motor de los demás coches se apagan YA: no deben quedar
    // congelados con la última ganancia que tuvieron (se superponían).
    for (const name of ENGINE_LOOPS) {
      if (name !== ENGINE_BY_CAR[id]) this.setLoop(name, 0, this.loops.get(name)?.rate ?? 1);
    }
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : MIX.master, this.ctx.currentTime, 0.03);
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedFlag);
    return this.mutedFlag;
  }

  // -------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------

  private play(name: OneShotName, gain = 1, rate = 1, cooldown = 0): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.ready || this.mutedFlag) return false;
    const now = ctx.currentTime;
    const until = this.cooldown.get(name) ?? 0;
    if (now < until) return false;
    const buffer = this.buffers.get(name);
    if (!buffer) return false;
    if (cooldown > 0) this.cooldown.set(name, now + cooldown);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    return true;
  }

  /** Click de UI (botones, sliders, teclas). */
  click(): void {
    this.play('ui_click', 0.5);
  }

  /** Paso de cuenta atrás: 0..2 = bip, 3 = salida. */
  countdownBeep(step: number): void {
    if (step >= 3) this.play('countdown_go', 0.8);
    else this.play('countdown_beep', 0.8);
  }

  // -------------------------------------------------------------------------
  // Actualización por frame
  // -------------------------------------------------------------------------

  update(dt: number, vehicle: Vehicle, opts: { paused: boolean }): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = vehicle.telemetry;
    const speed = t.speed;
    const paused = opts.paused;

    // ---- Motor: tono por rpm (buclado por encendido) + carga ----
    // Solo el bucle del coche activo recibe ganancia; los otros dos se escriben
    // a 0 cada frame (si no, conservan la última ganancia y se superponen).
    const rpmN = clamp((t.rpm - 900) / (6800 - 900), -0.1, 1.15);
    const rate = 0.55 + 1.75 * Math.max(0, rpmN);
    const engineTarget = paused ? 0 : MIX.engine * (0.42 + 0.58 * smoothstep(-0.1, 0.55, rpmN));
    const activeEngine = ENGINE_BY_CAR[this.carId];
    for (const name of ENGINE_LOOPS) {
      this.setLoop(name, name === activeEngine ? engineTarget : 0, rate);
    }

    // ---- Rodadura: superficie cruzada + volumen por velocidad ----
    const surface = t.surface;
    const rollMaster = paused ? 0 : MIX.roll * smoothstep(0.6, 14, speed);
    this.setLoop('roll_asphalt_loop', rollMaster * (surface === 'asphalt' ? 1 : 0.06), 0.85 + 0.35 * smoothstep(0, 30, speed));
    this.setLoop('roll_dirt_loop', rollMaster * (surface === 'dirt' ? 1 : 0.06), 0.85 + 0.35 * smoothstep(0, 30, speed));
    this.setLoop('roll_grass_loop', rollMaster * (surface === 'grass' ? 1 : 0.06), 0.85 + 0.35 * smoothstep(0, 30, speed));

    // ---- Neumáticos: slip combinado de las 4 ruedas ----
    let slipScore = 0;
    let land = -1;
    let landVel = 0;
    let bottom = -1;
    let bottomVel = 0;
    let clunk = 0;
    for (let i = 0; i < t.wheels.length; i++) {
      const w = t.wheels[i];
      const s = Math.max(Math.abs(w.slipAngle) / 6, Math.abs(w.slipRatio) / 0.25);
      if (s > slipScore) slipScore = s;
      // contacto: aterrizajes
      if (w.contact && !this.prevContact[i] && Math.abs(w.travelVel) > 0.35) {
        if (Math.abs(w.travelVel) > landVel) {
          land = i;
          landVel = Math.abs(w.travelVel);
        }
      }
      this.prevContact[i] = w.contact;
      // topes de suspensión
      if (w.travel > 75 && w.travelVel > 0.12 && w.travelVel > bottomVel) {
        bottom = i;
        bottomVel = w.travelVel;
      }
      if (w.travel < -65 && w.travelVel < -0.25 && -w.travelVel > clunk) {
        clunk = -w.travelVel;
      }
    }
    // suavizado del slip para modular las ganancias
    const k = clamp(dt * 12, 0, 1);
    this.slip += (slipScore - this.slip) * k;

    const slipGain = smoothstep(0.75, 1.6, this.slip);
    const speedFactor = smoothstep(2, 9, speed);
    this.setLoop('tire_squeal_loop', paused ? 0 : MIX.squeal * slipGain * speedFactor, 0.85 + 0.4 * clamp(this.slip - 1, 0, 1));
    this.setLoop('wheelspin_loop', paused ? 0 : MIX.wheelspin * slipGain * (1 - 0.75 * speedFactor), 1);

    // ---- Scrape de bajos: rodado extremo ----
    const scrapeScore = Math.max(
      smoothstep(55, 75, Math.abs(t.roll)),
      smoothstep(38, 55, Math.abs(t.pitch)),
    );
    this.setLoop('scrape_loop', paused ? 0 : MIX.scrape * scrapeScore, 1);

    // ---- Viento: crece rápido con la velocidad ----
    this.setLoop('wind_loop', paused ? 0 : MIX.wind * Math.pow(clamp(speed / 42, 0, 1), 2.2), 1);

    // ---- Eventos puntuales ----
    if (!paused) {
      if (land >= 0) {
        this.play('land_thump', clamp(0.4 + landVel * 0.9, 0.4, 1), 0.94 + 0.12 * Math.min(1, landVel), 0.12);
      }
      if (bottom >= 0) {
        const heavy = bottomVel > 0.55;
        this.play(heavy ? 'susp_bottomout_heavy' : 'susp_bottomout', clamp(0.45 + bottomVel, 0.45, 1), 0.96 + 0.08 * Math.min(1, bottomVel), 0.1);
      }
      if (clunk > 0) {
        this.play('susp_clunk', clamp(0.4 + clunk, 0.4, 1), 1, 0.12);
      }

      // Impactos: aceleración horizontal del chasis (Δv por frame)
      const dvx = vehicle.velocity.x - this.prevVx;
      const dvz = vehicle.velocity.z - this.prevVz;
      const accel = Math.sqrt(dvx * dvx + dvz * dvz) / Math.max(dt, 1e-4);
      if (accel > 22) {
        const heavy = accel > 55;
        const gain = clamp(0.45 + accel / 120, 0.45, 1);
        this.play(heavy ? 'impact_heavy' : 'impact_light', gain, 0.94 + 0.12 * Math.random(), 0.16);
      }

      // Vuelco
      if (Math.abs(t.roll) > 72 && speed > 2) {
        this.play('rollover', 0.9, 1, 3);
      }
    }
    this.prevVx = vehicle.velocity.x;
    this.prevVz = vehicle.velocity.z;
  }

  /** Fija objetivo de ganancia/tono de un bucle (suavizado, sin allocs). */
  private setLoop(name: LoopName, gain: number, rate: number): void {
    const layer = this.loops.get(name);
    const ctx = this.ctx;
    if (!layer || !ctx) return;
    const now = ctx.currentTime;
    layer.gain.gain.setTargetAtTime(gain, now, 0.06);
    if (Math.abs(layer.rate - rate) > 0.001) {
      layer.rate = rate;
      layer.src?.playbackRate.setTargetAtTime(rate, now, 0.05);
    }
  }
}
