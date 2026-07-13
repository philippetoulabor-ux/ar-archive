"""Export individual Home objects as GLB files for AR Archive."""
import bpy
import os

BLEND_PATH = os.environ.get(
    'WEBROOM_BLEND',
    os.path.expanduser('~/Desktop/webroom.blend'),
)
OUTPUT_DIR = os.path.join(
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..')),
    'public',
    'models',
)

# Blender object names (in .blend) → output filename
EXPORTS = [
    ('middleman.glb', ['middleman', 'mm-bretter']),
    ('ls-candle.glb', ['ls-candle']),
    ('alien-chair.glb', ['alien chair']),
    ('x-bock-couch.glb', ['x-bock couch']),
    ('weblampe.glb', ['weblampe']),
    ('speaker-module.glb', ['speaker module']),
    ('glowing-puppe.glb', ['glowing puppe']),
    ('grillz-poster.glb', ['grillz poster']),
    ('laptop.glb', ['Mesh_0.001']),
    ('regalbretter.glb', ['Regalbretter.001', 'Regalbretter.002']),
    ('regal-bild.glb', ['regal (bild)']),
]


def deselect_all():
    bpy.ops.object.select_all(action='DESELECT')


def select_objects(names):
    found = []
    missing = []
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is None:
            missing.append(name)
            continue
        obj.select_set(True)
        found.append(obj)
    return found, missing


def export_selection(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_lights=False,
        export_cameras=False,
    )


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if bpy.data.filepath != BLEND_PATH and os.path.isfile(BLEND_PATH):
        bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)

    all_names = sorted({name for _, names in EXPORTS for name in names})
    print('Available mesh objects:')
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type == 'MESH':
            print(f'  {obj.name}')

    failed = False
    for filename, object_names in EXPORTS:
        filepath = os.path.join(OUTPUT_DIR, filename)
        deselect_all()
        found, missing = select_objects(object_names)
        if missing:
            print(f'FAIL {filename}: missing objects {missing}')
            failed = True
            continue
        if not found:
            print(f'FAIL {filename}: no objects selected')
            failed = True
            continue

        bpy.context.view_layer.objects.active = found[0]
        export_selection(filepath)
        size_kb = os.path.getsize(filepath) / 1024
        print(f'OK   {filename} ({size_kb:.0f} KB) — {object_names}')

    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
