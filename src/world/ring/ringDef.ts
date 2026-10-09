/**
 * Ficha del Nordschleife para la UI (menú, minimapa, crono, aparición).
 *
 * Los puntos son la línea central diezmada (~400 pts): bastan para el
 * encuadre del minimapa, la longitud y el seguimiento del crono. La malla
 * de calzada real (3 m) y la física usan `centerline.ts` directamente.
 */
import { STATION_COUNT, LOOP_LENGTH, ROAD_WIDTH, stationPos, tangentAt } from './centerline';
import type { TrackDef } from '../track';

const DECIMATE = 17; // 6919 / 17 ≈ 407 puntos
const _p = { x: 0, z: 0, y: 0 };

function decimatedPoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < STATION_COUNT; i += DECIMATE) {
    stationPos(i, _p);
    pts.push([Math.round(_p.x * 10) / 10, Math.round(_p.z * 10) / 10]);
  }
  return pts;
}

export const NURBURGRING_DEF: TrackDef = {
  id: 'nurburgring',
  name: 'Nordschleife',
  surface: 'asfalto',
  inspiration: 'Nürburgring Nordschleife · escala 1:1',
  description: 'Bucle Touristenfahrten de 20,8 km y 300 m de desnivel: la Milla Verde, tal cual.',
  badge: '🇩🇪 Nordschleife · asfalto 1:1',
  points: decimatedPoints(),
  width: ROAD_WIDTH,
  // La curva por puntos diezmados recorta ~400 m en las curvas: la longitud
  // real es la del horneado 1:1 (ver LOOP_LENGTH).
  lengthMeters: LOOP_LENGTH,
  edgeLines: true,
  defaultRoughness: 0.6,
};

/** Aparición en la recta de Döttinger Höhe (estación 0 + rumbo). */
export function ringSpawn(): { x: number; z: number; yaw: number } {
  stationPos(0, _p);
  const t = tangentAt(0, { x: 0, z: 0 });
  return { x: _p.x, z: _p.z, yaw: Math.atan2(t.x, t.z) };
}
