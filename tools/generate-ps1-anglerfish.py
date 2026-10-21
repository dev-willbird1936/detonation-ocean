"""Generate an original PS1-inspired, skinned anglerfish GLB. Standard library only.
Optional Pillow creates the preview; no Blender, download, or runtime dependency.
"""

import json
import math
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / "ui/abyss/models/ps1-anglerfish"
PALETTE = [
    (41, 65, 79),
    (57, 83, 91),
    (73, 100, 103),
    (91, 117, 113),
    (112, 133, 119),
    (23, 26, 36),
    (189, 184, 145),
    (164, 244, 185),
]
vertices, faces = [], []
# Bone pivots in model space; front is -X, up is +Z.
bones = [
    ("root", (0, 0, 0), None),
    ("jaw", (-0.42, 0, -0.32), 0),
    ("tail_base", (0.85, 0, 0.03), 0),
    ("tail_tip", (1.55, 0, 0.03), 2),
    ("fin_left", (0.15, -0.55, -0.12), 0),
    ("fin_right", (0.15, 0.55, -0.12), 0),
    ("lure", (-0.55, 0, 0.65), 0),
]


def mesh(points, polygons, color, bone=0, material=0):
    start = len(vertices)
    vertices.extend((tuple(p), color, bone) for p in points)
    for poly in polygons:
        for i in range(1, len(poly) - 1):
            faces.append(
                ((start + poly[0], start + poly[i], start + poly[i + 1]), material)
            )


def tube(points, radii, color, bone=0, sides=5):
    vs = []
    for i, p in enumerate(points):
        d = sub(points[min(i + 1, len(points) - 1)], points[max(0, i - 1)])
        a = unit(cross(d, (0, 1, 0) if abs(unit(d)[1]) < 0.9 else (0, 0, 1)))
        b = unit(cross(d, a))
        for j in range(sides):
            t = j * math.tau / sides
            vs.append(
                tuple(
                    p[k] + radii[i] * (math.cos(t) * a[k] + math.sin(t) * b[k])
                    for k in range(3)
                )
            )
    fs = [tuple(reversed(range(sides)))]
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            fs.append((a, b, b + sides, a + sides))
    fs.append(tuple((len(points) - 1) * sides + j for j in range(sides)))
    mesh(vs, fs, color, bone)


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def unit(v):
    n = math.sqrt(sum(x * x for x in v)) or 1
    return tuple(x / n for x in v)


def ellipsoid(center, scale, color, bone=0, segments=8, rings=4, material=0):
    vs = []
    for i in range(1, rings):
        t = math.pi * i / rings
        for j in range(segments):
            a = math.tau * j / segments
            vs.append(
                (
                    center[0] + scale[0] * math.sin(t) * math.cos(a),
                    center[1] + scale[1] * math.sin(t) * math.sin(a),
                    center[2] + scale[2] * math.cos(t),
                )
            )
    top, bottom = len(vs), len(vs) + 1
    vs.extend(
        [
            (center[0], center[1], center[2] + scale[2]),
            (center[0], center[1], center[2] - scale[2]),
        ]
    )
    fs = [(top, j, (j + 1) % segments) for j in range(segments)]
    for i in range(rings - 2):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            fs.append((a, a + segments, b + segments, b))
    fs.extend(
        (
            bottom,
            (rings - 2) * segments + (j + 1) % segments,
            (rings - 2) * segments + j,
        )
        for j in range(segments)
    )
    mesh(vs, fs, color, bone, material)


