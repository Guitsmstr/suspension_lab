#!/usr/bin/env bash
#
# Despliega el Tesla de Blender al juego.
#
#   ./scripts/tesla-deploy.sh           # solo exporta + verifica el .glb
#   ./scripts/tesla-deploy.sh --serve   # + arranca el juego para verlo (Ctrl-C al salir)
#   ./scripts/tesla-deploy.sh --shot    # + capturas 3/4, frontal y lateral en .launch/
#   ./scripts/tesla-deploy.sh --deploy  # + commit + push (Vercel autodespliega)
#
# Se pueden combinar: --shot --deploy. Variables:
#   BLENDER=...  ruta al binario (por defecto Blender.app o `blender` del PATH)
#   MORRO=1      +1 si el morro esta en +Z del .blend, -1 si esta en -Z
#
set -euo pipefail
cd "$(dirname "$0")/.."

BLEND="car_tesla_model/Untitled.blend"
GLB="public/assets/cars/tesla.glb"
MORRO="${MORRO:-1.0}"
DO_SERVE=0
DO_SHOT=0
DO_DEPLOY=0
for a in "$@"; do
  case "$a" in
    --serve) DO_SERVE=1 ;;
    --shot) DO_SHOT=1 ;;
    --deploy) DO_DEPLOY=1 ;;
    *) echo "uso: $0 [--serve] [--shot] [--deploy]"; exit 1 ;;
  esac
done

