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

# Separacion 100 % programatica (sin operadores de seleccion): por esquina
# se duplica el body y de la copia se borra todo lo que NO esta en el bbox,
# y del body se borra lo que SI esta (las ruedas salen limpias del resto).
def _in_wheelbox(co, sx, sz):
    return (0.14 < sx * co.x < 0.22) and co.y < 0.16 and (0.22 < sz * co.z < 0.38)

for sx in (1.0, -1.0):
    for sz in (1.0, -1.0):
        w = src.copy()
        w.data = src.data.copy()
        bpy.context.collection.objects.link(w)
        bm = _bmesh0.new()
        bm.from_mesh(w.data)
        kill = [v for v in bm.verts if not _in_wheelbox(v.co, sx, sz)]
        _bmesh0.ops.delete(bm, geom=kill, context='VERTS')
        nw = len(bm.verts)
        bm.to_mesh(w.data)
        bm.free()
        bm2 = _bmesh0.new()
        bm2.from_mesh(src.data)
        kill2 = [v for v in bm2.verts if _in_wheelbox(v.co, sx, sz)]
        print(f"pasada sx={sx} sz={sz}: rueda={nw}v resto={len(bm2.verts) - len(kill2)}v")
        _bmesh0.ops.delete(bm2, geom=kill2, context='VERTS')
        bm2.to_mesh(src.data)
        bm2.free()
        w.name = f"WheelTmp_{sx:+.0f}_{sz:+.0f}"

wheels = [o for o in bpy.data.objects if o.type == 'MESH' and o is not src and o.name.startswith('WheelTmp_')]
print(f"separados: {len(wheels)} objetos rueda")
assert len(wheels) == 4, "no salieron 4 ruedas"

# Limpieza: el bbox arrastra fragmentos sueltos (faldones, detallitos).
# Quedarse solo con la isla conexa principal de cada rueda.
import bmesh as _bmesh

body = src
for w in wheels:
    # semilla = vertice mas cercano al centro esperado de rueda (frame local)
    sx = 1.0 if sum(v.co.x for v in w.data.vertices) / len(w.data.vertices) > 0 else -1.0
    sz = 1.0 if sum(v.co.z for v in w.data.vertices) / len(w.data.vertices) > 0 else -1.0
    seed_pt = Vector((sx * 0.18, 0.075, sz * 0.30))
    bpy.ops.object.select_all(action='DESELECT')
    w.select_set(True)
    bpy.context.view_layer.objects.active = w
    bpy.ops.object.mode_set(mode='EDIT')
    bm = _bmesh.from_edit_mesh(w.data)
    bm.verts.ensure_lookup_table()
    seed = min(bm.verts, key=lambda v: (v.co - seed_pt).length)
    seen = {seed}
    stack = [seed]
    while stack:
        u = stack.pop()
        for e in u.link_edges:
            x = e.other_vert(u)
            if x not in seen:
                seen.add(x)
                stack.append(x)
    for v in bm.verts:
        v.select = v not in seen
    _bmesh.update_edit_mesh(w.data)
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"  {w.name}: {len(seen)} verts de isla principal")
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
