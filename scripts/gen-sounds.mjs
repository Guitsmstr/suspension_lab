#!/usr/bin/env node
// Generador procedural de efectos de sonido para Suspension Lab.
//
// Sintetiza los WAV del juego en `public/sfx/` sin dependencias externas
// (Node puro). Todo es determinista: mismas semillas → mismos ficheros.
//
// Técnicas (calibradas contra grabaciones reales, ver scripts/sfx-analyze.mjs):
//   - Motor de combustión: tren de pulsos de encendido (excitación) + banco de
//     formantes paralelo (filtro), con irregularidad de amplitud/fase por pulso
//     (patrón tipo "crossplane") y lecho de ruido de admisión modulado por el
//     propio tren ("respiración"). El fundamental es el ritmo de encendido.
//   - Motor eléctrico: órdenes de engranaje/inversor tonales + zumbido + textura.
//   - Neumático (skid): rugido de baja-media frecuencia con grano + varios tonos
//     de stick-slop con modulación lenta independiente (salto de modo).
//   - Impactos: banco de modos inarmónicos con decaimientos distintos + crack
//     transitorio de ruido + golpe grave + chatarra.
//   - Rodadura/scrape: lecho de ruido filtrado + granos de ruido (wrap-add).
//
// Costura de bucles: pulsos/granos se insertan con wrap-around, los parciales y
// LFO caen en ciclos enteros del bucle y los filtros se asientan (filterLoop).
//
// Uso:
//   node scripts/gen-sounds.mjs              # genera todo
//   node scripts/gen-sounds.mjs --only engine # genera solo los que contengan "engine"
//   node scripts/gen-sounds.mjs --list        # muestra el catálogo

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sfx');
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** PRNG determinista (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buf(n) {
  return new Float32Array(n);
}

function seconds(s) {
  return Math.round(s * SR);
}

/** Ruido blanco de longitud n. */
function whiteNoise(n, rand) {
  const x = buf(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  return x;
}

/**
 * Ruido de costura suave: genera n+fade muestras y funde la cola con la
 * cabeza mediante crossfade circular.
 */
function loopNoise(n, rand, fade = Math.round(0.02 * SR)) {
  const src = whiteNoise(n + fade, rand);
  const out = buf(n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = src[i] * t + src[n + i] * (1 - t);
  }
  for (let i = fade; i < n; i++) out[i] = src[i];
  return out;
}

/** Filtro biquad (libro de recetas RBJ). */
function biquad(type, f0, Q, sr = SR) {
  const w0 = (TAU * f0) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cw = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'hp') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'bp') {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    throw new Error(`filtro desconocido: ${type}`);
  }
  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0,
    x1: 0, x2: 0, y1: 0, y2: 0,
    process(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    },
  };
}

/**
 * Filtra un bucle dejando el filtro asentado: procesa la señal dos veces
 * encadenando el estado y conserva la segunda pasada. Así la salida es
 * continua a través del punto de costura (sin "click" al loopear).
 */
function filterLoop(x, ...filters) {
  const n = x.length;
  const out = buf(n);
  for (const f of filters) { f.x1 = 0; f.x2 = 0; f.y1 = 0; f.y2 = 0; }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let s = x[i];
      for (const f of filters) s = f.process(s);
      if (pass === 1) out[i] = s;
    }
  }
  return out;
}

/** Aplica filtros a una señal de un solo disparo. */
function filter(x, ...filters) {
  const y = buf(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = x[i];
    for (const f of filters) s = f.process(s);
    y[i] = s;
  }
  return y;
}

/**
 * Banco de formantes paralelo: suma versiones filtradas con ganancia.
 * Formantes de coche real (Dupré et al. 2023): 40/200/400/550/750 Hz.
 */
function formantBank(x, formants) {
  const out = buf(x.length);
  for (const [f, q, g] of formants) {
    const band = filterLoop(x, biquad('bp', f, q));
    for (let i = 0; i < out.length; i++) out[i] += band[i] * g;
  }
  return out;
}

/**
 * Inserta `src` dentro del bucle `dst` en la posición `pos` con wrap-around.
 * Es lo que hace que pulsos y granos sean de costura continua.
 */
function wrapAdd(dst, src, pos, gain = 1) {
  const n = dst.length;
  const p = ((pos % n) + n) % n;
  for (let i = 0; i < src.length; i++) {
    dst[(p + i) % n] += src[i] * gain;
  }
  return dst;
}

/** Modulación de amplitud por ruido suavizado (grano/ textura). */
function texture(x, rand, { rate = 20, depth = 0.5 } = {}) {
  const n = x.length;
  const sm = filterLoop(loopNoise(n, rand), biquad('lp', rate, 0.7));
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(sm[i]));
  for (let i = 0; i < n; i++) x[i] *= 1 + depth * (sm[i] / (m || 1));
  return x;
}

