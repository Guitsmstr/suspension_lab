/**
 * Capturas rápidas de un coche (3/4, frontal, lateral) en .launch/.
 *
 *   node scripts/shot_car.mjs [tesla]
 *
 * Requiere `pnpm dev` corriendo. Si se pasa un nombre de coche distinto al
 * activo, lo selecciona con V hasta dar con él (máx. 3 intentos).
 */
import { chromium } from 'playwright';

const want = process.argv[2] ?? null;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 2560, height: 1600 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(
  () => document.getElementById('loading')?.classList.contains('done'),
  null,
  { timeout: 30000 },
);
await page.waitForTimeout(1500);

if (want) {
  for (let i = 0; i < 3; i++) {
    const badge = await page.evaluate(() => window.__sim?.carId?.() ?? '');
    if (badge === want) break;
    await page.keyboard.press('v');
    await page.waitForTimeout(1500);
  }
}

const yaw = await page.evaluate(() => {
  const q = window.__sim.vehicle.quaternion;
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
});
const car = await page.evaluate(() => window.__sim?.carId?.() ?? 'coche');
for (const [dyaw, name] of [[0.6, '34'], [Math.PI, 'front'], [Math.PI / 2, 'side']]) {
  await page.evaluate(([y, d]) => window.__sim?.cameraRig.setView(y + d, 1.28, 6.0), [yaw, dyaw]);
  await page.waitForTimeout(1500);
  const out = `.launch/${car}-${name}.png`;
  await page.screenshot({ path: out });
  console.log(' ', out);
}
await browser.close();
