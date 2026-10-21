"""Original low-poly blue-ringed octopus: pixel atlas, smooth arm skinning, two clips."""

import json
import math
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / "ui/abyss/models/ps1-octopus-comparison"
DEST = OUT / "handmade"
points, triangles, bones = [], [], [("root", (0, 0, 0), None)]


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def unit(v):
    length = math.sqrt(sum(x * x for x in v)) or 1
    return tuple(x / length for x in v)


def vertex(p, uv, joints=(0, 0, 0, 0), weights=(1, 0, 0, 0)):
    points.append((p, uv, joints, weights))
    return len(points) - 1


def face(*ids):
    for k in range(1, len(ids) - 1):
        triangles.append((ids[0], ids[k], ids[k + 1]))


def sphere(center, scale, segments=12, rings=6, palette=None):
    def uv(u, v):
        return (
            (u * 0.735 + 0.005, v * 0.97 + 0.015)
            if palette is None
            else ((100 + palette * 8) / 128, 0.5)
        )

    top = vertex((center[0], center[1] + scale[1], center[2]), uv(0.5, 0))
    bottom = vertex((center[0], center[1] - scale[1], center[2]), uv(0.5, 1))
    grid = []
    for i in range(1, rings):
        row = []
        t = math.pi * i / rings
        for j in range(segments + 1):
            a = math.tau * j / segments
            p = (
                center[0] + scale[0] * math.sin(t) * math.cos(a),
                center[1] + scale[1] * math.cos(t),
                center[2] + scale[2] * math.sin(t) * math.sin(a),
            )
            row.append(vertex(p, uv(j / segments, i / rings)))
        grid.append(row)
    for j in range(segments):
        face(top, grid[0][j + 1], grid[0][j])
        face(bottom, grid[-1][j], grid[-1][j + 1])
    for a, b in zip(grid, grid[1:]):
        for j in range(segments):
            face(a[j], a[j + 1], b[j + 1], b[j])