/** AM lenta por LFO de ciclos enteros (costura suave). */
function lfoAM(x, { cycles, depth }) {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    x[i] *= 1 + depth * Math.sin((TAU * cycles * i) / n);
  }
  return x;
}

/** Normaliza por pico (con margen) para evitar clipping al mezclar. */
function normalize(x, peak = 0.85) {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  if (max <= 0) return x;
  const g = peak / max;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Mezcla sumando `src` dentro de `dst` a partir de la muestra `offset`. */
function mixInto(dst, src, offset = 0, gain = 1) {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i++) dst[offset + i] += src[i] * gain;
  return dst;
}

/**
 * Costura de bucle. Los bucles se construyen ya continuos por diseño. El
 * chequeo compara la discontinuidad del wrap con el mayor salto entre
 * muestras adyacentes de la propia señal: un "click" real es un outlier.
 */
function checkLoop(name, x, threshold = 1.0) {
  const n = x.length;
  let maxStep = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (d > maxStep) maxStep = d;
  }
  const wrap = Math.abs(x[0] - x[n - 1]);
  const ratio = maxStep > 0 ? wrap / maxStep : 0;
  if (ratio > threshold) {
    console.warn(`  ⚠ ${name}: costura del bucle con click (wrapΔ=${wrap.toFixed(4)}, salto máx=${maxStep.toFixed(4)}, ratio=${ratio.toFixed(2)})`);
  }
  return x;
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

/** Pulso de excitación: click de ruido + cuerpo tonal, decaimiento exponencial. */
/** Pulso de presión de cilindro (modelo PTR): ataque + cola exponencial. */
function excitationPulse(len, tau, rand, { tone = 240, noiseMix = 0.55, noiseCut = 2200, alpha = 260 } = {}) {
  const x = buf(len);
  const nz = filter(whiteNoise(len, rand), biquad('lp', noiseCut, 0.7));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // E(t) = (1 − e^(−α·t)) · e^(−t/τ): frente de válvula + decaimiento
    const e = (1 - Math.exp(-alpha * t)) * Math.exp(-t / tau);
    x[i] = e * ((1 - noiseMix) * Math.sin(TAU * tone * t) + noiseMix * nz[i]);
  }
  return x;
}

/**
 * Bucle de motor de combustión por tren de pulsos + banco de formantes.
 * `pulseRate` (Hz) es el ritmo de encendido del bucle; el juego escala
 * playbackRate para seguir a las rpm.
 */
function engineLoop({
  dur = 2, pulseRate = 60, pattern = [1], jitter = 0.22, tau = 0.0055, pulseLen = 0.03, noiseMix = 0.45,
  formants = [[220, 5, 1], [520, 4, 0.7], [1150, 3, 0.4], [2400, 2, 0.2]],
  sub = 0.35, noiseBed = 0.3, noiseCut = 800, breathe = 0.55, rough = 0.06, postLp = 2200, seed = 1,
} = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  const pulses = Math.round(dur * pulseRate);
  const period = n / pulses;

  // 1) tren de pulsos de excitación (wrap-around → costura continua)
  const train = buf(n);
  const env = buf(n);
  const plen = Math.round(pulseLen * SR);
  for (let k = 0; k < pulses; k++) {
    const amp = pattern[k % pattern.length] * (1 + rough * 2 * (rand() - 0.5));
    const pos = Math.round(k * period + (rand() * 2 - 1) * jitter * period * 0.35);
    wrapAdd(train, excitationPulse(plen, tau, rand, { noiseMix }), pos, amp);
    const e = buf(plen);
    for (let i = 0; i < plen; i++) e[i] = Math.exp((-i / SR) / (tau * 1.8));
    wrapAdd(env, e, pos, amp);
  }

  // 2) cuerpo: banco de formantes paralelo sobre excitación oscurecida
  let x = formantBank(filterLoop(train, biquad('lp', postLp * 0.65, 0.8)), formants);

  // 3) subgrave (respuesta del escape)
  if (sub > 0) mixInto(x, filterLoop(train, biquad('lp', 130, 0.9)), 0, sub);

  // 4) lecho de ruido de admisión, "respirando" con el tren de pulsos
  if (noiseBed > 0) {
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, env[i]);
    const bed = filterLoop(loopNoise(n, rand), biquad('bp', noiseCut, 0.8), biquad('hp', 250, 0.7));
    for (let i = 0; i < n; i++) bed[i] *= 0.45 + breathe * (env[i] / (m || 1));
    mixInto(x, bed, 0, noiseBed);
  }

  // 5) irregularidad lenta de régimen + corte final de brillo
  lfoAM(x, { cycles: Math.round(3 * dur), depth: 0.05 });
  return filterLoop(x, biquad('lp', postLp, 0.7));
}

