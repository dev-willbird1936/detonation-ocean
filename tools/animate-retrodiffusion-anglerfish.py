"""Add hand-authored motion to the provider's rigid-node rig, without API calls."""

import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ui/abyss/models/ps1-anglerfish/retrodiffusion"
SOURCE = OUT / "anglerfish.glb"
TARGET = OUT / "anglerfish-custom.glb"
CUSTOM = {"Hover_Idle": 3.0, "Cruise_Swim": 1.2, "Bite_Snap": 0.85}


def read_glb(path):
    raw = path.read_bytes()
    magic, version, size = struct.unpack_from("<III", raw)
    assert magic == 0x46546C67 and version == 2 and size == len(raw)
    length = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20 : 20 + length])
    offset = 20 + length
    length, kind = struct.unpack_from("<II", raw, offset)
    assert kind == 0x004E4942
    return doc, bytearray(raw[offset + 8 : offset + 8 + length])


def multiply(a, b):
    x, y, z, w = a
    u, v, t, s = b
    return (
        w * u + x * s + y * t - z * v,
        w * v - x * t + y * s + z * u,
        w * t + x * v - y * u + z * s,
        w * s - x * u - y * v - z * t,
    )


def quaternion(axis, angle):
    value = [0.0, 0.0, 0.0, math.cos(angle / 2)]
    value[axis] = math.sin(angle / 2)
    return value


def keyed(t, points):
    for (start, a), (end, b) in zip(points, points[1:]):
        if start <= t <= end:
            u = (t - start) / (end - start)
            u = u * u * (3 - 2 * u)
            return a + (b - a) * u
    return points[-1][1]


