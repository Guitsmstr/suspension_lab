"""Ruedas del Kwid: neumatico + rin modelados por codigo, sin .blend.

Genera `public/assets/cars/kwid_wheels.glb` con 8 objetos centrados en el
buje y eje en Y (frame Blender Z-up: X=largo, Y=ancho, Z=arriba):

- `Wheel_FL/FR/RL/RR`: neumatico (perfil torneado: flancos, hombros,
  3 surcos; R=0.31, ancho 0.17 = diametro fisico del juego 0.62).
- `Hub_FL/FR/RL/RR`: rin 13" de 5 radios (canasta, pestana, buje,
  4 tuercas, tapon, valvula; 2 materiales: aluminio + oscuro).

El cargador (`loadKwidShell` en `src/render/sportBody.ts`) rota cada pieza
-90 sobre Y al frame del juego, la escala al diametro fisico y la centra
en su propia caja: rin y neumatico quedan concentricos por construccion.

Uso (sin abrir Blender):
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python scripts/kwid_wheels_export.py
"""

import math
from pathlib import Path

import bpy
import bmesh

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "cars" / "kwid_wheels.glb"

# Limpia la escena inicial (cubo, camara, luz del arranque).
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


RUBBER = material("KwidRubber", (0.07, 0.075, 0.08), 0.0, 0.92)
RIM = material("KwidRim", (0.78, 0.80, 0.83), 0.95, 0.32)
DARK = material("KwidDark", (0.10, 0.11, 0.12), 0.6, 0.55)