/** Bucle de motor eléctrico: órdenes de engranaje + inversor + zumbido. */
function evLoop({ dur = 2, seed = 301 } = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  const x = buf(n);

  // órdenes tonales: [frecuencia Hz, amplitud] (múltiplos de 0.5 Hz en bucle de 2 s)
  const tones = [
    [100, 0.5], [200, 0.3], [300, 0.12],            // zumbido de baja
    [1600, 0.2],                                    // orden mecánico
    [3200, 0.5], [6400, 0.2],                       // whine de engranaje (zona 3-8 kHz)
    [5100, 0.14], [7800, 0.06],                     // órdenes fantasma (bandas laterales)
    [9500, 0.05],                                   // portadora del inversor (spread-spectrum)
  ];
  const phase = new Float64Array(tones.length);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    for (let k = 0; k < tones.length; k++) {
      const [f, a] = tones[k];
      const vib = 1 + 0.0015 * Math.sin((TAU * (2 + k) * i) / n);
      phase[k] += (TAU * f * vib) / SR;
      x[i] += a * Math.sin(phase[k]);
    }
  }
  // textura: leve modulación y siseo de neumático/aire
  lfoAM(x, { cycles: 2 * (dur / 2), depth: 0.1 });
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('bp', 1800, 0.7)), 0, 0.06);
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('lp', 400, 0.8)), 0, 0.1);
  return texture(x, rand, { rate: 12, depth: 0.12 });
}

// ---------------------------------------------------------------------------
// Neumáticos
// ---------------------------------------------------------------------------

/**
 * Skid de neumático: rugido (baja-media frecuencia, granulado) + tonos de
 * stick-slip con modulación lenta independiente + siseo.
 */
function squealLoop({
  dur = 1.6, roarBand = [110, 640], roarGain = 1.2, tones = [780, 1170, 1560, 2340],
  toneAmp = [0.8, 0.45, 0.25, 0.12], vibDepth = 22, hissCut = 2000, hiss = 0.18,
  grainRate = 18, grainDepth = 0.55, seed = 11,
} = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);

  // rugido
  let roar = filterLoop(loopNoise(n, rand), biquad('lp', roarBand[1], 0.9), biquad('hp', roarBand[0], 0.8));
  texture(roar, rand, { rate: grainRate, depth: grainDepth });

  const x = buf(n);
  for (let i = 0; i < n; i++) x[i] = roar[i] * roarGain;

  // tonos de squeal: 2 osciladores desafinados (±1.5%) por tono, vibrato y AM
  const phase = new Float64Array(tones.length * 2);
  for (let k = 0; k < tones.length; k++) {
    const vibCycles = Math.round((1 + 0.3 * k) * dur);
    const amCycles = Math.round((0.6 + 0.25 * k) * dur);
    const det = 1 + 0.015 * (k % 2 === 0 ? 1 : -1);
    for (let i = 0; i < n; i++) {
      const vib = vibDepth * Math.sin((TAU * vibCycles * i) / n);
      const am = 0.55 + 0.45 * Math.sin((TAU * amCycles * i) / n); // AM 30-70 %
      phase[2 * k] += (TAU * (tones[k] * det + vib)) / SR;
      phase[2 * k + 1] += (TAU * (tones[k] / det + vib)) / SR;
      x[i] += toneAmp[k] * am * 0.5 * (Math.sin(phase[2 * k]) + Math.sin(phase[2 * k + 1]));
    }
  }

  // siseo
  if (hiss > 0) mixInto(x, filterLoop(loopNoise(n, rand), biquad('bp', hissCut, 1.1)), 0, hiss);
  return x;
}

/** Patinaje de ruedas en vacío / derrape fuerte. */
function wheelspinLoop({ dur = 1.4, seed = 91 } = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  let x = filterLoop(loopNoise(n, rand), biquad('lp', 1300, 0.9), biquad('hp', 180, 0.8));
  texture(x, rand, { rate: 25, depth: 0.6 });
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('bp', 2600, 1.2)), 0, 0.35);
  // tonos débiles de squeal modulados
  const tone = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const vib = 30 * Math.sin((TAU * 3 * i) / n);
    phase += (TAU * (1150 + vib)) / SR;
    tone[i] = Math.sin(phase) * (0.55 + 0.45 * Math.sin((TAU * 5 * i) / n));
  }
  mixInto(x, tone, 0, 0.35);
  return x;
}

// ---------------------------------------------------------------------------
// Rodadura, scrape, viento
// ---------------------------------------------------------------------------

