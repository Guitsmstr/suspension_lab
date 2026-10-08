#!/usr/bin/env node
// Analizador visual de los SFX generados.
//
// Escribe en `.smoke/sfx/` un PNG por grupo con, para cada sonido:
//   - envolvente (min/max por columna a lo largo de todo el fichero)
//   - zoom temporal de 25 ms centrado en el pico (forma del pulso)
//   - espectrograma log-frecuencia 40 Hz … 20 kHz (dB)
// e imprime una tabla de métricas (crest, centroide, planitud, bandas,
// ataque, decaimiento) para juzgar el timbre frente a lo esperado.
//
// Uso:
//   node scripts/sfx-analyze.mjs                     # analiza public/sfx (por grupos)
//   node scripts/sfx-analyze.mjs --only engine       # solo sonidos que contengan "engine"
//   node scripts/sfx-analyze.mjs --dir <ruta> [--crop s]  # analiza WAVs arbitrarios (referencias),
//                                                         recortando s segundos alrededor del pico

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const _srDefault = 48000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SFX_DIR = join(ROOT, 'public', 'sfx');
const OUT_DIR = join(ROOT, '.smoke', 'sfx');

const W = 640;          // ancho de imagen
const ENV_H = 40;       // tira de envolvente
const ZOOM_H = 40;      // tira de zoom temporal
const SPEC_H = 150;     // espectrograma
const GAP = 10;
const BLOCK_H = ENV_H + ZOOM_H + SPEC_H + GAP;
const FFT_SIZE = 2048;
const F_MIN = 40, F_MAX = 20000;

// Tasa de muestreo activa (por fichero; el WAV la trae en su cabecera).
let _sr = 48000;

const GROUPS = [
  ['motor', 'grp-motor'],
  ['rodadura', 'grp-rodadura'],
  ['neumático', 'grp-neumatico'],
  ['suspensión', 'grp-suspension'],
  ['chasis', 'grp-chasis'],
  ['impacto', 'grp-impacto'],
  ['ambiente', 'grp-ambiente'],
  ['ui', 'grp-ui'],
];

// ---------------------------------------------------------------------------
// PNG (sin dependencias)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(path, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(path, Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------
// WAV + FFT
// ---------------------------------------------------------------------------

function readWav(path) {
  const b = readFileSync(path);
  // localizar 'fmt ' para leer la tasa de muestreo
  let off = 12, sr = 48000, channels = 1, bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(off + 10);
      sr = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
      break;
    }
    off += 8 + size + (size % 2);
  }
  const dataOff = 44;
  const bytesPerSample = bits / 8;
  const frames = Math.floor((b.length - dataOff) / (bytesPerSample * channels));
  const s = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bytesPerSample;
      v += b.readInt16LE(o) / 32768;
    }
    s[i] = v / channels;
  }
  return { samples: s, sr };
}

function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / n;
  return mag;
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

const HANN = hann(FFT_SIZE);

function frameMag(samples, start) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = start + i;
    re[i] = (idx < samples.length ? samples[idx] : 0) * HANN[i];
  }
  return fftMag(re, im);
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

