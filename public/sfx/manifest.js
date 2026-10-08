window.SFX_MANIFEST = [
  {
    "name": "engine_offroad_loop.wav",
    "kind": "loop",
    "group": "motor",
    "desc": "Motor V8 ronco (todoterreno 4x4). Ritmo de encendido base 60 Hz, escalar con playbackRate.",
    "gain": 0.55,
    "baseFreq": 60
  },
  {
    "name": "engine_kwid_loop.wav",
    "kind": "loop",
    "group": "motor",
    "desc": "Motor de 3 cilindros ligero (Kwid). Ritmo de encendido base 60 Hz, escalar con playbackRate.",
    "gain": 0.5,
    "baseFreq": 60
  },
  {
    "name": "engine_ev_loop.wav",
    "kind": "loop",
    "group": "motor",
    "desc": "Zumbido eléctrico + whine de engranaje/inversor (Tesla). Escalar con playbackRate.",
    "gain": 0.5,
    "baseFreq": 100
  },
  {
    "name": "roll_asphalt_loop.wav",
    "kind": "loop",
    "group": "rodadura",
    "desc": "Rodadura continua sobre asfalto (lecho grave + granos finos). Escalar volumen con velocidad.",
    "gain": 0.45
  },
  {
    "name": "roll_dirt_loop.wav",
    "kind": "loop",
    "group": "rodadura",
    "desc": "Rodadura sobre tierra con gravilla granular. Escalar volumen con velocidad.",
    "gain": 0.5
  },
  {
    "name": "roll_grass_loop.wav",
    "kind": "loop",
    "group": "rodadura",
    "desc": "Rodadura sobre hierba (lecho suave + swish). Escalar volumen con velocidad.",
    "gain": 0.5
  },
  {
    "name": "tire_squeal_loop.wav",
    "kind": "loop",
    "group": "neumático",
    "desc": "Chirrido de neumático en límite de adherencia (rugido + tonos stick-slip). Escalar con slip.",
    "gain": 0.5
  },
  {
    "name": "brake_squeal_loop.wav",
    "kind": "loop",
    "group": "neumático",
    "desc": "Chirrido de frenado/bloqueo de ruedas (más agudo y estable).",
    "gain": 0.5
  },
  {
    "name": "wheelspin_loop.wav",
    "kind": "loop",
    "group": "neumático",
    "desc": "Patinaje de ruedas en vacío / derrape fuerte.",
    "gain": 0.5
  },
  {
    "name": "scrape_loop.wav",
    "kind": "loop",
    "group": "chasis",
    "desc": "Raspado continuo de bajos contra el suelo (granos metálicos).",
    "gain": 0.45
  },
  {
    "name": "wind_loop.wav",
    "kind": "loop",
    "group": "ambiente",
    "desc": "Viento / aire a velocidad. Escalar con velocidad y cámara.",
    "gain": 0.3
  },
  {
    "name": "susp_bottomout.wav",
    "kind": "oneshot",
    "group": "suspensión",
    "desc": "Golpe seco de tope de suspensión (bottom-out).",
    "gain": 0.85
  },
  {
    "name": "susp_bottomout_heavy.wav",
    "kind": "oneshot",
    "group": "suspensión",
    "desc": "Golpe de tope fuerte (gran compresión / aterrizaje duro).",
    "gain": 0.9
  },
  {
    "name": "susp_clunk.wav",
    "kind": "oneshot",
    "group": "suspensión",
    "desc": "Clunk de extensión/rebote de suspensión.",
    "gain": 0.75
  },
  {
    "name": "land_thump.wav",
    "kind": "oneshot",
    "group": "suspensión",
    "desc": "Aterrizaje de salto (impacto amortiguado + muelle + gravilla).",
    "gain": 0.9
  },
  {
    "name": "whoops_rumble.wav",
    "kind": "oneshot",
    "group": "suspensión",
    "desc": "Ráfaga de badenes (rumble de baja frecuencia granulado).",
    "gain": 0.8
  },
  {
    "name": "impact_light.wav",
    "kind": "oneshot",
    "group": "impacto",
    "desc": "Impacto ligero (chasis contra obstáculo, roce de borde).",
    "gain": 0.8
  },
  {
    "name": "impact_heavy.wav",
    "kind": "oneshot",
    "group": "impacto",
    "desc": "Impacto fuerte (colisión de alta energía).",
    "gain": 0.95
  },
  {
    "name": "rollover.wav",
    "kind": "oneshot",
    "group": "impacto",
    "desc": "Vuelco (choque + modos + raspado largo con chatarra).",
    "gain": 0.95
  },
  {
    "name": "ui_click.wav",
    "kind": "oneshot",
    "group": "ui",
    "desc": "Click de UI: botones, sliders, teclas.",
    "gain": 0.4
  },
  {
    "name": "countdown_beep.wav",
    "kind": "oneshot",
    "group": "ui",
    "desc": "Bip de cuenta atrás (3-2-1).",
    "gain": 0.5
  },
  {
    "name": "countdown_go.wav",
    "kind": "oneshot",
    "group": "ui",
    "desc": "Bip final de salida (\"¡VAMOS!\").",
    "gain": 0.55
  }
];