/** Tren de granos de ruido (wrap-add) para textura de gravilla/roce. */
function grainTrain(n, rand, { count = 40, lenMin = 0.004, lenMax = 0.014, ampMin = 0.2, ampMax = 1, f = 900, q = 1.1 } = {}) {
  const out = buf(n);
  const period = n / count;
  for (let k = 0; k < count; k++) {
    const len = Math.round((lenMin + rand() * (lenMax - lenMin)) * SR);
    const g = buf(len);
    const decay = (len / SR) * 0.35;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      g[i] = (rand() * 2 - 1) * Math.exp(-t / decay);
    }
    const gg = filter(g, biquad('bp', f * (0.55 + rand() * 0.9), q));
    wrapAdd(out, gg, Math.round(k * period + rand() * period), ampMin + rand() * (ampMax - ampMin));
  }
  return out;
}

/** Bucle de rodadura por superficie: lecho + granos + swish. */
function rollingLoop({ dur = 2, bedCut = 500, bedGain = 0.85, grainCount = 30, grainBand = 900, grainAmp = 0.6, swish = 0, swishCut = 2400, amCycles = 6, amDepth = 0.22, seed = 7 } = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  let x = filterLoop(loopNoise(n, rand), biquad('lp', bedCut, 0.8), biquad('hp', 55, 0.7));
  for (let i = 0; i < n; i++) x[i] *= bedGain;
  // resonancias del neumático: cavidad 200-250 Hz + horn/groove 800-1000 Hz
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('bp', 225, 3.5)), 0, bedGain * 0.4);
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('bp', 900, 3)), 0, bedGain * 0.25);
  if (grainCount > 0) mixInto(x, grainTrain(n, rand, { count: grainCount, f: grainBand }), 0, grainAmp);
  if (swish > 0) {
    const sw = filterLoop(loopNoise(n, rand), biquad('bp', swishCut, 0.9));
    mixInto(x, sw, 0, swish);
  }
  lfoAM(x, { cycles: amCycles, depth: amDepth });
  return texture(x, rand, { rate: 9, depth: 0.12 });
}

/** Bucle de raspado de bajos: granos metálicos densos + cama. */
function scrapeLoop({ dur = 1.0, seed = 21 } = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  let x = filterLoop(loopNoise(n, rand), biquad('bp', 2100, 1.2), biquad('lp', 7500, 0.7));
  mixInto(x, grainTrain(n, rand, { count: 60, lenMin: 0.002, lenMax: 0.008, f: 2600, q: 1.6, ampMin: 0.3 }), 0, 0.8);
  mixInto(x, filterLoop(loopNoise(n, rand), biquad('lp', 420, 0.9)), 0, 0.5);
  lfoAM(x, { cycles: 23, depth: 0.5 });
  return texture(x, rand, { rate: 40, depth: 0.25 });
}

/** Bucle de viento / aire a velocidad. */
function windLoop({ dur = 3, seed = 31 } = {}) {
  const rand = rng(seed);
  const n = Math.round(dur * SR);
  const dark = filterLoop(loopNoise(n, rand), biquad('lp', 520, 0.6), biquad('hp', 90, 0.7));
  const bright = filterLoop(loopNoise(n, rand), biquad('bp', 1300, 0.8), biquad('hp', 220, 0.7));
  const x = buf(n);
  for (let i = 0; i < n; i++) {
    const m = 1 + 0.5 * Math.sin((TAU * 2 * i) / n); // 2 ciclos en 3 s
    x[i] = dark[i] + bright[i] * 0.3 * m;
  }
  return texture(x, rand, { rate: 6, depth: 0.22 });
}

// ---------------------------------------------------------------------------
// One-shots
// ---------------------------------------------------------------------------

/** Pulso exponencial (golpe grave). */
function thump(n, fStart, fEnd, decay, { click = 0, rand = () => 0.5 } = {}) {
  const x = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = fEnd + (fStart - fEnd) * Math.exp(-t / decay);
    phase += (TAU * f) / SR;
    let s = Math.sin(phase) * Math.exp(-t / (decay * 1.6));
    if (click > 0) s += click * Math.exp(-t / 0.006) * (rand() * 2 - 1);
    x[i] = s;
  }
  return x;
}

/**
 * Banco de modos resonantes inarmónicos: lo que hace que un impacto suene a
 * objeto real (chapa, carrocería) y no a senoide.
 */
function modeBank(n, f0, modes, rand) {
  const x = buf(n);
  for (const [ratio, amp, decayS] of modes) {
    const f = f0 * ratio;
    const d = rand() * 0.4;
    let phase = d * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      phase += (TAU * f) / SR;
      x[i] += amp * Math.sin(phase) * Math.exp(-t / decayS);
    }
  }
  return x;
}

/** Modos estándar de carrocería: inarmónicos tipo placa (1, 1.5, 2.3, 3.1…).
 *  Amplitud ∝ √f (tilde azul de radiación) y decaimiento R = b1 + b3·f²
 *  (los modos altos mueren antes: es lo que da "material"). */
