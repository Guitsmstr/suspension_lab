#!/usr/bin/env node
// Cata de candidatos (NO entra al juego): descarga chirridos de derrape CC0,
// recorta la mejor ventana de 3 s, normaliza y genera `candidates.js` para
// la sección de cata de scripts/sfx-audition.html.
// Uso: node scripts/fetch-candidates.mjs
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, '.sfx-src', 'candidates');
const OUT_DIR = join(ROOT, 'sfx-candidates');
const SR = 48000;

const CANDIDATES = [
  { file: 'a1-screeching-tyres', url: 'https://cdn.freesound.org/previews/614/614627_5790048-hq.mp3', ext: 'mp3', desc: 'Chillidos sostenidos de neumáticos (86 s, sección más brillante)', credit: 'johnnydekk — "screeching tyres / tires"', page: 'https://freesound.org/people/johnnydekk/sounds/614627/', license: 'CC0 1.0' },
  { file: 'a2-auto-skidding', url: 'https://cdn.freesound.org/previews/369/369783_6767177-hq.mp3', ext: 'mp3', desc: 'Auto derrapando (10 s)', credit: 'Latranz — "Auto Skidding"', page: 'https://freesound.org/people/Latranz/sounds/369783/', license: 'CC-BY 4.0' },
  { file: 'a3-peel-out', url: 'https://cdn.freesound.org/previews/781/781779_8055754-hq.mp3', ext: 'mp3', desc: 'Quemada / arrancón (10 s)', credit: 'tiedyehomie — "Tire Burnout / peel out"', page: 'https://freesound.org/people/tiedyehomie/sounds/781779/', license: 'CC-BY 4.0' },
  { file: 'a4-skrrt', url: 'https://cdn.freesound.org/previews/685/685910_6565462-hq.mp3', ext: 'mp3', desc: 'Skrrt estilizado (8 s)', credit: 'elliottdj — "Skrrt"', page: 'https://freesound.org/people/elliottdj/sounds/685910/', license: 'CC0 1.0' },
  { file: 'a5-v8-burnout', url: 'https://cdn.freesound.org/previews/213/213664_2214631-hq.mp3', ext: 'mp3', desc: 'V8 + quemada (75 s, puede traer motor)', credit: 'Ears68 — "V-8 Burnout mix"', page: 'https://freesound.org/people/Ears68/sounds/213664/', license: 'CC0 1.0' },
  { file: 'a6-drag-burnout', url: 'https://cdn.freesound.org/previews/156/156633_230160-hq.mp3', ext: 'mp3', desc: 'Dragster quemando (38 s, puede traer motor)', credit: 'lonemonk — "Drag Car-Burnout and Run #2"', page: 'https://freesound.org/people/lonemonk/sounds/156633/', license: 'CC-BY 4.0' },
];

function readWavMono(path) {
  const b = readFileSync(path);
  let off = 12, channels = 1, bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); bits = b.readUInt16LE(off + 22); break; }
    off += 8 + size + (size % 2);
  }
  let dataOff = -1, dataLen = 0;
  off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const s = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) v += b.readInt16LE(dataOff + (i * channels + c) * bps) / 32768;
    s[i] = v / channels;
  }
  return s;
}

function writeWav(path, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
}

/** Ventana de 3 s con más energía aguda = sección de chillido sostenido. */
function pickBrightWindow(samples, winSec) {
  const win = Math.floor(winSec * SR);
  const hop = Math.floor(0.25 * SR);
  let best = hop * 2, bestScore = -Infinity;
  for (let start = hop * 2; start + win <= samples.length; start += hop) {
    let hf = 0, tot = 0, prev = samples[start];
    for (let i = start + 1; i < start + win; i++) {
      const d = samples[i] - prev; prev = samples[i];
      hf += d * d; tot += samples[i] * samples[i];
    }
    const score = hf / (tot + 1e-9);
    if (score > bestScore) { bestScore = score; best = start; }
  }
  return { start: best, score: bestScore };
}

function seamless(samples, xfadeSec) {
  const xf = Math.min(samples.length >> 2, Math.floor(xfadeSec * SR));
  const out = samples.slice();
  for (let i = 0; i < xf; i++) {
    const a = 0.5 - 0.5 * Math.cos((Math.PI * i) / xf);
    out[i] = samples[i] * a + samples[samples.length - xf + i] * (1 - a);
  }
  return out.slice(0, out.length - xf);
}

function normalize(samples, peak) {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  if (max > 1e-6) for (let i = 0; i < samples.length; i++) samples[i] *= peak / max;
  return samples;
}

async function main() {
  mkdirSync(SRC_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const c of CANDIDATES) {
    console.log(`\n● ${c.file}`);
    const raw = join(SRC_DIR, `${c.file}.${c.ext}`);
    if (!existsSync(raw)) {
      const res = await fetch(c.url, { headers: { 'User-Agent': 'SuspensionLab/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${c.url}`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    } else console.log('  ↻ cache');
    const tmp = join(SRC_DIR, `${c.file}-tmp.wav`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ac', '1', '-ar', String(SR),
      '-filter:a', 'highpass=f=250,lowpass=f=9000', '-c:a', 'pcm_s16le', tmp], { stdio: 'inherit' });
    let samples = readWavMono(tmp);
    if (c.full) {
      samples = seamless(samples, 0.15);
    } else {
      const { start, score } = pickBrightWindow(samples, 3.0);
      console.log(`  chillido @${(start / SR).toFixed(1)}s (brillo ${score.toFixed(2)})`);
      samples = seamless(samples.slice(start, start + 3 * SR), 0.2);
    }
    normalize(samples, 0.8);
    writeWav(join(OUT_DIR, `${c.file}.wav`), samples);
    console.log(`  ✓ ${(samples.length / SR).toFixed(2)}s`);
    manifest.push({ name: `${c.file}.wav`, kind: 'loop', desc: c.desc, credit: c.credit, page: c.page, license: c.license });
  }
  writeFileSync(join(OUT_DIR, 'candidates.js'), `window.SFX_CANDIDATES = ${JSON.stringify(manifest, null, 2)};\n`);
  console.log('\ncandidates.js actualizado.');
}

main().catch((e) => { console.error(e); process.exit(1); });
