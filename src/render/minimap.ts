/**
 * Minimapa del circuito activo: cinta del trazado + posición y rumbo del
 * coche. Canvas 2D superpuesto (abajo a la derecha); el bucle de render lo
 * alimenta con la pose del vehículo y el circuito activo lo reencuadra.
 * Sin asignaciones por fotograma (solo números): dibujar 400 segmentos a
 * 60 fps es despreciable frente a la escena 3D.
 */
import { trackCenterline, type TrackDef } from '../world/track';

const MAP_W = 320; // resolución interna (ver `<canvas id="minimap">`)
const MAP_H = 320;
const FRAME = 14; // margen interior [px]

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private pts: Array<{ x: number; z: number }> = [];
  private minX = 0;
  private maxX = 1;
  private minZ = 0;
  private maxZ = 1;
  private roadW = 8;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sin contexto 2D para el minimapa');
    this.ctx = ctx;
  }

  /** Recalcula el encuadre al cambiar de circuito (solo ahí asigna). */
  setTrack(def: TrackDef): void {
    const cl = trackCenterline(def, 400);
    this.pts = cl.map((p) => ({ x: p.x, z: p.z }));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 12; // aire alrededor del trazado [m]
    this.minX = minX - pad;
    this.maxX = maxX + pad;
    this.minZ = minZ - pad;
    this.maxZ = maxZ + pad;
    this.roadW = def.width;
  }

  /**
   * Dibuja trazado + coche. `hx,hz` = avance normalizado en el plano.
   * El canvas pone +z hacia abajo (norte arriba si el circuito mira a +z).
   */
  update(x: number, z: number, hx: number, hz: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    if (this.pts.length < 2) return;

    const bw = Math.max(1, this.maxX - this.minX);
    const bh = Math.max(1, this.maxZ - this.minZ);
    const s = Math.min((MAP_W - 2 * FRAME) / bw, (MAP_H - 2 * FRAME) / bh);
    const ox = FRAME + (MAP_W - 2 * FRAME - bw * s) / 2 - this.minX * s;
    const oz = FRAME + (MAP_H - 2 * FRAME - bh * s) / 2 - this.minZ * s;
    const X = (wx: number): number => ox + wx * s;
    const Z = (wz: number): number => oz + wz * s;

    // Cinta del circuito (cerrada).
    ctx.beginPath();
    ctx.moveTo(X(this.pts[0].x), Z(this.pts[0].z));
    for (let i = 1; i < this.pts.length; i++) ctx.lineTo(X(this.pts[i].x), Z(this.pts[i].z));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(215, 224, 234, 0.8)';
    ctx.lineWidth = Math.max(2.5, this.roadW * s);
    ctx.stroke();

    // Salida (verde).
    ctx.beginPath();
    ctx.arc(X(this.pts[0].x), Z(this.pts[0].z), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#4dd88a';
    ctx.fill();

    // Coche: triángulo orientado según el avance.
    ctx.save();
    ctx.translate(X(x), Z(z));
    ctx.rotate(Math.atan2(hx, -hz));
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffb454';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.stroke();
    ctx.restore();
  }
}
