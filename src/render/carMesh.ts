/**
 * Visualización del coche: carrocería, ruedas (neumático + llanta + frenos) y
 * suspensión animada (muelle helicoidal, amortiguador telescópico y brazos de
 * doble horquilla) que sigue el recorrido real calculado por la física.
 *
 * Tres carrocerías (`sport` / `offroad` / `kwid`, ver `cars.ts`): el deportivo
 * actual, un pick-up de rally-raid más alto y el Kwid Outsider (cáscara
 * `kwid.glb` modelada en Blender con sus medidas reales).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Vehicle } from '../vehicle/vehicle';
import { CARS, type CarId } from '../vehicle/cars';
import { loadKwidBody, loadKwidProceduralBody, loadKwidRaw, loadSportBody, loadTeslaBody } from './sportBody';

const PAINT_SPORT = 0x2456d0;
const PAINT_OFFROAD = 0xc96a1e;
const DARK_TRIM = 0x12161c;
const RUBBER = 0x14171b;
const RIM_COLOR = 0xb9c2cc;
const CALIPER = 0xd63b2f;

/** Cuánta de la deflexión del neumático se traslada a la rueda visual [m]. */
export const VISUAL_TIRE_DEFLECTION = 0.02;

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radius: number,
    private readonly height: number,
    private readonly turns: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.radius, -t * this.height, Math.sin(a) * this.radius);
  }
}

interface ArmVisual {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface WheelVisual {
  pivot: THREE.Group;
  spin: THREE.Group;
  /** Vestido de la rueda (neumático/llanta procedural o malla externa). */
  dressing: THREE.Group;
  /** Pinza de freno (no gira; se oculta si la rueda es externa). */
  caliper: THREE.Mesh;
  spring: THREE.Mesh;
  springTopY: number;
  damperRod: THREE.Mesh;
  damperBody: THREE.Mesh;
  arms: ArmVisual[];
  hubY: number;
  spinAngle: number;
}

export class CarVisual {
  readonly group = new THREE.Group();
  /** Solo carrocería procedural: se vacía al acoplar la malla externa. */
  readonly bodyGroup = new THREE.Group();
  /** true cuando la cáscara de Blender sustituye a la carrocería procedural. */
  externalAttached = false;

  /** Una entrada por rueda: pivote, giro, muelle y brazos (para depuración/tests). */
  readonly wheels: WheelVisual[] = [];
  readonly carId: CarId;

  private readonly paintMat: THREE.MeshPhysicalMaterial;
  private readonly trimMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshPhysicalMaterial;
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly rubberMat: THREE.MeshStandardMaterial;
  private readonly metalMat: THREE.MeshStandardMaterial;

  private readonly axleF: number;
  private readonly axleR: number;
  private readonly trackHalf: number;
  private readonly hubY0: number;
  private readonly tireK: number;
  private readonly tireHalfW: number;
  private readonly springLen: number;
  private readonly archR: number;

  constructor(carId: CarId = 'sport') {
    this.carId = carId;
    const spec = CARS[carId];
    this.axleF = spec.wheelbase * (1 - spec.frontShare);
    this.axleR = -spec.wheelbase * spec.frontShare;
    this.trackHalf = spec.track / 2;
    this.hubY0 = -spec.comHeight + spec.wheelRadius;
    this.tireK = spec.wheelRadius / 0.34;
    // El 4x4 calza más balón: un poco más ancho además de más alto.
    this.tireHalfW = 0.1225 * (carId === 'offroad' ? 1.22 : 1);
    this.springLen = carId === 'offroad' ? 0.44 : 0.36;
    this.archR = spec.wheelRadius + 0.12;

    this.paintMat = new THREE.MeshPhysicalMaterial({
      color: carId === 'offroad' ? PAINT_OFFROAD : PAINT_SPORT,
      metalness: 0.35,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.25,
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: DARK_TRIM,
      metalness: 0.35,
      roughness: 0.62,
    });
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x10161c,
      metalness: 0.1,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
    });
    this.rimMat = new THREE.MeshStandardMaterial({
      color: carId === 'offroad' ? 0x3a3f45 : RIM_COLOR,
      metalness: 0.95,
      roughness: 0.28,
    });
    this.rubberMat = new THREE.MeshStandardMaterial({
      color: RUBBER,
      metalness: 0.05,
      roughness: 0.88,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0x8d949c,
      metalness: 1,
      roughness: 0.36,
    });

