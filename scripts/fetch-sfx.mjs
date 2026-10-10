#!/usr/bin/env node
// Descarga SFX reales (CC0/CC-BY) y los procesa a WAV 48kHz mono listos para el juego.
// - Loops: recorte a zona estable + crossfade circular + normalizado a pico 0.75
// - One-shots: recorte de silencios + fundido de salida 8ms + normalizado
// Uso: node scripts/fetch-sfx.mjs [--only engine]
// Requiere: ffmpeg en PATH. Reversible: backup en .sfx-backup/, procedurales en scripts/gen-sounds.mjs
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, '.sfx-src');
const OUT_DIR = join(ROOT, 'public', 'sfx');
const SR = 48000;

/** Catálogo de fuentes. ss/t = recorte inicial ffmpeg; auto = elegir ventana estable. */
const SOURCES = [
  { name: 'engine_offroad_loop', url: 'https://cdn.freesound.org/previews/840/840649_10594370-hq.mp3', ext: 'mp3', kind: 'loop', dur: 4.0, ss: 0.15, t: 4.4, eq: 'highpass=f=40,lowpass=f=6500', peak: 0.8, xfade: 0.12, credit: 'Mihacappy — "djeep_idle.wav" (Diesel Jeep)', page: 'https://freesound.org/people/Mihacappy/sounds/840649/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'engine_kwid_loop', url: 'https://cdn.freesound.org/previews/269/269771_3366749-hq.mp3', ext: 'mp3', kind: 'loop', dur: 2.0, ss: 0.1, t: 2.2, eq: 'highpass=f=50,lowpass=f=7000', peak: 0.8, xfade: 0.08, credit: 'seth-m — "car idle" (Mini Cooper 2002)', page: 'https://freesound.org/people/seth-m/sounds/269771/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'roll_asphalt_loop', url: 'https://cdn.freesound.org/previews/612/612011_1648170-hq.mp3', ext: 'mp3', kind: 'loop', dur: 4.0, auto: 'stable', analyze: 90, eq: 'highpass=f=60,lowpass=f=3500', peak: 0.75, xfade: 0.25, credit: 'klankbeeld — "inside car 90 km asphalt"', page: 'https://freesound.org/people/klankbeeld/sounds/612011/', license: 'CC-BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  { name: 'roll_dirt_loop', url: 'https://cdn.freesound.org/previews/341/341069_3366749-hq.mp3', ext: 'mp3', kind: 'loop', dur: 4.0, ss: 0.15, t: 4.4, eq: 'highpass=f=60,lowpass=f=4500', peak: 0.75, xfade: 0.2, credit: 'seth-m — "gravel road"', page: 'https://freesound.org/people/seth-m/sounds/341069/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'roll_grass_loop', url: 'https://cdn.freesound.org/previews/146/146436_1661766-hq.mp3', ext: 'mp3', kind: 'loop', dur: 3.0, auto: 'stable', analyze: 120, eq: 'highpass=f=150,lowpass=f=1400', peak: 0.75, xfade: 0.3, credit: 'felix.blume — "Dry grass rustling in the wind (desert of Chile)"', page: 'https://freesound.org/people/felix.blume/sounds/146436/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'tire_squeal_loop', url: 'https://opengameart.org/sites/default/files/tires_squal_loop.wav', ext: 'wav', kind: 'loop', dur: 3.0, ss: 0, t: 3.0, eq: 'highpass=f=300,lowpass=f=9000', peak: 0.7, xfade: 0.15, desc: 'Chirrido de neumático en límite de adherencia. Escalar con slip.', credit: 'Tom Haigh / audible-edge (vía qubodup) — "tires_squal_loop"', page: 'https://opengameart.org/content/car-tire-squeal-skid-loop', license: 'CC-BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/' },
  { name: 'wheelspin_loop', url: 'https://cdn.freesound.org/previews/71/71737_995351-hq.mp3', ext: 'mp3', kind: 'loop', dur: 3.0, ss: 0.5, t: 3.5, eq: 'highpass=f=250,lowpass=f=6000', peak: 0.7, xfade: 0.2, credit: 'audible-edge — "Chrysler LHS tire squeal 02" (sección aceleración)', page: 'https://freesound.org/people/audible-edge/sounds/71737/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'scrape_loop', url: 'https://cdn.freesound.org/previews/422/422437_6613494-hq.mp3', ext: 'mp3', kind: 'loop', dur: 1.1, ss: 0, t: 1.1, eq: 'highpass=f=500,lowpass=f=10000', peak: 0.7, xfade: 0.08, credit: 'BehanSean — "metal scrape 2"', page: 'https://freesound.org/people/BehanSean/sounds/422437/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'wind_loop', url: 'https://opengameart.org/sites/default/files/wind%20woosh%20loop.ogg', ext: 'ogg', kind: 'loop', dur: 4.0, ss: 0.2, t: 4.4, eq: 'highpass=f=90,lowpass=f=4000', peak: 0.6, xfade: 0.4, credit: 'SketchMan3 — "wind woosh loop"', page: 'https://opengameart.org/content/wind-whoosh-loop', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'susp_bottomout', url: 'https://cdn.freesound.org/previews/778/778419_8927049-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=40,asetrate=48000*0.84,aresample=48000', peak: 0.85, credit: 'BlondPanda — "Car_Door_Closing_Dull_02" (-3 st)', page: 'https://freesound.org/people/BlondPanda/sounds/778419/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'susp_bottomout_heavy', url: 'https://cdn.freesound.org/previews/778/778421_8927049-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=35,asetrate=48000*0.75,aresample=48000', peak: 0.95, credit: 'BlondPanda — "Car_Door_Closing_Dull_04" (-5 st)', page: 'https://freesound.org/people/BlondPanda/sounds/778421/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'susp_clunk', url: 'https://cdn.freesound.org/previews/778/778418_8927049-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=60,asetrate=48000*0.84,aresample=48000', peak: 0.8, credit: 'BlondPanda — "Car_Door_Closing_Dull_01" (-3 st)', page: 'https://freesound.org/people/BlondPanda/sounds/778418/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'land_thump', url: 'https://cdn.freesound.org/previews/778/778420_8927049-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=35,lowpass=f=6000,asetrate=48000*0.80,aresample=48000', peak: 0.9, credit: 'BlondPanda — "Car_Door_Closing_Dull_03" (-4 st)', page: 'https://freesound.org/people/BlondPanda/sounds/778420/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'whoops_rumble', url: 'https://cdn.freesound.org/previews/630/630030_9129912-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, maxDur: 1.0, eq: 'lowpass=f=500', peak: 0.85, credit: 'el_boss — "Deep Bass Thump"', page: 'https://freesound.org/people/el_boss/sounds/630030/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'impact_light', url: 'https://cdn.freesound.org/previews/275/275160_4745081-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=40', peak: 0.9, desc: 'Golpe seco profundo (pow) — impactos normales.', gain: 0.8, credit: 'Bird_man — "Thud"', page: 'https://freesound.org/people/Bird_man/sounds/275160/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'impact_heavy', url: 'https://cdn.freesound.org/previews/442/442344_9133009-hq.mp3', ext: 'mp3', kind: 'oneshot', auto: 'peak', peakDur: 0.6, prePeak: 0.08, eq: 'highpass=f=30,lowpass=f=5000', peak: 0.95, desc: 'Pow grave grande — impactos fuertes.', gain: 0.9, credit: 'toddcircle — "Deep thud punch" (mejor golpe)', page: 'https://freesound.org/people/toddcircle/sounds/442344/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'impact_extreme', url: 'https://cdn.freesound.org/previews/332/332056_71257-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, eq: 'highpass=f=40', peak: 0.95, desc: 'Golpe corto y contundente — impactos extremos.', gain: 0.95, group: 'impacto', credit: 'qubodup — "Fast Collision"', page: 'https://freesound.org/people/qubodup/sounds/332056/', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { name: 'rollover', url: 'https://cdn.freesound.org/previews/810/810174_17437502-hq.mp3', ext: 'mp3', kind: 'oneshot', trim: true, maxDur: 0.8, eq: 'highpass=f=30,lowpass=f=8000', peak: 0.95, desc: 'Vuelco corto (chillido + golpe inicial).', gain: 0.95, group: 'impacto', credit: 'mokasza — "car crash" (recorte inicial)', page: 'https://freesound.org/people/mokasza/sounds/810174/', license: 'CC-BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
];

function readWavMono(path) {
  const b = readFileSync(path);
  let off = 12, channels = 1, bits = 16, sr = SR;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); break; }
    off += 8 + size + (size % 2);
  }
  // localizar chunk 'data'
  let dataOff = -1, dataLen = 0;
  off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error(`sin chunk data: ${path}`);
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const s = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bps;
      v += bps === 2 ? b.readInt16LE(o) / 32768 : b.readFloatLE(o);
    }
    s[i] = v / channels;
  }
  return { samples: s, sr };
}