function metrics(samples) {
  const n = samples.length;
  let peak = 0, sum = 0, peakIdx = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) { peak = a; peakIdx = i; }
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / n);

  // espectro promedio
  const avg = new Float32Array(FFT_SIZE / 2);
  let frames = 0;
  for (let start = 0; start + FFT_SIZE <= n; start += FFT_SIZE / 2) {
    const mag = frameMag(samples, start);
    for (let k = 0; k < avg.length; k++) avg[k] += mag[k] * mag[k];
    frames++;
  }
  for (let k = 0; k < avg.length; k++) avg[k] /= Math.max(1, frames);

  let num = 0, den = 0, logSum = 0, linSum = 0, bins = 0;
  const bandEdges = [20, 200, 800, 3000, 10000, 20000];
  const bands = new Array(bandEdges.length - 1).fill(0);
  let bandTotal = 0;
  for (let k = 1; k < avg.length; k++) {
    const f = (k * _sr) / FFT_SIZE;
    const p = avg[k];
    num += f * p;
    den += p;
    if (p > 1e-16) { logSum += Math.log(p); linSum += p; bins++; }
    for (let b = 0; b < bands.length; b++) {
      if (f >= bandEdges[b] && f < bandEdges[b + 1]) { bands[b] += p; bandTotal += p; break; }
    }
  }
  const centroid = den > 0 ? num / den : 0;
  const flatness = bins > 0 ? Math.exp(logSum / bins) / (linSum / bins) : 0;

  // ataque y decaimiento (envolvente RMS móvil de 2 ms)
  const win = Math.round(0.002 * _sr);
  let envPeak = 0;
  const env = new Float32Array(Math.ceil(n / win));
  for (let e = 0; e < env.length; e++) {
    let s2 = 0;
    for (let i = e * win; i < Math.min(n, (e + 1) * win); i++) s2 += samples[i] * samples[i];
    env[e] = Math.sqrt(s2 / win);
    if (env[e] > envPeak) envPeak = env[e];
  }
  let attack = 0;
  for (let e = 0; e < env.length; e++) {
    if (env[e] >= envPeak * 0.9) { attack = e * win / _sr; break; }
  }
  let decay = (n - 1) / _sr;
  for (let e = env.length - 1; e >= 0; e--) {
    if (env[e] >= envPeak * 0.01) { decay = (e * win) / _sr; break; }
  }

  return {
    dur: n / _sr,
    peak,
    rms,
    crest: peak / (rms || 1e-9),
    centroid,
    flatness,
    bands: bands.map(b => (bandTotal > 0 ? b / bandTotal : 0)),
    attack,
    decay,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function setPx(rgb, W2, x, y, r, g, b) {
  const o = (y * W2 + x) * 3;
  rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
}

function heat(v) {
  // mapa de calor simple: negro → azul → rojo → amarillo → blanco
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 * t - 0.2)));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.5 * t - 0.75)));
  const bl = Math.round(255 * Math.min(1, Math.max(0, 1.2 * t - 0.05) * (t < 0.5 ? 1 : 0.4)));
  return [r, g, bl];
}

function drawBlock(rgb, y0, samples, name) {
  const n = samples.length;

  // 1) envolvente min/max
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x * n) / W), b = Math.max(a + 1, Math.floor(((x + 1) * n) / W));
    let mn = 1, mx = -1;
    for (let i = a; i < b && i < n; i++) {
      if (samples[i] < mn) mn = samples[i];
      if (samples[i] > mx) mx = samples[i];
    }
    const yTop = y0 + Math.round((1 - mx) * (ENV_H / 2 - 1));
    const yBot = y0 + Math.round((1 - mn) * (ENV_H / 2 - 1));
    for (let y = yTop; y <= yBot; y++) setPx(rgb, W, x, y, 235, 235, 235);
  }
  for (let x = 0; x < W; x++) setPx(rgb, W, x, y0 + ENV_H / 2, 60, 60, 60);

  // 2) zoom de 25 ms centrado en el pico
  let peakIdx = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) { peak = a; peakIdx = i; }
  }
  const zoomN = Math.round(0.025 * _sr);
  const z0 = Math.max(0, Math.min(n - zoomN, peakIdx - Math.round(zoomN * 0.4)));
  const zTop = y0 + ENV_H, zMid = zTop + ZOOM_H / 2;
  for (let x = 0; x < W; x++) {
    const i = z0 + Math.round((x * zoomN) / W);
    const v = samples[Math.min(n - 1, i)];
    const y = zMid - v * (ZOOM_H / 2 - 1);
    const yPrev = x > 0 ? undefined : y;
    if (x > 0) {
      const iPrev = z0 + Math.round(((x - 1) * zoomN) / W);
      const vPrev = samples[Math.min(n - 1, iPrev)];
      const yP = zMid - vPrev * (ZOOM_H / 2 - 1);
      const steps = Math.ceil(Math.abs(y - yP)) + 1;
      for (let s = 0; s <= steps; s++) {
        const yy = Math.round(yP + ((y - yP) * s) / steps);
        setPx(rgb, W, x, yy, 120, 220, 160);
      }
    }
    setPx(rgb, W, x, Math.round(y), 120, 220, 160);
    void yPrev;
  }
  for (let x = 0; x < W; x++) setPx(rgb, W, x, zMid, 45, 70, 55);

  // 3) espectrograma log-frecuencia
  const specTop = y0 + ENV_H + ZOOM_H;
  const hop = Math.max(1, Math.floor((n - FFT_SIZE) / W));
  // rangos de bin por fila (log)
  const rows = new Array(SPEC_H);
  for (let y = 0; y < SPEC_H; y++) {
    const fTop = F_MIN * Math.pow(F_MAX / F_MIN, 1 - y / SPEC_H);
    const fBot = F_MIN * Math.pow(F_MAX / F_MIN, 1 - (y + 1) / SPEC_H);
    const b0 = Math.max(1, Math.floor((fBot * FFT_SIZE) / _sr));
    const b1 = Math.max(b0 + 1, Math.ceil((fTop * FFT_SIZE) / _sr));
    rows[y] = [b0, b1];
  }
  const DB_FLOOR = -72, DB_CEIL = -6;
  for (let x = 0; x < W; x++) {
    const start = Math.min(n - FFT_SIZE, x * hop);
    const mag = frameMag(samples, Math.max(0, start));
    for (let y = 0; y < SPEC_H; y++) {
      const [b0, b1] = rows[y];
      let m = 0;
      for (let k = b0; k < b1 && k < mag.length; k++) if (mag[k] > m) m = mag[k];
      const db = 20 * Math.log10(m + 1e-12);
      const v = (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR);
      const [r, g, b] = heat(v);
      setPx(rgb, W, x, specTop + y, r, g, b);
    }
  }

  // separador bajo el bloque
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < GAP; y++) setPx(rgb, W, x, specTop + SPEC_H + y, 20, 22, 26);
  }
  void name;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadFile(path, cropSec) {
  const { samples, sr } = readWav(path);
  _sr = sr;
  if (cropSec && samples.length > cropSec * sr) {
    const n = Math.round(cropSec * sr);
    let peakIdx = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) { peak = a; peakIdx = i; }
    }
    const start = Math.max(0, Math.min(samples.length - n, peakIdx - Math.round(n * 0.2)));
    return samples.slice(start, start + n);
  }
  return samples;
}