function bodyModes(f0, decayS, spread = 1) {
  const RATIOS = [1, 1.5, 2.31, 3.12, 4.4, 5.7, 7.2, 9.1];
  return RATIOS.map((ratio, i) => {
    const f = f0 * ratio;
    const amp = Math.pow(ratio, 0.5) * Math.pow(0.92, i);
    const decay = Math.max(0.012, (decayS / (1 + 0.55 * ratio * ratio)) * spread);
    return [ratio, amp, Math.max(0.012, decay)];
  });
}

/** Crack transitorio de ruido (el "chasquido" inicial de un impacto). */
function crack(len, { cut = 2500, q = 0.8, decay = 0.02, rand, tilt = 0 } = {}) {
  const x = buf(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    x[i] = (rand() * 2 - 1) * Math.exp(-t / decay);
  }
  const fs = [biquad('bp', cut, q)];
  if (tilt > 0) fs.push(biquad('hp', tilt, 0.7));
  return filter(x, ...fs);
}

/** Impacto de chasis / colisión con obstáculo. */
function impact({ seed = 51, heavy = false } = {}) {
  const rand = rng(seed);
  const n = seconds(heavy ? 1.1 : 0.45);
  const x = buf(n);
  const f0 = heavy ? 135 : 195;
  // golpe grave corto (equilibrado contra el cuerpo medio)
  mixInto(x, thump(n, heavy ? 120 : 185, heavy ? 48 : 95, heavy ? 0.1 : 0.055), 0, 0.55);
  // crack transitorio + escombros
  mixInto(x, crack(seconds(heavy ? 0.12 : 0.06), {
    cut: heavy ? 1500 : 2600, q: 0.7, decay: heavy ? 0.045 : 0.025, rand,
  }), 0, heavy ? 1.6 : 1.3);
  mixInto(x, crack(seconds(heavy ? 0.35 : 0.16), {
    cut: heavy ? 1600 : 1700, q: 0.6, decay: heavy ? 0.14 : 0.05, rand,
  }), 0, heavy ? 1.1 : 0.6);
  // modos resonantes del cuerpo
  mixInto(x, modeBank(n, f0, bodyModes(f0, heavy ? 0.3 : 0.14), rand), 0, heavy ? 0.8 : 0.65);
  // chatarra secundaria
  const clacks = heavy ? 6 : 3;
  for (let k = 0; k < clacks; k++) {
    const off = seconds(0.02 + rand() * (heavy ? 0.5 : 0.12));
    mixInto(x, crack(seconds(0.05), { cut: 900 + rand() * 2400, q: 2.2, decay: 0.012, rand }), off, (heavy ? 0.6 : 0.4) * (1 - k / (clacks + 1)));
  }
  return normalize(x, heavy ? 0.98 : 0.88);
}

/** Golpe seco de tope de suspensión (bottom-out): receta de golpe "seco"
 *  (ruido de ataque ≤3 ms + modos altos 800-3000 Hz + barrido descendente). */
function bottomOut({ seed = 41, heavy = false } = {}) {
  const rand = rng(seed);
  const n = seconds(heavy ? 0.55 : 0.38);
  const x = buf(n);
  const f0 = heavy ? 420 : 560;
  // golpe grave del amortiguador
  mixInto(x, thump(n, heavy ? 95 : 115, heavy ? 42 : 55, heavy ? 0.11 : 0.075), 0, 1.0);
  // clac seco: ataque de ruido muy corto
  mixInto(x, crack(seconds(0.02), { cut: heavy ? 3000 : 4200, q: 0.8, decay: 0.003, rand }), 0, 1.0);
  // barrido descendente tipo "909" (sensación de clac contra el tope)
  const sweep = buf(seconds(0.12));
  let phase = 0;
  for (let i = 0; i < sweep.length; i++) {
    const t = i / SR;
    const f = f0 * 1.9 * (1 + 0.9 * Math.exp(-t / 0.03));
    phase += (TAU * f) / SR;
    sweep[i] = Math.sin(phase) * Math.exp(-t / 0.045);
  }
  mixInto(x, sweep, 0, 0.6);
  // modos altos del cuerpo (800-3000 Hz), τ cortos
  mixInto(x, modeBank(n, f0, bodyModes(f0, heavy ? 0.1 : 0.06, 0.9), rand), 0, 0.85);
  return normalize(x, heavy ? 0.95 : 0.85);
}

/** Clunk de extensión / rebote de suspensión (seco y metálico). */
function suspClunk({ seed = 43 } = {}) {
  const rand = rng(seed);
  const n = seconds(0.22);
  const x = buf(n);
  mixInto(x, thump(n, 150, 85, 0.038), 0, 0.6);
  mixInto(x, crack(seconds(0.045), { cut: 3000, q: 1.3, decay: 0.012, rand }), 0, 1.1);
  mixInto(x, modeBank(n, 330, bodyModes(330, 0.045, 0.5), rand), 0, 0.7);
  return normalize(x, 0.8);
}

