# Specification — Suspension Lab

> Version: 0.1 · Date: 2026-10-14 · Status: in iteration
>
> Process: **spec-driven development**. This document is the product's source of truth. Decisions are recorded in [`decisions.md`](decisions.md) and pending work in [`backlog.md`](backlog.md).

## 1. Context

- **Product:** a browser driving game built around a real-time multi-body suspension simulation — 4 independent wheels, per-wheel travel/load telemetry, live tunable setup.
- **Stack:** Vite + TypeScript + three.js, pnpm. Deploys to Vercel (static `dist/`).
- **Strategy:** feel-first realism (body roll/pitch, surface feedback, granular skid audio) over arcade handling; every tunable parameter exposed in-app.

## 2. Users

- **Primary:** driving/physics enthusiasts on desktop (keyboard + mouse) and on phones (touch + tilt steering).
- **Secondary:** the developer tuning the model via telemetry and setup sliders.

## 3. Problem

Arcade web racers fake weight transfer. Suspension Lab simulates it: spring/damper/kinematics per corner, surface-dependent grip, load-sensitive audio — and shows it happening live.

## 4. Scope

### In

1. Real-time rigid-body vehicle with 4 independent suspensions and Pacejka-style tire grip.
2. Garage: 3 cars (sport/Tesla-like, offroad 4x4, Kwid FWD) with distinct mass, aero, drivetrain.
3. Circuits: 3 small-world tracks (Monaco/Barranquilla asphalt, Baja/Stadium dirt) + Nürburgring Nordschleife 1:1 streaming world.
4. Desktop input (keyboard/mouse orbit+zoom) and phone input (touch buttons + accelerometer tilt steering, phone-only UI).
5. Live tuning panel generated from `PARAM_SPECS`, telemetry HUD, minimap, race director (laps/timers), granular game audio.
6. Deterministic validation: headless physics suite, launch suite, touch suite.

### Out

- Multiplayer or networked leaderboards.
- Visual damage modeling.
- Custom user content (tracks/cars) upload.

## 5. Functional requirements

- **FR-01 — Driving:** keyboard drive (WASD/arrows, space handbrake, shift test mode, R reset with countdown, C camera, P pause, T track, V car, M menu, O collapse, N sound).
- **FR-02 — Phone driving:** touch buttons (steer/gas/brake/handbrake/reset/pause/menu/camera/fullscreen) visible on coarse-pointer devices only; tilt-to-steer with permission flow, center calibration, and invert toggle; persisted chase camera while driving.
- **FR-03 — Garage:** car switch recompiles the visual shell live, applies the setup preset, and respawns at the active track start.
- **FR-04 — Tracks:** track switch swaps the active world (small 320 m vs streaming ring), respawns the car, and updates badge/minimap/race director.
- **FR-05 — Tuning:** every adjustable parameter declared in `src/vehicle/params.ts`; panel sliders generated from `PARAM_SPECS`; presets per car.
- **FR-06 — Race:** lap counting, last/best times, surface badge, wrong-way warning, countdown on reset.
- **FR-07 — Failure visibility:** any boot or loop exception surfaces a visible error panel with technical details (never a mute loader).

## 6. Non-functional requirements

- **RNF-01 — Simulation determinism:** physics runs at a fixed `1/300 s` step decoupled from render; identical inputs produce identical trajectories.
- **RNF-02 — Performance:** 60 fps target on typical hardware; zero allocations inside `Vehicle.step`; capped substeps per frame with a max-frame-dt clamp.
- **RNF-03 — Physics/render agreement:** the analytic terrain function is the single height source for physics and mesh; road carving never leaves grass above asphalt.
- **RNF-04 — Correctness:** zero console/page errors in the launch suite; `pnpm test`, `pnpm check:launch`, and `pnpm check:touch` green before a story converges.
- **RNF-05 — Phone fit:** on coarse-pointer devices the HUD, minimap, panel, and menu compress to small-button layouts that never cover the driving controls.