def generate():
    doc, blob = read_glb(SOURCE)
    nodes = doc["nodes"]
    controls = {
        node["name"]: i
        for i, node in enumerate(nodes)
        if "mesh" not in node and "extensions" not in node
    }
    expected = [
        "root",
        "jaw",
        "tail",
        "tailfin",
        "pectoral_l",
        "pectoral_r",
        "pelvic_l",
        "pelvic_r",
        "lure_stalk",
        "bulb",
    ]
    assert all(name in controls for name in expected)
    parents = {
        child: i for i, node in enumerate(nodes) for child in node.get("children", [])
    }
    assert parents[controls["tailfin"]] == controls["tail"]
    assert parents[controls["bulb"]] == controls["lure_stalk"]
    jaw = controls["jaw"]
    assert all(
        parents[i] == jaw for i, n in enumerate(nodes) if n["name"].startswith("ltooth")
    )
    assert all(
        parents[i] == controls["root"]
        for i, n in enumerate(nodes)
        if n["name"].startswith("utooth")
    )

    # Provider's bulb light was a static scene sibling. Attach it at its existing
    # world position so it follows both the lure and whole fish, without a jump.
    def world_position(i):
        value = list(nodes[i].get("translation", [0, 0, 0]))
        while i in parents:
            i = parents[i]
            assert nodes[i].get("rotation", [0, 0, 0, 1]) == [0, 0, 0, 1]
            value = [
                a + b for a, b in zip(value, nodes[i].get("translation", [0, 0, 0]))
            ]
        return value

    bulb = controls["bulb"]
    fixed_lights = []
    for i, node in enumerate(nodes):
        if "KHR_lights_punctual" in node.get("extensions", {}) and i not in parents:
            old = world_position(i)
            base = world_position(bulb)
            node["translation"] = [a - b for a, b in zip(old, base)]
            nodes[bulb].setdefault("children", []).append(i)
            for scene in doc["scenes"]:
                if i in scene["nodes"]:
                    scene["nodes"].remove(i)
            fixed_lights.append(node["name"])

    def accessor(values, shape, bounds=False):
        while len(blob) % 4:
            blob.append(0)
        flat = [x for v in values for x in (v if isinstance(v, (list, tuple)) else [v])]
        offset = len(blob)
        blob.extend(struct.pack("<" + "f" * len(flat), *flat))
        doc["bufferViews"].append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(blob) - offset}
        )
        entry = {
            "bufferView": len(doc["bufferViews"]) - 1,
            "componentType": 5126,
            "count": len(values),
            "type": shape,
        }
        if bounds:
            entry.update(min=[min(values)], max=[max(values)])
        doc["accessors"].append(entry)
        return len(doc["accessors"]) - 1

    added = []
    for clip, duration in CUSTOM.items():
        count = math.ceil(duration * 60) + 1
        times = [duration * i / (count - 1) for i in range(count)]
        time_id = accessor(times, "SCALAR", True)
        samplers, channels = [], []

        def channel(name, path, values, shape):
            samplers.append(
                {
                    "input": time_id,
                    "output": accessor(values, shape),
                    "interpolation": "LINEAR",
                }
            )
            channels.append(
                {
                    "sampler": len(samplers) - 1,
                    "target": {"node": controls[name], "path": path},
                }
            )

        swim = clip == "Cruise_Swim"
        bite = clip == "Bite_Snap"
        amplitude = 0.24 if swim else 0.055 if bite else 0.07
        rotations = [
            ("tail", 1, amplitude, 0),
            ("tailfin", 1, amplitude * 1.35, -0.65),
            ("pectoral_l", 2, 0.15 if swim else 0.045, 0.3),
            ("pectoral_r", 2, -0.15 if swim else -0.045, 0.3),
            ("pelvic_l", 2, 0.045 if swim else 0.018, -0.3),
            ("pelvic_r", 2, -0.045 if swim else -0.018, -0.3),
            ("lure_stalk", 2, 0.045, -0.7),
            ("bulb", 0, 0.045, -1.0),
            ("jaw", 0, 0.012, 0),
            ("root", 2, 0.012 if swim else 0.008, 0),
        ]
        for name, axis, amp, phase in rotations:
            values = []
            rest = nodes[controls[name]].get("rotation", [0, 0, 0, 1])
            for i, t in enumerate(times):
                if bite and name == "jaw":
                    angle = keyed(
                        t / duration,
                        [
                            (0, 0),
                            (0.2, 0.16),
                            (0.4, 0.14),
                            (0.51, -0.30),
                            (0.65, -0.23),
                            (0.85, 0.025),
                            (1, 0),
                        ],
                    )
                else:
                    # Envelope yields a closed periodic trajectory and exact rest
                    # endpoints; avoids pose pops when changing clips.
                    u = t / duration
                    angle = (
                        amp
                        * math.sin(math.tau * u + phase)
                        * math.sin(math.pi * u) ** 2
                    )
                if i in (0, count - 1):
                    angle = 0
                values.append(multiply(rest, quaternion(axis, angle)))
            channel(name, "rotation", values, "VEC4")
        rest = nodes[controls["root"]].get("translation", [0, 0, 0])
        translations = []
        for i, t in enumerate(times):
            u = t / duration
            if bite:
                thrust = keyed(
                    u, [(0, 0), (0.25, -0.015), (0.52, 0.045), (0.7, 0.025), (1, 0)]
                )
                offset = [0, 0, thrust]
            else:
                offset = [0, 0.009 * math.sin(math.tau * u), 0]
            if i in (0, count - 1):
                offset = [0, 0, 0]
            translations.append([a + b for a, b in zip(rest, offset)])
        channel("root", "translation", translations, "VEC3")
        animation = {
            "name": clip,
            "samplers": samplers,
            "channels": channels,
            "extras": {
                "author": "Local hand-authored procedural animation",
                "loop": not bite,
            },
        }
        doc.setdefault("animations", []).append(animation)
        added.append(
            {
                "name": clip,
                "duration": duration,
                "channels": len(channels),
                "loop": not bite,
            }
        )

    doc["buffers"][0]["byteLength"] = len(blob)
    doc.setdefault("extras", {})["custom_animation_notes"] = {
        "original_preserved": True,
        "source": SOURCE.name,
        "light_parent_fix": fixed_lights,
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
    TARGET.write_bytes(data)
    report = {
        "control_nodes": len(controls),
        "mesh_parts": len(doc["meshes"]),
        "skinned_armatures": len(doc.get("skins", [])),
        "added": added,
        "original_clips": ["idle_swim"],
        "fixed_lights": fixed_lights,
        "glb_bytes": len(data),
    }
    (OUT / "custom-animation-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    validate()


def validate():
    original, old_blob = read_glb(SOURCE)
    doc, blob = read_glb(TARGET)
    assert doc["meshes"] == original["meshes"]
    assert doc["materials"] == original["materials"]
    assert doc["animations"][0] == original["animations"][0]
    assert blob[: len(old_blob)] == old_blob

    def decode(idx):
        a = doc["accessors"][idx]
        view = doc["bufferViews"][a["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
        return list(
            struct.iter_unpack(
                "<" + "f" * width,
                blob[view["byteOffset"] : view["byteOffset"] + view["byteLength"]],
            )
        )

    for animation in doc["animations"][1:]:
        for sampler, channel in zip(animation["samplers"], animation["channels"]):
            times = decode(sampler["input"])
            values = decode(sampler["output"])
            assert len(times) == len(values)
            assert all(b[0] > a[0] for a, b in zip(times, times[1:]))
            assert values[0] == values[-1]
            if channel["target"]["path"] == "rotation":
                assert all(abs(sum(x * x for x in q) - 1) < 1e-5 for q in values)
            assert any(
                sum(abs(a - b) for a, b in zip(v, values[0])) > 0.001 for v in values
            )
    print(
        "PASS: original geometry/textures/clip preserved; ordered keyframes, normalized rotations, rest endpoints and nonzero motion"
    )


if __name__ == "__main__":
    generate()