def arm(index):
    angle = math.tau * index / 8 + math.pi / 8
    path = []
    for i in range(13):
        t = i / 12
        radial = 0.22 + 0.98 * t - 0.10 * max(0, (t - 0.8) / 0.2) ** 2
        turn = angle + 0.33 * t * t
        path.append(
            (
                radial * math.cos(turn),
                0.17
                - 0.19 * math.sin(math.pi * t)
                + 0.24 * max(0, (t - 0.64) / 0.36) ** 2,
                0.05 + radial * math.sin(turn),
            )
        )
    first = len(bones)
    for k, ring in enumerate((0, 4, 8)):
        bones.append(
            (
                f"arm_{index + 1}_{['base', 'mid', 'tip'][k]}",
                path[ring],
                0 if k == 0 else first + k - 1,
            )
        )

    def skin(i):
        section = min(i // 4, 2)
        blend = (i % 4) / 4 if section < 2 else 0
        return (
            (first + section, first + min(section + 1, 2), 0, 0),
            (1 - blend, blend, 0, 0),
        )

    grid = []
    for i, p in enumerate(path):
        tangent = sub(path[min(i + 1, 12)], path[max(i - 1, 0)])
        a = unit(cross(tangent, (0, 1, 0)))
        b = unit(cross(tangent, a))
        radius = 0.10 * (1 - i / 14) ** 0.85 + 0.006
        row = []
        joints, weights = skin(i)
        for j in range(7):
            theta = math.tau * j / 6
            pos = tuple(
                p[k] + radius * (math.cos(theta) * a[k] + math.sin(theta) * b[k])
                for k in range(3)
            )
            row.append(
                vertex(
                    pos, (0.015 + 0.70 * i / 12, 0.05 + 0.9 * j / 6), joints, weights
                )
            )
        grid.append(row)
        if i in (2, 4, 6, 8, 10):
            # Small ivory underside suckers: geometry, not just painted dots.
            center = (p[0], p[1] - radius * 0.94, p[2])
            center_id = vertex(center, (108 / 128, 0.5), joints, weights)
            rim = []
            for j in range(5):
                q = math.tau * j / 5
                rim.append(
                    vertex(
                        (
                            center[0] + radius * 0.38 * math.cos(q),
                            center[1] - 0.004,
                            center[2] + radius * 0.38 * math.sin(q),
                        ),
                        (108 / 128, 0.5),
                        joints,
                        weights,
                    )
                )
            for j in range(5):
                face(center_id, rim[j], rim[(j + 1) % 5])
    for a, b in zip(grid, grid[1:]):
        for j in range(6):
            face(a[j], b[j], b[j + 1], a[j + 1])
    face(*reversed(grid[0][:6]))
    face(*grid[-1][:6])


def texture():
    colors = [(25, 29, 35), (232, 211, 145), (254, 244, 210), (24, 119, 185)]
    raw = bytearray()
    for y in range(64):
        raw.append(0)
        for x in range(128):
            if x >= 96:
                color = colors[(x - 96) // 8]
            else:
                # Staggered, dark-outlined blue rings on an ochre pixel skin.
                cx = ((x + (9 if (y // 16) % 2 else 0)) % 24) - 12
                cy = y % 16 - 8
                distance = (cx / 6) ** 2 + (cy / 4) ** 2
                shade = ((x // 3 + y // 3) % 3 - 1) * 8
                color = (max(0, 190 + shade), max(0, 139 + shade), max(0, 49 + shade))
                if 0.52 < distance < 1.6:
                    color = (18, 49, 70)
                if 0.72 < distance < 1.20:
                    color = (30, 168, 244) if cy < 0 else (18, 107, 205)
            raw.extend((*color, 255))

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 128, 64, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def export():
    blob, views, accessors = bytearray(), [], []

    def add(data, component, shape, bounds=False, target=None):
        while len(blob) % 4:
            blob.append(0)
        flat = [x for v in data for x in (v if isinstance(v, (tuple, list)) else [v])]
        offset = len(blob)
        blob.extend(
            struct.pack("<" + {5126: "f", 5123: "H"}[component] * len(flat), *flat)
        )
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob) - offset}
        if target:
            view["target"] = target
        views.append(view)
        entry = {
            "bufferView": len(views) - 1,
            "componentType": component,
            "count": len(data),
            "type": shape,
        }
        if bounds:
            size = 3 if shape == "VEC3" else 1
            entry.update(
                min=[min(flat[i::size]) for i in range(size)],
                max=[max(flat[i::size]) for i in range(size)],
            )
        accessors.append(entry)
        return len(accessors) - 1

    pos, normals, uvs, joints, weights = [], [], [], [], []
    for ids in triangles:
        normal = unit(
            cross(
                sub(points[ids[1]][0], points[ids[0]][0]),
                sub(points[ids[2]][0], points[ids[0]][0]),
            )
        )
        assert sum(n * n for n in normal) > 0.99
        for idx in ids:
            p, uv, j, w = points[idx]
            pos.append(p)
            normals.append(normal)
            uvs.append(uv)
            joints.append(j)
            weights.append(w)
            assert abs(sum(w) - 1) < 1e-6
    attrs = {
        name: add(data, ctype, shape, name == "POSITION", 34962)
        for name, data, ctype, shape in [
            ("POSITION", pos, 5126, "VEC3"),
            ("NORMAL", normals, 5126, "VEC3"),
            ("TEXCOORD_0", uvs, 5126, "VEC2"),
            ("JOINTS_0", joints, 5123, "VEC4"),
            ("WEIGHTS_0", weights, 5126, "VEC4"),
        ]
    }
    indices = add(list(range(len(pos))), 5123, "SCALAR", target=34963)
    inverse = add(
        [
            (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1)
            for _, p, _ in bones
        ],
        5126,
        "MAT4",
    )
    nodes = []
    for i, (name, p, parent) in enumerate(bones):
        node = {
            "name": name,
            "translation": list(sub(p, bones[parent][1]) if parent is not None else p),
        }
        children = [j for j, b in enumerate(bones) if b[2] == i]
        if children:
            node["children"] = children
        nodes.append(node)
    nodes.append({"name": "Handmade_Octopus", "mesh": 0, "skin": 0})
    animations = []
    for name, duration, amp in [("Idle", 3, 0.10), ("Swim", 2, 0.25)]:
        times = [duration * i / 120 for i in range(121)]
        time_id = add(times, 5126, "SCALAR", True)
        samplers, channels = [], []

        def channel(node, path, data, shape):
            samplers.append(
                {
                    "input": time_id,
                    "output": add(data, 5126, shape),
                    "interpolation": "LINEAR",
                }
            )
            channels.append(
                {"sampler": len(samplers) - 1, "target": {"node": node, "path": path}}
            )

        for arm_i in range(8):
            angle = math.tau * arm_i / 8 + math.pi / 8
            axis = (-math.sin(angle), 0, math.cos(angle))
            for section in range(3):
                values = []
                phase = (arm_i * 0.6 if name == "Idle" else 0) - section * 0.7
                for i, t in enumerate(times):
                    u = t / duration
                    a = (
                        amp
                        * (1 + section * 0.4)
                        * math.sin(math.tau * u + phase)
                        * math.sin(math.pi * u) ** 2
                    )
                    if i in (0, 120):
                        a = 0
                    values.append(
                        (*[v * math.sin(a / 2) for v in axis], math.cos(a / 2))
                    )
                channel(1 + arm_i * 3 + section, "rotation", values, "VEC4")
        channel(
            0,
            "translation",
            [
                (0, 0.016 * math.sin(math.tau * t / duration), 0)
                if i not in (0, 120)
                else (0, 0, 0)
                for i, t in enumerate(times)
            ],
            "VEC3",
        )
        animations.append({"name": name, "samplers": samplers, "channels": channels})
    png = texture()
    while len(blob) % 4:
        blob.append(0)
    views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(png)})
    image_id = len(views) - 1
    blob.extend(png)
    doc = {
        "asset": {
            "version": "2.0",
            "generator": "Original hand-authored procedural blue-ringed octopus",
        },
        "scene": 0,
        "scenes": [{"nodes": [0, len(bones)]}],
        "nodes": nodes,
        "skins": [
            {
                "name": "Octopus_25_bone_skin",
                "joints": list(range(len(bones))),
                "skeleton": 0,
                "inverseBindMatrices": inverse,
            }
        ],
        "meshes": [
            {
                "name": "Octopus",
                "primitives": [
                    {"attributes": attrs, "indices": indices, "material": 0}
                ],
            }
        ],
        "materials": [
            {
                "name": "Ochre_blue_ring_pixel_skin",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "doubleSided": True,
            }
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [
            {"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}
        ],
        "images": [{"bufferView": image_id, "mimeType": "image/png"}],
        "animations": animations,
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": accessors,
        "extras": {
            "license": "CC0-1.0",
            "arms": 8,
            "triangles": len(triangles),
            "description": "Three joints per arm, blended skin weights; original mesh, texture and animation. No API generation.",
        },
    }
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    blob.extend(b"\0" * ((-len(blob)) % 4))
    data = (
        struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(blob))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(blob), 0x004E4942)
        + blob
    )
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "octopus.glb").write_bytes(data)
    (DEST / "palette.png").write_bytes(png)
    variant = {
        "label": "handmade",
        "style": "Original handmade",
        "cost": 0,
        "stats": {"triangles": len(triangles)},
        "bytes": len(data),
        "controls": len(bones),
        "mesh_parts": 1,
        "skins": 1,
        "clips": ["Idle", "Swim"],
    }
    summary = json.loads((OUT / "comparison.json").read_text())
    summary["variants"] = [
        v for v in summary["variants"] if v["label"] != "handmade"
    ] + [variant]
    (OUT / "comparison.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(variant, indent=2))
    print(
        "PASS: eight arms, 25-bone skin, normalized weights, nondegenerate triangles, two clips; one material primitive"
    )


if __name__ == "__main__":
    sphere((0, 0.65, -0.10), (0.36, 0.43, 0.33))
    sphere((0, 0.25, 0.12), (0.29, 0.23, 0.27), 8, 4)
    for sign in (-1, 1):
        sphere((sign * 0.19, 0.33, 0.33), (0.085, 0.08, 0.06), 8, 4, palette=1)
        sphere((sign * 0.19, 0.33, 0.38), (0.045, 0.05, 0.025), 6, 3, palette=0)
    for i in range(8):
        arm(i)
    export()
