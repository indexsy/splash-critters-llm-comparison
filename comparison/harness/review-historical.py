"""Targeted historical-score verification, preserving the original evaluation logs."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TEMP = Path('/var/folders/7v/dtpvhs8x0n1d3_7vfccbrbvw0000gn/T/opencode') / 'splash-score-review'
MODELS = ['fable-5', 'gpt-6-astra', 'opus-5.5', 'opus-5', 'grok-4.7']
TEMP.mkdir(exist_ok=True)
command = sys.argv[1] if len(sys.argv) > 1 else 'checks'

if command == 'checks':
    def check(name):
        results = {'name': name}
        with (ROOT / 'comparison/logs' / f'score-review-{name}.txt').open('w') as log:
            log.write('2026-10-21 score review. Existing installed dependencies; build then test.\n')
            for phase in ['build', 'test']:
                args = ['npm', 'run', phase]
                log.write(f'\n--- {args}\n')
                log.flush()
                process = subprocess.Popen(args, cwd=ROOT / 'results' / name, stdout=log, stderr=log,
                                           start_new_session=True)
                try:
                    results[phase] = process.wait(timeout=180)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait()
                    results[phase] = 'timeout'
                log.write(f'RESULT {phase}={results[phase]}\n')
                log.flush()
        print(json.dumps(results), flush=True)
        return results
    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(check, MODELS))
    (ROOT / 'comparison/logs/score-review-checks.json').write_text(json.dumps(result, indent=2))
elif command == 'start':
    processes = []
    for index, name in enumerate(MODELS):
        port = 4410 + index
        data = TEMP / name
        data.mkdir(exist_ok=True)
        with (ROOT / 'comparison/logs' / f'score-review-server-{name}.txt').open('w') as log:
            process = subprocess.Popen(['npm', 'start'], cwd=ROOT / 'results' / name,
                                       env={**os.environ, 'PORT': str(port), 'DATA_DIR': str(data)},
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        processes.append({'name': name, 'port': port, 'pid': process.pid})
    (TEMP / 'pids.json').write_text(json.dumps(processes))
    print(json.dumps(processes, indent=2))
elif command == 'stop':
    saved = TEMP / 'pids.json'
    if saved.exists():
        for process in json.loads(saved.read_text()):
            try:
                os.killpg(process['pid'], signal.SIGTERM)
            except ProcessLookupError:
                pass
        saved.unlink()
else:
    raise SystemExit('Expected checks, start, or stop')