    this.group.add(this.bodyGroup);
    if (carId === 'offroad') this.buildOffroadBody();
    else this.buildBody();
    for (let i = 0; i < 4; i++) this.wheels.push(this.buildCorner(i));

    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  /**
   * Factoría: construye el visual procedural y, solo para el deportivo,
   * intenta vestirlo con la cáscara modelada en Blender. Si falla, queda el
   * procedural: el juego nunca se queda sin coche.
   */
  static async create(carId: CarId = 'sport'): Promise<CarVisual> {
    const visual = new CarVisual(carId);
    if (carId === 'sport') {
      // Tesla con sus propias ruedas; si falla, la cáscara anterior y en
      // último caso la procedural: el juego nunca se queda sin coche.
      const raw = await loadTeslaBody();
      if (raw) visual.attachRawBody(raw.body, raw.wheels, raw.droppedRims);
      else {
        const body = await loadSportBody();
        if (body) {
          visual.attachSportBody(body);
          visual.addContour(visual.bodyGroup);
        }
      }
    } else if (carId === 'kwid') {
      // Cáscara con sus propias ruedas y wires visibles (sin texturas).
      // Si falla la descarga, se usa la procedural: el demo nunca se
      // queda sin coche.
      const raw = await loadKwidRaw();
      if (raw) visual.attachRawBody(raw.body, raw.wheels, raw.droppedRims);
      else {
        const body = (await loadKwidBody()) ?? (await loadKwidProceduralBody());
        if (body) visual.attachSportBody(body);
      }
    }
    return visual;
  }

