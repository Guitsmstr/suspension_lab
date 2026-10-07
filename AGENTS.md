# Suspension Lab — instrucciones del proyecto

## Paquetes
- Usar **pnpm** exclusivamente (`pnpm install`, `pnpm dev`, `pnpm build`, `pnpm exec`). Nunca npm/npx/yarn.

## Comandos
- `pnpm dev` — servidor de desarrollo en http://127.0.0.1:5173
- `pnpm test` — suite de física headless (`scripts/physics-smoke.ts`); debe pasar antes de dar por bueno cualquier cambio en la física
- `pnpm check:launch` — arranca la app en Chromium headless (Playwright) y valida consola limpia, pantalla de carga, cámara, respuesta al teclado y aviso de error; guarda capturas en `.launch/`
- `pnpm build` — typecheck + build de producción
- `pnpm typecheck` — solo comprobación de tipos

## Convenciones
- TypeScript estricto, módulos ES, imports de three.js: `three` y `three/addons/...`.
- La física vive en `src/vehicle/` y no debe depender de three.js salvo por `THREE.Vector3/Quaternion`.
- El bucle de física corre a paso fijo `1/300 s` (`PHYSICS_DT` en `src/main.ts`); el render interpola/actualiza visuales.
- Todo parámetro ajustable se declara en `src/vehicle/params.ts` (el panel de la UI se genera automáticamente de `PARAM_SPECS`).
- El terreno es analítico (`Terrain.heightAt`) y comparten función física y malla: no introducir alturas discrepantes.
- Evitar asignaciones dentro del bucle de física (`Vehicle.step`); usar los vectores temporales de la clase.
