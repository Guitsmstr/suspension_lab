# Suspension Lab 🏎️

Simulación interactiva en 3D de un coche con **suspensión realista multi-cuerpo**, ejecutándose en el navegador con three.js y una física escrita a mano (sin motor de físicas).

![stack](https://img.shields.io/badge/three.js-0.186-blue) ![stack](https://img.shields.io/badge/vite-8-green) ![stack](https://img.shields.io/badge/typescript-5.9-blue)

## Arranque

```bash
pnpm install
pnpm dev            # http://127.0.0.1:5173
pnpm test           # suite de física headless (127 comprobaciones)
pnpm check:launch   # validación del arranque en navegador real (headless, 35 comprobaciones)
pnpm build          # typecheck + build de producción
```

> Este proyecto usa **pnpm** de forma exclusiva (ver `AGENTS.md`).

## Pantalla de carga y errores

Al arrancar se muestra una barra de progreso con la etapa activa (renderizador,
terreno, entorno, coche, panel, física). Si algo falla —durante la carga o en
pleno bucle de simulación— la misma tarjeta pasa a rojo e indica **"⚠ Algo ha
salido mal"** con el mensaje y un desplegable con la pila de llamadas. Como
red de seguridad, si el módulo principal no llega a cargar se avisa igualmente
a los 12 s en lugar de dejar la pantalla muda.

## Verificación

`pnpm test` ejecuta `scripts/physics-smoke.ts` sin navegador y comprueba el
comportamiento físico del modelo:

- estabilización en reposo (altura de rodaje, cargas estáticas, recorridos ≈ 0)
- aceleración (velocidad final, cambios de marcha, límite de adherencia)
- frenada (bloqueo de ruedas sin ABS, deceleración)
- curva sostenida (alabeo, transferencia de carga, sin topes de suspensión)
- maniobra de límite (volante a tope a 80 km/h sin divergencia ni vuelco)
- paso por badenes a 22 m/s (wheel hop de la masa no suspendida)
- estabilidad con parámetros extremos (muelles al máximo, amortiguación mínima)
- coherencia del visual con la física (ruedas y muelles siguen el recorrido)

`pnpm check:launch` arranca la app en un Chromium headless y valida el
lanzamiento real: barra de progreso, ausencia de errores de consola, bucle de
render, colocación de la cámara, respuesta al teclado y el aviso de error (se
provoca un fallo controlado para comprobarlo). Las capturas quedan en `.launch/`.

## Controles

| Tecla | Acción |
| --- | --- |
| `W` / `↑` | acelerar (en `R`, vuelve a 1ª y avanza) |
| `S` / `↓` | frenar; parado y mantenido, engrana la marcha atrás (`R` en el HUD) |
| `A` `D` / `←` `→` | girar |
| `SPACE` | freno de mano |
| `R` | reiniciar posición (con cuenta atrás 3-2-1) |
| `C` | cambiar cámara (persecución / capó / órbita) |
| `P` | pausa |
| `H` | mostrar/ocultar ayuda |
| `T` | circuito (rota por los 4 trazados) |
| `V` | coche (deportivo / todoterreno) |
| `M` | abrir/cerrar el menú |
| `Esc` | cerrar el menú |
| `O` | contraer/expandir el panel de ajustes |
| Ratón | arrastrar = orbitar · rueda = zoom |

## Menú principal

Con `M` (o el botón ☰) se abre el menú con todo: **garaje** (los tres coches),
**circuitos** (los cuatro trazados agrupados por superficie, con inspiración,
longitud y ancho) y **cámara**. Elegir coche o circuito lo aplica al momento y
reaparece el coche en la salida del trazado. Al cambiar de coche se aplica su
preset de puesta a punto y los sliders del panel se sincronizan solos (luego se
puede seguir ajustando a mano).

## Circuitos y mapa cerrado

Cuatro trazados conmutables con `T` (insignia arriba + menú), dos por superficie,
que usan casi todo el mapa (±140 m) con mezcla de curvas rápidas, medias y
lentas:

| Circuito | Superficie | Trazado | Largo / ancho |
| --- | --- | --- | --- |
| **🏁 Mónaco GP** | asfalto | gran anillo exterior: recta de meta de 190 m, subida este, esses, recta norte, chicane y horquilla oeste | ~810 m · 8 m |
| **🛣 Interlagos Mini** | asfalto | mixto centro-este: S inicial, curva ciega, exterior a fondo, horquilla alta y bajada | ~410 m · 7 m |
| **🏜 Baja Whoops** | tierra | rápida oeste con la recta de badenes como tramo de saltos y cerrada al fondo | ~450 m · 6 m |
| **🏜 Estadio Rallycross** | tierra | técnico centro-oeste: esses, horquilla alta y bajada sin respiro | ~290 m · 5,5 m |

El asfalto lleva líneas de borde y **pianos rojo/blanco en las curvas**; la tierra,
**conos naranjas** marcando la trazada. Las calzadas son cintas 3D ceñidas al terreno analítico (vuelan 3 cm sobre él: lo justo para que la malla nunca las tape sin enterrar visualmente las ruedas, ya que la física rueda sobre el terreno); si se cambia la rugosidad en vivo se reconstruyen la **malla del terreno**, las calzadas y las barreras (con rebote de 250 ms). Sin reconstruir el terreno, física y hierba discreparían y la pista quedaría enterrada. La decoración nunca nace sobre ninguna calzada.

El mapa está cerrado: una barrera a rayas rojas y blancas marca el perímetro (±150 m) y un muro invisible recorta la posición a ±148 m amortiguando la salida, así que es imposible salirse del mundo o caer al vacío.

La cámara de persecución no se aleja más de un **5 %** de la distancia elegida al acelerar: avanza con el desplazamiento del coche (sin retardo a velocidad) y el lerp solo suaviza ruido y giros, así que no tiembla yendo rápido. El zoom manual con la rueda no tiene este límite.

## Garaje: tres coches

| | ⚡ Tesla Model 3 | 🛻 Todoterreno 4x4 | 🚗 Kwid Outsider |
| --- | --- | --- | --- |
| Estilo | berlina eléctrica (Tripo `car_tesla_model/` → `tesla.glb`, estilo contorno) | pick-up de rally-raid | crossover urbano (Tripo `car_kwid_model/` → `kwid_tripo.glb`, estilo contorno) |
| Masa / CdM | 1840 kg / 0,50 m | 1850 kg / 0,68 m | 820 kg / 0,55 m |
| Ruedas | 0,34 m, tracción total | 0,42 m, tracción total | 0,31 m, delantera |
| Potencia aprox. | ~250 kW | ~175 kW | ~54 kW (68 CV reales) |
| Muelles / estabilizadoras | firmes (40/52 N/mm) | blandos y altos (24/27 N/mm, +12 mm) | blandos (24/20 N/mm) |
| Dirección máx. | 32° (en parking) | 38° (en parking) | 36° (en parking) |

Cada coche trae su geometría (vías, batalla, puntos bajos de carrocería), sus
masas y su preset de parámetros; la física (`Vehicle`) y el visual (`CarVisual`)
se reconstruyen al cambiar con `V`. Las métricas de balanceo del panel usan las
masas del coche activo.

## Modelo físico

### Grados de libertad
- **Chasis rígido**: 6 DOF — posición + cuaternión, velocidad lineal y angular en el marco del cuerpo. Integración semi-implícita de Euler a paso fijo **300 Hz**.
- **4 masas no suspendidas** (una por rueda): 1 DOF vertical cada una, lo que permite el *wheel hop* real (~11 Hz) junto con el modo de balanceo del chasis (~1,5 Hz).
- **4 ruedas**: giro propio gobernado por el par motriz, el freno y la fuerza longitudinal del neumático.
- **Ejes del coche**: morro a **+Z**, arriba **+Y** y derecha del conductor a **−X**. `steer > 0` (tecla D) es girar a la derecha: las ruedas apuntan hacia −X.

### Suspensión (doble horquilla)
Cada esquina modela la cinemática de una doble horquilla mediante relaciones de movimiento instantáneas alrededor de la posición estática:

- **Tasa en rueda** = rigidez del muelle × MR², con `MR` variable según el recorrido (rigidez progresiva).
- **Amortiguación asimétrica**: coeficientes distintos en compresión (*bump*) y rebote (*rebound*), típico de un amortiguador real.
- **Topes elásticos** progresivos al llegar a los límites de compresión y extensión.
- **Barra estabilizadora**: fuerza proporcional a la diferencia de recorrido entre las ruedas de un mismo eje.
- **Camber gain**: el camber cambia con el recorrido y con el ángulo de dirección.
- **Centro de rollo**: la fuerza lateral se aplica a su altura, de modo que el brazo de momento es `(h_CoM − h_rollCenter)` y la transferencia de carga es realista.
- **Geometría anti-dive / anti-squat**: parte de la fuerza longitudinal se reacciona por las barras en lugar de por los muelles.

### Neumáticos
Fórmula mágica de Pacejka simplificada por eje (`Fx0(κ)`, `Fy0(α)`) con:

- combinación mediante **elipse de fricción** estricta en espacio de fuerzas,
- **sensibilidad a la carga potencial** (`F ∝ Fz^0.85`, ver abajo),
- **empuje de camber**: la caída genera fuerza lateral hacia donde se inclina
  la rueda (≈0,9·Fz por radián; simétrico en espejo: en recta se cancela),
- **longitud de relajación** (el neumático necesita distancia para generar fuerza),
- rigidez y amortiguación verticales propias (el neumático también es un muelle).

#### Calibración con datos reales (no solo juegos)
La forma de la curva sale de la literatura de dinámica vehicular, no de
tanteo. Referencias: H. B. Pacejka, *Tire and Vehicle Dynamics* (forma
`D·sin(C·atan(B·x))`, relajación ≈ radio de rueda); Milliken & Milliken,
*Race Car Vehicle Dynamics* (sensibilidad a la carga, fig. 2.9);
T. D. Gillespie, *Fundamentals of Vehicle Dynamics* y J. Y. Wong,
*Theory of Ground Vehicles* (μ por superficie); R. van Gaal / Racer
(coeficientes MF5.2 de ejemplo: `pcy1=1.34`, `pdy1=1.04`).

| Parámetro del modelo | Valor en el sim | Rango real medido |
| --- | --- | --- |
| Pico lateral | α ≈ 7,7° | turismos 6–10° (F1 ≈ 3°) |
| Pico longitudinal | κ ≈ 11,5 % | calle 8–15 % |
| Rigidez inicial | ≈ 20·μ·Fz | familia Pacejka (B≈10–13, C≈1,3–1,65) |
| Relajación | 0,35 m | 0,12–0,45 m (Pacejka: orden del radio) |
| Sensibilidad a la carga | F ∝ Fz^0,85 | exponente 0,7–0,9; Milliken: 1,10→0,97 al duplicar carga |
| μ compuesto sport | 1,05 (rango 0,8–1,6) | calle 0,9–1,15; slicks hasta ~1,7 |

#### Superficies: el agarre lo manda el terreno
El μ del slider es el **compuesto en asfalto**; cada rueda multiplica por
la superficie que pisa (cada una la suya: frenar a caballo entre asfalto
y hierba mete guiñada, como en la realidad). El HUD indica la superficie
bajo el coche.

| Superficie | Factor | Referencia |
| --- | --- | --- |
| 🛣 asfalto (pistas, paddock) | ×1,00 | referencia del compuesto |
| 🏜 tierra (pistas de tierra, badenes) | ×0,60 | grava/tierra 0,4–0,7 (Wong, Gillespie) |
| 🟢 hierba (resto del mapa) | ×0,40 | goma/hierba 0,35 (Engineering Toolbox) |

Combinaciones típicas: deportivo en asfalto 1,05 · en hierba 0,42;
todoterreno en tierra 0,57. Fuera del asfalto el modelo añade **suelo blando**:
la rodadura se multiplica (tierra ×2,0, hierba ×3,2) y la rigidez vertical del
neumático baja (×0,85 / ×0,7): la rueda se hunde unos mm y cuesta mover el
coche, como manda la cizalla del suelo (Bekker/Wong). Por eso las diferencias
entre compuestos se aplanan fuera del asfalto.

#### Una nota sobre el subviraje
Con el volante a tope a 20 m/s se piden ~9 g laterales con un límite
real de ~1 g: **cualquier** coche real se va de morro (las ruedas
delanteras deslizan a 40°+). Es subviraje límite, no un bug. En el rango
de adherencia (hasta ~1 g en asfalto) el coche gira; en hierba el límite
baja a ~0,4 g y hay que ir acorde. Sin control de tracción, el trasera
a fondo quema goma en 1ª/2ª como cualquier propulsión real.

### Tren motriz
Curva de par motor realista, caja automática de 6 marchas con puntos de cambio, **corte de par al cambiar** (0,15 s casi sin par, como una caja real), **freno motor** (arrastre ≈18 N·m por cada 1000 rpm, repartido a las ruedas motrices), diferencial con bloqueo limitado por eje y reparto de par configurable entre ejes (de tracción trasera a delantera). Con el coche parado, mantener el freno (`S`) engrana la **marcha atrás** (desmultiplicación fija ≈ 1ª, par negativo, tope ~30 km/h, `R` en el HUD y en la telemetría como marcha 0); el acelerador (`W`) desengrana y vuelve a 1ª.

### Dirección
Geometría Ackermann real en el eje delantero, con **tope dependiente de la velocidad**: el ángulo del slider es el de parking (a <6 m/s); por encima se recorta al ángulo que demanda como máximo ~1,6 g laterales (modelo bicicleta). A 108 km/h el Tesla gira ~3° a tope de tecla: suficiente para jugar al límite del neumático sin pedir los ~9 g absurdos del tope de parking.

### Fuerzas adicionales
Aerodinámica (arrastre + downforce), resistencia a la rodadura y reparto de frenada con sesgo delantero.

### Contacto con el terreno y obstáculos
La rueda muestrea la altura del terreno bajo su eje, pero la carrocería también es sólida: diez puntos bajo el chasis (deflector, estribos, difusor y esquinas) generan una fuerza elástico-viscosa con rozamiento al raspar el suelo. Junto a ella hay una corrección geométrica de penetración, de modo que el coche **nunca se hunde** en badenes, pendientes ni aterrizajes: sin este contacto la carrocería atravesaba el terreno hasta 40 cm.

Las rocas y troncos son sólidos: publican un colisionador cilíndrico consultado por la física mediante una rejilla espacial, y se complementan con un tope de fuerza del neumático y una red de seguridad que reaparece el coche si el estado deja de ser finito.

## Mundo y assets

El terreno es analítico (`Terrain.heightAt`), la misma función para física y malla, con colinas, zona plana de salida, meseta y un tramo de badenes ajustable en vivo.

La vegetación y las rocas son modelos **CC0 del [Kenney Nature Kit](https://kenney.nl/assets/nature-kit)**, en glTF binario optimizado (17 piezas de 16 a 230 triángulos, ~180 KB en total, ver `public/assets/nature/LICENSE.md`). Se dibujan con `InstancedMesh` —1200 piezas en 31 draw calls— repartidas con un PRNG determinista y alineadas a la pendiente, con más densidad alrededor del paddock para que sirvan de puntos de referencia al conducir. La paleta original del pack (vegetación turquesa, madera salmón) se armoniza hacia tonos naturales al cargar.

## Ajuste en vivo

El panel lateral permite modificar, con respuesta inmediata:

- **Suspensión delantera/trasera**: rigidez del muelle, amortiguación de compresión y rebote, barra estabilizadora y precarga (altura de rodaje).
- **Neumáticos**: compuesto μ (en asfalto), rigidez vertical, amortiguación y caída de μ con la carga. La superficie (asfalto/tierra/hierba, indicada en el HUD) multiplica aparte.
- **Tren motriz**: par motor, reparto de tracción y fuerza de frenado.
- **Entorno**: ángulo de dirección y rugosidad del terreno.

Junto a los sliders, la UI muestra métricas de puesta a punto calculadas en vivo: **frecuencia de balanceo** (Hz) y **ratio de amortiguamiento crítico** ζ en compresión/rebote para cada eje, más telemetría de recorrido, carga, camber y deslizamiento por rueda, ángulos de alabeo/cabeceo y G longitudinal/lateral.

## Crono y reglas

El velocímetro (abajo al centro) incluye cronometraje: vuelta en curso,
última y mejor del circuito activo. La vuelta solo cuenta si se pisan los
8 sectores en orden —atajar por fuera la anula ("Vuelta no válida")— y rodar
marcha atrás de forma sostenida levanta el aviso de dirección contraria. Las
reglas solo informan: cambiar de circuito, de coche o pulsar `R` reinicia el
crono.

## Estructura

```
src/
├── main.ts                # render, bucle a paso fijo, cableado
├── input.ts               # teclado y suavizado de dirección
├── vehicle/
│   ├── params.ts          # parámetros ajustables + store (+ presets por coche)
│   ├── cars.ts            # los tres coches: geometría, masas y presets
│   ├── suspension.ts      # cinemática de horquilla, muelles, topes
│   ├── tire.ts            # Pacejka + elipse de fricción
│   ├── drivetrain.ts      # motor, caja, diferencial
│   └── vehicle.ts         # modelo multi-cuerpo (núcleo de la simulación)
├── world/
│   ├── terrain.ts         # terreno analítico = física + render coinciden
│   ├── surface.ts         # superficies (asfalto/tierra/hierba) y su μ
│   ├── track.ts           # 4 circuitos (asfalto/tierra) + barrera y muro del mapa
│   ├── race.ts            # crono por vuelta + reglas (sectores, dirección)
│   ├── scenery.ts         # assets CC0 instanciados (árboles, rocas, césped)
│   ├── obstacles.ts       # colisionadores de rocas y troncos (rejilla espacial)
│   └── environment.ts     # cielo físico, sol, sombras, PMREM
├── render/
│   ├── carMesh.ts         # carrocerías (deportivo + 4x4), ruedas y suspensión animada
│   └── cameraRig.ts       # persecución / capó / órbita
└── ui/
    ├── loader.ts          # pantalla de carga con progreso y aviso de error
    ├── panel.ts           # sliders, telemetría y métricas
    └── menu.ts            # menú: garaje, circuitos y cámara
```

## Ideas para seguir

- Registro de telemetría sobre un tramo de badenes (road test) con gráficas.
- Freno ABS y control de tracción.
- Suspensión con ejes de dirección instantáneos completos (restricciones de barras resueltas).
- Desgaste y temperatura del neumático.
