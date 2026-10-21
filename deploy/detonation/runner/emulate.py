"""Windows PE emulation with Speakeasy (SPEC 6.6 "Emulate"): 30 s and 5 M instructions. The file is loaded, never executed natively.

Prints the Speakeasy report reduced to what the controller maps (backend/detonation/emulator.mjs): api calls, file, registry and
network events per entry point, the error that stopped each entry point, and the instruction and time totals.
"""
import json
import os
import time

import speakeasy
from runnerlib import finish, parse_args

TIMEOUT_SECONDS = 30
MAX_INSTRUCTIONS = 5_000_000
MAX_API_COUNT = 10_000
MAX_LIST = 400
TEXT = 300


def configuration():
    with open(os.path.join(os.path.dirname(speakeasy.__file__), "configs", "default.json"), encoding="utf-8") as handle:
        config = json.load(handle)
    config.update({"timeout": TIMEOUT_SECONDS, "max_instructions": MAX_INSTRUCTIONS, "max_api_count": MAX_API_COUNT})
    config["user"] = {**config["user"], "name": "Dana", "is_admin": False}
    config["env"] = {**config["env"], "userprofile": "C:\\Users\\Dana", "temp": "C:\\Users\\Dana\\AppData\\Local\\Temp\\"}
    config["hostname"] = "dana-pc"
    return config


def text(value):
    return value if isinstance(value, str) else json.dumps(value, default=str)[:TEXT] if isinstance(value, (list, dict)) else str(value)


def reduce_entry(entry):
    network = entry.get("network_events") or {}
    return {
        "type": text(entry.get("ep_type", "")),
        "apis": [
            {"api": text(call.get("api_name", ""))[:80], "args": [text(arg)[:TEXT] for arg in (call.get("args") or [])][:12]}
            for call in (entry.get("apis") or [])[:MAX_LIST * 10]
        ],
        "files": [{key: text(event.get(key, ""))[:TEXT] for key in ("event", "path")} for event in (entry.get("file_access") or [])[:MAX_LIST]],
        "registry": [
            {key: text(event.get(key, ""))[:TEXT] for key in ("event", "path", "value_name", "data")}
            for event in (entry.get("registry_access") or [])[:MAX_LIST]
        ],
        "dns": [{"query": text(event.get("query", ""))[:TEXT]} for event in (network.get("dns") or [])[:MAX_LIST]],
        "traffic": [
            {key: text(event.get(key, ""))[:TEXT] for key in ("server", "port", "proto", "type", "method", "data", "headers")}
            for event in (network.get("traffic") or [])[:MAX_LIST]
        ],
        "instructions": entry.get("instr_count") or 0,
        "error": {key: text(error.get(key, ""))[:TEXT] for key in ("type", "api_name", "last_api", "pc")} if (error := entry.get("error")) else None,
    }


def main():
    args = parse_args()
    started = time.monotonic()
    try:
        emulator = speakeasy.Speakeasy(config=configuration())
        module = emulator.load_module(args.file)
        emulator.run_module(module, all_entrypoints=False)
        report = emulator.get_report()
        entries = [reduce_entry(entry) for entry in report.get("entry_points", [])]
        failure = None
    except Exception as error:  # an unsupported PE, a corrupt one or an emulator fault: reported, never fatal
        entries, failure = [], f"{error.__class__.__name__}: {str(error)[:TEXT]}"
    emulation = {"entryPoints": entries, "instructions": sum(entry["instructions"] for entry in entries), "seconds": round(time.monotonic() - started, 1), "timeoutSeconds": TIMEOUT_SECONDS, "maxInstructions": MAX_INSTRUCTIONS, "failure": failure}
    finish(args, emulation=emulation)


main()
