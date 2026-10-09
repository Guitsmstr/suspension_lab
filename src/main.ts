/**
 * Punto de entrada: arranque por etapas con barra de progreso, captura de
 * errores visible, render y bucle de física a paso fijo.
 */
import * as THREE from 'three';
import { Input } from './input';
import { ParamStore } from './vehicle/params';
import { CARS, CAR_ORDER, type CarId } from './vehicle/cars';
import { Vehicle } from './vehicle/vehicle';
import { Terrain } from './world/terrain';
import { buildEnvironment, followSun } from './world/environment';
import { buildScenery, type SceneryHandle } from './world/scenery';
import {
  TRACKS,
  TRACK_ORDER,
  TRACK_BOUND,
  RING_TRACK_ID,
  buildBoundary,
  buildTrack,
  enforceTrackBounds,
  makeTrackCarve,
  routeKeepOut,
  trackSpawn,
  type TrackHandle,
  type TrackId,
  type TrackMode,
} from './world/track';
import { RING_BOUND, RingWorld, SwitchableObstacles, SwitchableTerrain } from './world/ring/ringWorld';
import { ringSpawn } from './world/ring/ringDef';
import { CarVisual } from './render/carMesh';
import { CameraRig, type CameraMode } from './render/cameraRig';
import { Minimap } from './render/minimap';
import { RaceDirector } from './world/race';
import { Panel } from './ui/panel';
import { Menu } from './ui/menu';
import { Loader, installErrorReporter } from './ui/loader';
import { GameAudio } from './audio/gameAudio';

/** Paso de física fijo (s): suficientemente pequeño para la rigidez de los neumáticos. */
const PHYSICS_DT = 1 / 300;
/**
 * Tope de subpasos por fotograma: con fps bajos permite ponerse al día y que la
 * simulación siga corriendo en tiempo real (el coste de CPU del modelo es bajo).
 */
const MAX_SUBSTEPS = 96;
/** Tope de tiempo por fotograma: evita saltos enormes al volver de una pestaña en segundo plano. */
const MAX_FRAME_DT = 0.25;

/** Estado expuesto para pruebas automáticas y depuración (ver scripts/launch-check.mjs). */
export interface SimDebug {
  vehicle: Vehicle;
  carVisual: CarVisual;
  camera: THREE.PerspectiveCamera;
  input: Input;
  params: ParamStore;
  cameraRig: CameraRig;
  minimap: Minimap;
  scenery: SceneryHandle;
  ring: RingWorld;
  trackMode: () => TrackMode;
  trackId: () => TrackId;
  carId: () => CarId;
  paused: () => boolean;
  race: RaceDirector;
}

declare global {
  interface Window {
    __sim?: SimDebug;
  }
}