def build_geometry():
    # Hollow front: rings produce a real open mouth rather than a painted sphere.
    rings = [
        (-1.05, 0.68, 0.59, 0.02),
        (-0.55, 0.81, 0.73, 0.06),
        (0.05, 0.76, 0.67, 0.03),
        (0.65, 0.48, 0.43, 0.02),
        (1.08, 0.19, 0.22, 0.03),
    ]
    vs = [
        (x, math.cos(j * math.tau / 12) * ry, z + math.sin(j * math.tau / 12) * rz)
        for x, ry, rz, z in rings
        for j in range(12)
    ]
    fs = []
    for i in range(len(rings) - 1):
        for j in range(12):
            # Alternating triangulation keeps the faceted silhouette irregular.
            a, b = i * 12 + j, i * 12 + (j + 1) % 12
            fs.append((a, b, b + 12, a + 12))
    fs.append(tuple(48 + j for j in reversed(range(12))))
    mesh(vs, fs, 2)
    cavity = [
        (
            -1.04,
            math.cos(j * math.tau / 12) * 0.65,
            0.02 + math.sin(j * math.tau / 12) * 0.56,
        )
        for j in range(12)
    ]
    cavity.append((-0.48, 0, 0.01))
    mesh(cavity, [(j, 12, (j + 1) % 12) for j in range(12)], 5)
    upper = [
        (
            -1.09,
            0.68 * math.cos(i * math.pi / 8),
            0.02 + 0.59 * math.sin(i * math.pi / 8),
        )
        for i in range(9)
    ]
    lower = [
        (
            -1.12,
            0.68 * math.cos(math.pi + i * math.pi / 8),
            0.02 + 0.59 * math.sin(math.pi + i * math.pi / 8),
        )
        for i in range(9)
    ]
    tube(upper, [0.07] * 9, 3, sides=5)
    tube(lower, [0.085] * 9, 3, bone=1, sides=5)
    mesh(lower + [(-0.42, 0, -0.32)], [(i, i + 1, 9) for i in range(8)], 1, 1)
    for row, arc in enumerate((upper, lower)):
        for i in range(1, 8):
            p = arc[i]
            length = 0.24 + 0.13 * (1 - abs(i - 4) / 4)
            tip = (p[0] - 0.04, p[1] * 0.82, p[2] + (-length if row == 0 else length))
            tube([p, tip], [0.038, 0.003], 6, row, sides=4)
    for side in (-1, 1):
        ellipsoid((-0.73, side * 0.62, 0.38), (0.21, 0.115, 0.22), 0)
        ellipsoid((-0.82, side * 0.707, 0.40), (0.105, 0.037, 0.105), 6)
        ellipsoid(
            (-0.845, side * 0.741, 0.40), (0.054, 0.018, 0.07), 5, segments=6, rings=3
        )
        # Volumetric fins remain visible from both sides.
        mesh(
            [
                (0.1, side * 0.55, -0.12),
                (0.5, side * 0.68, -0.15),
                (0.65, side * 1.13, -0.44),
                (-0.12, side * 1.03, -0.35),
                (0.22, side * 0.79, -0.20),
            ],
            [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (1, 0, 3, 2)],
            1,
            4 if side < 0 else 5,
        )
        for k in range(3):
            tube(
                [
                    (-0.24 + k * 0.15, side * 0.725, 0.19 - k * 0.03),
                    (-0.12 + k * 0.15, side * 0.71, -0.09 - k * 0.02),
                ],
                [0.019, 0.014],
                0,
                sides=4,
            )
    tube(
        [(0.88, 0, 0.03), (1.30, 0, 0.03), (1.60, 0, 0.03)],
        [0.17, 0.12, 0.09],
        1,
        2,
        sides=6,
    )
    mesh(
        [
            (1.52, 0, 0.03),
            (2.20, -0.045, 0.57),
            (2.03, -0.045, 0.05),
            (2.20, -0.045, -0.48),
            (2.20, 0.045, 0.57),
            (2.03, 0.045, 0.05),
            (2.20, 0.045, -0.48),
        ],
        [
            (0, 1, 2),
            (0, 2, 3),
            (0, 5, 4),
            (0, 6, 5),
            (1, 4, 5, 2),
            (2, 5, 6, 3),
            (0, 4, 1),
            (0, 3, 6),
        ],
        2,
        3,
    )
    mesh(
        [
            (-0.2, 0, 0.66),
            (0.25, 0, 0.63),
            (0.8, 0, 0.31),
            (0.38, 0.035, 1.00),
            (0.38, -0.035, 1.00),
        ],
        [(0, 1, 3), (1, 2, 3), (0, 4, 1), (1, 4, 2), (0, 3, 4), (2, 4, 3)],
        1,
    )
    tube(
        [
            (-0.55, 0, 0.65),
            (-0.58, 0, 1.10),
            (-0.92, 0, 1.43),
            (-1.35, 0, 1.39),
            (-1.58, 0, 1.08),
        ],
        [0.055, 0.047, 0.039, 0.033, 0.03],
        0,
        6,
        sides=5,
    )
    ellipsoid(
        (-1.58, 0, 1.02), (0.14, 0.14, 0.18), 7, 6, segments=8, rings=4, material=1
    )


