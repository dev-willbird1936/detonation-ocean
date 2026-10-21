"""Image build step: compiles signature-base (Detection Rule License 1.1) into one rule file for static.py. Not run in a container of a job.

    yara_build.py <signature-base yara/ directory> <output .yarc> <summary .json>

A rule whose `license` meta names anything other than the Detection Rule License is dropped (TOOLS.md: "drop rules whose meta licence
differs", which removes the CC BY-NC, Volexity and similar rules); a rule without a licence meta takes the repository's licence. A file
that does not compile alone (it needs a rule of another file, an unknown external or a module this YARA does not have) is dropped whole.
The summary records what was kept and dropped so the image carries the numbers next to the attribution.
"""
import json
import os
import re
import sys

import yara

EXTERNALS = {"filename": "", "filepath": "", "extension": "", "filetype": "", "owner": "", "md5": ""}
RULE_START = re.compile(r"^(?:(?:private|global)[ \t]+)*rule[ \t]+\w+", re.M)
LICENSE = re.compile(r'\blicense\s*=\s*"([^"]*)"', re.I)
DETECTION_RULE_LICENSE = re.compile(r"Detection Rule License", re.I)


def split_rules(source):
    """(header, [rule blocks]): the text before the first rule (imports) and each rule up to the next one."""
    starts = [match.start() for match in RULE_START.finditer(source)]
    if not starts:
        return source, []
    return source[:starts[0]], [source[start:end] for start, end in zip(starts, starts[1:] + [len(source)])]


def main():
    directory, output, summary_path = sys.argv[1:4]
    kept_sources, summary = {}, {"files": 0, "filesKept": 0, "rulesSeen": 0, "rulesKept": 0, "rulesDroppedLicence": 0, "filesDroppedCompile": []}
    for name in sorted(os.listdir(directory)):
        if not name.endswith((".yar", ".yara")):
            continue
        summary["files"] += 1
        with open(os.path.join(directory, name), encoding="utf-8", errors="replace") as handle:
            header, blocks = split_rules(handle.read())
        licensed = []
        for block in blocks:
            summary["rulesSeen"] += 1
            found = LICENSE.search(block)
            if found and not DETECTION_RULE_LICENSE.search(found.group(1)):
                summary["rulesDroppedLicence"] += 1
                continue
            licensed.append(block)
        if not licensed:
            continue
        source = header + "".join(licensed)
        try:
            yara.compile(source=source, externals=EXTERNALS)
        except yara.Error as error:
            summary["filesDroppedCompile"].append({"file": name, "error": str(error)[:120]})
            continue
        kept_sources[re.sub(r"\W", "_", os.path.splitext(name)[0])] = source
        summary["filesKept"] += 1
        summary["rulesKept"] += len(licensed)
    rules = yara.compile(sources=kept_sources, externals=EXTERNALS)
    rules.save(output)
    with open(summary_path, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)
    print(json.dumps({key: value for key, value in summary.items() if key != "filesDroppedCompile"} | {"filesDroppedCompile": len(summary["filesDroppedCompile"])}))


if __name__ == "__main__":
    main()