/** Cede el control al navegador para que la barra de progreso se pinte. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function errorMessage(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack ?? '' };
  return { message: String(err), stack: '' };
}

async function boot(): Promise<void> {
  const loader = new Loader();
  installErrorReporter(loader);

  try {
    // ---------------- Renderer ----------------
    loader.setProgress(0.06, 'Creando renderizador WebGL');
    await nextPaint();

    const container = document.getElementById('view');
    if (!container) throw new Error('No se encuentra el contenedor #view en index.html');

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.45;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);
    camera.position.set(0, 3, -8);

    // ---------------- Mundo ----------------
    loader.setProgress(0.2, 'Generando terreno');
    await nextPaint();

    const params = new ParamStore();
    const terrain = new Terrain(params);
    // La malla del terreno va esculpida bajo las calzadas: la hierba nunca
    // asoma por la pista (ver `makeTrackCarve`).
    let terrainMesh = terrain.buildMesh(320, 320, makeTrackCarve(terrain));
    scene.add(terrainMesh);

    loader.setProgress(0.28, 'Cargando vegetación y rocas');
    await nextPaint();

    const keepOut = routeKeepOut();
    const scenery: SceneryHandle = await buildScenery(terrain, (done, total) => {
      loader.setProgress(0.28 + 0.14 * (done / total), `Cargando vegetación y rocas (${done}/${total})`);
    }, undefined, keepOut);
    scene.add(scenery.group);

    loader.setProgress(0.44, 'Trazando circuitos y barreras');
    await nextPaint();

    const tracks = new Map<TrackMode, TrackHandle>();
    for (const mode of TRACK_ORDER) {
      const handle = buildTrack(TRACKS[mode], terrain);
      handle.group.visible = mode === 'monaco';
      tracks.set(mode, handle);
      scene.add(handle.group);
    }
    const boundary = buildBoundary(terrain);
    scene.add(boundary.group);

    loader.setProgress(0.455, 'Trazando el Nordschleife 1:1');
    await nextPaint();

    const ring = new RingWorld((done, total) => {
      loader.setProgress(0.455 + 0.02 * (done / total), `Trazando el Nordschleife 1:1 (${done}/${total})`);
    });
    scene.add(ring.group);

    // Si cambia la rugosidad en vivo, la altura analítica cambia: hay que
    // reconstruir la malla del terreno ADEMÁS de calzadas y barreras. Antes
    // solo se reconstruían las calzadas, así que la física (nueva altura) y
    // la hierba renderizada (altura vieja) discrepaban: la pista quedaba bajo
    // la hierba y el coche parecía hundido en ella. Rebote para no hacerlo
    // a cada tick del slider.
    let roadTimer = 0;
    const scheduleRoadRefresh = (): void => {
      window.clearTimeout(roadTimer);
      roadTimer = window.setTimeout(() => {
        const fresh = terrain.buildMesh(320, 320, makeTrackCarve(terrain));
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh = fresh;
        terrainMesh.visible = !worldTerrain.useRing;
        scene.add(terrainMesh);
        for (const handle of tracks.values()) handle.refresh();
        boundary.refresh();
      }, 250);
    };
    params.onChange((key) => {
      if (key !== 'roughness') return;
      ring.terrain.setRoughness(params.get('roughness'));
      if (worldTerrain.useRing) {
        // En el anillo la rugosidad solo mueve las colinas (la pista manda):
        // se re-mallan las teselas visibles en vez del mundo pequeño.
        ring.refreshTiles();
        ring.ensureAround(vehicle.position.x, vehicle.position.z);
      } else {
        scheduleRoadRefresh();
      }
    });

    loader.setProgress(0.48, 'Compilando cielo, sol y sombras');
    await nextPaint();

    const env = buildEnvironment(scene, renderer);

    // ---------------- Vehículo ----------------
    loader.setProgress(0.64, 'Construyendo coche y suspensión');
    await nextPaint();

    let carId: CarId = 'sport';
    let trackId: TrackId = 'monaco';
    // La física delega en el mundo activo: el coche no se reconstruye al
    // cambiar entre el mapa de 320 m y el anillo 1:1.
    const worldTerrain = new SwitchableTerrain();
    worldTerrain.small = terrain;
    worldTerrain.ring = ring.terrain;
    const worldObstacles = new SwitchableObstacles();
    worldObstacles.small = scenery.obstacles;
    worldObstacles.ring = ring.obstacles;
    const vehicle = new Vehicle(params, worldTerrain, worldObstacles, carId);
    params.applyPreset(CARS[carId].preset);
    {
      const s = trackSpawn(TRACKS[trackId]);
      vehicle.setSpawn(s.x, s.z, s.yaw);
    }

    let car = await CarVisual.create(carId);
    scene.add(car.group);

    // Crono y reglas: vive del eje del circuito activo.
    const race = new RaceDirector();

    // ---------------- Entrada y UI ----------------
    loader.setProgress(0.82, 'Preparando panel de control');
    await nextPaint();

    const input = new Input();
    const cameraRig = new CameraRig();
    const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement | null;
    if (!minimapCanvas) throw new Error('No se encuentra el canvas #minimap en index.html');
    const minimap = new Minimap(minimapCanvas);
    const fwdMini = new THREE.Vector3();
    const helpEl = document.getElementById('help');
    let paused = false;

    // ---------------- Audio ----------------
    // El audio solo lee estado (telemetría): la física no depende de él. La
    // carga es asíncrona y degrada en silencio si algo falla.
    const audio = new GameAudio();
    void audio.load().catch(() => undefined);
    const unlockAudio = (): void => audio.unlock();
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    params.onChange(() => audio.click());

    const panel = new Panel(params, {
      onReset: () => {
        vehicle.reset();
        race.reset();
        startCountdown();
      },
      onPause: () => {
        paused = !paused;
        panel.setPaused(paused);
      },
      onCamera: () => {
        panel.setCameraLabel(cameraRig.nextMode());
        menu.refresh(carId, trackId, cameraRig.mode);
      },
      onHelp: () => helpEl?.classList.toggle('hidden'),
      onTrack: () => cycleTrack(),
      onCar: () => cycleCar(),
      onMenu: () => {
        menu.show();
        menu.refresh(carId, trackId, cameraRig.mode);
      },
      onCollapse: () => panel.toggleCollapsed(),
      onSound: () => {
        panel.setSoundLabel(!audio.toggleMuted());
      },
    });
    panel.setCameraLabel(cameraRig.modeLabel);
    panel.syncFromStore();

    // ---------------- Garaje y circuitos ----------------
    const trackBadge = document.getElementById('track-badge');
    const carBadge = document.getElementById('car-badge');

    /** Reaparece el coche en la salida del circuito activo (cada mundo, la suya). */
    const spawnOnTrack = (): void => {
      if (trackId === RING_TRACK_ID) {
        const s = ringSpawn();
        vehicle.setSpawn(s.x, s.z, s.yaw);
        ring.ensureAround(s.x, s.z);
      } else {
        const s = trackSpawn(TRACKS[trackId]);
        vehicle.setSpawn(s.x, s.z, s.yaw);
      }
    };

    const applyTrack = (id: TrackId, teleport = true): void => {
      trackId = id;
      const isRing = trackId === RING_TRACK_ID;
      // Conmutación de mundos: solo uno visible y la física delega en el suyo.
      worldTerrain.useRing = isRing;
      worldObstacles.useRing = isRing;
      ring.group.visible = isRing;
      terrainMesh.visible = !isRing;
      scenery.group.visible = !isRing;
      boundary.group.visible = !isRing;
      for (const [mode, handle] of tracks) handle.group.visible = !isRing && mode === trackId;
      // El mundo grande necesita ver lejos (6 km de bbox) con calima; el
      // pequeño, precisión de profundidad de cerca.
      camera.far = isRing ? 6000 : 1200;
      camera.updateProjectionMatrix();
      if (scene.fog instanceof THREE.FogExp2) scene.fog.density = isRing ? 0.0006 : 0.0015;
      const def = TRACKS[trackId];
      // La Barranquilla va casi lisa por defecto; el usuario puede retocarla
      // con el slider después (el valor por circuito solo se aplica al entrar).
      if (def.defaultRoughness !== undefined) {
        params.set('roughness', def.defaultRoughness);
        panel.syncFromStore();
      }
      ring.terrain.setRoughness(params.get('roughness'));
      if (trackBadge) trackBadge.textContent = def.badge;
      panel.setTrackLabel(def.name);
      race.setTrack(def);
      minimap.setTrack(def);
      if (teleport) spawnOnTrack();
      menu.refresh(carId, trackId, cameraRig.mode);
    };
    const cycleTrack = (): void => {
      applyTrack(TRACK_ORDER[(TRACK_ORDER.indexOf(trackId) + 1) % TRACK_ORDER.length]);
    };

    // Generación: si se cambia de coche dos veces seguidas antes de que
    // termine la primera carga, la primera promesa queda obsoleta y NO debe
    // montar su visual (si no, el visual fantasma queda en la escena).
    let carGen = 0;
    const applyCar = (id: CarId): void => {
      void (async (): Promise<void> => {
        const gen = ++carGen;
        carId = id;
        const spec = CARS[carId];
        vehicle.setCar(id);
        audio.setCar(id);
        params.applyPreset(spec.preset);
        panel.syncFromStore();
        panel.setSprungMasses(vehicle.sprungMassFront, vehicle.sprungMassRear);
        panel.setCarLabel(spec.name);
        scene.remove(car.group);
        const next = await CarVisual.create(carId);
        if (gen !== carGen) return; // obsoleto: otro cambio lo superó
        car = next;
        scene.add(car.group);
        race.reset();
        // El 4x4 pisa más alto: se reaparece en el inicio del circuito activo
        // para asentar la nueva altura de rodaje.
        spawnOnTrack();
        if (carBadge) carBadge.textContent = spec.badge;
        menu.refresh(carId, trackId, cameraRig.mode);
        if (window.__sim) window.__sim.carVisual = car;
      })();
    };
    const cycleCar = (): void => {
      applyCar(CAR_ORDER[(CAR_ORDER.indexOf(carId) + 1) % CAR_ORDER.length]);
    };

    const applyCamera = (mode: CameraMode): void => {
      while (cameraRig.mode !== mode) cameraRig.nextMode();
      panel.setCameraLabel(cameraRig.modeLabel);
      menu.refresh(carId, trackId, cameraRig.mode);
    };

    const menu = new Menu({
      onSelectCar: (id) => applyCar(id),
      onSelectTrack: (id) => applyTrack(id),
      onSelectCamera: (mode) => applyCamera(mode),
      onClose: () => menu.hide(),
      onVolume: (v) => audio.setVolume(v),
    });
    menu.setVolume(audio.getVolume());
    document.getElementById('menu-fab')?.addEventListener('click', () => {
      menu.show();
      menu.refresh(carId, trackId, cameraRig.mode);
    });
    applyTrack(trackId, false);
    applyCar(carId);
    {
      // applyCar reaparece el coche; se deja sobre la salida del circuito inicial
      spawnOnTrack();
    }    window.__sim = {
      vehicle,
      carVisual: car,
      camera,
      input,
      params,
      cameraRig,
      minimap,
      scenery,
      ring,
      trackMode: () => trackId,
      trackId: () => trackId,
      carId: () => carId,
      paused: () => paused,
      race,
    };

    // Ratón: arrastrar orbita, rueda hace zoom
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      cameraRig.drag(e.clientX - lastX, e.clientY - lastY);
      panel.setCameraLabel(cameraRig.modeLabel);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        cameraRig.zoom(e.deltaY);
      },
      { passive: false },
    );

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    // ---------------- Bucle ----------------
    loader.setProgress(0.94, 'Calibrando física');
    await nextPaint();

    // Cuenta atrás al reiniciar: bloquea la entrada 3 s con aviso central.
    const countdownEl = document.getElementById('countdown');
    const countdown = { active: false, t: 0 };
    const COUNTDOWN_STEPS = ['3', '2', '1', '¡VAMOS!'];
    const COUNTDOWN_END = 3.6; // 3 s de conteo + 0,6 s de "¡VAMOS!"
    const startCountdown = (): void => {
      countdown.active = true;
      countdown.t = 0;
      audio.countdownBeep(0);
      if (countdownEl) {
        countdownEl.hidden = false;
        countdownEl.textContent = COUNTDOWN_STEPS[0];
      }
    };

    const clock = new THREE.Clock();
    let accumulator = 0;
    let firstFrame = true;
    let running = true;

    const frame = (): void => {
      if (!running) return;
      requestAnimationFrame(frame);

      try {
        const dt = Math.min(clock.getDelta(), MAX_FRAME_DT);
        input.update(dt);

        if (input.consumePress('KeyR')) {
          vehicle.reset();
          race.reset();
          startCountdown();
        }
        if (input.consumePress('KeyP')) {
          paused = !paused;
          panel.setPaused(paused);
        }
        if (input.consumePress('KeyC')) {
          panel.setCameraLabel(cameraRig.nextMode());
          menu.refresh(carId, trackId, cameraRig.mode);
        }
        if (input.consumePress('KeyH')) helpEl?.classList.toggle('hidden');
        if (input.consumePress('KeyT')) cycleTrack();
        if (input.consumePress('KeyV')) cycleCar();
        if (input.consumePress('KeyO')) panel.toggleCollapsed();
        if (input.consumePress('KeyN')) panel.setSoundLabel(!audio.toggleMuted());
        if (input.consumePress('KeyM')) {
          menu.toggle();
          menu.refresh(carId, trackId, cameraRig.mode);
        }
        if (input.consumePress('Escape') && menu.open) menu.hide();

        // Fase del render dentro del último subpaso de física (0..1): el dibujo
        // interpola con ella entre el penúltimo y el último subpaso. Si no hay
        // subpaso nuevo (pausa), ambos estados coinciden y no hay nada que
        // interpolar.
        let renderAlpha = 1;
        if (!paused) {
          accumulator += dt;
          let steps = 0;
          // En cuenta atrás la entrada se ignora (el coche espera clavado).
          const drive = countdown.active
            ? { throttle: 0, brake: 0, steer: 0, handbrake: false }
            : input.state;
          while (accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
            vehicle.step(PHYSICS_DT, drive);
            accumulator -= PHYSICS_DT;
            steps++;
          }
          if (steps === MAX_SUBSTEPS) accumulator = 0;
          renderAlpha = Math.min(1, Math.max(0, accumulator / PHYSICS_DT));
          // Muro invisible: el mapa está cerrado (cada mundo, su límite).
          enforceTrackBounds(vehicle, worldTerrain.useRing ? RING_BOUND : TRACK_BOUND);

          // Crono y reglas (con el juego en marcha; congelado en cuenta atrás)
          if (!countdown.active) {
            race.update(dt, vehicle.position.x, vehicle.position.z, vehicle.telemetry.speedKph);
          }

          if (countdown.active) {
            countdown.t += dt;
            const step = Math.min(COUNTDOWN_STEPS.length - 1, Math.floor(countdown.t));
            const shown = COUNTDOWN_STEPS[step];
            if (countdownEl && countdownEl.textContent !== shown) {
              countdownEl.textContent = shown;
              audio.countdownBeep(step);
            }
            if (countdown.t >= COUNTDOWN_END) {
              countdown.active = false;
              if (countdownEl) countdownEl.hidden = true;
            }
          }

          // Red de seguridad: si cae del mundo, reaparece (cota relativa al
          // terreno activo: el anillo vive a ~300-600 m absolutos).
          if (vehicle.position.y < worldTerrain.heightAt(vehicle.position.x, vehicle.position.z) - 30) {
            vehicle.reset();
          }
        }

        car.update(vehicle, dt, renderAlpha);
        cameraRig.apply(camera, vehicle, dt, renderAlpha);
        ring.update(vehicle.position.x, vehicle.position.z);
        fwdMini.set(0, 0, 1).applyQuaternion(vehicle.quaternion);
        minimap.update(vehicle.position.x, vehicle.position.z, fwdMini.x, fwdMini.z);
        followSun(env, car.group.position);
        panel.update(vehicle.telemetry);
        audio.update(dt, vehicle, { paused });

        renderer.render(scene, camera);

        if (firstFrame) {
          firstFrame = false;
          loader.finish();
        }
      } catch (err) {
        running = false;
        // Mismo caso de "sonido congelado": si el bucle muere, el audio se
        // quedaría con las últimas ganancias. Silencio total.
        audio.setMuted(true);
        const { message, stack } = errorMessage(err);
        loader.fail(`Error en el bucle de simulación: ${message}`, stack);
      }
    };

    frame();
  } catch (err) {
    const { message, stack } = errorMessage(err);
    loader.fail(`No se ha podido iniciar la simulación: ${message}`, stack);
  }
}

void boot();
