/**
 * Cámara: persecución suave, vista desde el capó y órbita libre con ratón.
 */
import * as THREE from 'three';
import type { Vehicle } from '../vehicle/vehicle';

export type CameraMode = 'chase' | 'hood' | 'orbit';

const MODE_LABEL: Record<CameraMode, string> = {
  chase: 'persecución',
  hood: 'capó',
  orbit: 'órbita',
};

export class CameraRig {
  mode: CameraMode = 'chase';
  distance = 8.2;
  private azimuth = Math.PI * 0.12;
  private polar = 1.18; // desde el eje Y
  private readonly smoothPos = new THREE.Vector3(0, 3, -8);
  private readonly smoothTarget = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0, 0, 1);
  private yaw = 0; // rumbo de la cámara (rad), 0 = +Z
  private readonly tmp = new THREE.Vector3();
  private readonly targetDir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Scratch para la pose interpolada del coche (sin asignaciones por frame). */
  private readonly carPos = new THREE.Vector3();
  private readonly carQuat = new THREE.Quaternion();
  /** Desplazamiento del coche entre fotogramas (avance para la persecución). */
  private readonly prevCar = new THREE.Vector3();
  private readonly frameDelta = new THREE.Vector3();
  private chaseInit = false;

  nextMode(): CameraMode {
    const order: CameraMode[] = ['chase', 'hood', 'orbit'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.mode;
  }

  get modeLabel(): string {
    return MODE_LABEL[this.mode];
  }

  drag(dx: number, dy: number): void {
    this.azimuth -= dx * 0.005;
    this.polar = Math.max(0.35, Math.min(1.52, this.polar - dy * 0.005));
    if (this.mode === 'chase' || this.mode === 'hood') this.mode = 'orbit';
  }

  zoom(delta: number): void {
    this.distance = Math.max(3.5, Math.min(22, this.distance + delta * 0.012));
  }

  /** Fija una vista de órbita concreta (presets y pruebas automáticas). */
  setView(azimuth: number, polar: number, distance: number): void {
    this.mode = 'orbit';
    this.azimuth = azimuth;
    this.polar = Math.max(0.2, Math.min(1.55, polar));
    this.distance = Math.max(3, Math.min(30, distance));
  }

  /** Coloca la cámara al final del frame. `alpha` interpola la pose del coche. */
  apply(camera: THREE.PerspectiveCamera, vehicle: Vehicle, dt: number, alpha = 1): void {
    vehicle.renderPosition(alpha, this.carPos);
    vehicle.renderQuaternion(alpha, this.carQuat);
    const pos = this.carPos;
    const forward = this.tmp.copy(this.up).set(0, 0, 1).applyQuaternion(this.carQuat);
    const speed = vehicle.velocity.length();

    if (this.mode === 'hood') {
      // POV de conductor con guías visuales: cámara un poco más atrás y
      // arriba que el ojo, mirando algo más abajo para encuadrar capó,
      // aletas y retrovisores además de la pista.
      const camPos = new THREE.Vector3(0, vehicle.hoodY + 0.12, -0.55).applyQuaternion(this.carQuat).add(pos);
      camera.position.copy(camPos);
      const look = new THREE.Vector3(0, vehicle.hoodY - 0.42, 26).applyQuaternion(this.carQuat).add(pos);
      camera.lookAt(look);
      return;
    }

    if (this.mode === 'orbit') {
      const target = this.smoothTarget.copy(pos).addScaledVector(this.up, 0.7);
      const sinP = Math.sin(this.polar);
      const desired = new THREE.Vector3(
        Math.cos(this.azimuth) * sinP * this.distance,
        Math.cos(this.polar) * this.distance + 0.7,
        Math.sin(this.azimuth) * sinP * this.distance,
      ).add(pos);
      camera.position.lerp(desired, 1 - Math.exp(-12 * dt));
      camera.lookAt(target);
      return;
    }

    // Persecución: el rumbo de la cámara se suaviza hacia el rumbo real del coche.
    // Se interpola el ángulo (no el vector) para poder cruzar los ±180° sin
    // quedarse atascado en la dirección opuesta.
    if (speed > 2.5) {
      this.targetDir.copy(vehicle.velocity).setY(0).normalize();
    } else {
      this.targetDir.copy(forward).setY(0).normalize();
    }
    const targetYaw = Math.atan2(this.targetDir.x, this.targetDir.z);
    let diff = targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-2.6 * dt));
    this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Persecución con adaptación a la velocidad: a más velocidad se mira más
    // lejos (si no, el morro tapa la pista) y la cámara se eleva y retrasa un
    // poco en vez de pegarse al techo del coche.
    const lookAhead = 4.5 + speed * 0.28;
    const camHeight = 2.25 + Math.min(1.6, speed * 0.035);
    const effDistance = this.distance + Math.min(4, speed * 0.05);

    const desired = new THREE.Vector3()
      .copy(pos)
      .addScaledVector(this.dir, -effDistance)
      .addScaledVector(this.up, camHeight);
    // no bajar del suelo
    desired.y = Math.max(desired.y, pos.y + 0.4);

    // El tirón al acelerar no aleja la cámara más de un 5 % de la distancia
    // elegida: con la cámara cerca la velocidad se percibe mucho mejor.
    // Se recorta el punto deseado ANTES del suavizado (no la cámara tras él):
    // recortar después del lerp tiraba de la cámara hacia el coche a cada
    // fotograma y generaba un tembleque a alta velocidad que no venía del
    // terreno. Solo se limita la separación horizontal; el zoom no se toca.
    // Además la cámara avanza con el desplazamiento del coche (feed-forward):
    // sin esto, seguir un punto en movimiento con un lerp deja un retardo
    // proporcional a la velocidad (~6 m a 90 km/h) y el tope del 5 % sería
    // inalcanzable; con el avance, el lerp solo suaviza el ruido y los giros.
    {
      const dx = desired.x - pos.x;
      const dz = desired.z - pos.z;
      const maxSep = effDistance * 1.05;
      const sep = Math.hypot(dx, dz);
      if (sep > maxSep) {
        const k = maxSep / sep;
        desired.x = pos.x + dx * k;
        desired.z = pos.z + dz * k;
      }
    }

    if (!this.chaseInit) {
      this.chaseInit = true;
      this.prevCar.copy(pos);
    }
    this.frameDelta.copy(pos).sub(this.prevCar);
    this.prevCar.copy(pos);
    this.smoothPos.add(this.frameDelta);
    this.smoothPos.lerp(desired, 1 - Math.exp(-4.2 * dt));
    camera.position.copy(this.smoothPos);

    this.smoothTarget
      .lerp(this.tmp.copy(pos).addScaledVector(this.up, 1.0).addScaledVector(this.dir, lookAhead), 1 - Math.exp(-5 * dt));
    camera.lookAt(this.smoothTarget);
  }
}
