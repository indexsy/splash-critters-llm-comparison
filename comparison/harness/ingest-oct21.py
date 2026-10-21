"""Import the three 2026-10-21 archives without changing submission source."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
SUBMISSIONS = [
    (Path.home() / "minimax.zip", "minimax/", "minimax"),
    (Path.home() / "deepseekv4.1flash.zip", "deepseekv4.1flash/", "deepseek-v4.1-flash"),
    (Path.home() / "GLM.zip", "GLM/splash-critters/", "glm-oct21"),
]

manifest = []
verify = '--verify' in sys.argv
for archive, prefix, name in SUBMISSIONS:
    destination = ROOT / "results" / name
    if destination.exists() and not verify:
        raise SystemExit(f"Refusing to overwrite {destination}")
    count = 0
    with ZipFile(archive) as z:
        for entry in z.infolist():
            if entry.is_dir() or not entry.filename.startswith(prefix):
                continue
            relative = PurePosixPath(entry.filename[len(prefix):])
            if (not relative.parts or relative.is_absolute() or ".." in relative.parts
                    or any(p in {"node_modules", "dist", ".git", "__MACOSX", "tmp"}
                           for p in relative.parts)
                    or relative.parts[0] == "deepseekv4.1flash"
                    or relative.name == ".DS_Store" or relative.name.startswith("._")
                    or relative.name.endswith((".zip", ".tsbuildinfo", ".db", ".db-wal", ".db-shm"))):
                continue
            target = destination.joinpath(*relative.parts)
            if verify:
                if '--restore-locks' in sys.argv and relative.name == 'package-lock.json':
                    target.write_bytes(z.read(entry))
                if not target.exists() or target.read_bytes() != z.read(entry):
                    raise SystemExit(f"Source mismatch: {target}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(entry))
            count += 1
    manifest.append({"archive": archive.name, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                     "prefix": prefix, "result": name, "source_files": count})
print(json.dumps(manifest, indent=2))