function printMetrics(name, samples) {
  const mt = metrics(samples);
  const bands = mt.bands.map(b => b.toFixed(2)).join('/');
  console.log(
    `${name.padEnd(30)} ${mt.dur.toFixed(2)}s ${mt.peak.toFixed(3)} ${mt.rms.toFixed(4)} ${mt.crest.toFixed(2).padStart(6)} ` +
    `${(mt.centroid.toFixed(0) + ' Hz').padStart(10)} ${mt.flatness.toFixed(4).padStart(9)}  ${bands.padEnd(26)} ` +
    `${(mt.attack * 1000).toFixed(0).padStart(5)}ms ${(mt.decay * 1000).toFixed(0).padStart(5)}ms`
  );
  return mt;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const only = get('--only');
  const dir = get('--dir');
  const crop = parseFloat(get('--crop') || '0') || 0;
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('sonido                        dur    peak    rms   crest  centroide  planitud  bandas[<200/200-800/0.8-3k/3-10k/>10k]  ataque  caída');

  if (dir) {
    const files = readdirSync(dir).filter(f => f.endsWith('.wav')).sort();
    for (const f of files) {
      const samples = loadFile(join(dir, f), crop);
      printMetrics(f, samples);
      const rgb = new Uint8Array(W * (BLOCK_H - GAP) * 3);
      drawBlock(rgb, 0, samples, f);
      const out = `ref-${f.replace(/\.wav$/, '')}.png`;
      writePNG(join(OUT_DIR, out), W, BLOCK_H - GAP, rgb);
      console.log(`→ ${out}`);
    }
    return;
  }

  const manifest = JSON.parse(readFileSync(join(SFX_DIR, 'manifest.json'), 'utf8'));
  const items = manifest.filter(m => !only || m.name.includes(only));

  for (const m of items) {
    const samples = loadFile(join(SFX_DIR, m.name), 0);
    printMetrics(m.name, samples);
  }

  for (const [group, file] of GROUPS) {
    const groupItems = items.filter(m => m.group === group);
    if (!groupItems.length) continue;
    const h = BLOCK_H * groupItems.length - GAP;
    const rgb = new Uint8Array(W * h * 3);
    groupItems.forEach((m, i) => drawBlock(rgb, i * BLOCK_H, loadFile(join(SFX_DIR, m.name), 0), m.name));
    writePNG(join(OUT_DIR, `${file}.png`), W, h, rgb);
    console.log(`→ ${file}.png  (${groupItems.map(m => m.name.replace('.wav', '')).join(', ')})`);
  }
}

main();
