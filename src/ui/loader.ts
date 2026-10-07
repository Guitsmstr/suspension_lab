/**
 * Pantalla de carga: barra de progreso con estado por etapa y aviso de error
 * visible (con desplegable de detalles técnicos) si algo falla al arrancar o
 * durante la simulación.
 */
export class Loader {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly status: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly errorMsg: HTMLElement;
  private readonly errorStack: HTMLElement;
  private finished = false;

  constructor() {
    const get = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Falta el elemento #${id} en index.html`);
      return el;
    };
    this.root = get('loading');
    this.fill = get('loader-fill');
    this.status = get('loader-status');
    this.errorBox = get('loader-error');
    this.errorMsg = get('loader-error-msg');
    this.errorStack = get('loader-error-stack');
  }

  /** Actualiza la barra (0..1) y el texto de estado. */
  setProgress(progress: number, status: string): void {
    const pct = Math.max(0, Math.min(1, progress));
    this.fill.style.width = `${Math.round(pct * 100)}%`;
    this.status.textContent = status;
  }

  /** Oculta la pantalla de carga con un fundido. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.setProgress(1, 'Listo');
    this.root.classList.add('done');
  }

  /** Muestra un error visible sin cerrar la pantalla. */
  fail(message: string, stack = ''): void {
    this.finished = false;
    this.root.classList.remove('done');
    this.fill.classList.add('error');
    this.fill.style.width = '100%';
    this.status.textContent = 'La simulación no ha podido continuar';
    this.errorBox.hidden = false;
    this.errorMsg.textContent = message || 'Error desconocido';
    this.errorStack.textContent = stack || '(sin pila de llamadas)';
  }

  get hasFailed(): boolean {
    return !this.errorBox.hidden;
  }
}

/** Captura errores globales (incluidos los del bucle de simulación). */
export function installErrorReporter(loader: Loader): void {
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    loader.fail(e.message || 'Error de ejecución', err?.stack ?? '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as unknown;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? (reason.stack ?? '') : '';
    loader.fail(`Promesa rechazada: ${msg}`, stack);
  });
}