def lathe_mesh(name, profile, segs):
    """Torno de un perfil (r, y) alrededor del eje Y."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.to_mesh(me)
    bm.free()
    return me


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


# --- Neumatico: flancos con aro protector, hombros redondos, 3 surcos ---
tire_profile = [
    (0.170, -0.062), (0.200, -0.078), (0.236, -0.0835), (0.2385, -0.0815),
    (0.250, -0.085), (0.285, -0.078), (0.272, -0.0805), (0.302, -0.066),
    (0.308, -0.058), (0.3015, -0.035), (0.309, -0.018), (0.3015, 0.0),
    (0.309, 0.018), (0.3015, 0.035), (0.308, 0.058), (0.302, 0.066),
    (0.272, 0.0805), (0.285, 0.078), (0.250, 0.085), (0.2385, 0.0815),
    (0.236, 0.0835), (0.200, 0.078), (0.170, 0.062),
]
tire_me = lathe_mesh("TireL", tire_profile, 64)
tire_me.materials.append(RUBBER)

# --- Rin: canasta + pestana + buje + 5 radios + tuercas + tapon + valvula ---
bm = bmesh.new()


def ring(r, y, n):
    return [bm.verts.new((r * math.cos(2 * math.pi * i / n), y, r * math.sin(2 * math.pi * i / n)))
            for i in range(n)]


barrel = [ring(r, y, 48) for r, y in [(0.164, -0.062), (0.156, -0.02), (0.156, 0.02), (0.164, 0.062)]]
bm.verts.ensure_lookup_table()
for a, b in zip(barrel, barrel[1:]):
    for i in range(48):
        j = (i + 1) % 48
        bm.faces.new((a[i], a[j], b[j], b[i]))

R, t, y0 = 0.160, 0.007, 0.060  # pestana exterior (toro)
lip = []
for i in range(48):
    a = 2 * math.pi * i / 48
    row = []
    for j in range(10):
        b = 2 * math.pi * j / 10
        row.append(bm.verts.new(((R + t * math.cos(b)) * math.cos(a),
                                 y0 + t * math.sin(b),
                                 (R + t * math.cos(b)) * math.sin(a))))
    lip.append(row)
bm.verts.ensure_lookup_table()
for i in range(48):
    nxt = lip[(i + 1) % 48]
    for j in range(10):
        bm.faces.new((lip[i][j], nxt[j], nxt[(j + 1) % 10], lip[i][(j + 1) % 10]))

hub = [ring(0.034, 0.028, 24), ring(0.034, 0.060, 24)]  # buje central
bm.verts.ensure_lookup_table()
for i in range(24):
    j = (i + 1) % 24
    bm.faces.new((hub[0][i], hub[0][j], hub[1][j], hub[1][i]))
cap = bm.verts.new((0, 0.060, 0))
bm.verts.ensure_lookup_table()
for i in range(24):
    bm.faces.new((hub[1][i], hub[1][(i + 1) % 24], cap))

for k in range(5):  # 5 radios trapezoidales
    ang = 2 * math.pi * k / 5
    ca, sa = math.cos(ang), math.sin(ang)
    base = []
    for rr, w, y in [(0.028, -0.021, 0.046), (0.028, 0.021, 0.046),
                     (0.150, -0.030, 0.046), (0.150, 0.030, 0.046),
                     (0.028, -0.021, 0.058), (0.028, 0.021, 0.058),
                     (0.150, -0.030, 0.058), (0.150, 0.030, 0.058)]:
        base.append(bm.verts.new((rr * ca - w * sa, y, rr * sa + w * ca)))
    bm.verts.ensure_lookup_table()
    for ix in [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4),
               (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)]:
        bm.faces.new(tuple(base[i] for i in ix))


def dark_cyl(cx, cz, r, y0, y1, n=10):
    a = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / n), y0,
                       cz + r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    b = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / n), y1,
                       cz + r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    bm.verts.ensure_lookup_table()
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((a[i], a[j], b[j], b[i]))
        f.material_index = 1
    top = bm.verts.new((cx, y1, cz))
    bm.verts.ensure_lookup_table()
    for i in range(n):
        f = bm.faces.new((b[i], b[(i + 1) % n], top))
        f.material_index = 1


for k in range(4):  # tuercas (desfasadas de los radios)
    ang = 2 * math.pi * k / 4 + math.pi / 5
    dark_cyl(0.050 * math.cos(ang), 0.050 * math.sin(ang), 0.011, 0.048, 0.062)
dark_cyl(0, 0, 0.020, 0.058, 0.066, n=20)  # tapon central

n = 8  # valvula inclinada entre radios
va = [bm.verts.new((0.105 + 0.004 * math.cos(2 * math.pi * i / n), 0.040,
                     0.004 * math.sin(2 * math.pi * i / n))) for i in range(n)]
vb = [bm.verts.new((0.115 + 0.004 * math.cos(2 * math.pi * i / n), 0.058,
                     0.004 * math.sin(2 * math.pi * i / n))) for i in range(n)]
bm.verts.ensure_lookup_table()
for i in range(n):
    j = (i + 1) % n
    f = bm.faces.new((va[i], va[j], vb[j], vb[i]))
    f.material_index = 1

rim_me = bpy.data.meshes.new("RimL")
bm.to_mesh(rim_me)
bm.free()
rim_me.materials.append(RIM)
rim_me.materials.append(DARK)

# --- 4 esquinas: izquierda tal cual, derecha con espejo horneado ---
scene = bpy.context.scene
made = []
for suffix, mirror in [("FL", False), ("RL", False), ("FR", True), ("RR", True)]:
    t = bpy.data.objects.new(f"Wheel_{suffix}", tire_me if not mirror else tire_me.copy())
    h = bpy.data.objects.new(f"Hub_{suffix}", rim_me if not mirror else rim_me.copy())
    if mirror:
        for o in (t, h):
            o.rotation_euler = (math.pi, 0, 0)
    scene.collection.objects.link(t)
    scene.collection.objects.link(h)
    made += [t, h]

bpy.ops.object.select_all(action="DESELECT")
for o in made:
    if o.name.endswith(("FR", "RR")):  # espejo ya copiado: hornea la rotacion
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        o.select_set(False)
    smooth(o)

bpy.ops.object.select_all(action="DESELECT")
for o in made:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    use_selection=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
print("EXPORTADO", OUT)
