/**
 * Validación del Nürburgring 1:1 en navegador real (headless, SwiftShader).
 *
 *   pnpm exec node scripts/ring-check.mjs  (con `pnpm dev` corriendo)
 *
 * Entra al anillo desde el menú, verifica mundo/física/crono y guarda
 * capturas en .launch/.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.LAUNCH_URL ?? 'http://127.0.0.1:5173';
const OUT = '.launch';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => {
  errors.push(`pageerror: ${err.message}`);
  console.log(`  pageerror: ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(`console: ${msg.text()}`);
    console.log(`  consola: ${msg.text()}`);
  }
});

console.log(`\n▶ Nordschleife 1:1 en ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.waitForFunction(
    () => document.getElementById('loading')?.classList.contains('done') === true,
    { timeout: 30000 },
  );
} catch {
  check('la app arranca', false);
  await browser.close();
  process.exit(1);
}
check('la app arranca', true);

// --- entrar al anillo desde el menú ---
await page.keyboard.press('m');
await page.waitForFunction(() => !document.getElementById('menu')?.classList.contains('hidden'), { timeout: 5000 });
const ringCard = await page.evaluate(() => {
  const el = document.querySelector('#menu-ring [data-track="nurburgring"]');
  return el ? el.textContent : null;
});
check('el menú ofrece el Nordschleife 1:1', ringCard !== null, (ringCard ?? '').slice(0, 80));
await page.evaluate(() => document.querySelector('#menu-ring [data-track="nurburgring"]')?.click());
await page.keyboard.press('m'); // cerrar el menú (elegir no cierra solo)
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('hidden'), { timeout: 5000 });
await page.waitForTimeout(2500); // construcción inicial de teselas
const state = await page.evaluate(() => {
  const sim = window.__sim;
  const t = sim.ring.terrain;
  return {
    track: sim.trackId(),
    badge: document.getElementById('track-badge')?.textContent ?? '?',
    x: sim.vehicle.position.x,
    y: sim.vehicle.position.y,
    z: sim.vehicle.position.z,
    ground: t.heightAt(sim.vehicle.position.x, sim.vehicle.position.z),
    surface: sim.vehicle.telemetry.surface,
    tiles: sim.ring.tileCount,
    roadVerts: sim.ring.group.children[0].geometry.getAttribute('position').count,
    far: sim.camera.far,
  };
});
console.log('  estado:', JSON.stringify(state));
check('mundo anillo activo', state.track === 'nurburgring', state.track);
check('insignia del anillo', state.badge.includes('Nordschleife'), state.badge);
check('coche sobre la pista (cota coherente)', Math.abs(state.y - state.ground - 0.52) < 0.15,
  `y=${state.y.toFixed(2)} suelo=${state.ground.toFixed(2)}`);
check('superficie: asfalto', state.surface === 'asphalt', state.surface);
check('teselas con streaming', state.tiles >= 9, `${state.tiles} teselas`);
check('calzada completa (76k vértices)', state.roadVerts > 70000, `${state.roadVerts} vértices`);
check('cámara de lejos (far 6000)', state.far === 6000, `far=${state.far}`);
await page.screenshot({ path: `${OUT}/10-ring-spawn.png` });

// --- vista panorámica del valle ---
await page.evaluate(() => window.__sim?.cameraRig.setView(Math.PI * 0.75, 1.15, 30));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/11-ring-valley.png` });
await page.keyboard.press('c'); // volver a persecución
await page.waitForTimeout(400);

// --- conducir: acelerar por Döttinger Höhe (sin volante: si la trazada se
//     curva, acabará en la hierba como un conductor real despistado) ---
await page.keyboard.down('w');
await page.waitForTimeout(1500);
const early = await page.evaluate(() => ({
  speed: document.getElementById('speed')?.textContent ?? '?',
  surface: window.__sim.vehicle.telemetry.surface,
}));
await page.waitForTimeout(4500);
await page.keyboard.up('w');
const drive = await page.evaluate(() => {
  const sim = window.__sim;
  return {
    speed: document.getElementById('speed')?.textContent ?? '?',
    surface: sim.vehicle.telemetry.surface,
    x: sim.vehicle.position.x,
    y: sim.vehicle.position.y,
    z: sim.vehicle.position.z,
    ground: sim.ring.terrain.heightAt(sim.vehicle.position.x, sim.vehicle.position.z),
    contact: sim.vehicle.cornerStates.every((s) => s.contact),
    finite: [sim.vehicle.position, sim.vehicle.velocity].every((v) =>
      Number.isFinite(v.x + v.y + v.z)),
    tiles: sim.ring.tileCount,
    lap: document.getElementById('lap-time')?.textContent ?? '?',
  };
});
console.log('  conduciendo:', JSON.stringify(drive));
const kmh = Number(drive.speed);
check('el coche acelera en el anillo', Number.isFinite(kmh) && kmh > 40, `${drive.speed} km/h`);
check('al inicio rueda sobre asfalto', early.surface === 'asphalt', `${early.speed} km/h en ${early.surface}`);
check('física finita a velocidad', drive.finite, `contacto total: ${drive.contact}`);
check('cota coherente a velocidad', Math.abs(drive.y - drive.ground - 0.52) < 0.6,
  `y=${drive.y.toFixed(1)} suelo=${drive.ground.toFixed(1)}`);
check('el crono corre', drive.lap !== '0:00.0' && drive.lap !== '—', `vuelta ${drive.lap}`);
check('streaming sigue al coche', drive.tiles >= 9, `${drive.tiles} teselas`);
await page.screenshot({ path: `${OUT}/12-ring-driving.png` });

// --- R: reaparece en la salida, de vuelta al asfalto ---
await page.keyboard.press('r');
try {
  await page.waitForFunction(() => document.getElementById('countdown')?.hidden !== false, { timeout: 30000 });
} catch { /* se valida con el estado real */ }
await page.waitForTimeout(800);
const respawn = await page.evaluate(() => {
  const sim = window.__sim;
  return {
    surface: sim.vehicle.telemetry.surface,
    speed: sim.vehicle.telemetry.speedKph,
  };
});
check('R devuelve el coche al asfalto', respawn.surface === 'asphalt', `${respawn.surface} a ${respawn.speed.toFixed(0)} km/h`);

// --- volver al mundo pequeño sin errores ---
await page.keyboard.press('t');
await page.waitForTimeout(1200);
const back = await page.evaluate(() => ({
  track: window.__sim.trackId(),
  far: window.__sim.camera.far,
}));
check('T vuelve al mundo pequeño', back.track === 'monaco' && back.far === 1200, JSON.stringify(back));

check('sin errores de consola ni de página', errors.length === 0,
  errors.length ? errors.join(' | ').slice(0, 400) : 'limpio');

console.log(failures === 0 ? '✅ ANILLO VALIDADO' : `❌ ${failures} COMPROBACIÓN(ES) FALLAN`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