function writeWav(path, samples, sr = SR) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

function normalize(samples, peak) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  if (max <= 1e-6) return samples;
  const g = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= g;
  return samples;
}

/** Ventana más estable (mínima varianza de RMS entre subventanas) para texturas largas. */
function pickStableWindow(samples, sr, winSec, maxAnalyzeSec) {
  const n = Math.min(samples.length, Math.floor(maxAnalyzeSec * sr));
  const win = Math.floor(winSec * sr);
  const sub = Math.floor(0.25 * sr);
  const hop = Math.floor(0.5 * sr);
  let best = 0, bestScore = Infinity;
  for (let start = 0; start + win <= n; start += hop) {
    let mean = 0, m2 = 0, cnt = 0, peak = 0;
    for (let o = 0; o + sub <= win; o += sub) {
      let s2 = 0;
      for (let i = start + o; i < start + o + sub; i++) { s2 += samples[i] * samples[i]; peak = Math.max(peak, Math.abs(samples[i])); }
      const rms = Math.sqrt(s2 / sub);
      cnt++; const d = rms - mean; mean += d / cnt; m2 += d * (rms - mean);
    }
    const variance = m2 / Math.max(1, cnt);
    // penalizar picos (baches, cláxones) y pasajes casi silenciosos
    const score = variance / (mean * mean + 1e-8) + (peak > 4 * (mean + 1e-4) ? 10 : 0) + (mean < 1e-3 ? 5 : 0);
    if (score < bestScore) { bestScore = score; best = start; }
  }
  return { start: best, score: bestScore };
}