  /** Sustituye la carrocería procedural por la cáscara de Blender. */
  attachSportBody(body: THREE.Group): void {
    for (const child of [...this.bodyGroup.children]) {
      const mesh = child as THREE.Mesh;
      (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
      this.bodyGroup.remove(child);
    }
    this.bodyGroup.add(body);
    this.externalAttached = true;
  }

  /**
   * Cáscara con sus propias ruedas (`Wheel_*`): la cáscara va al `bodyGroup`
   * y cada rueda se acopla al buje físico de su esquina con `attach()`
   * (conserva su sitio modelado y pivota en el buje: dirige y gira con la
   * física real). Si el `glb` traía llantas sueltas descartadas
   * (`proceduralRim`), se muestra la llanta procedural (radios, aro, pinza)
   * ocultando solo su neumático: queda un solo juego (goma del `glb` +
   * llanta procedural). Si no, se ocultan vestido y pinza procedurales y se
   * añade el contorno stickman. Sin ruedas en el `glb`, equivale a
   * `attachSportBody` + contorno.
   */
  attachRawBody(
    body: THREE.Group,
    wheels: Array<{ name: string; obj: THREE.Object3D }>,
    proceduralRim = false,
  ): void {
    this.attachSportBody(body);
    for (const w of wheels) {
      const front = w.name.includes('Front');
      const left = w.name.includes('Left'); // +X es la izquierda del coche
      const corner = this.wheels[(front ? 0 : 2) + (left ? 1 : 0)];
      if (proceduralRim) {
        // Solo se esconde la goma procedural: la llanta queda a la vista.
        corner.dressing.traverse((o) => {
          if (o.name === 'TireProcedural') o.visible = false;
        });
      } else {
        corner.dressing.visible = false;
        corner.caliper.visible = false; // la pinza roja asomaba por la llanta
      }
      this.addContour(w.obj);
      corner.spin.attach(w.obj);
    }
    this.addContour(this.bodyGroup);
  }

  /**
   * Contorno stickman sobre una cáscara (también vale para el fallback). Dos
   * piezas baratas por malla:
   * 1) casco invertido (misma geometría, `BackSide`, 3 % mayor): la
   *    silueta vista desde cualquier ángulo;
   * 2) `EdgesGeometry` con umbral 35°: solo las aristas duras (pasos de
   *    rueda, marcos, pliegues), no los ~60k segmentos de la triangulación.
   *
   * El casco solo se pone en mallas cerradas y de cierto tamaño: en
   * superficies abiertas (cristales) o piezas finas lo taparía todo de negro.
   * Esas llevan solo aristas.
   */
  /** Contorno stickman sobre una cáscara (también vale para el fallback). */
  addContour(root: THREE.Object3D): void {
    // Primero recolectar (sin mutar): añadir hijos durante el traverse
    // lo recorrería también a ellos en recursión infinita.
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const seen = new Set<THREE.Material>();
    for (const mesh of meshes) {
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (CarVisual.needsHull(geo)) {
        const hull = new THREE.Mesh(geo, CarVisual.contourMat);
        hull.scale.setScalar(1.03);
        mesh.add(hull);
      }
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 35),
        CarVisual.contourLineMat,
      );
      mesh.add(edges);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m && !seen.has(m)) {
          seen.add(m);
          m.polygonOffset = true;
          m.polygonOffsetFactor = 1;
          m.polygonOffsetUnits = 1;
          m.needsUpdate = true;
        }
      }
    }
  }

  /**
   * ¿Merece casco? Solo mallas cerradas (sin aristas de borde) y de más de
   * ~500 vértices. Las abiertas (cristales, paneles sueltos) o diminutas
   * (tornillería, emblemas) quedarían tapadas de negro: solo aristas.
   */
  private static needsHull(geo: THREE.BufferGeometry): boolean {
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos || pos.count < 500) return false;
    const index = geo.index;
    if (!index) return false;
    const idx = index.array;
    const boundary = new Map<number, number>();
    for (let i = 0; i < idx.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[i + e];
        const b = idx[i + ((e + 1) % 3)];
        const key = a < b ? a * 1000000 + b : b * 1000000 + a;
        boundary.set(key, (boundary.get(key) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const n of boundary.values()) if (n === 1) open++;
    return open / (idx.length / 3) < 0.06;
  }

  private static readonly contourMat = new THREE.MeshBasicMaterial({
    color: 0x14171b,
    side: THREE.BackSide,
  });

  private static readonly contourLineMat = new THREE.LineBasicMaterial({
    color: 0x14171b,
    transparent: true,
    opacity: 0.9,
  });

  // ---------------------------------------------------------------- carrocería
  private addPart(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.bodyGroup.add(mesh);
    return mesh;
  }

  /**
   * Extruye un perfil lateral [z, y] a lo ancho (eje X) con bordes
   * redondeados. El perfil debe estar orientado en sentido antihorario.
   */
  private extrudeProfile(
    outline: Array<[number, number]>,
    width: number,
    bevel: number,
    mat: THREE.Material,
  ): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.85,
      bevelSegments: 4,
      curveSegments: 24,
      steps: 1,
    });
    geo.rotateY(-Math.PI / 2); // perfil X -> eje Z del coche, extrusión -> eje X
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0); // centrar a lo ancho
    const mesh = new THREE.Mesh(geo, mat);
    this.bodyGroup.add(mesh);
    return mesh;
  }

  /** Arco de paso de rueda sobre el eje: devuelve puntos del contorno (z, y). */
  private archPoints(axleZ: number, radius: number, segments: number): Array<[number, number]> {
    // El contorno inferior recorre de atrás hacia delante: el arco se sube por
    // detrás de la rueda (190°) y baja por delante (-16°), en sentido horario.
    const pts: Array<[number, number]> = [];
    const cy = this.hubY0 + 0.14;
    const a0 = THREE.MathUtils.degToRad(196);
    const a1 = THREE.MathUtils.degToRad(-16);
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (a1 - a0) * (i / segments);
      pts.push([axleZ + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return pts;
  }

  private buildBody(): void {
    const paint = this.paintMat;
    const trim = this.trimMat;
    const FRONT_AXLE_Z = this.axleF;
    const REAR_AXLE_Z = this.axleR;

    // ---- Carrocería principal: silueta lateral con pasos de rueda abiertos ----
    // (z, y) en el frame del cuerpo; el suelo está en y=-0.52.
    const ARCH_Y = this.hubY0 + 0.14;
    const ARCH_R = this.archR;
    const rearEntry: [number, number] = [
      REAR_AXLE_Z + Math.cos(THREE.MathUtils.degToRad(196)) * ARCH_R,
      ARCH_Y + Math.sin(THREE.MathUtils.degToRad(196)) * ARCH_R,
    ];
    const rearExit: [number, number] = [
      REAR_AXLE_Z + Math.cos(THREE.MathUtils.degToRad(-16)) * ARCH_R,
      ARCH_Y + Math.sin(THREE.MathUtils.degToRad(-16)) * ARCH_R,
    ];
    const frontEntry: [number, number] = [
      FRONT_AXLE_Z + Math.cos(THREE.MathUtils.degToRad(196)) * ARCH_R,
      ARCH_Y + Math.sin(THREE.MathUtils.degToRad(196)) * ARCH_R,
    ];
    const frontExit: [number, number] = [
      FRONT_AXLE_Z + Math.cos(THREE.MathUtils.degToRad(-16)) * ARCH_R,
      ARCH_Y + Math.sin(THREE.MathUtils.degToRad(-16)) * ARCH_R,
    ];
    this.extrudeProfile(
      [
        [-2.0, -0.32], // bajos traseros
        [-1.86, -0.335],
        rearEntry,
        ...this.archPoints(REAR_AXLE_Z, ARCH_R, 14),
        rearExit,
        [0.4, -0.345], // bajos centrales
        frontEntry,
        ...this.archPoints(FRONT_AXLE_Z, ARCH_R, 14),
        frontExit,
        [2.02, -0.34], // bajos delanteros
        [2.1, -0.1], // morro
        [2.02, 0.02],
        [1.85, 0.12], // borde de capó
        [1.32, 0.3], // corona de la aleta delantera
        [0.95, 0.17], // capó
        [0.55, 0.24], // cowl
        [-0.2, 0.26], // cintura
        [-0.95, 0.25],
        [-1.43, 0.3], // corona de la aleta trasera
        [-1.6, 0.22], // tapa del maletero
        [-2.04, 0.14], // borde de cola
        [-2.08, -0.04], // zaga
      ],
      1.46, // ancho + bisel ≈ 1.61 m
      0.06,
      paint,
    );

    // ---- Bañera interior oscura: tapa los pasos de rueda por dentro ----
    this.addPart(new THREE.BoxGeometry(1.5, 0.56, 3.0), trim, 0, -0.04, -0.05);

    // ---- Habitáculo acristalado + techo en color carrocería ----
    this.extrudeProfile(
      [
        [0.62, 0.22], // base del parabrisas
        [0.1, 0.6],
        [-0.15, 0.66], // frente del techo
        [-0.75, 0.67], // trasera del techo
        [-1.3, 0.24], // base de la luneta
        [-0.3, 0.2],
      ],
      1.06, // ancho + bisel ≈ 1.16 m (tumblehome)
      0.05,
      this.glassMat,
    );
    const roof = this.addPart(new RoundedBoxGeometry(1.2, 0.06, 0.95, 4, 0.03), paint, 0, 0.67, -0.45);
    roof.rotation.x = 0.012;
    // Montantes B pintados sobre el cristal lateral
    for (const sx of [-1, 1]) {
      const pillar = this.addPart(new THREE.BoxGeometry(0.05, 0.42, 0.1), paint, sx * 0.6, 0.44, -0.45);
      pillar.rotation.x = -0.05;
    }
    // Aleta de tiburón
    const fin = this.addPart(new THREE.BoxGeometry(0.03, 0.09, 0.22), paint, 0, 0.73, -0.82);
    fin.rotation.x = -0.15;

    // ---- Ensanches de aleta sobre cada rueda ----
    const flareGeo = new THREE.TorusGeometry(0.46, 0.07, 12, 28);
    for (const sx of [-1, 1]) {
      for (const z of [FRONT_AXLE_Z, REAR_AXLE_Z]) {
        const flare = new THREE.Mesh(flareGeo, paint);
        flare.position.set(sx * 0.84, -0.2, z);
        flare.rotation.y = Math.PI / 2;
        this.bodyGroup.add(flare);
      }
    }

    // ---- Frontal: calandra, faros y tomas ----
    this.addPart(new RoundedBoxGeometry(0.9, 0.16, 0.08, 3, 0.03), trim, 0, -0.12, 2.1);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xdfe9ff,
      emissive: 0x9fc2ff,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.12,
    });
    for (const sx of [-1, 1]) {
      this.addPart(new RoundedBoxGeometry(0.3, 0.08, 0.1, 2, 0.03), trim, sx * 0.55, 0.06, 1.97);
      const lens = this.addPart(
        new RoundedBoxGeometry(0.32, 0.09, 0.06, 2, 0.025),
        lensMat,
        sx * 0.55,
        0.06,
        2.0,
      );
      lens.rotation.y = -sx * 0.28;
      this.addPart(new RoundedBoxGeometry(0.22, 0.12, 0.1, 2, 0.03), trim, sx * 0.68, -0.18, 2.02);
      // Intermitentes laterales
      const sideMarker = this.addPart(
        new THREE.BoxGeometry(0.02, 0.04, 0.16),
        new THREE.MeshStandardMaterial({
          color: 0x3a2408,
          emissive: 0xff9a1f,
          emissiveIntensity: 0.9,
          roughness: 0.3,
        }),
        sx * 0.8,
        0.02,
        1.95,
      );
      sideMarker.rotation.y = -sx * 0.1;
    }
    // Deflector delantero (zona baja: coincide con el contacto físico)
    this.addPart(new THREE.BoxGeometry(1.5, 0.04, 0.22), trim, 0, -0.41, 1.96);
    // Estribos (zona baja: coinciden con el contacto físico)
    this.addPart(new THREE.BoxGeometry(0.08, 0.12, 2.0), trim, -0.82, -0.38, 0);
    this.addPart(new THREE.BoxGeometry(0.08, 0.12, 2.0), trim, 0.82, -0.38, 0);

    // ---- Zaga: barra de pilotos, alerón, difusor y escapes ----
    this.addPart(new RoundedBoxGeometry(1.36, 0.13, 0.06, 3, 0.03), trim, 0, 0.1, -2.06);
    this.addPart(
      new RoundedBoxGeometry(1.3, 0.09, 0.06, 3, 0.03),
      new THREE.MeshStandardMaterial({
        color: 0x4a0d0d,
        emissive: 0xff2b1f,
        emissiveIntensity: 1.6,
        metalness: 0.2,
        roughness: 0.25,
      }),
      0,
      0.1,
      -2.07,
    );
    const ducktail = this.addPart(new RoundedBoxGeometry(1.34, 0.035, 0.3, 3, 0.015), paint, 0, 0.26, -1.92);
    ducktail.rotation.x = -0.1;
    // Difusor (zona baja: coincide con el contacto físico) + aletas
    this.addPart(new THREE.BoxGeometry(1.44, 0.12, 0.26), trim, 0, -0.38, -1.98);
    for (const fx of [-0.45, -0.15, 0.15, 0.45]) {
      this.addPart(new THREE.BoxGeometry(0.02, 0.1, 0.24), trim, fx, -0.36, -2.0);
    }
    const exhaustGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.16, 18);
    exhaustGeo.rotateX(Math.PI / 2);
    this.addPart(exhaustGeo, this.metalMat, -0.3, -0.32, -2.12);
    this.addPart(exhaustGeo, this.metalMat, 0.3, -0.32, -2.12);

    // ---- Retrovisores, tiradores y detalles ----
    for (const sx of [-1, 1]) {
      this.addPart(new THREE.BoxGeometry(0.12, 0.03, 0.05), trim, sx * 0.86, 0.3, 0.55);
      this.addPart(new RoundedBoxGeometry(0.1, 0.08, 0.14, 2, 0.03), paint, sx * 0.93, 0.32, 0.55);
      this.addPart(new THREE.BoxGeometry(0.012, 0.06, 0.1), this.glassMat, sx * 0.885, 0.32, 0.55);
      this.addPart(new THREE.BoxGeometry(0.02, 0.025, 0.16), trim, sx * 0.815, 0.12, -0.35);
    }
  }

  /**
   * Pick-up de rally-raid: chasis alto con caja trasera, paragolpes de tubo,
   * baca con rueda de repuesto, snorkel y aletas atornilladas. El suelo está
   * en y=-0.68 (CdM más alto) y las protecciones coinciden con los contactos
   * físicos del 4x4.
   */
  private buildOffroadBody(): void {
    const paint = this.paintMat;
    const trim = this.trimMat;
    const FZ = this.axleF;
    const RZ = this.axleR;

    // ---- Carrocería: silueta de pick-up con caja abierta ----
    const ARCH_Y = this.hubY0 + 0.14;
    const ARCH_R = this.archR;
    const deg = THREE.MathUtils.degToRad;
    const rearEntry: [number, number] = [RZ + Math.cos(deg(196)) * ARCH_R, ARCH_Y + Math.sin(deg(196)) * ARCH_R];
    const rearExit: [number, number] = [RZ + Math.cos(deg(-16)) * ARCH_R, ARCH_Y + Math.sin(deg(-16)) * ARCH_R];
    const frontEntry: [number, number] = [FZ + Math.cos(deg(196)) * ARCH_R, ARCH_Y + Math.sin(deg(196)) * ARCH_R];
    const frontExit: [number, number] = [FZ + Math.cos(deg(-16)) * ARCH_R, ARCH_Y + Math.sin(deg(-16)) * ARCH_R];
    this.extrudeProfile(
      [
        [-2.15, -0.42], // paragolpes trasero
        [-2.1, -0.1],
        [-2.0, 0.18], // portón de la caja
        [-0.7, 0.22], // borde de caja
        [-0.55, 0.3],
        [0.35, -0.3], // bajos centrales
        frontEntry,
        ...this.archPoints(FZ, ARCH_R, 14),
        frontExit,
        [2.05, -0.32], // bajos delanteros
        [2.2, -0.05], // morro alto
        [2.12, 0.22],
        [1.7, 0.34], // capó plano
        [1.1, 0.36],
        [0.9, 0.34],
        [-0.5, 0.3], // cintura de la cabina (se cierra abajo)
        [-0.62, 0.22],
        [-2.0, 0.18],
      ],
      1.6, // ancho + bisel ≈ 1.75 m
      0.05,
      paint,
    );
    // El arco trasero queda abierto por la caja: se recorta con el mismo
    // contorno que el delantero mediante la bañera interior.
    void rearEntry;
    void rearExit;

    // ---- Bañera interior + caja de carga ----
    this.addPart(new THREE.BoxGeometry(1.55, 0.5, 3.1), trim, 0, 0.0, -0.2);
    // Paredes de la caja
    for (const sx of [-1, 1]) {
      this.addPart(new THREE.BoxGeometry(0.06, 0.3, 1.5), paint, sx * 0.82, 0.32, -1.35);
    }
    this.addPart(new THREE.BoxGeometry(1.6, 0.3, 0.08), paint, 0, 0.32, -2.06);
    // Rueda de repuesto tumbada en la caja
    const spareGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24);
    spareGeo.rotateZ(Math.PI / 2);
    const spare = this.addPart(spareGeo, this.rubberMat, 0.25, 0.32, -1.35);
    spare.rotation.z = Math.PI / 2;
    spare.rotation.y = 0.3;

    // ---- Cabina acristalada + techo ----
    this.extrudeProfile(
      [
        [0.95, 0.32], // base del parabrisas
        [0.45, 0.85],
        [0.1, 0.92],
        [-0.45, 0.92],
        [-0.62, 0.3], // luneta trasera de cabina
        [0.2, 0.3],
      ],
      1.2,
      0.05,
      this.glassMat,
    );
    this.addPart(new RoundedBoxGeometry(1.34, 0.07, 0.85, 3, 0.03), paint, 0, 0.94, -0.18);

    // ---- Baca con focos de largo alcance ----
    for (const sx of [-0.5, 0.5]) {
      this.addPart(new THREE.BoxGeometry(0.06, 0.06, 0.9), trim, sx, 1.02, -0.18);
    }
    for (const bx of [-0.5, -0.17, 0.17, 0.5]) {
      const lamp = this.addPart(
        new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14),
        new THREE.MeshStandardMaterial({
          color: 0xf5f2df,
          emissive: 0xfff2b0,
          emissiveIntensity: 0.9,
          roughness: 0.3,
        }),
        bx,
        1.0,
        0.28,
      );
      lamp.rotation.x = Math.PI / 2;
    }

    // ---- Aletas atornilladas sobre cada rueda ----
    const flareGeo = new THREE.TorusGeometry(this.archR, 0.09, 10, 24, Math.PI);
    for (const sx of [-1, 1]) {
      for (const z of [FZ, RZ]) {
        const flare = new THREE.Mesh(flareGeo, trim);
        flare.position.set(sx * (this.trackHalf + 0.06), this.hubY0 + 0.14, z);
        flare.rotation.y = Math.PI / 2;
        this.bodyGroup.add(flare);
      }
    }

    // ---- Paragolpes de tubo delantero + cubrecárter ----
    const barGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.7, 12);
    barGeo.rotateZ(Math.PI / 2);
    this.addPart(barGeo, trim, 0, -0.05, 2.28);
    this.addPart(barGeo, trim, 0, 0.28, 2.2);
    for (const sx of [-0.6, 0.6]) {
      const upright = new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10);
      this.addPart(upright, trim, sx, 0.12, 2.24);
    }
    // Cubrecárter (coincide con el contacto físico delantero)
    const skid = this.addPart(new THREE.BoxGeometry(1.3, 0.05, 0.5), this.metalMat, 0, -0.47, 2.0);
    skid.rotation.x = 0.12;
    // Estribos laterales
    this.addPart(new THREE.BoxGeometry(0.1, 0.1, 2.2), trim, -0.9, -0.46, 0);
    this.addPart(new THREE.BoxGeometry(0.1, 0.1, 2.2), trim, 0.9, -0.46, 0);
    // Protector trasero + gancho
    this.addPart(new THREE.BoxGeometry(1.6, 0.14, 0.12), trim, 0, -0.4, -2.18);
    // Snorkel en el pilar A derecho
    this.addPart(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 10), trim, -0.82, 0.6, 0.7);
    this.addPart(new THREE.BoxGeometry(0.09, 0.09, 0.2), trim, -0.82, 0.95, 0.78);

    // ---- Faros redondos + pilotos ----
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xdfe9ff,
      emissive: 0x9fc2ff,
      emissiveIntensity: 1.2,
      metalness: 0.2,
      roughness: 0.15,
    });
    for (const sx of [-1, 1]) {
      const lampGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 18);
      lampGeo.rotateX(Math.PI / 2);
      this.addPart(lampGeo, lensMat, sx * 0.55, 0.12, 2.12);
      this.addPart(
        new RoundedBoxGeometry(0.5, 0.1, 0.06, 2, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0x4a0d0d,
          emissive: 0xff2b1f,
          emissiveIntensity: 1.4,
          roughness: 0.3,
        }),
        sx * 0.45,
        0.16,
        -2.12,
      );
      this.addPart(new THREE.BoxGeometry(0.12, 0.03, 0.05), trim, sx * 0.92, 0.5, 0.6);
      this.addPart(new RoundedBoxGeometry(0.1, 0.09, 0.15, 2, 0.03), paint, sx * 0.99, 0.52, 0.6);
    }
  }

  // ------------------------------------------------- esquina: rueda + suspensión
  private buildCorner(index: number): WheelVisual {
    const front = index < 2;
    const sx = index % 2 === 0 ? -1 : 1;
    const zAxle = front ? this.axleF : this.axleR;
    const x = sx * this.trackHalf;
    const hubY = this.hubY0;
    const k = this.tireK;
    const hw = this.tireHalfW;

    // ---- rueda ----
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    const dressing = new THREE.Group();
    spin.add(dressing);
    pivot.add(spin);

    // Perfil del neumático (sección transversal, revolucionada sobre Y),
    // escalado a la rueda del coche activo.
    const prof: Array<[number, number]> = [
      [0.222, -0.1225],
      [0.29, -0.1225],
      [0.325, -0.112],
      [0.341, -0.082],
      [0.345, -0.03],
      [0.345, 0.03],
      [0.341, 0.082],
      [0.325, 0.112],
      [0.29, 0.1225],
      [0.222, 0.1225],
    ];
    const wScale = hw / 0.1225;
    const profile = prof.map(([r, w]) => new THREE.Vector2(r * k, w * wScale));
    const tireGeo = new THREE.LatheGeometry(profile, 40);
    tireGeo.rotateZ(Math.PI / 2); // el eje de la rueda pasa a ser X
    const tireMesh = new THREE.Mesh(tireGeo, this.rubberMat);
    tireMesh.name = 'TireProcedural';
    dressing.add(tireMesh);

    // Taco lateral del 4x4: anillo dentado (barato: toro de baja resolución)
    if (this.carId === 'offroad') {
      const lugGeo = new THREE.TorusGeometry(0.345 * k, 0.028 * k, 6, 28);
      lugGeo.rotateY(Math.PI / 2);
      for (const lx of [-hw * 0.8, hw * 0.8]) {
        const lug = new THREE.Mesh(lugGeo, this.rubberMat);
        lug.position.x = lx;
        dressing.add(lug);
      }
    }

    const rimR = 0.222 * k;
    const rimGeo = new THREE.CylinderGeometry(rimR, rimR, hw * 2 - 0.01, 32);
    rimGeo.rotateZ(Math.PI / 2);
    dressing.add(new THREE.Mesh(rimGeo, this.rimMat));

    const hubGeo = new THREE.CylinderGeometry(0.075 * k, 0.075 * k, hw * 2 + 0.02, 20);
    hubGeo.rotateZ(Math.PI / 2);
    dressing.add(new THREE.Mesh(hubGeo, this.rimMat));

    if (this.carId === 'offroad') {
      // Llanta de chapa con 8 agujeros simulados (discos oscuros)
      const holeGeo = new THREE.CylinderGeometry(0.035, 0.035, hw * 2 + 0.03, 10);
      holeGeo.rotateZ(Math.PI / 2);
      const holeMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 });
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.set(0, Math.cos(a) * rimR * 0.55, Math.sin(a) * rimR * 0.55);
        dressing.add(hole);
      }
    } else {
      const spokeGeo = new THREE.BoxGeometry(0.2, 0.055, 0.062);
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, this.rimMat);
        const a = (s / 5) * Math.PI * 2;
        spoke.position.set(sx * 0.115, Math.cos(a) * 0.115, Math.sin(a) * 0.115);
        spoke.rotation.x = -a;
        dressing.add(spoke);
      }
    }

    const discGeo = new THREE.CylinderGeometry(0.185 * k, 0.185 * k, 0.024, 28);
    discGeo.rotateZ(Math.PI / 2);
    dressing.add(new THREE.Mesh(discGeo, this.metalMat));

    // Aro exterior pulido (solo deportivo)
    if (this.carId !== 'offroad') {
      const lipGeo = new THREE.TorusGeometry(0.2, 0.022, 12, 40);
      lipGeo.rotateY(Math.PI / 2);
      const lip = new THREE.Mesh(lipGeo, this.rimMat);
      lip.position.x = sx * 0.115;
      dressing.add(lip);
    }

    // Pinza de freno (no gira con la rueda)
    const caliper = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.13, 0.24),
      new THREE.MeshStandardMaterial({ color: CALIPER, metalness: 0.6, roughness: 0.4 }),
    );
    caliper.position.set(sx * 0.02, 0.13 * k, -0.06);
    pivot.add(caliper);

    pivot.position.set(x, hubY, zAxle);
    this.group.add(pivot);

    // ---- suspensión ----
    const hardX = sx * (this.trackHalf - 0.29);
    const hardY = this.carId === 'offroad' ? 0.3 : 0.17;
    const hardpoint = new THREE.Vector3(hardX, hardY, zAxle + (front ? -0.1 : 0.1));
    const springOffset = new THREE.Vector3(sx * 0.1, 0, front ? -0.06 : 0.06);
    const SPRING_LEN = this.springLen;

    const springGeo = new THREE.TubeGeometry(new HelixCurve(0.062 * k, SPRING_LEN, 7), 160, 0.0145, 8, false);
    const spring = new THREE.Mesh(
      springGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8b23c, metalness: 0.85, roughness: 0.35 }),
    );
    spring.position.copy(hardpoint).add(springOffset);
    this.group.add(spring);

    const rodGeo = new THREE.CylinderGeometry(0.019, 0.019, SPRING_LEN, 12);
    const damperRod = new THREE.Mesh(rodGeo, this.metalMat);
    damperRod.position.copy(spring.position).add(new THREE.Vector3(0, -SPRING_LEN / 2, 0));
    this.group.add(damperRod);

    const bodyGeo = new THREE.CylinderGeometry(0.041, 0.041, SPRING_LEN * 0.62, 16);
    const damperBody = new THREE.Mesh(bodyGeo, this.trimMat);
    damperBody.position.copy(spring.position).add(new THREE.Vector3(0, -SPRING_LEN * 0.28, 0));
    this.group.add(damperBody);

    // Brazos de la horquilla (dos por nivel)
    const arms: ArmVisual[] = [];
    const armGeo = new THREE.BoxGeometry(0.055, 0.055, 1); // longitud sobre Z
    const inboardX = sx * (this.trackHalf - 0.45);
    const hub = new THREE.Vector3(x, hubY, zAxle);
    const specs: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(inboardX, hub.y - 0.04, hub.z + 0.3), new THREE.Vector3(hub.x, hub.y - 0.02, hub.z + 0.12)],
      [new THREE.Vector3(inboardX, hub.y - 0.04, hub.z - 0.3), new THREE.Vector3(hub.x, hub.y - 0.02, hub.z - 0.12)],
      [new THREE.Vector3(inboardX, hub.y + 0.22, hub.z + 0.24), new THREE.Vector3(hub.x, hub.y + 0.1, hub.z + 0.1)],
      [new THREE.Vector3(inboardX, hub.y + 0.22, hub.z - 0.24), new THREE.Vector3(hub.x, hub.y + 0.1, hub.z - 0.1)],
    ];
    for (const [from, to] of specs) {
      const mesh = new THREE.Mesh(armGeo, this.trimMat);
      this.group.add(mesh);
      arms.push({ mesh, from, to });
    }

    return {
      pivot,
      spin,
      dressing,
      caliper,
      spring,
      springTopY: spring.position.y,
      damperRod,
      damperBody,
      arms,
      hubY,
      spinAngle: 0,
    };
  }

  // ------------------------------------------------------------- actualización
  private updateArm(arm: ArmVisual, hubOffsetY: number): void {
    const to = arm.to.clone();
    to.y += hubOffsetY;
    const dir = to.clone().sub(arm.from);
    const len = dir.length();
    arm.mesh.position.copy(arm.from).add(to).multiplyScalar(0.5);
    arm.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    arm.mesh.scale.set(1, 1, len);
  }

  update(vehicle: Vehicle, dt: number): void {
    this.group.position.copy(vehicle.position);
    this.group.quaternion.copy(vehicle.quaternion);

    for (let i = 0; i < 4; i++) {
      const st = vehicle.cornerStates[i];
      const c = vehicle.corners[i];
      const w = this.wheels[i];

      // La rueda sube con la compresión; se añade la deformación del neumático
      // para que la llanta apoye sobre el suelo sin "hundirse".
      // El neumático se comprime contra el suelo: su llanta baja, pero el
      // dibujo rígido de la rueda solo muestra una parte (si no, la rueda
      // aparece enterrada en cargas fuertes).
      const yLocal = c.yStatic + st.s + Math.min(st.tireDeflection, VISUAL_TIRE_DEFLECTION);
      w.pivot.position.set(c.x, yLocal, c.z);
      w.pivot.rotation.set(0, st.steer, st.camber);

      w.spinAngle += st.wheelOmega * dt;
      w.spin.rotation.x = w.spinAngle;

      // Muelle y amortiguador se comprimen con el recorrido real
      const dist = Math.abs(yLocal - w.springTopY);
      const scaleY = Math.max(0.55, Math.min(1.35, dist / this.springLen));
      w.spring.scale.set(1, scaleY, 1);
      w.damperRod.scale.set(1, scaleY, 1);
      w.damperBody.scale.set(1, 0.85 + (scaleY - 1) * 0.4, 1);

      // Brazos: siguen el buje
      const hubOffsetY = yLocal - w.hubY;
      for (const arm of w.arms) this.updateArm(arm, hubOffsetY);
    }
  }
}
