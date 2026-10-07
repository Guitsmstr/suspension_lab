/**
 * Parámetros ajustables en vivo desde la UI.
 * Cada especificación define rango, unidad y grupo para generar el panel.
 */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  def: number;
  group: string;
}

export type ParamValues = Record<string, number>;

export const PARAM_SPECS: ParamSpec[] = [
  // ---- Suspensión delantera (valores "en muelle", multiplicados por MR² al volante) ----
  {
    key: 'fSpring',
    label: 'Rigidez del muelle',
    unit: 'N/mm',
    min: 15,
    max: 85,
    step: 0.5,
    def: 30,
    group: 'Suspensión delantera',
  },
  {
    key: 'fBump',
    label: 'Amortiguación compresión',
    unit: 'N·s/m',
    min: 400,
    max: 8000,
    step: 50,
    def: 3100,
    group: 'Suspensión delantera',
  },
  {
    key: 'fRebound',
    label: 'Amortiguación rebote',
    unit: 'N·s/m',
    min: 800,
    max: 14000,
    step: 50,
    def: 4800,
    group: 'Suspensión delantera',
  },
  {
    key: 'fArb',
    label: 'Barra estabilizadora',
    unit: 'N/mm',
    min: 0,
    max: 70,
    step: 0.5,
    def: 20,
    group: 'Suspensión delantera',
  },
  {
    key: 'fPreload',
    label: 'Precarga (altura)',
    unit: 'mm',
    min: -35,
    max: 35,
    step: 1,
    def: 0,
    group: 'Suspensión delantera',
  },

  // ---- Suspensión trasera ----
  {
    key: 'rSpring',
    label: 'Rigidez del muelle',
    unit: 'N/mm',
    min: 15,
    max: 90,
    step: 0.5,
    def: 38,
    group: 'Suspensión trasera',
  },
  {
    key: 'rBump',
    label: 'Amortiguación compresión',
    unit: 'N·s/m',
    min: 400,
    max: 8000,
    step: 50,
    def: 2900,
    group: 'Suspensión trasera',
  },
  {
    key: 'rRebound',
    label: 'Amortiguación rebote',
    unit: 'N·s/m',
    min: 800,
    max: 14000,
    step: 50,
    def: 4550,
    group: 'Suspensión trasera',
  },
  {
    key: 'rArb',
    label: 'Barra estabilizadora',
    unit: 'N/mm',
    min: 0,
    max: 70,
    step: 0.5,
    def: 15,
    group: 'Suspensión trasera',
  },
  {
    key: 'rPreload',
    label: 'Precarga (altura)',
    unit: 'mm',
    min: -35,
    max: 35,
    step: 1,
    def: 0,
    group: 'Suspensión trasera',
  },

  // ---- Neumáticos (compuesto; la superficie multiplica aparte: ver surface.ts) ----
  {
    key: 'tireMu',
    label: 'Agarre del compuesto μ',
    unit: '',
    min: 0.8,
    max: 1.6,
    step: 0.01,
    def: 1.05,
    group: 'Neumáticos',
  },
  {
    key: 'tireVertStiff',
    label: 'Rigidez vertical',
    unit: 'N/mm',
    min: 120,
    max: 520,
    step: 5,
    def: 240,
    group: 'Neumáticos',
  },
  {
    key: 'tireVertDamp',
    label: 'Amortiguación del neumático',
    unit: 'N·s/m',
    min: 100,
    max: 3000,
    step: 25,
    def: 700,
    group: 'Neumáticos',
  },
  {
    key: 'tireLoadSens',
    label: 'Caída de μ con la carga',
    unit: '',
    min: 0.05,
    max: 0.3,
    step: 0.01,
    def: 0.15,
    group: 'Neumáticos',
  },

  // ---- Tren motriz ----
  {
    key: 'enginePower',
    label: 'Par motor',
    unit: '×',
    min: 0.3,
    max: 2,
    step: 0.05,
    def: 1,
    group: 'Tren motriz',
  },
  {
    key: 'driveBias',
    label: 'Reparto de tracción al eje del.',
    unit: '',
    min: 0,
    max: 1,
    step: 0.01,
    def: 0,
    group: 'Tren motriz',
  },
  {
    key: 'brakeStrength',
    label: 'Fuerza de frenado',
    unit: '×',
    min: 0.3,
    max: 2,
    step: 0.05,
    def: 1,
    group: 'Tren motriz',
  },

  // ---- Dirección y entorno ----
  {
    key: 'steerLock',
    label: 'Ángulo máximo de dirección',
    unit: '°',
    min: 15,
    max: 50,
    step: 1,
    def: 32,
    group: 'Dirección y entorno',
  },
  {
    key: 'roughness',
    label: 'Rugosidad del terreno',
    unit: '×',
    min: 0,
    max: 2,
    step: 0.05,
    def: 0.5,
    group: 'Dirección y entorno',
  },
];

export const DEFAULTS: ParamValues = Object.fromEntries(
  PARAM_SPECS.map((s) => [s.key, s.def]),
);

export class ParamStore {
  readonly values: ParamValues = { ...DEFAULTS };
  private listeners = new Set<(key: string, value: number) => void>();

  get(key: string): number {
    return this.values[key] ?? DEFAULTS[key] ?? 0;
  }

  set(key: string, value: number): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    for (const fn of this.listeners) fn(key, value);
  }

  reset(): void {
    for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v);
  }

  /** Aplica el preset de un coche (solo las claves que trae el preset). */
  applyPreset(preset: Record<string, number>): void {
    for (const [k, v] of Object.entries(preset)) {
      if (k in this.values) this.set(k, v);
    }
  }

  onChange(fn: (key: string, value: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