/** Aterrizaje de salto: impacto amortiguado + muelle + gravilla. */
function landing({ seed = 61 } = {}) {
  const rand = rng(seed);
  const n = seconds(0.8);
  const x = buf(n);
  mixInto(x, thump(n, 110, 48, 0.11), 0, 0.7);
  mixInto(x, crack(seconds(0.1), { cut: 1800, q: 0.8, decay: 0.03, rand }), 0, 1.0);
  mixInto(x, modeBank(n, 150, bodyModes(150, 0.14, 0.7), rand), 0, 0.65);
  // "boing" de muelle
  const spring = buf(seconds(0.5));
  let phase = 0;
  for (let i = 0; i < spring.length; i++) {
    const t = i / SR;
    const f = 105 + 35 * Math.exp(-t / 0.09);
    phase += (TAU * f) / SR;
    spring[i] = Math.sin(phase) * Math.exp(-t / 0.17);
  }
  mixInto(x, spring, 0, 0.45);
  // gravilla al apoyar
  mixInto(x, grainTrain(seconds(0.35), rand, { count: 22, f: 1400, ampMin: 0.15, ampMax: 0.7 }), seconds(0.02), 0.85);
  return normalize(x, 0.92);
}

/** Ráfaga de badenes (rumble de baja frecuencia con textura). */
function whoopsRumble({ seed = 71 } = {}) {
  const rand = rng(seed);
  const n = seconds(0.65);
  let x = filterLoop(loopNoise(n, rand), biquad('lp', 320, 0.9));
  lfoAM(x, { cycles: 11, depth: 0.85 });
  mixInto(x, grainTrain(n, rand, { count: 26, f: 700, ampMin: 0.1, ampMax: 0.5 }), 0, 0.5);
  const sub = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (TAU * 55) / SR;
    sub[i] = Math.sin(phase) * 0.5 + Math.sin(2 * phase) * 0.2;
  }
  mixInto(x, sub, 0, 0.5);
  return normalize(x, 0.85);
}

/** Vuelco: choque + modos + raspado largo con chatarra. */
function rollover({ seed = 101 } = {}) {
  const rand = rng(seed);
  const n = seconds(1.5);
  const x = buf(n);
  mixInto(x, thump(n, 130, 40, 0.13), 0, 0.5);
  mixInto(x, crack(seconds(0.15), { cut: 1300, q: 0.7, decay: 0.055, rand }), 0, 1.3);
  mixInto(x, crack(seconds(0.4), { cut: 950, q: 0.6, decay: 0.14, rand }), 0, 0.7);
  mixInto(x, modeBank(n, 120, bodyModes(120, 0.28), rand), 0, 0.7);
  mixInto(x, scrapeLoop({ dur: 1.0, seed: 102 }), seconds(0.12), 0.5);
  for (let k = 0; k < 5; k++) {
    const off = seconds(0.05 + rand() * 0.8);
    mixInto(x, crack(seconds(0.05), { cut: 900 + rand() * 2000, q: 2.4, decay: 0.012, rand }), off, 0.45 * (1 - k / 6));
  }
  return normalize(x, 0.95);
}

/** Click de UI: crack de ruido + ping corto. */
function uiClick({ seed = 111, f = 2400 } = {}) {
  const rand = rng(seed);
  const n = seconds(0.06);
  const x = buf(n);
  mixInto(x, crack(seconds(0.012), { cut: 3400, q: 1.1, decay: 0.004, rand }), 0, 1);
  const ping = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (TAU * f) / SR;
    ping[i] = (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * Math.exp(-t / 0.01);
  }
  mixInto(x, ping, 0, 0.8);
  return normalize(x, 0.55);
}

/** Bip de cuenta atrás (3-2-1). */
function countdownBeep({ f = 880, dur = 0.16, bright = false } = {}) {
  const n = seconds(dur);
  const x = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / (dur * 0.45));
    phase += (TAU * f) / SR;
    x[i] = (Math.sin(phase) + (bright ? 0.35 : 0.12) * Math.sin(2 * phase)) * env;
  }
  return normalize(x, 0.6);
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

