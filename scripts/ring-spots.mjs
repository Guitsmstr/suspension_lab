/**
 * Fotografía puntos conflictivos del anillo (teletransporte + órbita).
 *
 *   SPOTS='[{"s":8926,"x":-1395.8,"z":-1890.4,"yaw":1.836}]' pnpm exec node scripts/ring-spots.mjs
 *
 * Guarda .launch/spot-<s>-orbit.png y .launch/spot-<s>-chase.png.
 */
import { chromium } from 'playwright';

const URL = process.env.LAUNCH_URL ?? 'http://127.0.0.1:5173';
const SPOTS = JSON.parse(process.env.SPOTS ?? '[]');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(
  () => document.getElementById('loading')?.classList.contains('done') === true,
  { timeout: 30000 },
);
// entrar al anillo
await page.keyboard.press('m');
await page.waitForFunction(() => !document.getElementById('menu')?.classList.contains('hidden'), { timeout: 5000 });
await page.evaluate(() => document.querySelector('#menu-ring [data-track="nurburgring"]')?.click());
await page.keyboard.press('m');
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('hidden'), { timeout: 5000 });
await page.waitForTimeout(1500);

for (const sp of SPOTS) {
  await page.evaluate(({ x, z, yaw }) => {
    const sim = window.__sim;
    sim.vehicle.setSpawn(x, z, yaw);
    sim.ring.ensureAround(x, z);
  }, sp);
  await page.waitForTimeout(2000);
  // órbita alta: la cinta y la hierba alrededor
  await page.evaluate(() => window.__sim?.cameraRig.setView(Math.PI * 0.3, 0.9, 30));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.launch/spot-${sp.s}-orbit.png` });
  // persecución: lo que ve el conductor
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await page.waitForTimeout(400);
  await page.keyboard.press('c');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.launch/spot-${sp.s}-chase.png` });
  const st = await page.evaluate(() => ({
    y: window.__sim.vehicle.position.y,
    ground: window.__sim.ring.terrain.heightAt(
      window.__sim.vehicle.position.x, window.__sim.vehicle.position.z),
  }));
  console.log(`s=${sp.s}: y=${st.y.toFixed(2)} suelo=${st.ground.toFixed(2)}`);
}
console.log(errors.length ? `ERRORES: ${errors.join(' | ')}` : 'sin errores');
await browser.close();
