/** Sonda rápida de controles táctiles: escritorio oculto, móvil visible y conduce. */
import { chromium } from 'playwright';

const URL = process.env.LAUNCH_URL ?? 'http://127.0.0.1:5173';
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// --- 1. Escritorio: sin controles táctiles ni errores ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction(
      () => document.getElementById('loading')?.classList.contains('done') === true,
      { timeout: 25000 },
    );
  } catch { /* el check lo dirá */ }
  const st = await page.evaluate(() => ({
    done: document.getElementById('loading')?.classList.contains('done'),
    tc: document.getElementById('touch-controls'),
    touchCls: document.body.classList.contains('touch'),
  }));
  check('escritorio: carga completa', st.done === true);
  check('escritorio: sin controles táctiles', st.tc === null && st.touchCls === false,
    `tc=${!!st.tc} body.touch=${st.touchCls}`);
  check('escritorio: sin errores de consola', errors.length === 0, errors.join(' | '));
  await page.close();
}

// --- 2. Móvil emulado: controles visibles y conducen ---
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction(
      () => document.getElementById('loading')?.classList.contains('done') === true,
      { timeout: 25000 },
    );
  } catch { /* el check lo dirá */ }
  const st = await page.evaluate(() => ({
    done: document.getElementById('loading')?.classList.contains('done'),
    tc: !!document.getElementById('touch-controls'),
    btns: document.querySelectorAll('#touch-controls [data-tc]').length,
    tiltHidden: document.querySelector('[data-tc="tilt"]')?.classList.contains('hidden'),
  }));
  check('móvil: carga completa', st.done === true);
  check('móvil: controles visibles', st.tc === true && st.btns >= 8, `${st.btns} botones`);
  check('móvil: sin errores de consola', errors.length === 0, errors.join(' | '));

  // GAS táctil → throttle 1 en la sim
  await page.evaluate(() => window.__sim?.input.update?.(0.016));
  const gas = await page.locator('[data-tc="gas"]');
  await gas.dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__sim?.input.state.throttle === 1, { timeout: 3000 })
    .catch(() => undefined);
  const thro = await page.evaluate(() => window.__sim?.input.state.throttle);
  check('móvil: GAS acelera', thro === 1, `throttle=${thro}`);

  // El coche avanza con el GAS mantenido
  const before = await page.evaluate(() => ({ x: window.__sim.vehicle.position.x, z: window.__sim.vehicle.position.z }));
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    hud: document.getElementById('speed')?.textContent,
    x: window.__sim.vehicle.position.x, z: window.__sim.vehicle.position.z,
  }));
  await gas.dispatchEvent('pointerup');
  const adv = Math.hypot(after.x - before.x, after.z - before.z);
  check('móvil: el coche avanza con GAS', Number(after.hud) > 10 && adv > 1.5,
    `${after.hud} km/h · ${adv.toFixed(1)} m`);

  // ◀ táctil → steer negativo
  const left = await page.locator('[data-tc="left"]');
  await left.dispatchEvent('pointerdown');
  await page.waitForTimeout(600);
  const steer = await page.evaluate(() => window.__sim?.input.state.steer);
  await left.dispatchEvent('pointerup');
  check('móvil: ◀ gira a la izquierda', steer < -0.2, `steer=${steer?.toFixed(2)}`);

  // Tilt simulado: activar y empujar una muestra por software
  const tiltOk = await page.evaluate(() => {
    const sim = window.__sim;
    if (!sim) return 'sin sim';
    sim.input.tilt.enabled = true;
    sim.input.tilt.active = true;
    sim.input.tilt.steer = 0.8;
    sim.input.update(0.5);
    return sim.input.state.steer;
  });
  check('móvil: el tilt dirige la dirección', typeof tiltOk === 'number' && tiltOk > 0.2,
    `steer=${typeof tiltOk === 'number' ? tiltOk.toFixed(2) : tiltOk}`);

  await page.screenshot({ path: '.launch/10-touch.png' });
  await ctx.close();
}

console.log(failures === 0 ? '✅ TÁCTIL VALIDADO' : `❌ ${failures} FALLO(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
