# Backlog

Story states: `draft` → `refined` → `ready` → `in progress` → `done` (or `postponed`).

Stories in `draft` need refinement: acceptance criteria, dependencies, and resolution of open questions. Story work runs through the `sdd` coordinator (`.opencode/agents/sdd.md`); per-story artifacts live in `docs/specs/<story>/`.

---

## E0 — SDD harness

- [x] **E0-S1 · SDD harness bootstrap** (constitution, spec, backlog, ADR log, role runbooks, deterministic gate + pre-commit hook) · `done`
  - See D4. Artifacts: `docs/specs/e0-s1-sdd-harness/`. Gate green on landing.

## E1 — Phone driving quality

- [ ] **E1-S1 · Tilt-sign check on a physical device** · `draft`
  - The headless touch suite injects tilt state; the sensor mapping (`devicemotion` lateral axis per screen orientation) is unverified on hardware.
  - Questions: which orientations need checking (portrait/landscape both ways)? Who runs the on-device pass?
- [ ] **E1-S2 · PWA install polish** · `draft`
  - `public/manifest.webmanifest` ships without icons; install prompt and homescreen launch unverified.
  - Questions: icon source (SVG maskable)? Target: Android + iOS homescreen?

## E2 — Simulation depth (to refine)

- [ ] **E2-S1 · Next physics/model iteration** · `draft`
  - No scoped item yet. Candidates surface from driving sessions.

## E3 — Technical debt (from the 2026-10-14 technical diagnosis · prioritized)

Full findings with `file:line` evidence are summarized below; re-verify evidence at story start (code may drift).

- [ ] **E3-S1 · RNF-02 real: zero allocations in the hot path** · `draft` (URGENT)
  - Per-substep allocations inside `Vehicle.step`: `src/vehicle/vehicle.ts:713` (brake torque array literal), `src/vehicle/drivetrain.ts:147` (return object), `drivetrain.ts:170` (torque-split tuple, ~4 calls/substep at `vehicle.ts:678-706`) ≈ 3.000 objects/s at 300 Hz. Spec `docs/spec.md` RNF-02 forbids this and no test enforces it.
  - Also per-frame render allocations (H3): `src/render/cameraRig.ts:79,81,89,121` (Vector3 per frame), `src/render/carMesh.ts:996-1002` (`updateArm` clones 16×/frame while `SHOW_SUSPENSION=false` at `carMesh.ts:32`), `src/world/ring/groundTiles.ts:227-237`, `src/render/minimap.ts:65-66`, `src/world/race.ts:128` (history push).
  - Remediation: class-owned scratch objects/out-params; skip `updateArm` when hidden; circular buffer for race history. Add a smoke assertion (allocation/GC stability over N substeps).
- [ ] **E3-S2 · Spatial index for small-world surface queries** · `draft` (URGENT)
  - `src/world/surface.ts:42-50` linearly scans all `trackSurfaceSamples()` (~220/track, `track.ts:1060-1074`), ~9 full scans per physics substep (~1.4M checks/s) from `vehicle.ts:736-738,776-778,1146-1148`. Cost grows with every new track. The ring already has `src/world/ring/spatialIndex.ts`.
  - Remediation: RingIndex-style grid for small-world samples + per-substep memoization of surface under each wheel; unify `surfaceAt`/`surfaceMuAt`/`surfaceKindAt` into one query. Measure before/after with a counter in the smoke.
- [ ] **E3-S3 · Data-driven car pipeline** · `draft` (URGENT)
  - Car logic is scattered code, not data: `src/render/carMesh.ts:177-208` (if/fallback chains), `carMesh.ts:117-118,869-921` (offroad branches), `src/audio/gameAudio.ts:46-53` (engine map), `src/vehicle/vehicle.ts:418-458` (suspension hardpoints with magic ±0.52/±0.54 offsets NOT derived from `CarSpec` — latent bug for wide/narrow cars), `scripts/launch-check.mjs:430-432` ("3 coches" literal). A 4th car touches 5+ modules.
  - Remediation: extend `CarSpec` (hardpoints, wheel profile, visual attach strategy, audio engine); declarative attach registry in `CarVisual.create`; E2E expectations derived from `window.__sim`/`CAR_ORDER` instead of literals.
