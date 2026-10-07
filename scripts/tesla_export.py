"""Exporta el Tesla remodelado a tesla.glb para el juego.

Frame del .blend (modelo Tripo en Y-up): X=ancho, Y=arriba, Z=largo.
Frame del juego (glTF): X=ancho, Y=arriba, Z=largo con morro en +Z,
origen en el CdM (suelo en y=-0.5), metros.

MORRO = +1 si el morro esta en +Z del blend, -1 si esta en -Z.
"""
import bpy
import sys
from mathutils import Vector

MORRO = float(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else 1.0
ESCALA = 2.87 / 0.60  # batalla del blend (0.60) -> batalla real (2.87 m)
RADIO_OBJ = 0.34 / (0.075 * ESCALA)  # radio fisico / radio modelado escalado
# Posicion fisica de los bujes en el frame del juego (ver cars.ts: sport)
HUB_X = 0.8
HUB_Y = -0.16
HUB_FZ = 1.492
HUB_RZ = -1.378

print(f"MORRO={MORRO} ESCALA={ESCALA:.4f} RADIO_OBJ={RADIO_OBJ:.4f}")

# Limpieza: fuera camara, luz y RootNode
for name in ('Camera', 'Light', 'Camera.001', 'Cam2', 'Cam'):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)

src = [o for o in bpy.data.objects if o.type == 'MESH']
assert len(src) == 1, f"esperaba 1 mesh, hay {len(src)}"
src = src[0]
print("mesh:", src.name, "materiales:", [m.name for m in src.data.materials])
print(f"transform: loc={[round(v,3) for v in src.location]} rot={[round(v,3) for v in src.rotation_euler]} scl={[round(v,3) for v in src.scale]}")

# 0. Aplicar modificadores (p.ej. WEIGHTED_NORMAL del usuario): si no, el
#    export ignora el fix y el script trabaja sobre la malla base.
bpy.ops.object.select_all(action='DESELECT')
src.select_set(True)
bpy.context.view_layer.objects.active = src
for m in list(src.modifiers):
    try:
        bpy.ops.object.modifier_apply(modifier=m.name)
        print(f"modificador aplicado: {m.name} ({m.type})")
    except Exception as e:
        print(f"modificador NO aplicado: {m.name} ({e})")
for img in bpy.data.images:
    print(f"imagen: {img.name} packed={img.packed_file is not None} size={img.size[0]}x{img.size[1]}")

import bmesh as _bmesh0

# Separacion por CONECTIVIDAD exacta (sin bbox destructivo): por esquina se
# hace flood fill desde una semilla y esa isla es la rueda. Del body solo
# sale la isla: los bordes de aleta y fragmentos cercanos se quedan en su
# sitio (el bbox anterior los borraba y dejaba agujeros).
def _flood_island(bm, seed):
    seen = {seed}
    stack = [seed]
    while stack:
        u = stack.pop()
        for e in u.link_edges:
            x = e.other_vert(u)
            if x not in seen:
                seen.add(x)
                stack.append(x)
    return seen

for sx in (1.0, -1.0):
    for sz in (1.0, -1.0):
        seed_pt = Vector((sx * 0.18, 0.075, sz * 0.30))
        bm = _bmesh0.new()
        bm.from_mesh(src.data)
        bm.verts.ensure_lookup_table()
        seed = min(bm.verts, key=lambda v: (v.co - seed_pt).length)
        island = _flood_island(bm, seed)
        idx = {v.index for v in island}
        nw = len(idx)
        assert nw < 1500, f"el flood se escapo del paso de rueda ({nw}v): rueda soldada?"
        # objeto rueda: duplicado del body con solo la isla
        w = src.copy()
        w.data = src.data.copy()
        bpy.context.collection.objects.link(w)
        bmw = _bmesh0.new()
        bmw.from_mesh(w.data)
        _bmesh0.ops.delete(bmw, geom=[v for v in bmw.verts if v.index not in idx], context='VERTS')
        bmw.to_mesh(w.data)
        bmw.free()
        # del body: borrar solo la isla
        _bmesh0.ops.delete(bm, geom=list(island), context='VERTS')
        bm.to_mesh(src.data)
        bm.free()
        w.name = f"WheelTmp_{sx:+.0f}_{sz:+.0f}"
        print(f"pasada sx={sx} sz={sz}: rueda={nw}v resto={len(src.data.vertices)}v")

wheels = [o for o in bpy.data.objects if o.type == 'MESH' and o is not src and o.name.startswith('WheelTmp_')]
print(f"separados: {len(wheels)} objetos rueda")
assert len(wheels) == 4, "no salieron 4 ruedas"
for w in wheels:
    print(f"  {w.name}: {len(w.data.vertices)}v")

body = src
body.name = 'TeslaBody'

# Clasifica cada rueda por posicion en el MUNDO Blender (matrix_world incluye
# la rotacion +90 X que trae el objeto: X=ancho, Y=largo, Z=arriba).
# El morro del modelo esta en Y=-MORRO (con MORRO=+1: -Y).
# Se usa el centro del BBOX (el centroide de vertices engana por la
# asimetria de la llanta y descentraria el giro).
def center(o):
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    xs = [w.x for w in ws]
    ys = [w.y for w in ws]
    zs = [w.z for w in ws]
    return Vector((
        (min(xs) + max(xs)) / 2,
        (min(ys) + max(ys)) / 2,
        (min(zs) + max(zs)) / 2,
    ))

