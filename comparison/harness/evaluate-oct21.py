"""Clean-source build gauntlet; run once per imported submission."""
from pathlib import Path
import os
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
name = sys.argv[1]
cwd = root / "results" / name
log = root / "comparison" / "logs" / f"{name}.log"
with log.open("w") as out:
    out.write(f"Submission: {name}\nDate: 2026-10-21\n")
    out.write(subprocess.check_output(["node", "--version"], text=True))
    for label, command, timeout in [
        ("install", ["npm", "install", "--no-audit", "--no-fund"], 360),
        ("test", ["npm", "test"], 240),
        ("build", ["npm", "run", "build"], 240),
        ("soak", ["npm", "run", "soak"], 120),
    ]:
        out.write(f"\n--- {label}: {' '.join(command)}\n")
        out.flush()
        start = time.monotonic()
        code = -1
        process = subprocess.Popen(command, cwd=cwd, stdout=out, stderr=out,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
            result = "PASS" if code == 0 else f"FAIL (exit {code})"
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(process.pid, signal.SIGTERM)
            process.wait()
            result = "TIMEOUT"
        out.write(f"RESULT {label}={result}; elapsed={time.monotonic()-start:.1f}s\n")
        out.flush()
        print(f"{name}: {label}={result}", flush=True)
        if label == "install" and code != 0:
            break