# --- 0. Blender ---
if [ -z "${BLENDER:-}" ]; then
  if [ -x "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
  else
    BLENDER="$(command -v blender || true)"
  fi
fi
[ -n "$BLENDER" ] || { echo "❌ no encuentro Blender (define BLENDER=...)"; exit 1; }
[ -f "$BLEND" ] || { echo "❌ no existe $BLEND"; exit 1; }

echo "▶ exportando $BLEND (MORRO=$MORRO)..."
"$BLENDER" --background "$BLEND" --python scripts/tesla_export.py -- "$MORRO" 2>&1 \
  | grep -E "modificador|separados|rueda=|islas del body|volteada|volteadas|desplazada|EXPORTADO|Error|Traceback|Assertion" \
  || { echo "❌ falló la exportación"; exit 1; }
[ -f "$GLB" ] || { echo "❌ no se generó $GLB"; exit 1; }

# --- 1. verificación del .glb (cotas, ruedas en bujes, winding) ---
echo "▶ verificando $GLB..."
python3 - "$GLB" <<'EOF'
import struct, json, array, sys
from collections import defaultdict

d = open(sys.argv[1], 'rb').read()
ln = struct.unpack('<I', d[12:16])[0]
js = json.loads(d[20:20 + ln])
binstart = 20 + ln + 8

def acc(i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    off = binstart + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return array.array('f', d[off:off + a['count'] * 3 * 4]), a['count']

def acci(i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    off = binstart + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    ct = {5121: 'B', 5123: 'H', 5125: 'I'}[a['componentType']]
    return array.array(ct, d[off:off + a['count'] * array.array(ct).itemsize])

errs = []
nodes = js['nodes']
wheels = [n for n in nodes if (n.get('name') or '').startswith('Wheel')]
if len(wheels) != 4:
    errs.append(f"ruedas: esperaba 4, hay {len(wheels)}")
bodies = [n for n in nodes if n.get('mesh') is not None and not (n.get('name') or '').startswith('Wheel')]
if not bodies:
    errs.append("sin carroceria")

for n in nodes:
    if n.get('mesh') is None:
        continue
    prim = js['meshes'][n['mesh']]['primitives'][0]
    pos, c = acc(prim['attributes']['POSITION'])
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    idx = acci(prim['indices'])
    vol = 0.0
    for t in range(0, len(idx), 3):
        ax, ay, az = pos[3 * idx[t]], pos[3 * idx[t] + 1], pos[3 * idx[t] + 2]
        bx, by, bz = pos[3 * idx[t + 1]], pos[3 * idx[t + 1] + 1], pos[3 * idx[t + 1] + 2]
        cx, cy, cz = pos[3 * idx[t + 2]], pos[3 * idx[t + 2] + 1], pos[3 * idx[t + 2] + 2]
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    if vol < 0:
        errs.append(f"{n.get('name')}: winding invertido (vol={vol / 6:+.2f}) -> en Blender: Select All + Shift+N, verifica con Face Orientation")
    name = n.get('name') or ''
    if name.startswith('Wheel'):
        cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
        exp = {
            'Wheel_Front_Left': (0.8, -0.16, 1.49), 'Wheel_Front_Right': (-0.8, -0.16, 1.49),
            'Wheel_Rear_Left': (0.8, -0.16, -1.38), 'Wheel_Rear_Right': (-0.8, -0.16, -1.38),
        }[name]
        err = abs(cx - exp[0]) + abs(cy - exp[1]) + abs(cz - exp[2])
        if err > 0.1:
            errs.append(f"{name}: descentrada del buje ({cx:+.2f},{cy:+.2f},{cz:+.2f})")
    elif 'Body' in name and 'TeslaBody' in ''.join(x.get('name') or '' for x in nodes):
        pass  # la carroceria se valida por cotas globales abajo

# cotas globales del conjunto (ancho/alto/largo de berlina)
allx = [x for n in nodes if n.get('mesh') is not None for x in acc(js['meshes'][n['mesh']]['primitives'][0]['attributes']['POSITION'])[0][0::3]]
w = max(allx) - min(allx)
if not 1.6 < w < 2.4:
    errs.append(f"ancho raro: {w:.2f} m (esperaba ~1.9)")

# malla explotada: casi todo son bordes (p.ej. Edge Split aplicado)
bnd = tot = 0
for n in nodes:
    if n.get('mesh') is None:
        continue
    prim = js['meshes'][n['mesh']]['primitives'][0]
    idx = acci(prim['indices'])
    uses = defaultdict(int)
    for t in range(0, len(idx), 3):
        for e in range(3):
            a2, b2 = idx[t + e], idx[t + (e + 1) % 3]
            uses[(a2, b2) if a2 < b2 else (b2, a2)] += 1
    for c in uses.values():
        tot += 1
        if c == 1:
            bnd += 1
if tot and bnd / tot > 0.5:
    print(f"⚠️  malla explotada: {100 * bnd / tot:.0f}% aristas de borde "
          f"(¿Edge Split aplicado? En Blender: Select All + M > Merge by Distance)")

if errs:
    print("❌ " + "\n❌ ".join(errs))
    sys.exit(1)
print(f"✅ glb OK ({len(d) // 1024} KB, 4 ruedas en bujes, winding correcto)")
EOF

# --- 2. servidor local (solo si hace falta verlo) ---
DEV_PID=""
dev_up() { curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ 2>/dev/null | grep -q 200; }
if [ "$DO_SERVE" = 1 ] || [ "$DO_SHOT" = 1 ]; then
  if dev_up; then
    echo "▶ reuso el servidor local (ya corre)"
  else
    echo "▶ arranco pnpm dev..."
    pnpm dev >/tmp/tesla-dev.log 2>&1 &
    DEV_PID=$!
    for _ in $(seq 1 30); do dev_up && break; sleep 1; done
    dev_up || { echo "❌ el dev no arranca (mira /tmp/tesla-dev.log)"; kill $DEV_PID 2>/dev/null; exit 1; }
  fi
fi

# --- 3. capturas ---
if [ "$DO_SHOT" = 1 ]; then
  echo "▶ capturas en .launch/ ..."
  node scripts/shot_car.mjs tesla
fi

# --- 4. servir en primer plano ---
if [ "$DO_SERVE" = 1 ]; then
  [ -n "$DEV_PID" ] && kill $DEV_PID 2>/dev/null
  echo "▶ http://127.0.0.1:5173 (Ctrl-C para salir)"
  exec pnpm dev
fi
[ -n "$DEV_PID" ] && kill $DEV_PID 2>/dev/null

# --- 5. deploy ---
if [ "$DO_DEPLOY" = 1 ]; then
  if git status --porcelain=v1 -- public/assets/cars/tesla.glb scripts/tesla_export.py | grep -q .; then
    git add public/assets/cars/tesla.glb scripts/tesla_export.py
    git commit -q -m "Tesla: actualiza modelo desde Blender" && git push -q
    git log --oneline -1
    echo "✅ desplegado (Vercel autodespliega desde GitHub)"
  else
    echo "✅ sin cambios: el .glb ya es el commiteado, nada que desplegar"
  fi
fi