for w in wheels:
    c = center(w)
    front = (c.y * MORRO) < 0
    left = c.x > 0  # +X es la izquierda del coche (ver carMesh.ts)
    w.name = f"Wheel_{'Front' if front else 'Rear'}_{'Left' if left else 'Right'}"
    print(f"  {w.name}: centro=({c.x:.3f},{c.y:.3f},{c.z:.3f}) verts={len(w.data.vertices)}")

# 2. Rotacion +90 sobre X para todos: (x,y,z)->(x,-z,y).
#    Y-blend(arriba)->Z, Z-blend(largo)->-Y. Estandar Blender (Z-up).
import math
for o in [body, *wheels]:
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.scale = (ESCALA, ESCALA, ESCALA)
    o.location = (0, 0, 0)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')

# 3. Suelo (z=0) a z=-0.5 POR VERTICES: el CdM queda en el origen
#    (frame cuerpo del juego) y los nodos quedan limpios.
for o in [body, *wheels]:
    for v in o.data.vertices:
        v.co.z -= 0.5

# 3b. La batalla del modelo es simetrica (+-1.435) pero la fisica no
#    (+1.492/-1.378): las ruedas quedan 5.7 cm por delante de los pasos.
#    Se desplaza TODA la carroceria (solo ella: las ruedas ya estan en los
#    bujes) para que los pasos caigan sobre las ruedas, sin tocar la fisica.
#    En frame Blender (Y=largo, morro en -Y*MORRO): y += punto medio bujes.
HUB_MID = ((-HUB_FZ) + (-HUB_RZ)) / 2 * MORRO
for v in body.data.vertices:
    v.co.y += HUB_MID
print(f"carroceria desplazada en Y-blender: {HUB_MID:+.4f} m")

# 4. Ruedas: escala de radio y recolocacion a los bujes fisicos.
#    En frame Blender: X=ancho, Y=largo (morro en -Y si MORRO=+1), Z=arriba.
for w in wheels:
    front = 'Front' in w.name
    left = 'Left' in w.name
    # El morro en frame Blender queda en -Y*MORRO; el eje delantero va ahi.
    # (El exportador mapea (x,y,z)->(x,z,-y): Y=-1.492 acaba en Z=+1.492.)
    tz = (-HUB_FZ if front else -HUB_RZ) * MORRO
    tx = HUB_X if left else -HUB_X
    c = center(w)
    # escala del plano de rueda (Y,Z) alrededor de su centro
    for v in w.data.vertices:
        v.co.y = c.y + (v.co.y - c.y) * RADIO_OBJ
        v.co.z = c.z + (v.co.z - c.z) * RADIO_OBJ
    # traslada el centro al buje fisico
    delta = Vector((tx - c.x, tz - c.y, HUB_Y - c.z))
    for v in w.data.vertices:
        v.co += delta
    print(f"  {w.name}: buje=({tx:.2f},{tz:.2f},{HUB_Y:.2f})")

# 5. Auditoria de winding por isla (conserva las normales custom del
#    modificador WEIGHTED_NORMAL del usuario: no se recalcula nada).
#    Las islas con volumen signado negativo estan invertidas (su casco del
#    contorno las tapa y salen negras): se voltean, salvo interior del
#    habitaculo (asientos, salpicadero), que mira hacia dentro a proposito.
import bmesh as _bm2

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.data.objects if o.type == 'MESH' and o is not body and o not in wheels]
print(f"islas del body: {len(parts)}")
flipped = 0
for p in parts:
    bm = _bm2.new()
    bm.from_mesh(p.data)
    vol = bm.calc_volume(signed=True)
    bm.free()
    n = len(p.data.vertices)
    cx = sum(v.co.x for v in p.data.vertices) / n
    cy = sum(v.co.y for v in p.data.vertices) / n
    cz = sum(v.co.z for v in p.data.vertices) / n
    # Frame actual: metros, X=ancho, Y=largo, Z=arriba, suelo en z=-0.5.
    interior = abs(cx) < 0.7 and -0.1 < cz < 0.5 and abs(cy) < 1.9
    bajos = cz < -0.35  # miran al suelo a proposito: no tocar
    if vol < -1e-9 and not interior and not bajos:
        bpy.ops.object.select_all(action='DESELECT')
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.flip_normals()
        bpy.ops.object.mode_set(mode='OBJECT')
        flipped += 1
        print(f"  volteada: {p.name} verts={n} vol={vol:.2e}")
print(f"volteadas: {flipped}/{len(parts)}")
# Las islas quedan como objetos separados (TeslaBody, TeslaBody.001, ...):
# el juego aplica el casco del contorno solo a las cerradas (ver addContour)
# y solo aristas al resto, asi los cristales no quedan tapados de negro.
for p in parts:
    p.name = f"TeslaBody_{p.name}"
print("islas separadas:", len(parts) + 1)

# 6. Exporta carroceria (body + islas) + ruedas
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
for p in parts:
    p.select_set(True)
for w in wheels:
    w.select_set(True)
bpy.ops.export_scene.gltf(
    filepath='/Users/guits/Documents/temp/public/assets/cars/tesla.glb',
    use_selection=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)
print("EXPORTADO")
