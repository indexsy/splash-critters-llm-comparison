"""Start isolated evaluation servers. PIDs and output are saved for cleanup."""
from pathlib import Path
import os
import subprocess
import json
import signal
import sys

root = Path(__file__).resolve().parents[2]
temp = Path('/var/folders/7v/dtpvhs8x0n1d3_7vfccbrbvw0000gn/T/opencode') / 'splash-oct21'
temp.mkdir(exist_ok=True)
if '--stop' in sys.argv:
    saved = temp / 'pids.json'
    if saved.exists():
        for process in json.loads(saved.read_text()):
            try:
                os.killpg(process['pid'], signal.SIGTERM)
            except ProcessLookupError:
                pass
        saved.unlink()
    raise SystemExit(0)
processes = []
for name, port, command in [
    ('minimax', 4317, ['npm', 'start']),
    ('deepseek-v4.1-flash', 4318, ['npm', 'start']),
    ('glm-oct21', 4319, ['npm', 'start']),
    ('glm-oct21', 4320, ['npm', 'run', 'dev', '-w', 'packages/client', '--', '--host', '127.0.0.1', '--port', '4320']),
]:
    data = temp / name
    data.mkdir(exist_ok=True)
    with (root / 'comparison' / 'logs' / f'{name}-server-{port}.log').open('w') as log:
        process = subprocess.Popen(command, cwd=root / 'results' / name,
                                   env={**os.environ, 'PORT': str(port), 'DATA_DIR': str(data)},
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    processes.append({'name': name, 'port': port, 'pid': process.pid})
(temp / 'pids.json').write_text(json.dumps(processes))
print(json.dumps(processes, indent=2))