- [ ] **E3-S4 · Race rules coverage + literal-free E2E** · `draft` (HIGH)
  - `RaceDirector` (`src/world/race.ts:92-160`) has zero tests; `SwitchableTerrain`/`SwitchableObstacles` (`src/world/ring/ringWorld.ts:18-56`) only indirect. E2E literals break on new content: `scripts/launch-check.mjs:329` (track order), `:331-333` (badge strings), `:431` ("3 coches y 4 circuitos"), `scripts/touch-check.mjs:66`. No unit-test runner, no lint (`validate.sh` says "no lint configured").
  - Remediation: minimal unit-test runner (or extracted smoke scenarios) covering RaceDirector with DOM stubs; derive E2E expectations from the app; add ESLint to the gate.
- [ ] **E3-S5 · Build hygiene: payload and boot** · `draft` (HIGH)
  - Blender sources (`*.blend`, `*.blend1` under `public/assets/cars/`) are copied to `dist/` and deployable; sourcemaps public (`vite.config.ts:11`); 22 WAVs fetched+decoded in parallel at boot (`src/audio/gameAudio.ts:148-160`); GLB fallback chains fetch up to 3-4 files per car (`src/render/sportBody.ts:14-20`), 17 nature GLBs (`src/world/scenery.ts:164-176`).
  - Remediation: exclude author artifacts from the build, non-public/absent sourcemaps in prod, compressed audio + deferred layers, GLB preload/cache per car.
- [ ] **E3-S6 · Structural refactors (to refine)** · `draft` (HIGH/MEDIUM)
  - `src/main.ts` god-file (595 lines: boot + wiring + loop; double car build at `main.ts:209` and `main.ts:370`; `main.ts:374` broken formatting; closure-order hazard in `params.onChange` at `main.ts:170-181`). Duplicate road pipelines: `track.ts:376-406,600-644,650-698,855-878` vs `ring/roadChunks.ts:20-162`; grass-carve rules tripled: `track.ts:914-1023` vs `ring/ringTerrain.ts:120-129` vs `ring/groundTiles.ts:109-129`; `smoothstep` reimplemented ≥5×. `TrackId` union forces manual ring discrimination (`track.ts:40,362-369`, `ui/menu.ts:52-89`, `main.ts:283-313`). Legacy phantom constants (`vehicle.ts:64-79` vs `cars.ts`). DOM coupling in `world/race.ts:54-59`, `render/minimap.ts:23-27`, `gameAudio.ts:132-136`. Boot builds all 4 roads always (`track.ts:917`, rebuild on roughness change `main.ts:156-168`). `SAMPLES=400` → 52 m spacing on the 20.8 km ring (wrong-way threshold `race.ts:114,17` imprecise).
  - Remediation (split into stories at refinement): road-ribbon abstraction + single carve function + track data files; `Game`/Boot phases; `world: 'small'|'ring'` registry; RaceDirector publishes state (no DOM); distance-based race sampling; lazy per-track road grids.
- [ ] **E3-S7 · Mobile path robustness** · `draft` (MEDIUM)
  - One-shot layout decisions (`src/ui/touchControls.ts:44-49` `isTouchDevice` on `screen.width/height<820`; `main.ts:477-481` collapse only at boot — rotation is not re-evaluated; `resize` handler at `main.ts:422-427` ignores layout); eternal `setInterval` without cleanup (`touchControls.ts:345-351`); iOS permission flow has no retry path (`touchControls.ts:215-250`); safe-area only bottom (`index.html:661`).
  - Remediation: re-evaluate layout on `orientationchange`/`resize`; destroy/cleanup watcher; visible permission state + retry; top safe-area for notched landscape.
- [ ] **E3-S8 · Low-hanging polish (to refine)** · `draft` (LOW)
  - `index.html` monolithic (~1.150 lines inline CSS, manual z-index 12-20, no `@media`); duplicated sfx manifests (`public/sfx/manifest.json` vs `manifest.js`, neither consumed — gains hardcoded in `gameAudio.ts:67-76`); formatting damage from manual edits (`main.ts:374`, `track.ts:436`, `physics-smoke.ts:859`); QA scripts outside the gate (`scripts/ring-check.mjs`, `shot_car.mjs`, `fetch-sfx.mjs`, `bake-ring.mjs`); `trackCenterline` re-sampled independently by minimap/race/track.
