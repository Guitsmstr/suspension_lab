/**
 * Superficies del mundo y su agarre relativo.
 *
 * El neumático no agarra igual en todas partes: la fricción la manda la
 * pareja goma/superficie (no solo el compuesto). Valores calibrados con
 * datos reales (ver README "Neumáticos y superficies"):
 *
 * - asfalto ×1.00 — la referencia del compuesto (μ del slider).
 * - tierra  ×0.60 — pista de tierra/grava compactada (Wong/Gillespie 0.4-0.7).
 * - hierba  ×0.40 — césped seco (Engineering Toolbox: 0.35 goma/hierba).
 *
 * Las zonas son analíticas (sin texturas que leer): calzadas de los
 * circuitos, paddock de salida, tramo de badenes y, por defecto, hierba.
 */
import { trackSurfaceSamples, type TrackSurface } from './track';

export type SurfaceKind = 'asphalt' | 'dirt' | 'grass';

/** Factor que multiplica al μ del compuesto según la superficie. */
export const SURFACE_MU: Record<SurfaceKind, number> = {
  asphalt: 1.0,
  dirt: 0.6,
  grass: 0.4,
};

export const SURFACE_LABEL: Record<SurfaceKind, string> = {
  asphalt: 'asfalto',
  dirt: 'tierra',
  grass: 'hierba',
};

/** Tramo de badenes (coherente con Terrain): tierra compactada. */
export const WHOOPS_CENTER_Z = -16;
export const WHOOPS_HALF_WIDTH = 3.2;
/** Paddock de salida (coherente con Terrain): explanada asfaltada. */
export const PADDOCK_RADIUS = 9;

/** Superficie bajo el punto (x, z). Barata: ~500 distancias al cuadrado. */
export function surfaceAt(x: number, z: number): SurfaceKind {
  // Las calzadas mandan sobre todo lo demás (la pista de tierra cubre los
  // badenes donde se solapan, como en la realidad).
  const samples = trackSurfaceSamples();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < s.r * s.r) {
      return trackSurfaceToKind(s.surface);
    }
  }
  if (x * x + z * z < PADDOCK_RADIUS * PADDOCK_RADIUS) return 'asphalt';
  if (Math.abs(z - WHOOPS_CENTER_Z) < WHOOPS_HALF_WIDTH + 1.3 && Math.abs(x) < 48) {
    return 'dirt';
  }
  return 'grass';
}

function trackSurfaceToKind(surface: TrackSurface): SurfaceKind {
  return surface === 'asfalto' ? 'asphalt' : 'dirt';
}

/** μ relativo (0..1+) de la superficie bajo (x, z). */
export function surfaceMuAt(x: number, z: number): number {
  return SURFACE_MU[surfaceAt(x, z)];
}
