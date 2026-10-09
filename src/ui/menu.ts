/**
 * Menú principal: garaje (los dos coches), circuitos (los cuatro trazados
 * agrupados por superficie) y cámara. Se abre con `M`, se cierra con `M`,
 * `Esc` o el botón "Conducir".
 */
import { CARS, CAR_ORDER, type CarId } from '../vehicle/cars';
import { TRACKS, TRACK_ORDER, trackLength, type TrackId } from '../world/track';
import type { CameraMode } from '../render/cameraRig';

export interface MenuActions {
  onSelectCar: (id: CarId) => void;
  onSelectTrack: (id: TrackId) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onClose: () => void;
  onVolume: (v: number) => void;
}

const CAMERA_OPTIONS: Array<{ mode: CameraMode; label: string; hint: string }> = [
  { mode: 'chase', label: 'Persecución', hint: 'clásica trasera' },
  { mode: 'hood', label: 'Capó', hint: 'a bordo' },
  { mode: 'orbit', label: 'Órbita', hint: 'libre con ratón' },
];

export class Menu {
  private readonly root: HTMLElement;
  private readonly carCards = new Map<CarId, HTMLElement>();
  private readonly trackCards = new Map<TrackId, HTMLElement>();
  private readonly camBtns = new Map<CameraMode, HTMLElement>();
  private volInput: HTMLInputElement | null = null;
  private volVal: HTMLElement | null = null;

  constructor(private readonly actions: MenuActions) {
    const root = document.getElementById('menu');
    if (!root) throw new Error('No #menu element');
    this.root = root;

    const carsHost = root.querySelector<HTMLElement>('#menu-cars');
    if (carsHost) {
      for (const id of CAR_ORDER) {
        const spec = CARS[id];
        const card = document.createElement('button');
        card.className = 'menu-card';
        card.dataset.car = id;
        card.innerHTML =
          `<div class="menu-card-title">${spec.badge}</div>` + `<div class="menu-card-sub">${spec.blurb}</div>`;
        card.addEventListener('click', () => this.actions.onSelectCar(id));
        carsHost.appendChild(card);
        this.carCards.set(id, card);
      }
    }

    for (const surface of ['asfalto', 'tierra'] as const) {
      const host = root.querySelector<HTMLElement>(surface === 'asfalto' ? '#menu-road' : '#menu-dirt');
      if (!host) continue;
      for (const id of TRACK_ORDER) {
        const def = TRACKS[id];
        if (def.surface !== surface) continue;
        const card = document.createElement('button');
        card.className = 'menu-card';
        card.dataset.track = id;
        const km = (trackLength(def) / 1000).toFixed(2);
        card.innerHTML =
          `<div class="menu-card-title">${def.badge}</div>` +
          `<div class="menu-card-sub">${def.inspiration} · ${km} km · ${def.width} m</div>` +
          `<div class="menu-card-desc">${def.description}</div>`;
        card.addEventListener('click', () => this.actions.onSelectTrack(id));
        host.appendChild(card);
        this.trackCards.set(id, card);
      }
    }

    const camHost = root.querySelector<HTMLElement>('#menu-cams');
    if (camHost) {
      for (const opt of CAMERA_OPTIONS) {
        const btn = document.createElement('button');
        btn.className = 'menu-card menu-card-small';
        btn.innerHTML = `<div class="menu-card-title">${opt.label}</div><div class="menu-card-sub">${opt.hint}</div>`;
        btn.addEventListener('click', () => this.actions.onSelectCamera(opt.mode));
        camHost.appendChild(btn);
        this.camBtns.set(opt.mode, btn);
      }
    }

    root.querySelector('#btn-drive')?.addEventListener('click', () => this.actions.onClose());
    root.addEventListener('click', (e) => {
      if (e.target === root) this.actions.onClose();
    });

    this.volInput = root.querySelector<HTMLInputElement>('#menu-vol');
    this.volVal = root.querySelector<HTMLElement>('#menu-vol-val');
    this.volInput?.addEventListener('input', () => {
      const v = Number(this.volInput?.value ?? 80) / 100;
      this.actions.onVolume(v);
      if (this.volVal) this.volVal.textContent = `${this.volInput?.value ?? 80}%`;
    });
  }

  /** Sincroniza el slider con el volumen real (p. ej. restaurado). */
  setVolume(v: number): void {
    const pct = Math.round(v * 100);
    if (this.volInput) this.volInput.value = String(pct);
    if (this.volVal) this.volVal.textContent = `${pct}%`;
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  toggle(): boolean {
    const willOpen = this.root.classList.contains('hidden');
    this.root.classList.toggle('hidden');
    return willOpen;
  }

  /** Marca la selección activa (coche, circuito y cámara). */
  refresh(car: CarId, track: TrackId, camera: CameraMode): void {
    for (const [id, el] of this.carCards) el.classList.toggle('selected', id === car);
    for (const [id, el] of this.trackCards) el.classList.toggle('selected', id === track);
    for (const [mode, el] of this.camBtns) el.classList.toggle('selected', mode === camera);
  }
}
