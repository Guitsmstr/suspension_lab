/**
 * Panel de control: sliders generados desde PARAM_SPECS, telemetría en vivo
 * (recorridos, cargas, ángulos) y métricas de puesta a punto calculadas
 * (frecuencia de balanceo y amortiguamiento crítico).
 */
import { PARAM_SPECS, ParamStore, type ParamSpec } from '../vehicle/params';
import { rideMetrics, FRONT_KINEMATICS, REAR_KINEMATICS } from '../vehicle/suspension';
import { SPRUNG_MASS_FRONT, SPRUNG_MASS_REAR, type VehicleTelemetry } from '../vehicle/vehicle';

function digitsFor(step: number): number {
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

export interface PanelActions {
  onReset: () => void;
  onPause: () => void;
  onCamera: () => void;
  onHelp: () => void;
  onTrack: () => void;
  onCar: () => void;
  onMenu: () => void;
  onCollapse: () => void;
}

function fmt(v: number, digits = 1): string {
  return v.toFixed(digits);
}

const SURFACE_BADGE: Record<string, string> = {
  asphalt: '🛣 asfalto',
  dirt: '🏜 tierra',
  grass: '🟢 hierba',
};

export class Panel {
  private readonly valueEls = new Map<string, HTMLElement>();
  private readonly inputEls = new Map<string, HTMLInputElement>();
  private readonly specByKey = new Map<string, ParamSpec>();
  private sprungFront = SPRUNG_MASS_FRONT;
  private sprungRear = SPRUNG_MASS_REAR;
  private readonly wheelBars: Array<{ fill: HTMLElement; num: HTMLElement }> = [];
  private readonly statEls = new Map<string, HTMLElement>();
  private readonly tuneEls = new Map<string, HTMLElement>();
  private readonly hudSpeed: HTMLElement | null;
  private readonly hudGear: HTMLElement | null;
  private readonly hudRpm: HTMLElement | null;
  private readonly hudRpmFill: HTMLElement | null;
  private readonly hudSurface: HTMLElement | null;
  private lastTelemetry: VehicleTelemetry | null = null;

  constructor(
    private readonly params: ParamStore,
    actions: PanelActions,
  ) {
    const container = document.getElementById('params');
    if (!container) throw new Error('No #params element');

    let currentGroup = '';
    for (const spec of PARAM_SPECS) {
      if (spec.group !== currentGroup) {
        currentGroup = spec.group;
        const g = document.createElement('div');
        g.className = 'group';
        g.innerHTML = `<h2>${spec.group}</h2>`;
        container.appendChild(g);
      }
      container.appendChild(this.buildParam(spec));
    }

    this.buildTelemetry();
    this.buildWheelBars();
    this.buildTuneSummary();

    this.hudSpeed = document.getElementById('speed');
    this.hudGear = document.getElementById('gear');
    this.hudRpm = document.getElementById('rpm');
    this.hudRpmFill = document.getElementById('rpm-fill');
    this.hudSurface = document.getElementById('surface');

    document.getElementById('btn-reset')?.addEventListener('click', actions.onReset);
    document.getElementById('btn-pause')?.addEventListener('click', actions.onPause);
    document.getElementById('btn-camera')?.addEventListener('click', actions.onCamera);
    document.getElementById('btn-help')?.addEventListener('click', actions.onHelp);
    document.getElementById('btn-track')?.addEventListener('click', actions.onTrack);
    document.getElementById('btn-car')?.addEventListener('click', actions.onCar);
    document.getElementById('btn-menu')?.addEventListener('click', actions.onMenu);
    document.getElementById('btn-collapse')?.addEventListener('click', actions.onCollapse);

    this.params.onChange(() => this.updateTuneSummary());
    this.updateTuneSummary();
  }

  private buildParam(spec: ParamSpec): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'param';

    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = spec.label;

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = `${fmt(spec.def, spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2)} ${spec.unit}`;

    row.append(label, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.def);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.params.set(spec.key, v);
      value.textContent = `${fmt(v, spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2)} ${spec.unit}`;
    });

    wrap.append(row, input);
    this.valueEls.set(spec.key, value);
    this.inputEls.set(spec.key, input);
    this.specByKey.set(spec.key, spec);
    return wrap;
  }

  /** Refresca todos los sliders tras aplicar un preset (cambio de coche). */
  syncFromStore(): void {
    for (const [key, input] of this.inputEls) {
      const spec = this.specByKey.get(key);
      if (!spec) continue;
      const v = this.params.get(key);
      input.value = String(v);
      const value = this.valueEls.get(key);
      if (value) value.textContent = `${fmt(v, digitsFor(spec.step))} ${spec.unit}`;
    }
    this.updateTuneSummary();
  }

  /** Masas suspendidas del coche activo (métricas de balanceo). */
  setSprungMasses(front: number, rear: number): void {
    this.sprungFront = front;
    this.sprungRear = rear;
    this.updateTuneSummary();
  }

  private buildTelemetry(): void {
    const host = document.getElementById('telemetry');
    if (!host) return;
    const stats: Array<[string, string]> = [
      ['roll', 'Alabeo'],
      ['pitch', 'Cabeceo'],
      ['gLat', 'G lateral'],
      ['gLong', 'G longitudinal'],
    ];
    for (const [key, label] of stats) {
      const el = document.createElement('div');
      el.className = 'stat';
      el.innerHTML = `<div class="k">${label}</div><div class="v">–</div>`;
      host.appendChild(el);
      this.statEls.set(key, el.querySelector('.v') as HTMLElement);
    }
  }

  private buildWheelBars(): void {
    const host = document.getElementById('wheel-bars');
    if (!host) return;
    const names = ['Del. izq.', 'Del. der.', 'Tras. izq.', 'Tras. der.'];
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'wheel-row';
      row.innerHTML = `
        <div class="name">${names[i]}</div>
        <div class="bar"><div class="zero"></div><div class="fill"></div></div>
        <div class="num">0 mm</div>`;
      host.appendChild(row);
      this.wheelBars.push({
        fill: row.querySelector('.fill') as HTMLElement,
        num: row.querySelector('.num') as HTMLElement,
      });
    }
    const note = document.createElement('div');
    note.style.cssText = 'color: var(--muted); font-size: 10px; margin-top: 2px;';
    note.textContent = 'Recorrido de suspensión (mm, relativo al estático)';
    host.appendChild(note);
  }

  private buildTuneSummary(): void {
    const host = document.getElementById('wheel-bars');
    if (!host) return;
    const box = document.createElement('div');
    box.style.cssText = 'margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;';
    for (const key of ['tuneF', 'tuneR']) {
      const el = document.createElement('div');
      el.className = 'stat';
      el.innerHTML = '<div class="k">–</div><div class="v">–</div>';
      box.appendChild(el);
      this.tuneEls.set(key, el as HTMLElement);
    }
    host.appendChild(box);
  }

  private updateTuneSummary(): void {
    const p = this.params.values;
    const front = rideMetrics(p.fSpring * 1000, p.fBump, p.fRebound, FRONT_KINEMATICS, this.sprungFront);
    const rear = rideMetrics(p.rSpring * 1000, p.rBump, p.rRebound, REAR_KINEMATICS, this.sprungRear);

    const write = (key: string, title: string, m: typeof front) => {
      const el = this.tuneEls.get(key);
      if (!el) return;
      el.innerHTML = `
        <div class="k">${title}</div>
        <div class="v">${fmt(m.frequency, 2)} <small>Hz</small> · ζ ${fmt(m.zetaBump, 2)}/${fmt(m.zetaRebound, 2)}</div>`;
    };
    write('tuneF', 'Balanceo delantero', front);
    write('tuneR', 'Balanceo trasero', rear);
  }

  setPaused(paused: boolean): void {
    const btn = document.getElementById('btn-pause');
    if (btn) {
      btn.textContent = paused ? 'Continuar (P)' : 'Pausa (P)';
      btn.classList.toggle('active', paused);
    }
  }

  setCameraLabel(label: string): void {
    const btn = document.getElementById('btn-camera');
    if (btn) btn.textContent = `Cámara: ${label} (C)`;
  }

  setTrackLabel(label: string): void {
    const btn = document.getElementById('btn-track');
    if (btn) btn.textContent = `Circuito: ${label} (T)`;
  }

  setCarLabel(label: string): void {
    const btn = document.getElementById('btn-car');
    if (btn) btn.textContent = `Coche: ${label} (V)`;
  }

  /** Contrae/expande el panel dejando solo la cabecera. Devuelve si queda contraído. */
  toggleCollapsed(): boolean {
    const panel = document.getElementById('panel');
    if (!panel) return false;
    const collapsed = panel.classList.toggle('collapsed');
    // La telemetría vive en su propia ventana, pero se muestra y oculta con
    // el menú de suspensiones.
    document.getElementById('telemetry-panel')?.classList.toggle('hidden', collapsed);
    const btn = document.getElementById('btn-collapse');
    if (btn) {
      btn.textContent = collapsed ? '+' : '–';
      btn.title = collapsed ? 'Expandir panel (O)' : 'Contraer panel (O)';
    }
    return collapsed;
  }

  update(t: VehicleTelemetry): void {
    this.lastTelemetry = t;

    // HUD: velocidad, marcha y régimen
    if (this.hudSpeed) this.hudSpeed.textContent = String(Math.round(t.speedKph));
    if (this.hudGear) this.hudGear.textContent = t.gear <= 0 ? 'R' : String(t.gear);
    if (this.hudRpm) this.hudRpm.textContent = String(Math.round(t.rpm));
    if (this.hudRpmFill) {
      this.hudRpmFill.style.width = `${Math.max(0, Math.min(100, (t.rpm / 6800) * 100))}%`;
    }
    if (this.hudSurface) this.hudSurface.textContent = SURFACE_BADGE[t.surface] ?? t.surface;

    const set = (key: string, text: string) => {
      const el = this.statEls.get(key);
      if (el) el.textContent = text;
    };
    set('roll', `${fmt(t.roll, 1)}°`);
    set('pitch', `${fmt(t.pitch, 1)}°`);
    set('gLat', `${fmt(t.gLat, 2)} g`);
    set('gLong', `${fmt(t.gLong, 2)} g`);

    for (let i = 0; i < this.wheelBars.length; i++) {
      const w = t.wheels[i];
      const bar = this.wheelBars[i];
      if (!w || !bar) continue;
      // recorrido: -75 mm (rebote) .. +95 mm (compresión)
      const norm = Math.max(-1, Math.min(1, w.travel / 95));
      const pct = Math.abs(norm) * 50;
      bar.fill.style.width = `${pct}%`;
      bar.fill.style.left = norm >= 0 ? '50%' : `${50 - pct}%`;
      bar.fill.style.background = w.contact ? 'var(--accent)' : 'var(--bad)';
      bar.num.textContent = `${w.travel >= 0 ? '+' : ''}${fmt(w.travel, 0)} mm`;
    }
  }

  get telemetry(): VehicleTelemetry | null {
    return this.lastTelemetry;
  }
}