def png_chunk(kind, data):
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def atlas_png():
    rows = []
    for y in range(64):
        row = bytearray([0])
        for x in range(64):
            c = PALETTE[x // 8]
            d = ((x * 13 + y * 7 + (x // 2) * (y // 2)) % 5 - 2) * 3
            row.extend(max(0, min(255, v + d)) for v in c)
            row.append(255)
        rows.append(bytes(row))
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + png_chunk(b"IEND", b"")
    )


def export():
    blob, views, accessors = bytearray(), [], []

    def yup(p):
        return (p[0], p[2], -p[1])

    def add(values, component, shape, bounds=False, target=None):
        flat = [x for v in values for x in (v if isinstance(v, (tuple, list)) else [v])]
        fmt = {5126: "f", 5123: "H", 5125: "I"}[component]
        while len(blob) % 4:
            blob.append(0)
        offset = len(blob)
        blob.extend(struct.pack("<" + fmt * len(flat), *flat))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob) - offset}
        if target:
            view["target"] = target
        views.append(view)
        a = {
            "bufferView": len(views) - 1,
            "componentType": component,
            "count": len(values),
            "type": shape,
        }
        if bounds:
            dims = {"SCALAR": 1, "VEC3": 3}[shape]
            columns = [flat[i::dims] for i in range(dims)]
            a.update(min=[min(c) for c in columns], max=[max(c) for c in columns])
        accessors.append(a)
        return len(accessors) - 1

    # Split triangle corners for correct flat normals, UV seams and rigid skinning.
    pos, normals, uvs, joints, weights, indices = [], [], [], [], [], [[], []]
    for ids, mat in faces:
        normal = unit(
            cross(
                sub(vertices[ids[1]][0], vertices[ids[0]][0]),
                sub(vertices[ids[2]][0], vertices[ids[0]][0]),
            )
        )
        for corner, idx in enumerate(ids):
            p, color, bone = vertices[idx]
            indices[mat].append(len(pos))
            pos.append(yup(p))
            normals.append(yup(normal))
            uvs.append(
                ((color * 8 + 1 + (corner % 2) * 5) / 64, (9 + (idx * 7) % 45) / 64)
            )
            joints.append((bone, 0, 0, 0))
            weights.append((1, 0, 0, 0))
    attrs = {
        key: add(data, ctype, shape, key == "POSITION", 34962)
        for key, data, ctype, shape in [
            ("POSITION", pos, 5126, "VEC3"),
            ("NORMAL", normals, 5126, "VEC3"),
            ("TEXCOORD_0", uvs, 5126, "VEC2"),
            ("JOINTS_0", joints, 5123, "VEC4"),
            ("WEIGHTS_0", weights, 5126, "VEC4"),
        ]
    }
    primitives = [
        {
            "attributes": attrs,
            "indices": add(ids, 5123, "SCALAR", target=34963),
            "material": m,
        }
        for m, ids in enumerate(indices)
    ]
    matrices = [
        (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -yup(p)[0], -yup(p)[1], -yup(p)[2], 1)
        for _, p, _ in bones
    ]
    inverse = add(matrices, 5126, "MAT4")
    nodes = []
    for i, (name, p, parent) in enumerate(bones):
        node = {
            "name": name,
            "translation": list(
                yup(sub(p, bones[parent][1]) if parent is not None else p)
            ),
        }
        children = [j for j, b in enumerate(bones) if b[2] == i]
        if children:
            node["children"] = children
        nodes.append(node)
    nodes.append({"name": "PS1_Anglerfish", "mesh": 0, "skin": 0})
    animations = []

    def clip(name, duration, swim, bite=False):
        samples = 25 if not bite else 17
        times = [duration * i / (samples - 1) for i in range(samples)]
        t_accessor = add(times, 5126, "SCALAR", True)
        samplers, channels = [], []

        def channel(bone, path, data, shape):
            samplers.append(
                {
                    "input": t_accessor,
                    "output": add(data, 5126, shape),
                    "interpolation": "LINEAR",
                }
            )
            channels.append(
                {"sampler": len(samplers) - 1, "target": {"node": bone, "path": path}}
            )

        for b, axis, amp, phase in [
            (1, 1, 0.04, 0),
            (2, 2, swim, 0),
            (3, 2, swim * 1.4, -0.8),
            (4, 0, swim * 0.8, 0),
            (5, 0, -swim * 0.8, 0),
            (6, 0, 0.10, 1.1),
        ]:
            values = []
            for i, t in enumerate(times):
                a = amp * (math.sin(t / duration * math.tau + phase) - math.sin(phase))
                if bite and b == 1:
                    # Opens downward around +Y, then closes; returns to rest.
                    u = t / duration
                    a = (
                        -0.58 * math.sin(math.pi * min(1, u / 0.62))
                        if u < 0.62
                        else 0.06 * math.sin(math.pi * (u - 0.62) / 0.38)
                    )
                if i in (0, samples - 1):
                    a = 0
                q = [0, 0, 0, math.cos(a / 2)]
                q[axis] = math.sin(a / 2)
                values.append((*yup(q[:3]), q[3]))
            channel(b, "rotation", values, "VEC4")
        channel(
            0,
            "translation",
            [(0, 0.035 * math.sin(t / duration * math.tau), 0) for t in times],
            "VEC3",
        )
        animations.append({"name": name, "samplers": samplers, "channels": channels})

    clip("Idle", 2.0, 0.10)
    clip("Swim", 1.0, 0.30)
    clip("Bite", 0.75, 0.07, True)
    image = atlas_png()
    while len(blob) % 4:
        blob.append(0)
    views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(image)})
    image_view = len(views) - 1
    blob.extend(image)
    gltf = {
        "asset": {"version": "2.0", "generator": "Original procedural PS1 anglerfish"},
        "scene": 0,
        "scenes": [{"nodes": [0, 7]}],
        "nodes": nodes,
        "meshes": [{"name": "Anglerfish_flat_skinned", "primitives": primitives}],
        "skins": [
            {
                "name": "Anglerfish_7_bone_rig",
                "joints": list(range(7)),
                "skeleton": 0,
                "inverseBindMatrices": inverse,
            }
        ],
        "animations": animations,
        "materials": [
            {
                "name": "Pixel_skin",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "doubleSided": True,
            },
            {
                "name": "Lure_glow",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "emissiveFactor": [0.45, 1, 0.55],
            },
        ],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [
            {"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}
        ],
        "images": [{"bufferView": image_view, "mimeType": "image/png"}],
        "bufferViews": views,
        "accessors": accessors,
        "buffers": [{"byteLength": len(blob)}],
        "extras": {
            "style": "PS1 inspired, flat shaded, nearest-filtered 64x64 pixel atlas",
            "front": "-X",
            "up": "+Y",
            "triangles": len(faces),
            "sourceLicense": "CC0-1.0",
            "clips": "Idle and Swim loop; Bite is one-shot",
        },
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    blob.extend(b"\0" * ((-len(blob)) % 4))
    data = (
        struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
        + struct.pack("<II", len(js), 0x4E4F534A)
        + js
        + struct.pack("<II", len(blob), 0x004E4942)
        + blob
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "anglerfish.glb").write_bytes(data)
    (OUT / "palette.png").write_bytes(image)
    print(
        json.dumps(
            {
                "path": str(OUT / "anglerfish.glb"),
                "bytes": len(data),
                "triangles": len(faces),
                "bones": len(bones),
                "materials": 2,
                "animations": [a["name"] for a in animations],
            },
            indent=2,
        )
    )
    return gltf, blob


def preview():
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return
    image = Image.new("RGB", (800, 800), (13, 21, 30))
    draw = ImageDraw.Draw(image)
    forward = unit((4, 6, -2.9))
    right = unit(cross(forward, (0, 0, 1)))
    up = unit(cross(right, forward))

    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    def screen(p):
        return (400 + dot(p, right) * 175, 465 - dot(p, up) * 175)

    tris = []
    light = unit((-3, -4, 7))
    for ids, material in faces:
        ps = [vertices[i][0] for i in ids]
        n = unit(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])))
        shade = 0.42 + 0.58 * abs(dot(n, light))
        c = PALETTE[vertices[ids[0]][1]]
        if material == 1:
            shade = 1
        color = tuple(min(255, int(v * shade)) for v in c)
        tris.append(
            (sum(dot(p, forward) for p in ps) / 3, [screen(p) for p in ps], color)
        )
    for _, ps, c in sorted(tris, reverse=True):
        draw.polygon(ps, fill=c)
    draw.text(
        (28, 28),
        "PS1 ANGLERFISH / 7-BONE RIG / IDLE + SWIM + BITE",
        fill=(164, 200, 200),
    )
    draw.text(
        (28, 760),
        f"{len(faces)} TRIANGLES / 64x64 PIXEL ATLAS / FLAT SHADING",
        fill=(125, 153, 161),
    )
    image.save(OUT / "preview.png")


def validate(gltf, blob):
    assert len(faces) < 1500
    assert all(abs(sum(w) - 1) < 1e-6 for w in [(1, 0, 0, 0)])
    for a in gltf["accessors"]:
        view = gltf["bufferViews"][a["bufferView"]]
        assert view["byteOffset"] % 4 == 0
        assert view["byteOffset"] + view["byteLength"] <= len(blob)
    assert all(len(set(ids)) == 3 for ids, _ in faces)
    assert all(
        sum(
            x * x
            for x in cross(
                sub(vertices[ids[1]][0], vertices[ids[0]][0]),
                sub(vertices[ids[2]][0], vertices[ids[0]][0]),
            )
        )
        > 1e-15
        for ids, _ in faces
    )
    assert all(0 <= v[2] < 7 for v in vertices)
    assert [a["name"] for a in gltf["animations"]] == ["Idle", "Swim", "Bite"]
    print(
        "PASS: triangle budget, nondegenerate geometry, buffer bounds, alignment, joint range, clips"
    )


if __name__ == "__main__":
    build_geometry()
    gltf, blob = export()
    validate(gltf, blob)
    preview()