/** Ventana con más energía aguda (para chirridos de freno entre ruidos largos). */
function pickBrightWindow(samples, sr, winSec, maxAnalyzeSec) {
  const n = Math.min(samples.length, Math.floor(maxAnalyzeSec * sr));
  const win = Math.floor(winSec * sr);
  const hop = Math.floor(0.25 * sr);
  let best = 0, bestScore = -Infinity;
  for (let start = 0; start + win <= n; start += hop) {
    let hf = 0, tot = 0;
    let prev = samples[start];
    for (let i = start + 1; i < start + win; i++) {
      const d = samples[i] - prev; prev = samples[i];
      hf += d * d; tot += samples[i] * samples[i];
    }
    const score = hf / (tot + 1e-9);
    if (score > bestScore) { bestScore = score; best = start; }
  }
  return { start: best, score: bestScore };
}

/** Ventana con el pico global (para one-shots con varios eventos: quedarse el mejor golpe). */
function pickPeakWindow(samples, sr, durSec, preSec) {
  let peakIdx = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) { peak = a; peakIdx = i; }
  }
  const start = Math.max(0, Math.min(samples.length - Math.floor(durSec * sr), peakIdx - Math.floor(preSec * sr)));
  return { start, peak };
}

/** Crossfade circular: funde los últimos xf samples con la cabeza (bucle sin click). */
function seamlessLoop(samples, sr, xfadeSec) {
  const xf = Math.min(samples.length >> 2, Math.floor(xfadeSec * sr));
  const out = samples.slice();
  for (let i = 0; i < xf; i++) {
    const t = i / xf; // 0→1
    const a = 0.5 - 0.5 * Math.cos(Math.PI * t); // raised-cosine
    out[i] = samples[i] * a + samples[samples.length - xf + i] * (1 - a);
  }
  return out.slice(0, out.length - xf);
}

