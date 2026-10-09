/**
 * Bake de Nürburgring Nordschleife 1:1.
 *
 * Entrada: `.ring-work/ring-raw.json` ({coords:[lon,lat][], elevation:Float[]})
 *   o, si aún no hay elevación, el `.geojson` directo (elevación = 0 + aviso).
 * Salida: `src/world/ring/centerline-data.ts` con:
 *   - estaciones uniformes cada 3 m (x, z, elevación suavizada) en metros 1:1,
 *     x = este, z = sur (norte = −z, como el resto del proyecto);
 *   - curvatura firmada por estación (para pianos/guardarraíles en fase 2);
 *   - rejilla gruesa de elevación base (64 m) para el terreno lejano;
 *   - metadatos (longitud, bbox, origen WGS84, procedencia).
 *
 * Uso: `node scripts/bake-ring.mjs [--reverse]`
 *   --reverse invierte el sentido (ver NOTA_SENTIDO abajo).
 *
 * NOTA_SENTIDO: el trazado GeoJSON viene en un orden concreto; el sentido
 * correcto de carrera (Döttinger Höhe → meta → subida a Antoniusbuche) se
 * verifica con el perfil de elevación: los primeros 6 km deben BAJAR en neto
 * hacia Breidscheid. Si suben, re-hornear con --reverse.
 *
 * Procedencia de los datos: traza central de
 * maciejb2k/nurburgring-nordschleife-geojson (Touristenfahrten, ~3004 pts,
 * longitud medida 20757 m ≈ 20,8 km oficiales 1:1) + elevación SRTM vía
 * open-meteo. Ver atribución en `src/world/ring/centerline.ts`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const WORK = new URL('../.ring-work/', import.meta.url);
const OUT = new URL('../src/world/ring/centerline-data.ts', import.meta.url);
const REVERSE = process.argv.includes('--reverse');

const R_EARTH = 6371000;
const STEP = 3; // remuestreo uniforme [m]
const GRID_CELL = 64; // rejilla base [m]
const GRID_MARGIN = 900; // margen alrededor del bbox [m]

function loadInput() {
  const rawPath = new URL('ring-raw.json', WORK);
  if (existsSync(rawPath)) {
    const j = JSON.parse(readFileSync(rawPath, 'utf8'));
    return { coords: j.coords, elev: j.elevation };
  }
  const geoPath = new URL('touristenfahrten.geojson', WORK);
  const g = JSON.parse(readFileSync(geoPath, 'utf8'));
  const coords = g.features[0].geometry.coordinates;
  console.warn('AVISO: sin elevación (ring-raw.json ausente): se hornea plano (y=0).');
  return { coords, elev: new Array(coords.length).fill(0) };
}

const { coords, elev } = loadInput();
console.log(`puntos de entrada: ${coords.length}, con elevación: ${elev.some((e) => e !== 0)}`);

// --- origen: centro del bbox (coordenadas equilibradas ±3,5 km) ---
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const [lon, lat] of coords) {
  if (lon < minLon) minLon = lon;
  if (lon > maxLon) maxLon = lon;
  if (lat < minLat) minLat = lat;
  if (lat > maxLat) maxLat = lat;
}
const lon0 = (minLon + maxLon) / 2;
const lat0 = (minLat + maxLat) / 2;
const cosLat = Math.cos((lat0 * Math.PI) / 180);
const KX = (R_EARTH * Math.PI) / 180;
const toX = (lon) => (lon - lon0) * cosLat * KX;
const toZ = (lat) => -(lat - lat0) * KX; // z+ = sur (norte arriba en el minimapa)

let pts = coords.map(([lon, lat], i) => ({ x: toX(lon), z: toZ(lat), e: elev[i] ?? 0 }));
// Cierra el anillo por construcción (primero ≈ último): quita el duplicado final.
{
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(b.x - a.x, b.z - a.z) < 0.5) pts.pop();
}
if (REVERSE) pts.reverse();
const n = pts.length;

// --- longitud + distancia acumulada ---
const cum = new Float64Array(n + 1);
for (let i = 0; i < n; i++) {
  const a = pts[i], b = pts[(i + 1) % n];
  cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.z - a.z);
}
const totalLen = cum[n];
console.log(`longitud del anillo: ${totalLen.toFixed(0)} m (${n} pts)`);

// --- suavizado de la elevación: mediana (quita atípicos puntuales del DEM,
//     ≤13 m) + gaussiana (el ruido de ladera/píxel vive en 7-30 m; la señal
//     real —rasantes y saltos como Flugplatz o Pflanzgarten— en ≥40 m).
//     El máximo real ronda el 11-12 %: por encima, el bake avisa.
function medianCircular(vals, windowM) {
  const win = Math.max(3, Math.round(windowM / (totalLen / n)) | 1);
  const h = Math.floor(win / 2);
  const out = new Float64Array(n);
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = -h; k <= h; k++) buf.push(vals[((i + k) % n + n) % n]);
    buf.sort((a, b) => a - b);
    out[i] = buf[h];
  }
  return out;
}
function gaussCircular(vals, sigmaM) {
  const step = totalLen / n;
  const h = Math.max(1, Math.ceil((3 * sigmaM) / step));
  const w = [];
  let sum = 0;
  for (let k = -h; k <= h; k++) {
    const v = Math.exp(-0.5 * ((k * step) / sigmaM) ** 2);
    w.push(v);
    sum += v;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -h; k <= h; k++) acc += vals[((i + k) % n + n) % n] * w[k + h];
    out[i] = acc / sum;
  }
  return out;
}
const hasElev = elev.some((e) => e !== 0);
const eRaw = Float64Array.from(pts.map((p) => p.e));
// σ=45 m: el ruido de ladera/píxel del DEM (≤60 m) muere; la señal real
// (rasantes de ≥100 m, desnivel de 300 m) queda intacta. Los saltos cortos
// (Pflanzgarten, ~40 m) se suavizan en fase 1 — se recuperarán con un DEM
// mejor (ver NOTA_DEM). Tras esto la curvatura vertical mínima debe quedar
// en R>150 m (seguro a velocidad media) y la pendiente bajo el 15 %.
const eSm = hasElev ? gaussCircular(medianCircular(eRaw, 21), 45) : eRaw;
{
  let mn = Infinity, mx = -Infinity;
  for (const v of eSm) { if (v < mn) mn = v; if (v > mx) mx = v; }
  console.log(`elevación suavizada: min ${mn.toFixed(1)} max ${mx.toFixed(1)} desnivel ${(mx - mn).toFixed(0)} m`);
  // Tendencia de los primeros 6 km (ver NOTA_SENTIDO).
  const target = 6000;
  let i0 = 0;
  while (cum[i0] < target) i0++;
  console.log(`cota en salida: ${eSm[0].toFixed(1)} → cota a 6 km: ${eSm[i0 % n].toFixed(1)} (dif ${(eSm[i0 % n] - eSm[0]).toFixed(0)} m)`);
}

// --- remuestreo uniforme cada STEP m (posición + elevación) ---
function sampleAt(s) {
  s = ((s % totalLen) + totalLen) % totalLen;
  let lo = 0, hi = n;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = pts[lo % n], b = pts[(lo + 1) % n];
  const segLen = cum[lo + 1] - cum[lo] || 1;
  const f = (s - cum[lo]) / segLen;
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    e: eSm[lo % n] + (eSm[(lo + 1) % n] - eSm[lo % n]) * f,
  };
}
const m = Math.round(totalLen / STEP);
const SX = new Float64Array(m), SZ = new Float64Array(m), SE = new Float64Array(m);
for (let i = 0; i < m; i++) {
  const s = sampleAt((i * totalLen) / m);
  SX[i] = s.x; SZ[i] = s.z; SE[i] = s.e;
}
console.log(`estaciones uniformes: ${m} cada ${(totalLen / m).toFixed(2)} m`);
{
  // Prior de diseño vial: una carretera no supera el ~12 % ni tiene
  // rasantes más cerradas que su velocidad de diseño. Todo lo que exceda
  // esos límites en el perfil medido es error del DEM (dosel del bosque,
  // píxeles de 30 m, deriva lateral de la traza), no la calzada: se
  // relaja iterativamente hasta encajar, conservando la forma macro.
  const DS = totalLen / m;
  const GMAX = 0.12;
  const KMAX = 1 / 150;
  let iter = 0;
  for (; iter < 2000; iter++) {
    let fixed = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const g = (SE[j] - SE[i]) / DS;
      if (g > GMAX) {
        const e = ((g - GMAX) * DS) / 2;
        SE[j] -= e; SE[i] += e; fixed++;
      } else if (g < -GMAX) {
        const e = ((-GMAX - g) * DS) / 2;
        SE[j] += e; SE[i] -= e; fixed++;
      }
    }
    for (let i = 0; i < m; i++) {
      const k = (SE[(i - 1 + m) % m] - 2 * SE[i] + SE[(i + 1) % m]) / (DS * DS);
      if (k > KMAX) {
        SE[i] += ((k - KMAX) * DS * DS) / 2; fixed++;
      } else if (k < -KMAX) {
        SE[i] -= ((-KMAX - k) * DS * DS) / 2; fixed++;
      }
    }
    if (fixed === 0) break;
  }
  console.log(`relajación vial: ${iter} iteraciones`);
}
{
  // Calidad del perfil: el máximo real ronda el 11-12 %; por encima hay ruido.
  let gmax = 0, gbad = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const d = Math.hypot(SX[j] - SX[i], SZ[j] - SZ[i]) || 1;
    const g = Math.abs(SE[j] - SE[i]) / d;
    if (g > gmax) gmax = g;
    if (g > 0.15) gbad++;
  }
  console.log(`pendiente máx entre estaciones: ${(gmax * 100).toFixed(1)} % · tramos >15 %: ${gbad}`);
  if (gmax > 0.14) console.warn('AVISO: pendiente excesiva — revisar el filtrado de elevación.');
  {
    // Curvatura vertical: lo que lanza el coche no es la pendiente sino su
    // cambio (cresta con R < v²/g). Rmin > 150 m = seguro a velocidad media.
    let kmax = 0;
    for (let i = 0; i < m; i++) {
      const a = SE[(i - 1 + m) % m], b = SE[i], c = SE[(i + 1) % m];
      const d = totalLen / m;
      const k = Math.abs(a - 2 * b + c) / (d * d);
      if (k > kmax) kmax = k;
    }
    console.log(`curvatura vertical máx: ${(kmax * 1000).toFixed(2)} ‰/m (Rmin ${(1 / kmax).toFixed(0)} m)`);
  }
}

// --- curvatura firmada (para mobiliario en fase 2): d(yaw)/ds con tangentes a ±12 m ---
const CURV = new Float64Array(m);
for (let i = 0; i < m; i++) {
  const a = i, b = (i + 4) % m, c = (i + 8) % m; // +12/+24 m
  const yaw1 = Math.atan2(SX[b] - SX[a], SZ[b] - SZ[a]);
  const yaw2 = Math.atan2(SX[c] - SX[b], SZ[c] - SZ[b]);
  let d = yaw2 - yaw1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  CURV[i] = d / 12;
}

// --- bbox ---
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < m; i++) {
  if (SX[i] < x0) x0 = SX[i];
  if (SX[i] > x1) x1 = SX[i];
  if (SZ[i] < z0) z0 = SZ[i];
  if (SZ[i] > z1) z1 = SZ[i];
}
console.log(`bbox: x ${x0.toFixed(0)}..${x1.toFixed(0)}  z ${z0.toFixed(0)}..${z1.toFixed(0)}`);

// --- rejilla gruesa de elevación base: vecino más cercano + 3 desenfoques
//     (el terreno lejano sigue la cota de la pista sin dientes de Voronoi) ---
const gx0 = Math.floor((x0 - GRID_MARGIN) / GRID_CELL) * GRID_CELL;
const gz0 = Math.floor((z0 - GRID_MARGIN) / GRID_CELL) * GRID_CELL;
const gnx = Math.ceil((x1 + GRID_MARGIN - gx0) / GRID_CELL) + 1;
const gnz = Math.ceil((z1 + GRID_MARGIN - gz0) / GRID_CELL) + 1;
console.log(`rejilla base: ${gnx}×${gnz} celdas de ${GRID_CELL} m`);
let grid = new Float64Array(gnx * gnz);
for (let j = 0; j < gnz; j++) {
  for (let i = 0; i < gnx; i++) {
    const x = gx0 + i * GRID_CELL, z = gz0 + j * GRID_CELL;
    let best = Infinity, bi = 0;
    for (let k = 0; k < m; k += 2) {
      const dx = x - SX[k], dz = z - SZ[k];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = k; }
    }
    grid[j * gnx + i] = SE[bi];
  }
  if (j % 30 === 0) console.log(`  rejilla fila ${j}/${gnz}`);
}
for (let pass = 0; pass < 3; pass++) {
  const next = new Float64Array(gnx * gnz);
  for (let j = 0; j < gnz; j++) {
    for (let i = 0; i < gnx; i++) {
      let acc = 0, cnt = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = Math.min(gnz - 1, Math.max(0, j + dj));
        for (let di = -1; di <= 1; di++) {
          const ii = Math.min(gnx - 1, Math.max(0, i + di));
          acc += grid[jj * gnx + ii]; cnt++;
        }
      }
      next[j * gnx + i] = acc / cnt;
    }
  }
  grid = next;
}

// --- emisión ---
const r2 = (v) => (Math.round(v * 100) / 100).toString();
const r4 = (v) => (Math.round(v * 10000) / 10000).toString();
const arr = (a, f) => Array.from(a, f).join(',');
const out =
  `/**\n` +
  ` * Geometría 1:1 del Nürburgring Nordschleife (bucle Touristenfahrten).\n` +
  ` * GENERADO por scripts/bake-ring.mjs — no editar a mano.\n` +
  ` *\n` +
  ` * - ${m} estaciones uniformes cada ${(totalLen / m).toFixed(2)} m, ` +
  `longitud total ${totalLen.toFixed(0)} m (oficial: 20832 m).\n` +
  ` * - x = este [m], z = sur [m] (norte = −z), origen WGS84 lon ${lon0.toFixed(6)} lat ${lat0.toFixed(6)}.\n` +
  ` * - y = cota SRTM (open-meteo) suavizada [m${hasElev ? '' : ' — PENDIENTE: horneado sin elevación'}].\n` +
  ` * - Procedencia: traza maciejb2k/nurburgring-nordschleife-geojson + SRTM.\n` +
  ` *   © OpenStreetMap contributors (ODbL) — ver centerline.ts.\n` +
  (REVERSE ? ` * - Sentido INVERTIDO con --reverse.\n` : ``) +
  ` */\n` +
  `export const RING_STEP = ${(totalLen / m).toFixed(4)};\n` +
  `export const RING_LENGTH = ${totalLen.toFixed(2)};\n` +
  `export const RING_ORIGIN = { lon: ${lon0.toFixed(6)}, lat: ${lat0.toFixed(6)} };\n` +
  `export const RING_BBOX = { x0: ${x0.toFixed(1)}, x1: ${x1.toFixed(1)}, z0: ${z0.toFixed(1)}, z1: ${z1.toFixed(1)} };\n` +
  `export const RING_REVERSED = ${REVERSE ? 'true' : 'false'};\n` +
  `/** Estaciones: [x0,z0,y0, x1,z1,y1, ...] [m]. */\n` +
  `export const RING_STATIONS: number[] = [${Array.from({ length: m }, (_, i) => `${r2(SX[i])},${r2(SZ[i])},${r2(SE[i])}`).join(',')}];\n` +
  `/** Curvatura firmada por estación [rad/m] (+ = giro a la derecha). */\n` +
  `export const RING_CURVATURE: number[] = [${arr(CURV, r4)}];\n` +
  `export const RING_GRID = { x0: ${gx0}, z0: ${gz0}, nx: ${gnx}, nz: ${gnz}, cell: ${GRID_CELL} };\n` +
  `/** Cota base del terreno lejano [m] (nx×nz, fila = z). */\n` +
  `export const RING_BASE_ELEV: number[] = [${arr(grid, (v) => (Math.round(v * 20) / 20).toString())}];\n`;
writeFileSync(OUT, out);
console.log(`escrito: ${OUT} (${(out.length / 1024).toFixed(0)} KB)`);
