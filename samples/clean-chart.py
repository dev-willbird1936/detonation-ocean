# Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
import csv
import os
import sys

if os.environ.get("DETONATION_SANDBOX") != "1" or not os.path.isdir("/home/dana/Documents"):
    sys.exit(0)

path = os.path.join(os.path.expanduser("~"), "Documents", "photos-list.csv")
with open(path, newline="", encoding="utf-8") as handle:
    rows = list(csv.DictReader(handle))

albums = {}
for row in rows:
    albums[row["album"]] = albums.get(row["album"], 0) + 1

print(f"photos: {len(rows)}")
for album, count in sorted(albums.items()):
    print(f"{album}: {count}")
print(f"total size KB: {sum(int(row['size_kb']) for row in rows)}")
