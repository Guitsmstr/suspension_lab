"""Ruedas del Kwid: `kwid.blend` -> `kwid_wheels.glb` (lo que carga el juego).

Fuente unica: `public/assets/cars/kwid.blend` (ver texto `LEEME` dentro del
archivo). Toma `Wheel_FL/FR/RL/RR` (neumatico) y `Hub_FL/FR/RL/RR` (rin, 1 o
2 materiales) modelados en su sitio del coche y genera mallas frescas
centradas en su propia caja (rin y neumatico quedan concentricos), con
transformadas identidad. Sin rotar: el exportador pasa a Y-up y el cargador
(`loadKwidShell` en `src/render/sportBody.ts`) rota -90 sobre Y al frame del
juego, escala al diametro fisico (0.62 m) y cuelga cada pieza de su buje.

No modifica el .blend (trabaja sobre copias en memoria).

Uso (sin abrir Blender):
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python scripts/kwid_wheels_export.py            # ruedas -> kwid_wheels.glb
    /Applications/Blender.app/Contents/MacOS/Blender --background -- \
        --python scripts/kwid_wheels_export.py --body    # + carroceria -> kwid_body.glb

El modo `--body` es la via preparada para cambiar la carroceria: exporta
`Body` al frame del juego (X=ancho, Y=arriba, Z=largo, origen en el CdM,
suelo en y=-0.55) deshaciendo la colocacion visual del archivo (el -0.053
en largo lo aplica el cargador con `KWID_BODY_SHIFT_Z`). OJO: el juego hoy
carga la carroceria desde `kwid_tripo.glb`; usar `kwid_body.glb` requiere
cambiar `KWID_ASSET_URL` en `src/render/sportBody.ts` (un solo punto).
"""

import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "assets" / "cars" / "kwid.blend"
OUT = ROOT / "public" / "assets" / "cars" / "kwid_wheels.glb"
BODY_OUT = ROOT / "public" / "assets" / "cars" / "kwid_body.glb"
WANT_BODY = "--body" in sys.argv

PARTS = [f"{p}_{s}" for s in ("FL", "FR", "RL", "RR") for p in ("Wheel", "Hub")]

bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.view_layer.update()

if WANT_BODY:
    # Archivo (X=largo, Y=ancho, Z=arriba, suelo z=0) -> coords Blender tales
    # que el exportador (x,y,z)->(x,z,-y) deje el frame del juego (X=ancho,
    # Y=arriba, Z=largo, origen CdM): (ancho, -largo, arriba-0.55). El -0.053
    # visual en largo se deshace (lo aplica el cargador).
    src = bpy.data.objects.get("Body")
    assert src is not None and src.type == "MESH", "falta Body en kwid.blend"
    me = bpy.data.meshes.new("Body")
    verts = []
    for v in src.data.vertices:
        w = src.matrix_world @ v.co
        verts.append((w.y, -(w.x + 0.053), w.z - 0.55))
    me.from_pydata(verts, [], [tuple(p.vertices) for p in src.data.polygons])
    me.update()
    for mat in src.data.materials:
        me.materials.append(mat)
    for poly_src, poly_dst in zip(src.data.polygons, me.polygons):
        poly_dst.material_index = poly_src.material_index
        poly_dst.use_smooth = poly_src.use_smooth
    for o in [o for o in bpy.data.objects if o.name != "Body"]:
        bpy.data.objects.remove(o, do_unlink=True)
    ob = bpy.data.objects.new("Body", me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=str(BODY_OUT),
        use_selection=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print("EXPORTADO", BODY_OUT)
    raise SystemExit(0)

fresh = []
for name in PARTS:
    src = bpy.data.objects.get(name)
    assert src is not None and src.type == "MESH", f"falta {name} en kwid.blend (ver LEEME)"
    ws = [src.matrix_world @ v.co for v in src.data.vertices]
    lo = Vector((min(c.x for c in ws), min(c.y for c in ws), min(c.z for c in ws)))
    hi = Vector((max(c.x for c in ws), max(c.y for c in ws), max(c.z for c in ws)))
    bc = (lo + hi) / 2
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(w - bc) for w in ws], [], [tuple(p.vertices) for p in src.data.polygons])
    me.update()
    for mat in src.data.materials:
        me.materials.append(mat)
    for poly_src, poly_dst in zip(src.data.polygons, me.polygons):
        poly_dst.material_index = poly_src.material_index
        poly_dst.use_smooth = poly_src.use_smooth
    ob = bpy.data.objects.new(name + "_fresh", me)
    bpy.context.scene.collection.objects.link(ob)
    fresh.append((name, ob))

for o in [o for o in bpy.data.objects if o.name not in PARTS and not o.name.endswith("_fresh")]:
    bpy.data.objects.remove(o, do_unlink=True)
for name, ob in fresh:
    stale = bpy.data.objects.get(name)
    if stale is not None and stale is not ob:
        bpy.data.objects.remove(stale, do_unlink=True)
    ob.name = name

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    use_selection=False,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
print("EXPORTADO", OUT, "objetos:", sorted(name for name, _ in fresh))