const SOUNDS = [
  // --- Tier A ---
  {
    name: 'engine_offroad_loop',
    kind: 'loop',
    group: 'motor',
    desc: 'Motor V8 ronco (todoterreno 4x4). Ritmo de encendido base 60 Hz, escalar con playbackRate.',
    baseFreq: 60,
    gain: 0.55,
    build: () => normalize(engineLoop({
      dur: 2, pulseRate: 60,
      pattern: [1, 0.78, 0.92, 0.85],       // irregularidad tipo crossplane
      jitter: 0.26, tau: 0.0042, pulseLen: 0.035,
      formants: [[200, 6, 1.3], [400, 5, 1.15], [550, 4.5, 1.0], [750, 4, 0.85], [1150, 2.5, 0.22], [2100, 2, 0.07]],
      sub: 0.5, noiseBed: 0.22, noiseCut: 800, breathe: 0.6, rough: 0.09, postLp: 2200, seed: 201,
    }), 0.8),
  },
  {
    name: 'engine_kwid_loop',
    kind: 'loop',
    group: 'motor',
    desc: 'Motor de 3 cilindros ligero (Kwid). Ritmo de encendido base 60 Hz, escalar con playbackRate.',
    baseFreq: 60,
    gain: 0.5,
    build: () => normalize(engineLoop({
      dur: 2, pulseRate: 60,
      pattern: [1, 0.9, 0.95],
      jitter: 0.2, tau: 0.0028, pulseLen: 0.025,
      formants: [[235, 6, 1.25], [430, 5, 1.1], [600, 4.5, 1.0], [800, 4, 0.85], [1400, 2.5, 0.28], [2500, 2, 0.09]],
      sub: 0.25, noiseBed: 0.22, noiseCut: 1000, breathe: 0.5, rough: 0.07, postLp: 2800, seed: 202,
    }), 0.8),
  },
  {
    name: 'engine_ev_loop',
    kind: 'loop',
    group: 'motor',
    desc: 'Zumbido eléctrico + whine de engranaje/inversor (Tesla). Escalar con playbackRate.',
    baseFreq: 100,
    gain: 0.5,
    build: () => normalize(evLoop(), 0.8),
  },
  {
    name: 'roll_asphalt_loop',
    kind: 'loop',
    group: 'rodadura',
    desc: 'Rodadura continua sobre asfalto (lecho grave + granos finos). Escalar volumen con velocidad.',
    gain: 0.45,
    build: () => normalize(rollingLoop({
      bedCut: 520, bedGain: 0.95, grainCount: 14, grainBand: 650, grainAmp: 0.22,
      swish: 0.06, swishCut: 1800, amCycles: 6, amDepth: 0.2, seed: 211,
    }), 0.75),
  },
  {
    name: 'roll_dirt_loop',
    kind: 'loop',
    group: 'rodadura',
    desc: 'Rodadura sobre tierra con gravilla granular. Escalar volumen con velocidad.',
    gain: 0.5,
    build: () => normalize(rollingLoop({
      bedCut: 430, bedGain: 0.8, grainCount: 46, grainBand: 800, grainAmp: 0.9,
      swish: 0.1, swishCut: 1800, amCycles: 14, amDepth: 0.35, seed: 212,
    }), 0.75),
  },
  {
    name: 'roll_grass_loop',
    kind: 'loop',
    group: 'rodadura',
    desc: 'Rodadura sobre hierba (lecho suave + swish). Escalar volumen con velocidad.',
    gain: 0.5,
    build: () => normalize(rollingLoop({
      bedCut: 380, bedGain: 0.7, grainCount: 30, grainBand: 1000, grainAmp: 0.5,
      swish: 0.35, swishCut: 1800, amCycles: 10, amDepth: 0.3, seed: 213,
    }), 0.75),
  },
  {
    name: 'tire_squeal_loop',
    kind: 'loop',
    group: 'neumático',
    desc: 'Chirrido de neumático en límite de adherencia (rugido + tonos stick-slip). Escalar con slip.',
    gain: 0.5,
    build: () => normalize(squealLoop(), 0.7),
  },
  // --- Tier B ---
  {
    name: 'brake_squeal_loop',
    kind: 'loop',
    group: 'neumático',
    desc: 'Chirrido de frenado/bloqueo de ruedas (más agudo y estable).',
    gain: 0.5,
    build: () => normalize(squealLoop({
      dur: 1.6, roarBand: [180, 850], roarGain: 1.0, tones: [1350, 2025, 2700, 4050],
      toneAmp: [0.75, 0.4, 0.22, 0.1], vibDepth: 34, hissCut: 2600, hiss: 0.22,
      grainRate: 12, grainDepth: 0.35, seed: 221,
    }), 0.7),
  },
  {
    name: 'wheelspin_loop',
    kind: 'loop',
    group: 'neumático',
    desc: 'Patinaje de ruedas en vacío / derrape fuerte.',
    gain: 0.5,
    build: () => normalize(wheelspinLoop(), 0.7),
  },
  {
    name: 'scrape_loop',
    kind: 'loop',
    group: 'chasis',
    desc: 'Raspado continuo de bajos contra el suelo (granos metálicos).',
    gain: 0.45,
    build: () => normalize(scrapeLoop(), 0.7),
  },
  {
    name: 'wind_loop',
    kind: 'loop',
    group: 'ambiente',
    desc: 'Viento / aire a velocidad. Escalar con velocidad y cámara.',
    gain: 0.3,
    build: () => normalize(windLoop(), 0.6),
  },
  {
    name: 'susp_bottomout',
    kind: 'oneshot',
    group: 'suspensión',
    desc: 'Golpe seco de tope de suspensión (bottom-out).',
    gain: 0.85,
    build: () => bottomOut(),
  },
  {
    name: 'susp_bottomout_heavy',
    kind: 'oneshot',
    group: 'suspensión',
    desc: 'Golpe de tope fuerte (gran compresión / aterrizaje duro).',
    gain: 0.9,
    build: () => bottomOut({ heavy: true }),
  },
  {
    name: 'susp_clunk',
    kind: 'oneshot',
    group: 'suspensión',
    desc: 'Clunk de extensión/rebote de suspensión.',
    gain: 0.75,
    build: () => suspClunk(),
  },
  {
    name: 'land_thump',
    kind: 'oneshot',
    group: 'suspensión',
    desc: 'Aterrizaje de salto (impacto amortiguado + muelle + gravilla).',
    gain: 0.9,
    build: () => landing(),
  },
  {
    name: 'whoops_rumble',
    kind: 'oneshot',
    group: 'suspensión',
    desc: 'Ráfaga de badenes (rumble de baja frecuencia granulado).',
    gain: 0.8,
    build: () => whoopsRumble(),
  },
  {
    name: 'impact_light',
    kind: 'oneshot',
    group: 'impacto',
    desc: 'Impacto ligero (chasis contra obstáculo, roce de borde).',
    gain: 0.8,
    build: () => impact(),
  },
  {
    name: 'impact_heavy',
    kind: 'oneshot',
    group: 'impacto',
    desc: 'Impacto fuerte (colisión de alta energía).',
    gain: 0.95,
    build: () => impact({ heavy: true }),
  },
  {
    name: 'rollover',
    kind: 'oneshot',
    group: 'impacto',
    desc: 'Vuelco (choque + modos + raspado largo con chatarra).',
    gain: 0.95,
    build: () => rollover(),
  },
  {
    name: 'ui_click',
    kind: 'oneshot',
    group: 'ui',
    desc: 'Click de UI: botones, sliders, teclas.',
    gain: 0.4,
    build: () => uiClick(),
  },
  {
    name: 'countdown_beep',
    kind: 'oneshot',
    group: 'ui',
    desc: 'Bip de cuenta atrás (3-2-1).',
    gain: 0.5,
    build: () => countdownBeep(),
  },
  {
    name: 'countdown_go',
    kind: 'oneshot',
    group: 'ui',
    desc: 'Bip final de salida ("¡VAMOS!").',
    gain: 0.55,
    build: () => countdownBeep({ f: 1320, dur: 0.5, bright: true }),
  },
];

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

