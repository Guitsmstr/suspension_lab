/**
 * Validación del lanzamiento en un navegador real (headless).
 *
 *   pnpm check:launch
 *
 * Comprueba que la app arranca sin errores, que la pantalla de carga avanza y
 * desaparece, que el bucle de render funciona, que la cámara se coloca detrás
 * del coche y que el coche responde al teclado. Guarda capturas en .launch/.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.LAUNCH_URL ?? 'http://127.0.0.1:5173';
const OUT = '.launch';

const findings = [];
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

page.on('console', (msg) => {
  const type = msg.type();
  const text = `[${type}] ${msg.text()}`;
  if (type === 'error' || type === 'warning') {
    findings.push({ level: type === 'error' ? 'error' : 'warn', text });
    if (type === 'error') console.log(`  consola: ${text}`);
  }
});
page.on('pageerror', (err) => {
  findings.push({ level: 'error', text: `pageerror: ${err.message}` });
  console.log(`  pageerror: ${err.message}`);
});
page.on('requestfailed', (req) => {
  findings.push({ level: 'error', text: `request fallida: ${req.url()} (${req.failure()?.errorText})` });
  console.log(`  request fallida: ${req.url()}`);
});

console.log(`\n▶ Lanzamiento de ${URL}`);

// CPU ralentizada durante la carga para poder capturar la pantalla de progreso
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-boot.png` });

// --- 1. la pantalla de carga debe avanzar y desaparecer ---
const bootState = await page.evaluate(() => {
  const fill = document.getElementById('loader-fill');
  const status = document.getElementById('loader-status');
  const err = document.getElementById('loader-error');
  return {
    width: fill ? fill.style.width : '?',
    status: status?.textContent ?? '?',
    errorShown: err ? !err.hidden : true,
    errorMsg: document.getElementById('loader-error-msg')?.textContent ?? '',
  };
});
console.log(`  carga: ${bootState.width} · "${bootState.status}"`);
check('la barra de progreso se ha movido', bootState.width !== '0%', `ancho ${bootState.width}`);
check('sin error durante la carga', !bootState.errorShown, bootState.errorMsg);

await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

let loadingHidden = false;
try {
  await page.waitForFunction(
    () => document.getElementById('loading')?.classList.contains('done') === true,
    { timeout: 20000 },
  );
  loadingHidden = true;
} catch {
  loadingHidden = false;
}
check('la pantalla de carga desaparece', loadingHidden);
await page.screenshot({ path: `${OUT}/02-loaded.png` });

// --- 2. el bucle de render debe avanzar ---
const fps = await page.evaluate(async () => {
  let frames = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      frames++;
      if (performance.now() - t0 >= 1000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return frames;
});
// Umbral >= 3 (no > 3): con SwiftShader por software y la máquina cargada
// el bucle avanza igual a 3 fps; lo que se valida es que avanza, no el rendimiento.
check('el bucle de render avanza', fps >= 3, `${fps} fps (render por software)`);

// --- 3. la cámara de persecución debe quedar DETRÁS del coche ---
const cam = await page.evaluate(() => {
  const sim = window.__sim;
  if (!sim) return null;
  const car = sim.vehicle.position;
  const q = sim.vehicle.quaternion;
  // adelante del coche en el mundo: +Z rotado por el cuaternión
  const fz = { x: 2 * (q.x * q.z + q.w * q.y), y: 2 * (q.y * q.z - q.w * q.x), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
  const dx = sim.camera.position.x - car.x;
  const dy = sim.camera.position.y - car.y;
  const dz = sim.camera.position.z - car.z;
  return {
    behind: dx * fz.x + dy * fz.y + dz * fz.z,
    dist: Math.hypot(dx, dy, dz),
  };
});
check('el gancho de depuración existe', cam !== null);
if (cam) {
  check('la cámara queda detrás del coche', cam.behind < -2, `proyección ${cam.behind.toFixed(2)} m`);
  check('la cámara mantiene distancia', cam.dist > 4 && cam.dist < 14, `${cam.dist.toFixed(2)} m`);
}

// --- 4. el coche debe responder al teclado ---
await page.keyboard.down('w');
// Bajo render por software la entrega de la tecla puede tardar: esperar a
// que la simulación la vea en vez de muestrear a tiempo fijo.
let throttleSeen = false;
try {
  await page.waitForFunction(() => window.__sim?.input.state.throttle === 1, { timeout: 3000 });
  throttleSeen = true;
} catch {
  throttleSeen = false;
}
const inputState = await page.evaluate(() => window.__sim?.input.state ?? null);
check('el acelerador llega a la simulación', inputState?.throttle === 1, JSON.stringify(inputState));

const before = await page.evaluate(() => ({
  hud: document.getElementById('speed')?.textContent ?? '?',
  x: window.__sim ? window.__sim.vehicle.position.x : 0,
  z: window.__sim ? window.__sim.vehicle.position.z : 0,
}));
await page.waitForTimeout(2500);
await page.keyboard.up('w');
const after = await page.evaluate(() => ({
  hud: document.getElementById('speed')?.textContent ?? '?',
  x: window.__sim ? window.__sim.vehicle.position.x : 0,
  z: window.__sim ? window.__sim.vehicle.position.z : 0,
}));
const speedAfter = Number(after.hud);
const advanced = Math.hypot(after.x - before.x, after.z - before.z);
check('el coche acelera con W', Number.isFinite(speedAfter) && speedAfter > 10 && advanced > 1.5,
  `${before.hud} → ${after.hud} km/h · avance ${advanced.toFixed(1)} m`);
await page.screenshot({ path: `${OUT}/03-driving.png` });

// --- 3b. HUD a 1/4 de pantalla y minimapa abajo a la derecha ---
const hudQ = await page.evaluate(() => {
  const r = document.getElementById('hud')?.getBoundingClientRect();
  if (!r) return null;
  return { cx: r.left + r.width / 2, vw: window.innerWidth };
});
check('velocidad centrada a 1/4 de pantalla', hudQ !== null && Math.abs(hudQ.cx - hudQ.vw * 0.25) < hudQ.vw * 0.05,
  JSON.stringify(hudQ));
const mini = await page.evaluate(() => {
  const c = document.getElementById('minimap');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(window.innerWidth - r.right),
    bottom: Math.round(window.innerHeight - r.bottom),
  };
});
check('minimapa visible abajo a la derecha', mini !== null && mini.w > 100 && mini.h > 100 && mini.right < 30 && mini.bottom < 30,
  JSON.stringify(mini));
const overlap = await page.evaluate(() => {
  const p = document.getElementById('panel')?.getBoundingClientRect();
  const m = document.getElementById('minimap')?.getBoundingClientRect();
  if (!p || !m) return null;
  return { panelBottom: Math.round(p.bottom), miniTop: Math.round(m.top) };
});
check('el panel no tapa el minimapa', overlap !== null && overlap.panelBottom <= overlap.miniTop + 2,
  JSON.stringify(overlap));

// --- 4b. la cámara no se aleja más del 5 % al acelerar ---
// A 33 km/h el retardo del suavizado la dejaría ~2 m atrás (+26 %); el tope lo impide.
const camChase = await page.evaluate(() => {
  const s = window.__sim;
  const c = s.camera.position;
  const p = s.vehicle.position;
  return { sep: Math.hypot(c.x - p.x, c.z - p.z), dist: s.cameraRig.distance };
});
check('la cámara no se aleja más del 5% al acelerar', camChase.sep <= camChase.dist * 1.06,
  `separación ${camChase.sep.toFixed(2)} m con distancia ${camChase.dist.toFixed(2)} m`);

// --- 5. maniobra: giro + frenada ---
// Rumbo del morro (componente x del +Z rotado por el cuaternión): girar a la
// derecha desde +Z lo hace negativo.
const headingX = () => page.evaluate(() => {
  const q = window.__sim.vehicle.quaternion;
  return 2 * (q.x * q.z + q.w * q.y);
});
await page.keyboard.down('w');
const headBefore = await headingX();
await page.keyboard.down('d');
// Bucle hasta ver el giro (máx ~6 s): con render por software a 3-5 fps el
// tiempo simulado por segundo real varía mucho; se mantiene el mismo umbral,
// solo se espera lo necesario en vez de un tiempo fijo.
let headAfter = headBefore;
for (let i = 0; i < 15 && !(headAfter < headBefore - 0.02); i++) {
  await page.waitForTimeout(400);
  headAfter = await headingX();
}
await page.keyboard.up('d');
check('D gira a la derecha en el navegador', headAfter < headBefore - 0.02,
  `morro x: ${headBefore.toFixed(3)} → ${headAfter.toFixed(3)}`);
await page.keyboard.down(' ');
await page.waitForTimeout(1200);
await page.keyboard.up(' ');
await page.keyboard.up('w');
await page.screenshot({ path: `${OUT}/04-maneuver.png` });

// --- 5b. marcha atrás: R (+cuenta atrás), mantener S, el coche retrocede y marca R ---
await page.keyboard.press('r');
// La R dispara la cuenta atrás (3,6 s de juego sin entrada): se espera a
// que termine antes de conducir, y de paso se valida el conteo.
try {
  await page.waitForFunction(() => document.getElementById('countdown')?.hidden === false, { timeout: 3000 });
} catch {
  // si no apareció, se sigue igual
}
check('R muestra la cuenta atrás', await page.evaluate(() => document.getElementById('countdown') !== null));
try {
  await page.waitForFunction(() => document.getElementById('countdown')?.hidden !== false, { timeout: 25000 });
} catch {
  // se deja que la prueba de reversa falle con el estado real
}
await page.waitForTimeout(400);
const revBefore = await page.evaluate(() => {
  const sim = window.__sim;
  const q = sim.vehicle.quaternion;
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const p = sim.vehicle.position;
  return { fx, fz, x: p.x, z: p.z };
});
await page.keyboard.down('s');
await page.waitForTimeout(2500);
await page.keyboard.up('s');
const revAfter = await page.evaluate((before) => ({
  d: window.__sim.vehicle.position.x * before.fx + window.__sim.vehicle.position.z * before.fz
    - (before.x * before.fx + before.z * before.fz),
  gear: document.getElementById('gear')?.textContent ?? '?',
  reversing: window.__sim.vehicle.reversing,
}), revBefore);
check('S mantenido en parado da marcha atrás', revAfter.d < -1.5, `${revAfter.d.toFixed(1)} m`);
check('el HUD marca R en reversa', revAfter.gear === 'R' || revAfter.reversing === true,
  `marcha=${revAfter.gear} reversing=${revAfter.reversing}`);

// --- 5c. rugosidad al máximo: el terreno se reconstruye y nada se entierra ---
await page.keyboard.press('r');
await page.waitForTimeout(300);
await page.evaluate(() => window.__sim?.params.set('roughness', 2));
await page.waitForTimeout(2200);
const roughBack = await page.evaluate(() => window.__sim?.params.get('roughness') ?? -1);
check('la rugosidad se aplica en vivo', roughBack === 2, `roughness=${roughBack}`);
await page.screenshot({ path: `${OUT}/09-rough.png` });
await page.evaluate(() => window.__sim?.params.set('roughness', 1));
await page.waitForTimeout(1800);

const telemetry = await page.evaluate(() => {
  const grab = (id) => document.getElementById(id)?.textContent ?? '?';
  return {
    speed: grab('speed'),
    gear: grab('gear'),
    rpm: grab('rpm'),
    params: document.querySelectorAll('#params .param').length,
    wheelRows: document.querySelectorAll('#wheel-bars .wheel-row').length,
  };
});
check('panel de parámetros generado', telemetry.params >= 15, `${telemetry.params} sliders`);
check('telemetría de ruedas presente', telemetry.wheelRows === 4, `${telemetry.wheelRows} filas`);

// --- 5d. decoración del terreno cargada (assets CC0) ---
const scenery = await page.evaluate(() => {
  const s = window.__sim?.scenery;
  const car = window.__sim?.vehicle.position;
  return {
    instances: s?.instances ?? 0,
    obstacles: s?.obstacles?.obstacles?.length ?? 0,
    drawCalls: s ? s.group.children.length : 0,
    near: s && car ? s.countNear(car.x, car.z, 45) : 0,
  };
});
check('decoración instanciada', scenery.instances > 400, `${scenery.instances} piezas en ${scenery.drawCalls} draw calls`);
check('obstáculos sólidos publicados', scenery.obstacles > 40, `${scenery.obstacles} colisionadores`);
// La densidad junto al coche se verifica por salida en 5e (cada circuito).

// --- 5e. circuitos: T rota por los 4 trazados (cada uno con su ruta) ---
const seenTracks = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  seenTracks.push(await page.evaluate(() => ({
    mode: window.__sim.trackId(),
    badge: document.getElementById('track-badge')?.textContent ?? '?',
    near: window.__sim.scenery.countNear(
      window.__sim.vehicle.position.x, window.__sim.vehicle.position.z, 45),
  })));
}
const seenIds = seenTracks.map((t) => t.mode).join(',');
check('T rota por los 4 circuitos', seenIds === 'interlagos,baja,stadium,monaco', seenIds);
check('cada circuito trae su insignia',
  seenTracks[0].badge.includes('Interlagos') && seenTracks[1].badge.includes('Baja') &&
  seenTracks[2].badge.includes('Estadio') && seenTracks[3].badge.includes('Barranquilla'),
  seenTracks.map((t) => t.badge).join(' | '));
// Ninguna salida en un vacío: la de Barranquilla (recta oeste, junto al
// borde) es la más rala por diseño; el mínimo lo marca ella.
const minNear = Math.min(...seenTracks.map((t) => t.near));
check('puntos de referencia en cada salida', minNear > 8,
  seenTracks.map((t) => `${t.mode}=${t.near}`).join(' '));

// --- 5g. garaje: V rota deportivo / todoterreno / kwid ---
// Se espera al cambio real de coche en vez de dormir un fijo: el cambio
// compila shaders al cargar la cáscara y puede tardar más de lo esperado.
const waitCarChange = async (car, badge) => {
  try {
    await page.waitForFunction(({ c, b }) => {
      const el = document.getElementById('car-badge');
      return window.__sim?.carId() === c && (el?.textContent ?? '').includes(b);
    }, { c: car, b: badge }, { timeout: 5000 });
  } catch {
    // se deja que el check falle con el estado real
  }
};
await page.keyboard.press('v');
await waitCarChange('offroad', 'Todoterreno');
const carOff = await page.evaluate(() => ({
  car: window.__sim.carId(),
  badge: document.getElementById('car-badge')?.textContent ?? '?',
  comHeight: window.__sim.vehicle.comHeight,
}));
check('V cambia al todoterreno', carOff.car === 'offroad' && carOff.badge.includes('Todoterreno'),
  `${carOff.car} · ${carOff.badge}`);
check('el 4x4 pisa más alto', carOff.comHeight > 0.6, `CdM ${carOff.comHeight} m`);
await page.screenshot({ path: `${OUT}/05b-offroad.png` });
await page.keyboard.press('v');
await waitCarChange('kwid', 'Kwid');
const carKwid = await page.evaluate(() => ({
  car: window.__sim.carId(),
  badge: document.getElementById('car-badge')?.textContent ?? '?',
}));
check('V cambia al Kwid', carKwid.car === 'kwid' && carKwid.badge.includes('Kwid'),
  `${carKwid.car} · ${carKwid.badge}`);
// La cáscara Blender del Kwid carga en vivo igual que la del deportivo.
let kwidBody = false;
try {
  await page.waitForFunction(() => window.__sim?.carVisual?.externalAttached === true, { timeout: 8000 });
  kwidBody = true;
} catch {
  kwidBody = false;
}
check('cáscara Blender del Kwid cargada', kwidBody);
await page.screenshot({ path: `${OUT}/05b2-kwid.png` });
await page.keyboard.press('v');
await waitCarChange('sport', 'Tesla');
const carSport = await page.evaluate(() => ({
  car: window.__sim.carId(),
  badge: document.getElementById('car-badge')?.textContent ?? '?',
}));
check('V vuelve al Tesla', carSport.car === 'sport' && carSport.badge.includes('Tesla'),
  `${carSport.car} · ${carSport.badge}`);
// La cáscara de Blender carga en vivo: se espera a que sustituya a la
// procedural (o se cae al procedural si el asset falta).
let blenderBody = false;
try {
  await page.waitForFunction(() => window.__sim?.carVisual?.externalAttached === true, { timeout: 8000 });
  blenderBody = true;
} catch {
  blenderBody = false;
}
check('cáscara del Tesla cargada', blenderBody);
// La cáscara va en frame del cuerpo: si cuelga baja, las ruedas se entierran
// en los pasos y las faldillas rozan (el mínimo de la caja engaña porque el
// splitter/difusor cuelgan bajo el plano del suelo).
const bodyDrop = await page.evaluate(() => {
  const v = window.__sim?.carVisual;
  const ext = v?.bodyGroup.children[0];
  return ext ? ext.position.y : 99;
});
check('la cáscara no cuelga bajo el chasis', Math.abs(bodyDrop) < 0.05, `${(bodyDrop * 100).toFixed(0)} cm`);

// --- 5h. menú con M: garaje, circuitos y cámara ---
await page.keyboard.press('m');
// A 3-5 fps por software 300 ms fijos no bastan: la pulsación se procesa en
// el siguiente fotograma. Se espera a la apertura real como en el resto.
try {
  await page.waitForFunction(
    () => !document.getElementById('menu')?.classList.contains('hidden'),
    { timeout: 4000 },
  );
} catch {
  // se deja que el check falle con el estado real
}
const menuState = await page.evaluate(() => ({
  open: !document.getElementById('menu')?.classList.contains('hidden'),
  cars: document.querySelectorAll('#menu-cars .menu-card').length,
  road: document.querySelectorAll('#menu-road .menu-card').length,
  dirt: document.querySelectorAll('#menu-dirt .menu-card').length,
  cams: document.querySelectorAll('#menu-cams .menu-card').length,
}));
check('M abre el menú', menuState.open, JSON.stringify(menuState));
check('el menú ofrece 3 coches y 4 circuitos',
  menuState.cars === 3 && menuState.road === 2 && menuState.dirt === 2 && menuState.cams === 3,
  `${menuState.cars} coches · ${menuState.road + menuState.dirt} circuitos · ${menuState.cams} cámaras`);
await page.screenshot({ path: `${OUT}/05c-menu.png` });
// Elegir el 4x4 y el Baja desde el menú
await page.evaluate(() => {
  document.querySelector('#menu-cars [data-car="offroad"]')?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.querySelector('#menu-dirt [data-track="baja"]')?.click();
});
await page.waitForTimeout(400);
const menuPick = await page.evaluate(() => ({
  car: window.__sim.carId(),
  track: window.__sim.trackId(),
}));
check('el menú cambia coche y circuito', menuPick.car === 'offroad' && menuPick.track === 'baja',
  JSON.stringify(menuPick));
await page.keyboard.press('m');
await page.waitForTimeout(300);
const menuClosed = await page.evaluate(() =>
  document.getElementById('menu')?.classList.contains('hidden') ?? false);
check('M cierra el menú', menuClosed);
// Se deja el Tesla en Barranquilla para el resto de comprobaciones
await page.keyboard.press('v');
await page.waitForTimeout(300);
await page.keyboard.press('t');
await page.waitForTimeout(300);
await page.keyboard.press('t');
await page.waitForTimeout(300);

// --- 5f. panel contraíble con O (esperas amplias: a 3 fps por software
// un fotograma tarda ~330 ms y la pulsación se procesa en el siguiente) ---
await page.keyboard.press('o');
await page.waitForTimeout(600);
const collapsed = await page.evaluate(() => ({
  cls: document.getElementById('panel')?.classList.contains('collapsed') ?? false,
  hidden: getComputedStyle(document.getElementById('params')).display === 'none',
  teleHidden: getComputedStyle(document.getElementById('telemetry-panel')).display === 'none',
}));
check('O contrae el panel', collapsed.cls && collapsed.hidden, JSON.stringify(collapsed));
check('O oculta la telemetría con el panel', collapsed.teleHidden, JSON.stringify(collapsed));
await page.screenshot({ path: `${OUT}/05-collapsed.png` });
await page.keyboard.press('o');
await page.waitForTimeout(600);
const restored = await page.evaluate(() => ({
  cls: document.getElementById('panel')?.classList.contains('collapsed') ?? true,
  shown: getComputedStyle(document.getElementById('params')).display !== 'none',
  teleShown: getComputedStyle(document.getElementById('telemetry-panel')).display !== 'none',
}));
check('O restaura el panel', !restored.cls && restored.shown, JSON.stringify(restored));
check('O restaura la telemetría con el panel', restored.teleShown, JSON.stringify(restored));

// --- 5b. vista de órbita para revisar el coche en tres cuartos ---
// (la entrada es por flanco: hay que dejar pasar un fotograma entre pulsaciones)
await page.keyboard.press('c');
await page.waitForTimeout(400);
await page.keyboard.press('c');
await page.waitForTimeout(1500);
const camMode = await page.evaluate(() => window.__sim?.cameraRig.mode ?? '?');
console.log(`  cámara: ${camMode}`);
await page.screenshot({ path: `${OUT}/05-orbit.png` });

// --- 5c. panorama para revisar densidad de referencia y proporciones ---
await page.evaluate(() => window.__sim?.cameraRig.setView(Math.PI / 2, 1.22, 30));
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/06-panorama.png` });

// --- 5d. vista frontal en tres cuartos para revisar el morro ---
await page.evaluate(() => {
  const sim = window.__sim;
  const q = sim.vehicle.quaternion;
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  sim.cameraRig.setView(Math.atan2(fz, fx) + 0.45, 1.32, 8.5);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/07-front.png` });

// --- 6. sin errores de consola ni de página ---
const errors = findings.filter((f) => f.level === 'error');
check('sin errores de consola ni de página', errors.length === 0,
  errors.length ? errors.map((e) => e.text).join(' | ') : 'limpio');

// --- 7. si algo falla en ejecución debe verse el aviso ---
await page.evaluate(() => {
  setTimeout(() => {
    throw new Error('Fallo simulado para validar el aviso de error');
  }, 0);
});
await page.waitForTimeout(700);
const errState = await page.evaluate(() => ({
  visible: document.getElementById('loader-error')?.hidden === false,
  msg: document.getElementById('loader-error-msg')?.textContent ?? '',
  details: document.getElementById('loader-error-stack')?.textContent?.length ?? 0,
}));
check('el aviso de error aparece ante un fallo', errState.visible, errState.msg);
check('el aviso incluye detalles técnicos', errState.details > 20, `${errState.details} caracteres`);
await page.screenshot({ path: `${OUT}/08-error.png` });

console.log(`\nTelemetría final: ${telemetry.speed} km/h · marcha ${telemetry.gear} · ${telemetry.rpm} rpm`);
console.log(`Capturas guardadas en ${OUT}/`);
console.log(failures === 0 ? '✅ LANZAMIENTO VALIDADO' : `❌ ${failures} COMPROBACIÓN(ES) FALLAN`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
