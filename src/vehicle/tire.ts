/**
 * Modelo de neumático: fórmula mágica de Pacejka simplificada con
 * combinación longitudinal/lateral mediante elipse de fricción y
 * sensibilidad a la carga.
 *
 *   Fx0(κ) = D·sin(Cx·atan(Bx·κ))
 *   Fy0(α) = -D·sin(Cy·atan(By·α))
 *
 * Bx/By se derivan del punto de deslizamiento de pico (κ_peak, α_peak).
 *
 * Calibración con datos reales (ver README "Neumáticos y superficies"):
 * - pico lateral a ~7.7° (turismos 6-10°; Milliken & Milliken, RCVD),
 * - pico longitudinal a κ ≈ 11.5 % (calle 8-15 %),
 * - rigidez inicial ≈ 20·μ·Fz (familia Pacejka: B·C·D con B≈10-13, C≈1.3-1.65),
 * - sensibilidad a la carga potencial: F ∝ Fz^0.85 (Milliken: μ cae ~12 %
 *   al duplicar la carga: 1.10 → 0.97).
 */
export interface TireConfig {
  mu: number; // agarre máximo (pico μ en asfalto, a carga nominal)
  /** Déficit del exponente de carga: F ∝ Fz^(1-loadSens) (real 0.1-0.2). */
  loadSens: number;
  fzNominal: number; // carga de referencia [N]
}

export const KAPPA_PEAK = 0.115; // slip ratio donde aparece el pico
export const ALPHA_PEAK = 0.135; // ángulo de deslizamiento de pico [rad] (~7.7°)

const CX = 1.62; // factor de forma longitudinal
const CY = 1.4; // factor de forma lateral
const BX = Math.tan(Math.PI / (2 * CX)) / KAPPA_PEAK;
const BY = Math.tan(Math.PI / (2 * CY)) / ALPHA_PEAK;

export interface TireForces {
  fx: number;
  fy: number;
}

const EMPTY: TireForces = { fx: 0, fy: 0 };

/**
 * @param fz    carga vertical en el neumático [N], >= 0
 * @param kappa slip ratio = (ω·R - v_long) / |v_long|ref
 * @param alpha ángulo de deslizamiento [rad], positivo = desliza hacia la derecha
 */
export function tireForces(
  fz: number,
  kappa: number,
  alpha: number,
  cfg: TireConfig,
  out: TireForces = { fx: 0, fy: 0 },
): TireForces {
  if (fz <= 0) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }

  // Sensibilidad a la carga (ley potencial, no lineal): el μ efectivo cae
  // con la carga como (Fz/Fz0)^-loadSens. Con loadSens = 0.15, duplicar la
  // carga deja el 90 % del μ (Milliken & Milliken, RCVD fig. 2.9: 1.10→0.97).
  const ratio = fz / cfg.fzNominal;
  const loadFactor = Math.max(0.5, Math.min(1.35, Math.pow(ratio, -cfg.loadSens)));
  const D = cfg.mu * fz * loadFactor;

  // Fuerza de cada eje con su propia curva de Pacejka
  const fx0 = D * Math.sin(CX * Math.atan(BX * kappa));
  const fy0 = -D * Math.sin(CY * Math.atan(BY * alpha));

  // Elipse de fricción: la combinación no puede superar la capacidad del neumático
  const combined = Math.hypot(fx0, fy0) / D;
  const scale = combined > 1 ? 1 / combined : 1;

  out.fx = fx0 * scale;
  out.fy = fy0 * scale;
  return out;
}

export const EMPTY_TIRE_FORCES = EMPTY;