function trimSilence(samples, sr, maxDur) {
  const th = 0.02;
  let a = 0, b = samples.length;
  while (a < b && Math.abs(samples[a]) < th) a++;
  a = Math.max(0, a - Math.floor(0.005 * sr));
  if (maxDur) b = Math.min(b, a + Math.floor(maxDur * sr));
  // fundido de salida 8ms para no clickear
  const out = samples.slice(a, b);
  const f = Math.min(out.length, Math.floor(0.008 * sr));
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
  return out;
}

async function download(url, dest, tries = 5) {
  const tag = `${dest}.url`;
  if (existsSync(dest)) {
    const prev = existsSync(tag) ? readFileSync(tag, 'utf8') : null;
    if (prev === url) { console.log(`  ↻ cache ${dest}`); return; }
    console.log(`  ↻ URL cambió, re-descargo ${dest}`);
    rmSync(dest, { force: true });
  }
  let last = null;
  for (let a = 0; a < tries; a++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'SuspensionLab/1.0 (juego web; contacto repo)' } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
      writeFileSync(tag, url);
      console.log(`  ↓ ${(buf.length / 1024).toFixed(0)} KB ${url.split('/').pop()}`);
      return;
    }
    last = res.status;
    console.log(`  … HTTP ${res.status}, reintento ${a + 1}/${tries} en ${(a + 1) * 8}s`);
    await new Promise(r => setTimeout(r, (a + 1) * 8000));
  }
  throw new Error(`HTTP ${last} ${url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  mkdirSync(SRC_DIR, { recursive: true });
  const items = SOURCES.filter(s => !only || s.name.includes(only));
  const credits = [];
  for (const s of items) {
    console.log(`\n● ${s.name} [${s.license}]`);
    const raw = join(SRC_DIR, `${s.name}-raw.${s.ext}`);
    await download(s.url, raw);
    const tmp = join(SRC_DIR, `${s.name}-tmp.wav`);
    // 1) ffmpeg: recorte grueso + EQ + 48k mono
    const fargs = ['-y', '-v', 'error'];
    if (s.ss) fargs.push('-ss', String(s.ss));
    fargs.push('-i', raw);
    if (s.t && !s.auto) fargs.push('-t', String(s.t));
    else if (s.auto && s.analyze) fargs.push('-t', String(s.analyze));
    fargs.push('-ac', '1', '-ar', String(SR), '-filter:a', s.eq, '-c:a', 'pcm_s16le', tmp);
    execFileSync('ffmpeg', fargs, { stdio: 'inherit' });
    // 2) node: ventana estable / recorte fino + loop + normalize
    let { samples, sr } = readWavMono(tmp);
    if (sr !== SR) throw new Error(`sr inesperado ${sr}`);
    if (s.auto === 'stable') {
      const { start, score } = pickStableWindow(samples, sr, s.dur, s.analyze);
      console.log(`  ventana estable @${(start / sr).toFixed(1)}s (score ${score.toFixed(3)})`);
      samples = samples.slice(start, start + Math.floor(s.dur * sr));
    } else if (s.auto === 'bright') {
      const { start, score } = pickBrightWindow(samples, sr, s.dur, s.analyze);
      console.log(`  ventana brillante @${(start / sr).toFixed(1)}s (score ${score.toFixed(3)})`);
      samples = samples.slice(start, start + Math.floor(s.dur * sr));
    } else if (s.auto === 'peak') {
      const { start, peak } = pickPeakWindow(samples, sr, s.peakDur, s.prePeak ?? 0.08);
      console.log(`  mejor golpe @${(start / sr).toFixed(2)}s (pico ${peak.toFixed(3)})`);
      samples = samples.slice(start, start + Math.floor(s.peakDur * sr));
    } else if (s.kind === 'loop') {
      const want = Math.floor((s.dur + s.xfade) * sr);
      if (samples.length > want) samples = samples.slice(0, want);
    }
    if (s.kind === 'loop') {
      samples = seamlessLoop(samples, sr, s.xfade);
      // chequeo de costura: discontinuidad del wrap vs salto máx interno
      let maxStep = 0;
      for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
      const wrap = Math.abs(samples[0] - samples[samples.length - 1]);
      console.log(`  loop ${(samples.length / sr).toFixed(2)}s wrapΔ=${wrap.toFixed(4)} saltoMáx=${maxStep.toFixed(4)}`);
    } else {
      samples = trimSilence(samples, sr, s.maxDur);
    }
    normalize(samples, s.peak);
    const out = join(OUT_DIR, `${s.name}.wav`);
    writeWav(out, samples);
    console.log(`  ✓ ${(samples.length / sr).toFixed(2)}s pico ${s.peak} → ${out}`);
    credits.push(s);
  }
  // 3) manifest: añadir crédito/fuente a los reemplazados (conservar gain/kind/group/desc)
  const manPath = join(OUT_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manPath, 'utf8'));
  const byName = new Map(credits.map(c => [c.name, c]));
  const have = new Set(manifest.map(m => m.name.replace(/\.wav$/, '')));
  for (const m of manifest) {
    const c = byName.get(m.name.replace(/\.wav$/, ''));
    if (c) {
      m.src = c.page; m.credit = c.credit; m.license = c.license; m.licenseUrl = c.licenseUrl;
      if (c.desc) m.desc = c.desc;
      if (c.gain !== undefined) m.gain = c.gain;
      if (c.group) m.group = c.group;
    }
  }
  for (const c of credits) {
    if (!have.has(c.name)) {
      manifest.push({
        name: `${c.name}.wav`, kind: c.kind, group: c.group ?? 'impacto',
        desc: c.desc ?? c.credit, gain: c.gain ?? 0.9,
        src: c.page, credit: c.credit, license: c.license, licenseUrl: c.licenseUrl,
      });
      console.log(`  + entrada nueva en manifest: ${c.name}.wav`);
    }
  }
  writeFileSync(manPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, 'manifest.js'), `window.SFX_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`);
  // 4) atribución CC-BY (también listamos CC0 por cortesía)
  const lines = ['# Atribución de SFX (grabaciones reales)', '', 'Los `ui_click` y `countdown_*` siguen siendo procedurales (`scripts/gen-sounds.mjs`, sin atribución). El Tesla EV no lleva sonido de motor.', ''];
  for (const m of manifest) {
    if (!m.credit) continue;
    lines.push(`- **${m.name}** — ${m.credit} — [fuente](${m.src}) — [${m.license}](${m.licenseUrl})`);
  }
  lines.push('', 'Licencias CC-BY exigen este crédito + enlace. CC0 no lo exige pero lo mantenemos por cortesía.');
  writeFileSync(join(OUT_DIR, 'ATTRIBUTION.md'), lines.join('\n'));
  console.log('\nmanifest.json + manifest.js + ATTRIBUTION.md actualizados.');
}

main().catch(e => { console.error(e); process.exit(1); });