function writeWav(name, samples) {
  const n = samples.length;
  const path = join(OUT_DIR, `${name}.wav`);
  const bufWav = Buffer.alloc(44 + n * 2);
  bufWav.write('RIFF', 0);
  bufWav.writeUInt32LE(36 + n * 2, 4);
  bufWav.write('WAVE', 8);
  bufWav.write('fmt ', 12);
  bufWav.writeUInt32LE(16, 16);
  bufWav.writeUInt16LE(1, 20); // PCM
  bufWav.writeUInt16LE(1, 22); // mono
  bufWav.writeUInt32LE(SR, 24);
  bufWav.writeUInt32LE(SR * 2, 28);
  bufWav.writeUInt16LE(2, 32);
  bufWav.writeUInt16LE(16, 34);
  bufWav.write('data', 36);
  bufWav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    bufWav.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, bufWav);
  return { path, bytes: bufWav.length, seconds: n / SR };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

  if (args.includes('--list')) {
    for (const s of SOUNDS) console.log(`${s.name.padEnd(24)} ${s.kind.padEnd(8)} [${s.group}] ${s.desc}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const s of SOUNDS) {
    if (only && !s.name.includes(only)) continue;
    const t0 = Date.now();
    const samples = s.build();
    if (s.kind === 'loop') checkLoop(s.name, samples);
    const info = writeWav(s.name, samples);
    manifest.push({
      name: `${s.name}.wav`,
      kind: s.kind,
      group: s.group,
      desc: s.desc,
      gain: s.gain,
      ...(s.baseFreq ? { baseFreq: s.baseFreq } : {}),
    });
    console.log(`✓ ${s.name}.wav  (${info.seconds.toFixed(2)} s, ${(info.bytes / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`);
  }
  if (!only) {
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Variante JS para poder cargarlo desde file:// (la página de audición).
    writeFileSync(join(OUT_DIR, 'manifest.js'), `window.SFX_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`);
    console.log(`\nmanifest.json escrito con ${manifest.length} sonidos en ${OUT_DIR}`);
  }
}

main();
