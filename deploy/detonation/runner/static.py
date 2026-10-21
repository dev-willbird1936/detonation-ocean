"""Static analysis (SPEC 6.6 "Static"): capa capabilities and YARA matches. Twilight signals only; mapped by backend/detonation/static.mjs.

capa runs on PE files (rules capa-rules 9.4.0, rule cache built into the image, no FLIRT signatures: they need over 512 MB) with a time
limit; its absence or failure never blocks YARA. YARA runs the signature-base rule set (Detection Rule License 1.1, built by yara_build.py:
a rule with another licence in its meta is dropped), so a match names the rule and its author. generic.py imports `yara_scan`.

    static.py --kind static --file F [--format pe|other]
"""
import json
import time

import yara
from runnerlib import finish, parse_args, run

RULES = "/opt/capa/rules"
SIGNATURES = "/opt/capa/sigs"
CAPA_CACHE = "/opt/capa-cache"
CAPA = "/opt/static-venv/bin/capa"
YARA_RULES = "/opt/yara/signature-base.yarc"
CAPA_SECONDS = 22
YARA_SECONDS = 15
MAX_CAPA = 60
MAX_YARA = 25
TEXT = 160
# What the rules of signature-base may read at scan time; yara_build.py declares the same names with these defaults.
EXTERNALS = {"filename": "", "filepath": "", "extension": "", "filetype": "", "owner": "", "md5": ""}
FILETYPES = {"pe": "EXE", "elf": "ELF"}


def text(value, size=TEXT):
    return str(value or "")[:size]


def capa_scan(path):
    """`{ok, rules: [{name, namespace, attack: [...], count}], error?, seconds}`; ok is False when capa could not analyse the file."""
    started = time.monotonic()
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp/dt", "XDG_CACHE_HOME": CAPA_CACHE, "TMPDIR": "/tmp/dt/tmp"}
    done = run([CAPA, "-r", RULES, "-s", SIGNATURES, "-j", "-q", path], CAPA_SECONDS, env=env)
    seconds = round(time.monotonic() - started, 1)
    if done["timedOut"]:
        return {"ok": False, "error": "capa did not finish in time", "seconds": seconds, "rules": []}
    if done["code"] != 0:
        return {"ok": False, "error": text(done["stderr"][-200:] or f"capa exited with code {done['code']}", 200), "seconds": seconds, "rules": []}
    try:
        output = done["stdout"]
        start = output.find("{")
        report = json.loads(output[start:] if start >= 0 else output)
    except (ValueError, KeyError):
        return {"ok": False, "error": text(done["stderr"][-200:] or "capa printed no report", 200), "seconds": seconds, "rules": []}
    if not isinstance(report, dict) or not isinstance(report.get("rules"), dict):
        return {"ok": False, "error": "capa returned an invalid report", "seconds": seconds, "rules": []}
    rules = []
    for name, rule in report["rules"].items():
        if not isinstance(rule, dict):
            return {"ok": False, "error": "capa returned an invalid report", "seconds": seconds, "rules": []}
        meta = rule.get("meta", {})
        matches = rule.get("matches", [])
        attack_data = meta.get("attack", []) if isinstance(meta, dict) else None
        if not isinstance(meta, dict) or not isinstance(matches, list) or not isinstance(attack_data, list):
            return {"ok": False, "error": "capa returned an invalid report", "seconds": seconds, "rules": []}
        attack = [text(item.get("id")) for item in attack_data if isinstance(item, dict)]
        rules.append({"name": text(name, 120), "namespace": text(meta.get("namespace"), 120), "attack": attack[:5], "count": len(matches)})
    return {"ok": True, "rules": rules[:MAX_CAPA], "ruleCount": len(rules), "seconds": seconds}


def yara_scan(path, filetype=""):
    """`{ok, matches: [{rule, tags, author, description, reference}], source}`; the compiled rule set is read once."""
    started = time.monotonic()
    try:
        rules = yara.load(YARA_RULES)
        externals = {**EXTERNALS, "filename": "sample", "filepath": "/tmp/dt/sample", "extension": ".bin", "filetype": FILETYPES.get(filetype, filetype.upper())}
        found = rules.match(path, externals=externals, timeout=YARA_SECONDS)
    except Exception as error:  # a rule set that is missing or a scan that fails is reported, not fatal
        return {"ok": False, "error": error.__class__.__name__, "matches": []}
    matches = []
    for match in found[:MAX_YARA]:
        meta = match.meta or {}
        matches.append({
            "rule": text(match.rule, 100), "tags": [text(tag, 40) for tag in match.tags][:6], "author": text(meta.get("author"), 100),
            "description": text(meta.get("description")), "reference": text(meta.get("reference"), 200),
        })
    return {"ok": True, "matches": matches, "matchCount": len(found), "seconds": round(time.monotonic() - started, 1), "ruleset": "signature-base"}


def main():
    args = parse_args(("ext", "format"))
    fmt = args.format or "pe"
    report = {"format": fmt, "capa": capa_scan(args.file) if fmt == "pe" else None, "yara": yara_scan(args.file, fmt)}
    finish(args, static=report)


if __name__ == "__main__":
    main()
